#!/usr/bin/env node
/**
 * Optional: add plot keywords from TMDB to the answer-pool movies in data/movies.json.
 * Used for the fifth hint. Without it the game falls back to a title-pattern hint.
 *
 *   TMDB_API_KEY=... node scripts/enrich-tmdb.mjs [--file data/movies.json] [--all]
 *
 * Get a free key at https://www.themoviedb.org/settings/api (either the v3 key
 * or the v4 "Read Access Token" works). By default only movies flagged as
 * possible answers are enriched; --all does every movie.
 */
import { readFileSync, writeFileSync } from 'node:fs';

const args = process.argv.slice(2);
const FILE = args.includes('--file') ? args[args.indexOf('--file') + 1] : 'data/movies.json';
const ALL = args.includes('--all');
const KEY = process.env.TMDB_API_KEY;
if (!KEY) {
  console.error('Set TMDB_API_KEY in the environment.');
  process.exit(1);
}
const isBearer = KEY.startsWith('ey');
const CONCURRENCY = 4;
const MAX_KEYWORDS = 8;

async function tmdb(pathname, params = {}) {
  const url = new URL('https://api.themoviedb.org/3' + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { accept: 'application/json' };
  if (isBearer) headers.authorization = `Bearer ${KEY}`;
  else url.searchParams.set('api_key', KEY);
  for (let attempt = 0; attempt < 5; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429) {
      const wait = Number(res.headers.get('retry-after') || 2) * 1000;
      await new Promise((r) => setTimeout(r, wait));
      continue;
    }
    if (!res.ok) throw new Error(`${pathname}: HTTP ${res.status}`);
    return res.json();
  }
  throw new Error(`${pathname}: rate limited`);
}

async function keywordsFor(imdbId) {
  const found = await tmdb(`/find/${imdbId}`, { external_source: 'imdb_id' });
  const hit = found.movie_results?.[0];
  if (!hit) return null;
  const kw = await tmdb(`/movie/${hit.id}/keywords`);
  return (kw.keywords || []).map((k) => k.name).slice(0, MAX_KEYWORDS);
}

async function main() {
  const data = JSON.parse(readFileSync(FILE, 'utf8'));
  const todo = data.movies.filter((m) => (ALL || m.answer) && !m.keywords);
  console.error(`${todo.length} movies to enrich`);
  let done = 0;
  let idx = 0;
  const save = () => writeFileSync(FILE, JSON.stringify(data));
  const workers = Array.from({ length: CONCURRENCY }, async () => {
    while (idx < todo.length) {
      const m = todo[idx++];
      try {
        const kw = await keywordsFor(m.id);
        m.keywords = kw && kw.length ? kw : [];
      } catch (err) {
        console.error(`  ${m.id} ${m.title}: ${err.message}`);
      }
      done++;
      if (done % 100 === 0) {
        console.error(`  ${done}/${todo.length}`);
        save();
      }
    }
  });
  await Promise.all(workers);
  save();
  const withKw = data.movies.filter((m) => m.keywords?.length).length;
  console.error(`done: ${withKw} movies have keywords`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
