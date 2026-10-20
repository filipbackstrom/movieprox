#!/usr/bin/env node
/**
 * Build data/countries.json for Geoprox.
 *
 * Sources
 *   - Wikidata (CC0): the set of sovereign states with an ISO 3166-1 alpha-2 code,
 *     population, area and continent(s).  https://query.wikidata.org/
 *   - GeoNames (CC BY 4.0): short common names and LAND neighbours per country.
 *     https://download.geonames.org/export/dump/countryInfo.txt
 *   - Landlocked status is a fixed list; it does not change and the Wikidata flag is incomplete.
 *
 * Usage:
 *   node scripts/build-country-data.mjs [--cache-dir data/raw/countries] [--max-age-hours 72] [--out data/countries.json]
 */
import { existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const UA = 'Movieprox data build (hobby project; https://github.com/filipbackstrom/movieprox)';
const WDQS = 'https://query.wikidata.org/sparql';
const GEONAMES = 'https://download.geonames.org/export/dump/countryInfo.txt';

const args = parseArgs(process.argv.slice(2));
const CACHE_DIR = args['cache-dir'] || path.join('data', 'raw', 'countries');
const MAX_AGE_MS = int(args['max-age-hours'], 72) * 3_600_000;
const OUT = args.out || path.join('data', 'countries.json');

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const next = argv[i + 1];
    if (next !== undefined && !next.startsWith('--')) {
      out[a.slice(2)] = next;
      i++;
    } else out[a.slice(2)] = true;
  }
  return out;
}
function int(v, fallback) {
  if (v === undefined || v === true) return fallback;
  const n = Number(v);
  if (!Number.isFinite(n)) throw new Error(`Expected a number, got ${v}`);
  return n;
}
const log = (...p) => console.error(new Date().toISOString().slice(11, 19), ...p);

async function fetchCached(url, cacheName, headers = {}) {
  mkdirSync(CACHE_DIR, { recursive: true });
  const file = path.join(CACHE_DIR, cacheName);
  if (existsSync(file) && Date.now() - statSync(file).mtimeMs < MAX_AGE_MS) return readFileSync(file, 'utf8');
  const res = await fetch(url, { headers: { 'user-agent': UA, ...headers } });
  if (!res.ok) throw new Error(`${url}: HTTP ${res.status} ${(await res.text()).slice(0, 200)}`);
  const text = await res.text();
  writeFileSync(file, text);
  return text;
}

// The 44 landlocked UN members / observers plus Kosovo. Two of them (Liechtenstein,
// Uzbekistan) are doubly landlocked; the game does not distinguish.
const LANDLOCKED = new Set(
  'AF AD AM AT AZ BY BT BO BW BF BI CF TD CZ SZ ET HU KZ XK KG LA LS LI LU MW ML MD MN NP NE MK PY RW SM RS SK SS CH TJ TM UG UZ VA ZM ZW'.split(' '),
);

const CONTINENTS = { AF: 'Africa', AN: 'Antarctica', AS: 'Asia', EU: 'Europe', NA: 'North America', OC: 'Oceania', SA: 'South America' };
const SEVEN = new Set(Object.values(CONTINENTS));

/** GeoNames names are mostly the short common names; a few need a nudge. */
const NAME_OVERRIDES = {
  PS: 'Palestine',
  VA: 'Vatican City',
  TL: 'East Timor',
  CD: 'DR Congo',
  CG: 'Republic of the Congo',
  FM: 'Micronesia',
  KN: 'Saint Kitts and Nevis',
  VC: 'Saint Vincent and the Grenadines',
  LC: 'Saint Lucia',
  ST: 'São Tomé and Príncipe',
  CI: 'Ivory Coast',
};

/** Extra names people type. The Wikidata label and ISO codes are added automatically. */
const ALIASES = {
  US: ['USA', 'United States of America', 'America'],
  GB: ['UK', 'Britain', 'Great Britain', 'England'],
  AE: ['UAE'],
  NL: ['Holland'],
  MM: ['Burma'],
  CZ: ['Czech Republic'],
  SZ: ['Swaziland'],
  CI: ["Côte d'Ivoire", 'Cote dIvoire'],
  MK: ['Macedonia'],
  TR: ['Türkiye', 'Turkiye'],
  CV: ['Cabo Verde'],
  CD: ['Democratic Republic of the Congo', 'Congo-Kinshasa', 'Zaire'],
  CG: ['Congo-Brazzaville', 'Congo'],
  TL: ['Timor-Leste'],
  VA: ['Holy See', 'Vatican'],
  KR: ['Korea', 'Republic of Korea'],
  KP: ['DPRK'],
  RU: ['Russian Federation'],
  IR: ['Persia'],
  LA: ['Lao'],
  BN: ['Brunei Darussalam'],
  PS: ['Palestinian Territory', 'Palestinian Territories'],
  TW: ['Taiwan'],
  SY: ['Syrian Arab Republic'],
  VN: ['Viet Nam'],
  KN: ['St Kitts and Nevis'],
  VC: ['St Vincent and the Grenadines'],
  LC: ['St Lucia'],
  ST: ['Sao Tome and Principe'],
  BA: ['Bosnia'],
  TT: ['Trinidad'],
  AG: ['Antigua'],
  FM: ['Federated States of Micronesia'],
  GM: ['The Gambia'],
  BS: ['The Bahamas'],
  CF: ['CAR'],
  DO: ['Dominican Rep'],
};

