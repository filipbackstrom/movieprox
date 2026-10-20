#!/usr/bin/env node
/**
 * Build data/artists.json for Musicprox.
 *
 * Sources
 *   - kworb.net "Spotify Most Streamed Artists of All Time": the top 3,000 artists by
 *     total Spotify streams, each with its Spotify artist ID.  https://kworb.net/spotify/artists.html
 *   - Wikidata (CC0): artist type (solo/group), gender, country and genres, matched
 *     exactly on the Spotify artist ID (property P1902).  https://query.wikidata.org/
 *   - kworb.net per-artist pages for each artist's most streamed songs (answer pool only).
 *
 * Usage:
 *   node scripts/build-music-data.mjs [options]
 *
 * Options:
 *   --answer-count N     How many of the top artists may be daily answers (default 1000)
 *   --min-sitelinks N    Daily answers need an article in at least N Wikipedia editions (default 20)
 *   --songs N            Songs to keep per artist (default 5)
 *   --cache-dir DIR      Where downloaded pages are kept (default data/raw/kworb)
 *   --max-age-hours N    Reuse cached pages younger than this (default 72)
 *   --skip-songs         Do not fetch per-artist song pages
 *   --concurrency N      Parallel song-page downloads (default 2, be polite)
 *   --out FILE           Output path (default data/artists.json)
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const UA = 'Movieprox data build (hobby project; https://github.com/filipbackstrom/movieprox)';
const KWORB_ARTISTS = 'https://kworb.net/spotify/artists.html';
const KWORB_SONGS = (id) => `https://kworb.net/spotify/artist/${id}_songs.html`;
const WDQS = 'https://query.wikidata.org/sparql';

const args = parseArgs(process.argv.slice(2));
const ANSWER_COUNT = int(args['answer-count'], 1000);
const MIN_SITELINKS = int(args['min-sitelinks'], 20);
const SONGS_PER_ARTIST = int(args.songs, 5);
const CACHE_DIR = args['cache-dir'] || path.join('data', 'raw', 'kworb');
const MAX_AGE_MS = int(args['max-age-hours'], 72) * 3_600_000;
const SKIP_SONGS = Boolean(args['skip-songs']);
const CONCURRENCY = int(args.concurrency, 2);
const OUT = args.out || path.join('data', 'artists.json');

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
    } else out[key] = true;
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function decodeEntities(s) {
  return s
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)))
    .replace(/&nbsp;/g, ' ')
    .trim();
}
const num = (s) => Number(String(s).replace(/,/g, ''));

/** Fetch text with an on-disk cache. */
async function fetchCached(url, cacheName) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, cacheName);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS) {
    return readFileSync(file, 'utf8');
  }
  for (let attempt = 1; attempt <= 4; attempt++) {
    const res = await fetch(url, { headers: { 'user-agent': UA } });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after') || attempt * 5) * 1000;
      log(`  ${res.status} from ${url}, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`${url}: HTTP ${res.status}`);
    const text = await res.text();
    writeFileSync(file, text);
    return text;
  }
  throw new Error(`${url}: gave up after retries`);
}

// ---------- 1. artist list ----------

function parseArtists(html) {
  // Cells may be empty (an artist with no featured streams has an empty "As feature" cell).
  const re =
    /<td class="text"><div><a href="\/spotify\/artist\/([A-Za-z0-9]+)_songs\.html">([^<]*)<\/a><\/div><\/td>\s*<td>([\d,.]+)<\/td>\s*<td>([\d,.]*)<\/td>\s*<td class="smaller">([\d,.]*)<\/td>\s*<td class="smaller">([\d,.]*)<\/td>\s*<td class="smaller">([\d,.]*)<\/td>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    // Figures on the list page are in millions of streams.
    out.push({
      id: m[1],
      name: decodeEntities(m[2]),
      streams: Math.round(num(m[3]) * 1e6),
      daily: m[4] ? Math.round(num(m[4]) * 1e6) : 0,
      leadStreams: m[5] ? Math.round(num(m[5]) * 1e6) : 0,
    });
  }
  return out;
}

// ---------- 2. Wikidata ----------

async function sparql(query) {
  for (let attempt = 1; attempt <= 5; attempt++) {
    const res = await fetch(WDQS + '?query=' + encodeURIComponent(query), {
      headers: { 'user-agent': UA, accept: 'application/sparql-results+json' },
    });
    if (res.status === 429 || res.status >= 500) {
      const wait = Number(res.headers.get('retry-after') || attempt * 10) * 1000;
      log(`  WDQS ${res.status}, waiting ${wait / 1000}s`);
      await sleep(wait);
      continue;
    }
    if (!res.ok) throw new Error(`WDQS HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`);
    return (await res.json()).results.bindings;
  }
  throw new Error('WDQS: gave up after retries');
}

function wikidataQuery(ids) {
  const values = ids.map((id) => `"${id}"`).join(' ');
  return `
SELECT ?spotify ?item
  (SAMPLE(?itemLabel_) AS ?itemLabel)
  (SAMPLE(?sitelinks_) AS ?sitelinks)
  (GROUP_CONCAT(DISTINCT ?typeLabel; separator="|") AS ?types)
  (GROUP_CONCAT(DISTINCT ?genderLabel; separator="|") AS ?genders)
  (GROUP_CONCAT(DISTINCT ?countryLabel; separator="|") AS ?countries)
  (GROUP_CONCAT(DISTINCT ?originLabel; separator="|") AS ?origins)
  (GROUP_CONCAT(DISTINCT ?genreLabel; separator="|") AS ?genres)
  (GROUP_CONCAT(DISTINCT ?memberGenderLabel; separator="|") AS ?memberGenders)
WHERE {
  VALUES ?spotify { ${values} }
  ?item wdt:P1902 ?spotify .
  OPTIONAL { ?item rdfs:label ?itemLabel_ FILTER(LANG(?itemLabel_) = "en") }
  OPTIONAL { ?item wikibase:sitelinks ?sitelinks_ }
  OPTIONAL { ?item wdt:P31 ?type . ?type rdfs:label ?typeLabel FILTER(LANG(?typeLabel) = "en") }
  OPTIONAL { ?item wdt:P21 ?gender . ?gender rdfs:label ?genderLabel FILTER(LANG(?genderLabel) = "en") }
  OPTIONAL { ?item wdt:P27 ?country . ?country rdfs:label ?countryLabel FILTER(LANG(?countryLabel) = "en") }
  OPTIONAL { ?item wdt:P495 ?origin . ?origin rdfs:label ?originLabel FILTER(LANG(?originLabel) = "en") }
  OPTIONAL { ?item wdt:P136 ?genre . ?genre rdfs:label ?genreLabel FILTER(LANG(?genreLabel) = "en") }
  OPTIONAL {
    { ?item wdt:P527 ?member } UNION { ?member wdt:P463 ?item }
    ?member wdt:P21 ?mg . ?mg rdfs:label ?memberGenderLabel FILTER(LANG(?memberGenderLabel) = "en")
  }
}
GROUP BY ?spotify ?item`;
}

const GROUP_WORDS = /\b(group|band|duo|trio|quartet|ensemble|orchestra|choir|collective|supergroup|project|crew)\b/i;
const COUNTRY_ALIASES = {
  'United States of America': 'United States',
  'United Kingdom of Great Britain and Northern Ireland': 'United Kingdom',
  'Kingdom of the Netherlands': 'Netherlands',
  "People's Republic of China": 'China',
  'Republic of Ireland': 'Ireland',
  'Republic of Korea': 'South Korea',
};

function normalizeGender(label) {
  const l = label.toLowerCase();
  if (l === 'male' || l === 'trans man' || l === 'cisgender man') return 'male';
  if (l === 'female' || l === 'trans woman' || l === 'cisgender woman') return 'female';
  if (l.includes('non-binary') || l.includes('genderqueer') || l.includes('genderfluid') || l.includes('agender')) return 'non-binary';
  return null;
}

function interpret(binding) {
  const split = (key) => (binding[key]?.value ? binding[key].value.split('|').filter(Boolean) : []);
  const types = split('types');
  const genders = split('genders').map(normalizeGender).filter(Boolean);
  const memberGenders = split('memberGenders').map(normalizeGender).filter(Boolean);
  let type = null;
  if (types.some((t) => t.toLowerCase() === 'human')) type = 'solo';
  else if (types.some((t) => GROUP_WORDS.test(t)) || memberGenders.length) type = 'group';
  else if (types.length && genders.length) type = 'solo';

  let gender = null;
  if (type === 'solo') gender = genders[0] || null;
  else if (type === 'group') {
    const set = new Set(memberGenders);
    if (set.size === 1) gender = [...set][0];
    else if (set.size > 1) gender = 'mixed';
    else if (genders.length) gender = genders.length === 1 ? genders[0] : 'mixed';
  }

  let countries = type === 'group' ? split('origins') : split('countries');
  if (!countries.length) countries = type === 'group' ? split('countries') : split('origins');
  countries = [...new Set(countries.map((c) => COUNTRY_ALIASES[c] || c))].slice(0, 3);

  const genres = [...new Set(split('genres'))].slice(0, 4);
  return {
    wikidata: binding.item.value.split('/').pop(),
    // Number of Wikipedia language editions with an article: a rough "how famous globally" signal.
    sitelinks: binding.sitelinks ? Number(binding.sitelinks.value) : 0,
    type,
    gender,
    countries,
    genres,
  };
}

// ---------- 3. songs ----------

function parseSongs(html) {
  // Songs where the artist is only featured are prefixed with "* " before the link.
  const re = /<td class="text"><div>(\*\s*)?<a href="https:\/\/open\.spotify\.com\/track\/[^"]+" target="_blank">([^<]*)<\/a><\/div><\/td><td>([\d,]+)<\/td>/g;
  const out = [];
  let m;
  while ((m = re.exec(html))) {
    out.push({ title: decodeEntities(m[2]), feature: Boolean(m[1]), streams: num(m[3]) });
  }
  return out;
}

function pickSongs(songs) {
  const seen = new Set();
  // Strip "(feat. X)", "(From "Movie")", "- Remastered 2011", "- Language: Tamil; From ..." and similar.
  const DESCRIPTOR = /\b(feat|ft|with|from|remaster(ed)?|version|edit|mix|remix|live|bonus|deluxe|radio|original|soundtrack|motion picture|acoustic|demo|mono|stereo|language|single|album|explicit)\b/i;
  const clean = (t) =>
    t
      .replace(/\s*[([][^)\]]*[)\]]/g, (m) => (DESCRIPTOR.test(m) ? '' : m))
      .replace(/\s+-\s+.*$/, '')
      .replace(/\*+$/, '')
      .replace(/\s{2,}/g, ' ')
      .trim();
  const take = (list) => {
    const out = [];
    for (const s of list) {
      const title = clean(s.title);
      const key = title.toLowerCase();
      if (!title || seen.has(key)) continue;
      seen.add(key);
      out.push(title);
      if (out.length + picked.length >= SONGS_PER_ARTIST) break;
    }
    return out;
  };
  const picked = [];
  picked.push(...take(songs.filter((s) => !s.feature)));
  if (picked.length < 3) picked.push(...take(songs.filter((s) => s.feature)));
  return picked.slice(0, SONGS_PER_ARTIST);
}

// ---------- main ----------

async function main() {
  log('config', { ANSWER_COUNT, MIN_SITELINKS, SONGS_PER_ARTIST, CACHE_DIR, SKIP_SONGS, OUT });

  log('fetching artist list');
  const artists = parseArtists(await fetchCached(KWORB_ARTISTS, 'artists.html'));
  if (artists.length < 1000) throw new Error(`Only parsed ${artists.length} artists; did the page layout change?`);
  log(`${artists.length} artists parsed`);

  // Wikidata results are cached per Spotify ID so the thresholds below can be re-tuned
  // without re-querying. `null` marks an ID that Wikidata does not know.
  mkdirSync(CACHE_DIR, { recursive: true });
  const wdCacheFile = path.join(CACHE_DIR, 'wikidata.json');
  const wdCache =
    existsSync(wdCacheFile) && Date.now() - statSync(wdCacheFile).mtimeMs < MAX_AGE_MS ? JSON.parse(readFileSync(wdCacheFile, 'utf8')) : {};
  const byId = new Map(artists.map((a) => [a.id, a]));
  const todo = artists.filter((a) => !(a.id in wdCache));
  log(`querying Wikidata for ${todo.length} artists (${artists.length - todo.length} cached)`);
  const BATCH = 60;
  for (let i = 0; i < todo.length; i += BATCH) {
    const batch = todo.slice(i, i + BATCH);
    const rows = await sparql(wikidataQuery(batch.map((a) => a.id)));
    for (const a of batch) wdCache[a.id] = null;
    for (const row of rows) {
      const id = row.spotify.value;
      if (!byId.has(id) || wdCache[id]) continue; // keep the first match if several items share the ID
      wdCache[id] = interpret(row);
    }
    writeFileSync(wdCacheFile, JSON.stringify(wdCache));
    if ((i / BATCH) % 10 === 0) log(`  ${Math.min(i + BATCH, todo.length)}/${todo.length}`);
    await sleep(500);
  }
  let matched = 0;
  for (const a of artists) {
    if (wdCache[a.id]) {
      Object.assign(a, wdCache[a.id]);
      matched++;
    }
  }
  log(`${matched} artists matched on Wikidata`);

  const complete = (a) => a.type && a.gender && a.countries?.length && a.genres?.length;
  const famous = (a) => (a.sitelinks || 0) >= MIN_SITELINKS;
  const answerCandidates = artists.slice(0, ANSWER_COUNT).filter((a) => complete(a) && famous(a));
  log(
    `${answerCandidates.length} of the top ${ANSWER_COUNT} have complete hints and >= ${MIN_SITELINKS} Wikipedia editions ` +
      `(${artists.slice(0, ANSWER_COUNT).filter(complete).length} complete, ${artists.slice(0, ANSWER_COUNT).filter(famous).length} famous)`,
  );

  if (!SKIP_SONGS) {
    log(`fetching songs for ${answerCandidates.length} artists (concurrency ${CONCURRENCY})`);
    let idx = 0;
    let done = 0;
    await Promise.all(
      Array.from({ length: CONCURRENCY }, async () => {
        while (idx < answerCandidates.length) {
          const a = answerCandidates[idx++];
          try {
            const html = await fetchCached(KWORB_SONGS(a.id), `${a.id}_songs.html`);
            a.songs = pickSongs(parseSongs(html));
          } catch (err) {
            log(`  ${a.name}: ${err.message}`);
          }
          done++;
          if (done % 100 === 0) log(`  ${done}/${answerCandidates.length}`);
          await sleep(250);
        }
      }),
    );
  }

  const out = artists.map((a) => ({
    id: a.id,
    name: a.name,
    streams: a.streams,
    daily: a.daily,
    wikidata: a.wikidata,
    sitelinks: a.sitelinks || undefined,
    type: a.type || undefined,
    gender: a.gender || undefined,
    countries: a.countries?.length ? a.countries : undefined,
    genres: a.genres?.length ? a.genres : undefined,
    songs: a.songs?.length ? a.songs : undefined,
    answer: complete(a) && famous(a) && artists.indexOf(a) < ANSWER_COUNT && (SKIP_SONGS || (a.songs?.length ?? 0) >= 3) ? true : undefined,
  }));
  const answers = out.filter((a) => a.answer).length;
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'Total Spotify streams via kworb.net; artist facts from Wikidata (CC0)',
      answerCount: ANSWER_COUNT,
      artists: out,
    }),
  );
  log(`wrote ${OUT}: ${out.length} guessable artists, ${answers} possible answers`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
