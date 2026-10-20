#!/usr/bin/env node
/**
 * Build data/movies.json from IMDb's official non-commercial datasets.
 *
 *   https://developer.imdb.com/non-commercial-datasets/
 *   Files live at https://datasets.imdbws.com/ and are refreshed daily.
 *
 * Usage:
 *   node scripts/build-data.mjs [options]
 *
 * Options:
 *   --guess-min-votes N   Minimum votes for a movie to be guessable (default 25000)
 *   --answer-min-votes N  Minimum votes for a movie to be a daily answer (default 150000)
 *   --min-year N          Skip movies released before this year (default: none)
 *   --max-cast N          How many actors to keep per movie (default 4)
 *   --cache-dir DIR       Download the .tsv.gz files here and reuse them next run
 *   --from-dir DIR        Read the .tsv.gz files from a directory you downloaded yourself
 *   --out FILE            Output path (default data/movies.json)
 *
 * Without --cache-dir / --from-dir the files are streamed straight from IMDb and
 * never touch the disk. title.principals is ~700MB compressed, so expect a few
 * minutes on a normal connection.
 */
import { createGunzip } from 'node:zlib';
import { createInterface } from 'node:readline';
import { createReadStream, createWriteStream, existsSync, mkdirSync, renameSync, writeFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const BASE_URL = 'https://datasets.imdbws.com/';

const args = parseArgs(process.argv.slice(2));
const GUESS_MIN_VOTES = int(args['guess-min-votes'], 25000);
const ANSWER_MIN_VOTES = int(args['answer-min-votes'], 150000);
const MIN_YEAR = int(args['min-year'], 0);
const MAX_CAST = int(args['max-cast'], 4);
const CACHE_DIR = args['cache-dir'] || null;
const FROM_DIR = args['from-dir'] || null;
const OUT = args.out || path.join('data', 'movies.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[key] = next;
      i++;
    } else {
      out[key] = true;
    }
  }
  return out;
}