const WD_QUERY = `
SELECT ?country ?countryLabel ?iso2
  (MAX(?pop) AS ?population) (MAX(?ar) AS ?area)
  (GROUP_CONCAT(DISTINCT ?continentLabel; separator="|") AS ?continents)
  (SAMPLE(?un_) AS ?un)
WHERE {
  ?country wdt:P31 wd:Q3624078 ; wdt:P297 ?iso2 .
  FILTER NOT EXISTS { ?country wdt:P576 ?dissolved }
  OPTIONAL { ?country wdt:P1082 ?pop }
  OPTIONAL { ?country wdt:P2046 ?ar }
  OPTIONAL { ?country wdt:P30 ?continent . ?continent rdfs:label ?continentLabel FILTER(LANG(?continentLabel) = "en") }
  OPTIONAL { ?country wdt:P463 wd:Q1065 . BIND(1 AS ?un_) }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}
GROUP BY ?country ?countryLabel ?iso2`;

const flagEmoji = (iso2) => String.fromCodePoint(...[...iso2.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

const normalize = (s) =>
  s
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();

async function main() {
  log('fetching Wikidata country list');
  const wd = JSON.parse(
    await fetchCached(WDQS + '?query=' + encodeURIComponent(WD_QUERY), 'wikidata.json', { accept: 'application/sparql-results+json' }),
  ).results.bindings;
  log(`  ${wd.length} sovereign states with an ISO code`);

  log('fetching GeoNames country table');
  const geo = new Map();
  for (const line of (await fetchCached(GEONAMES, 'countryInfo.txt')).split('\n')) {
    if (!line || line.startsWith('#')) continue;
    const f = line.split('\t');
    geo.set(f[0], {
      iso2: f[0],
      iso3: f[1],
      name: f[4],
      capital: f[5],
      area: Number(f[6]) || null,
      population: Number(f[7]) || null,
      continent: CONTINENTS[f[8]] || null,
      neighbours: (f[17] || '').split(',').filter(Boolean),
    });
  }
  log(`  ${geo.size} territories`);

  const countries = [];
  for (const row of wd) {
    const iso2 = row.iso2.value;
    const g = geo.get(iso2);
    if (!g) {
      log(`  skipping ${row.countryLabel.value} (${iso2}): not in GeoNames`);
      continue;
    }
    const wdLabel = row.countryLabel.value;
    const name = NAME_OVERRIDES[iso2] || g.name;
    const wdContinents = (row.continents?.value || '').split('|').filter((c) => SEVEN.has(c));
    const continents = [...new Set([g.continent, ...wdContinents].filter(Boolean))];
    const population = Number(row.population?.value) || g.population;
    const area = Number(row.area?.value) || g.area;
    if (LANDLOCKED.has(iso2) && g.neighbours.length === 0) log(`  warning: ${name} is landlocked but GeoNames lists no neighbours`);
    countries.push({
      id: iso2,
      name,
      flag: flagEmoji(iso2),
      wikidata: row.country.value.split('/').pop(),
      unMember: Boolean(row.un?.value),
      capital: g.capital || undefined,
      population,
      area,
      continents,
      landlocked: LANDLOCKED.has(iso2),
      neighbourIds: g.neighbours,
      aliases: [...new Set([wdLabel, ...(ALIASES[iso2] || [])].filter((a) => normalize(a) !== normalize(name)))],
    });
  }

  // Neighbours by name, restricted to countries in the game. GeoNames counts the
  // Guantanamo Bay fence as a US-Cuba land border; the game does not.
  const NOT_NEIGHBOURS = { US: ['CU'], CU: ['US'] };
  const byId = new Map(countries.map((c) => [c.id, c]));
  for (const c of countries) {
    c.neighbours = c.neighbourIds
      .filter((id) => !(NOT_NEIGHBOURS[c.id] || []).includes(id))
      .map((id) => byId.get(id)?.name)
      .filter(Boolean)
      .sort((a, b) => a.localeCompare(b, 'en'));
    delete c.neighbourIds;
  }

  // Alphabetical order is the game's scale.
  countries.sort((a, b) => normalize(a.name).localeCompare(normalize(b.name), 'en'));
  countries.forEach((c, i) => {
    c.order = i;
    c.answer = true;
  });

  const landlockedCount = countries.filter((c) => c.landlocked).length;
  mkdirSync(path.dirname(OUT), { recursive: true });
  writeFileSync(
    OUT,
    JSON.stringify({
      generatedAt: new Date().toISOString(),
      source: 'Wikidata (CC0) for the country list, population, area and continents; GeoNames (CC BY 4.0) for names and land neighbours',
      countries,
    }),
  );
  log(`wrote ${OUT}: ${countries.length} countries (${landlockedCount} landlocked, ${countries.filter((c) => !c.neighbours.length).length} without land neighbours)`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