function int(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got ${v}`);
  return n;
}

function log(...parts) {
  console.error(new Date().toISOString().slice(11, 19), ...parts);
}

/** Open a dataset as an async iterator of lines (header skipped). */
async function* lines(name) {
  let input;
  if (FROM_DIR) {
    const file = path.join(FROM_DIR, name);
    if (!existsSync(file)) throw new Error(`Missing ${file}`);
    input = createReadStream(file);
  } else if (CACHE_DIR) {
    mkdirSync(CACHE_DIR, { recursive: true });
    const file = path.join(CACHE_DIR, name);
    if (!existsSync(file)) {
      log(`downloading ${name} -> ${file}`);
      const res = await fetch(BASE_URL + name);
      if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
      const tmp = file + '.part';
      await pipeline(Readable.fromWeb(res.body), createWriteStream(tmp));
      renameSync(tmp, file);
    }
    input = createReadStream(file);
  } else {
    log(`streaming ${name}`);
    const res = await fetch(BASE_URL + name);
    if (!res.ok) throw new Error(`${name}: HTTP ${res.status}`);
    input = Readable.fromWeb(res.body);
  }
  const rl = createInterface({ input: input.pipe(createGunzip()), crlfDelay: Infinity });
  let first = true;
  let count = 0;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    count++;
    if (count % 2_000_000 === 0) log(`  ${name}: ${count.toLocaleString()} rows`);
    yield line;
  }
  log(`  ${name}: done (${count.toLocaleString()} rows)`);
}

const NULL = '\\N';
const field = (v) => (v === NULL ? null : v);

async function main() {
  log('config', { GUESS_MIN_VOTES, ANSWER_MIN_VOTES, MIN_YEAR, MAX_CAST, OUT });

  // 1. Ratings: keep everything with enough votes. Small file, read first so the
  //    big files can be filtered against a Set.
  const ratings = new Map(); // tconst -> { rating, votes }
  for await (const line of lines('title.ratings.tsv.gz')) {
    const [tconst, averageRating, numVotes] = line.split('\t');
    const votes = Number(numVotes);
    if (votes >= GUESS_MIN_VOTES) ratings.set(tconst, { rating: Number(averageRating), votes });
  }
  log(`${ratings.size.toLocaleString()} titles with >= ${GUESS_MIN_VOTES} votes`);

  // 2. Basics: keep feature films only.
  const movies = new Map(); // tconst -> movie
  for await (const line of lines('title.basics.tsv.gz')) {
    const tab = line.indexOf('\t');
    const tconst = line.slice(0, tab);
    const r = ratings.get(tconst);
    if (!r) continue;
    const [, titleType, primaryTitle, originalTitle, isAdult, startYear, , runtimeMinutes, genres] = line.split('\t');
    if (titleType !== 'movie' || isAdult !== '0') continue;
    const year = Number(field(startYear));
    if (!year || year < MIN_YEAR) continue;
    const genreList = field(genres) ? genres.split(',') : [];
    if (genreList.length === 0) continue;
    const runtime = Number(field(runtimeMinutes)) || null;
    if (runtime !== null && runtime < 60) continue; // skip shorts that slipped through
    movies.set(tconst, {
      id: tconst,
      title: primaryTitle,
      originalTitle: originalTitle !== primaryTitle ? originalTitle : undefined,
      year,
      rating: r.rating,
      votes: r.votes,
      genres: genreList,
      runtime: runtime ?? undefined,
      directorIds: [],
      castIds: [],
    });
  }
  ratings.clear();
  log(`${movies.size.toLocaleString()} feature films kept`);

  // 3. Crew: directors.
  const neededNames = new Set();
  for await (const line of lines('title.crew.tsv.gz')) {
    const [tconst, directors] = line.split('\t');
    const m = movies.get(tconst);
    if (!m || directors === NULL) continue;
    m.directorIds = directors.split(',').slice(0, 3);
    m.directorIds.forEach((n) => neededNames.add(n));
  }

  // 4. Principals: billed actors, in billing order.
  for await (const line of lines('title.principals.tsv.gz')) {
    const tab = line.indexOf('\t');
    const tconst = line.slice(0, tab);
    const m = movies.get(tconst);
    if (!m) continue;
    const [, ordering, nconst, category] = line.split('\t');
    if (category !== 'actor' && category !== 'actress') continue;
    m.castIds.push([Number(ordering), nconst]);
  }
  for (const m of movies.values()) {
    m.castIds.sort((a, b) => a[0] - b[0]);
    // An actor playing several roles gets one row per role; keep each person once.
    m.castIds = [...new Set(m.castIds.map((x) => x[1]))].slice(0, MAX_CAST);
    m.castIds.forEach((n) => neededNames.add(n));
  }

  // 5. Names.
  const names = new Map();
  for await (const line of lines('name.basics.tsv.gz')) {
    const tab = line.indexOf('\t');
    const nconst = line.slice(0, tab);
    if (!neededNames.has(nconst)) continue;
    const tab2 = line.indexOf('\t', tab + 1);
    names.set(nconst, line.slice(tab + 1, tab2));
  }

  // 6. Assemble.
  const out = [];
  for (const m of movies.values()) {
    out.push({
      id: m.id,
      title: m.title,
      originalTitle: m.originalTitle,
      year: m.year,
      rating: m.rating,
      votes: m.votes,
      genres: m.genres,
      runtime: m.runtime,
      directors: m.directorIds.map((n) => names.get(n)).filter(Boolean),
      cast: m.castIds.map((n) => names.get(n)).filter(Boolean),
      answer: m.votes >= ANSWER_MIN_VOTES ? true : undefined,
    });
  }
  out.sort((a, b) => b.votes - a.votes);

  const answers = out.filter((m) => m.answer).length;
  const result = {
    generatedAt: new Date().toISOString(),
    source: 'IMDb Non-Commercial Datasets (https://developer.imdb.com/non-commercial-datasets/)',
    guessMinVotes: GUESS_MIN_VOTES,
    answerMinVotes: ANSWER_MIN_VOTES,
    movies: out,
  };
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(OUT, JSON.stringify(result));
  log(`wrote ${OUT}: ${out.length.toLocaleString()} guessable movies, ${answers.toLocaleString()} possible answers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
