import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../src/engine.js';
import movies from '../src/games/movies.js';
import music, { formatStreams } from '../src/games/music.js';
import countries, { formatQuantity } from '../src/games/countries.js';

const { MAX_GUESSES, OUTCOME, applyGuess, createGame } = E;

const movie = (id, title, rating, extra = {}) => ({
  id,
  title,
  year: 2000,
  rating,
  votes: 100000,
  genres: ['Drama'],
  directors: ['Someone'],
  cast: ['A', 'B', 'C', 'D'],
  answer: true,
  ...extra,
});

const shawshank = movie('tt0111161', 'The Shawshank Redemption', 9.3);
const lobster = movie('tt3464902', 'The Lobster', 7.1);
const iLoveYouMan = movie('tt1155056', 'I Love You, Man', 7.0);
const scaryMovie = movie('tt0175142', 'Scary Movie', 6.3);
const superbad = movie('tt0829482', 'Superbad', 7.6);
const anchorman = movie('tt0357413', 'Anchorman', 7.1);
const stepBrothers = movie('tt0838283', 'Step Brothers', 6.9);
const zoolander = movie('tt0196229', 'Zoolander', 6.5);
const hangover = movie('tt1119646', 'The Hangover', 7.7);
const twilight = movie('tt1099212', 'Twilight', 5.3);
const godfather = movie('tt0068646', 'The Godfather', 9.2);

const all = [shawshank, lobster, iLoveYouMan, scaryMovie, superbad, anchorman, stepBrothers, zoolander, hangover, twilight, godfather];

function game(target = iLoveYouMan, bounds = { high: shawshank, low: scaryMovie }) {
  return createGame({ target, bounds, mode: 'daily', puzzleNo: 1 });
}
const guess = (s, m) => applyGuess(movies, s, m);

test('the example from the design: The Lobster replaces Shawshank as the upper bound', () => {
  const { state, outcome } = guess(game(), lobster);
  assert.equal(outcome, OUTCOME.HIGH);
  assert.equal(state.high.id, lobster.id);
  assert.equal(state.low.id, scaryMovie.id);
  assert.equal(state.status, 'playing');
});

test('a guess below the secret replaces the lower bound', () => {
  const { state, outcome } = guess(game(), stepBrothers);
  assert.equal(outcome, OUTCOME.LOW);
  assert.equal(state.low.id, stepBrothers.id);
  assert.equal(state.high.id, shawshank.id);
});

test('a guess outside the current range is wasted and moves nothing', () => {
  const s = guess(game(), lobster).state; // 6.3 .. 7.1
  const r = guess(s, hangover); // 7.7
  assert.equal(r.outcome, OUTCOME.OUTSIDE);
  assert.equal(r.state.high.id, lobster.id);
  assert.equal(r.state.low.id, scaryMovie.id);
  assert.equal(r.state.guesses.length, 2);
});

test('a guess equal to a bound value is not an improvement', () => {
  const s = guess(game(), lobster).state;
  const r = guess(s, anchorman); // also 7.1
  assert.equal(r.outcome, OUTCOME.OUTSIDE);
  assert.equal(r.state.high.id, lobster.id);
});

test('a guess with the exact secret value pins it', () => {
  const sameRated = movie('tt9999999', 'Some 7.0 Movie', 7.0);
  const r = guess(game(), sameRated);
  assert.equal(r.outcome, OUTCOME.SAME);
  assert.equal(r.state.pinned, 7.0);
  assert.deepEqual(E.valueWindow(movies, r.state), { pinned: 7.0 });
  const r2 = guess(r.state, lobster);
  assert.equal(r2.outcome, OUTCOME.OUTSIDE);
  const r3 = guess(r2.state, iLoveYouMan);
  assert.equal(r3.outcome, OUTCOME.CORRECT);
  assert.equal(r3.state.status, 'won');
});

test('float noise does not break equality', () => {
  const target = movie('a', 'A', 0.1 + 0.2);
  const g = movie('b', 'B', 0.3);
  const r = guess(createGame({ target, bounds: { high: null, low: null } }), g);
  assert.equal(r.outcome, OUTCOME.SAME);
});

test('correct guess wins; duplicates and post-game guesses are rejected without consuming a turn', () => {
  const r = guess(game(), iLoveYouMan);
  assert.equal(r.outcome, OUTCOME.CORRECT);
  assert.equal(r.state.status, 'won');
  const again = guess(r.state, lobster);
  assert.ok(again.error);
  assert.equal(again.state.guesses.length, 1);

  const s = guess(game(), lobster).state;
  const dup = guess(s, lobster);
  assert.ok(dup.error);
  assert.equal(dup.state.guesses.length, 1);
});

test('the game is lost after MAX_GUESSES wrong guesses', () => {
  let s = game();
  for (let i = 0; i < MAX_GUESSES; i++) s = guess(s, movie(`x${i}`, `X${i}`, 8.0 + i / 100)).state;
  assert.equal(s.status, 'lost');
});

test('null bounds mean the edge of the scale', () => {
  const s = createGame({ target: godfather, bounds: { high: null, low: scaryMovie } });
  assert.deepEqual(E.valueWindow(movies, s), { low: 6.3, high: 10 });
  const r = guess(s, shawshank);
  assert.equal(r.outcome, OUTCOME.HIGH);
  assert.equal(r.state.high.id, shawshank.id);
});

test('hints unlock after 2, 5, 8, 11 and 14 guesses', () => {
  assert.deepEqual(
    E.hints(movies).map((h) => h.after),
    [2, 5, 8, 11, 14],
  );
  let s = game();
  assert.equal(E.unlockedHints(movies, s).length, 0);
  s = guess(s, lobster).state;
  assert.equal(E.unlockedHints(movies, s).length, 0);
  s = guess(s, stepBrothers).state;
  assert.deepEqual(
    E.unlockedHints(movies, s).map((h) => h.key),
    ['genre'],
  );
  assert.equal(E.nextHint(movies, s).key, 'year');
  for (let i = 0; i < 12; i++) s = guess(s, movie(`y${i}`, `Y${i}`, 8.0 + i / 100)).state;
  assert.equal(s.guesses.length, 14);
  assert.equal(E.unlockedHints(movies, s).length, 5);
  assert.equal(E.nextHint(movies, s), null);
  assert.equal(s.status, 'playing', 'one guess left after the final hint');
});

test('movie hint text and the title-pattern fallback for keywords', () => {
  const target = { ...iLoveYouMan, year: 2009, genres: ['Comedy', 'Romance'], directors: ['John Hamburg'], cast: ['Paul Rudd', 'Jason Segel', 'Rashida Jones', 'Extra'] };
  const h = E.hints(movies);
  assert.deepEqual(E.hintText(h[0], target), { label: 'Genre', text: 'Comedy, Romance' });
  assert.deepEqual(E.hintText(h[1], target), { label: 'Release year', text: '2009' });
  assert.deepEqual(E.hintText(h[2], target), { label: 'Director', text: 'John Hamburg' });
  assert.deepEqual(E.hintText(h[3], target), { label: 'Featured actors', text: 'Paul Rudd, Jason Segel, Rashida Jones' });
  assert.deepEqual(E.hintText(h[4], target), { label: 'Title pattern', text: 'I L___ Y__, M__' });
  assert.deepEqual(E.hintText(h[4], { ...target, keywords: ['bromance', 'wedding'] }), { label: 'Plot keywords', text: 'bromance, wedding' });
  assert.deepEqual(E.hintText(h[2], { ...target, directors: [] }), { label: 'Director', text: 'Unknown' });
  assert.equal(E.titlePattern("Ocean's Eleven"), "O____'_ E_____");
  assert.equal(E.titlePattern('2001: A Space Odyssey'), '2001: A S____ O______');
  assert.equal(E.titlePattern('Amélie'), 'A_____');
});

test('candidate count reflects the value window', () => {
  let s = game(); // 6.3 .. 9.3 exclusive
  assert.equal(E.candidatesInWindow(movies, all, s), 8);
  s = guess(s, lobster).state; // 6.3 .. 7.1
  assert.equal(E.candidatesInWindow(movies, all, s), 3);
  s = guess(s, movie('p', 'P', 7.0)).state; // pinned
  assert.equal(E.candidatesInWindow(movies, all, s), 1);
});

test('daily target is deterministic and walks the pool without repeating', () => {
  assert.equal(E.pickDailyTarget(movies, all, 1).id, E.pickDailyTarget(movies, all, 1).id);
  const seen = new Set();
  for (let i = 1; i <= all.length; i++) seen.add(E.pickDailyTarget(movies, all, i).id);
  assert.equal(seen.size, all.length);
  assert.equal(E.pickDailyTarget(movies, all, all.length + 1).id, E.pickDailyTarget(movies, all, 1).id);
  assert.equal(E.pickDailyTarget(movies, all, 0).id, E.pickDailyTarget(movies, all, all.length).id);
  assert.notEqual(E.pickDailyTarget(movies, all, 1).id, E.pickDailyTarget(music, all, 1).id, 'games use different seeds');
});

test('movie bounds are a full point away when possible, nearest otherwise, never the target', () => {
  const rng = E.mulberry32(42);
  for (let i = 0; i < 50; i++) {
    const b = E.pickBounds(movies, all, iLoveYouMan, rng);
    assert.ok(b.high.rating >= 8.0, `high ${b.high.rating}`);
    assert.ok(b.low.rating <= 6.0, `low ${b.low.rating}`);
    assert.notEqual(b.high.id, iLoveYouMan.id);
    assert.notEqual(b.low.id, iLoveYouMan.id);
  }
  const top = E.pickBounds(movies, all, shawshank, rng);
  assert.equal(top.high, null);
  assert.ok(top.low.rating <= 8.3);
  const god = E.pickBounds(movies, all, godfather, rng);
  assert.equal(god.high.id, shawshank.id);
});

test('puzzle numbers count from the launch date', () => {
  assert.equal(E.puzzleNumber(movies, '2026-10-20'), 1);
  assert.equal(E.puzzleNumber(movies, '2026-10-21'), 2);
  assert.equal(E.puzzleNumber(movies, '2027-01-01'), 74);
  assert.match(E.localDateString(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('share text', () => {
  let s = game();
  s = guess(s, lobster).state;
  s = guess(s, hangover).state;
  s = guess(s, stepBrothers).state;
  s = guess(s, movie('p', 'P', 7.0)).state;
  s = guess(s, iLoveYouMan).state;
  assert.equal(E.shareText(movies, s, { url: 'https://example.com' }), 'Movieprox #1 5/15\n🔼⬜🔽🟰🎯\nhttps://example.com');
  let lost = game();
  for (let i = 0; i < MAX_GUESSES; i++) lost = guess(lost, movie(`x${i}`, `X${i}`, 8.0 + i / 100)).state;
  assert.ok(E.shareText(movies, lost).startsWith('Movieprox #1 X/15\n🔼⬜⬜⬜⬜\n'));
});

test('search ranks exact, prefix, then substring, then by weight', () => {
  const idx = E.buildSearchIndex(movies, [
    ...all,
    movie('o1', 'Oldboy', 8.4, { votes: 600000, originalTitle: 'Oldeuboi' }),
    movie('m1', 'The Matrix', 8.7, { votes: 2000000 }),
    movie('m2', 'The Matrix Reloaded', 7.2, { votes: 600000 }),
  ]);
  assert.deepEqual(
    E.searchItems(idx, 'the matrix').map((m) => m.id),
    ['m1', 'm2'],
  );
  assert.equal(E.searchItems(idx, 'matrix')[0].id, 'm1');
  assert.equal(E.searchItems(idx, 'oldeuboi')[0].id, 'o1', 'original title is searchable');
  assert.equal(E.searchItems(idx, 'x').length, 0, 'needs two characters');
  assert.equal(E.searchItems(idx, 'scary  movie!')[0].id, scaryMovie.id);
});

test('stats track streaks across consecutive puzzles', () => {
  let stats = E.emptyStats();
  const win = (no) => ({ ...guess(game(), iLoveYouMan).state, puzzleNo: no });
  const loss = (no) => {
    let s = game();
    for (let i = 0; i < MAX_GUESSES; i++) s = guess(s, movie(`x${i}`, `X${i}`, 8.0 + i / 100)).state;
    return { ...s, puzzleNo: no };
  };
  stats = E.recordResult(stats, win(1));
  stats = E.recordResult(stats, win(2));
  assert.equal(stats.streak, 2);
  stats = E.recordResult(stats, win(4));
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 2);
  stats = E.recordResult(stats, loss(5));
  assert.equal(stats.streak, 0);
  assert.equal(stats.played, 4);
  assert.equal(stats.won, 3);
  assert.deepEqual(stats.distribution, { 1: 3 });
  assert.equal(E.recordResult(stats, game()), stats);
});

// ---------- Musicprox ----------

const artist = (id, name, streamsB, extra = {}) => ({
  id,
  name,
  streams: Math.round(streamsB * 1e9),
  type: 'solo',
  gender: 'male',
  countries: ['United States'],
  genres: ['pop'],
  songs: ['Song A', 'Song B', 'Song C', 'Song D'],
  answer: true,
  ...extra,
});
const drake = artist('d', 'Drake', 143.2, { countries: ['Canada'], genres: ['hip hop', 'R&B'] });
const taylor = artist('t', 'Taylor Swift', 120.5, { gender: 'female' });
const abba = artist('a', 'ABBA', 30.1, { type: 'group', gender: 'mixed', countries: ['Sweden'], genres: ['pop', 'disco'] });
const bts = artist('b', 'BTS', 45.0, { type: 'group', gender: 'male', countries: ['South Korea'] });
const robyn = artist('r', 'Robyn', 1.6, { gender: 'female', countries: ['Sweden'] });
const kent = artist('k', 'Kent', 1.4, { type: 'group', gender: 'male', countries: ['Sweden'], songs: [] });
const artists = [drake, taylor, abba, bts, robyn, kent];

test('stream formatting', () => {
  assert.equal(formatStreams(143_151_400_000), '143B');
  assert.equal(formatStreams(30_100_000_000), '30.1B');
  assert.equal(formatStreams(30_000_000_000), '30B');
  assert.equal(formatStreams(1_420_400_000), '1.4B');
  assert.equal(formatStreams(1_000_000_000), '1B');
  assert.equal(formatStreams(870_000_000), '870M');
});

test('bounds prefer well-known items when any are far enough away', () => {
  const famous = movie('f1', 'Famous High', 8.5, { votes: 2_000_000 });
  const famousLow = movie('f2', 'Famous Low', 5.5, { votes: 2_000_000 });
  const pool = [...all, famous, famousLow]; // the fixtures above all have 100k votes
  const rng = E.mulberry32(3);
  for (let i = 0; i < 20; i++) {
    const b = E.pickBounds(movies, pool, iLoveYouMan, rng);
    assert.equal(b.high.id, famous.id);
    assert.equal(b.low.id, famousLow.id);
  }
  // Nothing famous far enough on the high side -> any far-enough answer, never the nearest.
  const b = E.pickBounds(movies, [...all, famousLow], iLoveYouMan, rng);
  assert.ok(b.high.rating >= 8.0);
  assert.equal(b.low.id, famousLow.id);
});

test('music guesses compare stream counts', () => {
  const s = createGame({ target: bts, bounds: { high: drake, low: robyn } });
  const r = applyGuess(music, s, abba); // 30.1B < 45B -> new lower bound
  assert.equal(r.outcome, OUTCOME.LOW);
  assert.equal(r.state.low.id, abba.id);
  const r2 = applyGuess(music, r.state, taylor); // 120.5B -> new upper bound
  assert.equal(r2.outcome, OUTCOME.HIGH);
  assert.equal(E.candidatesInWindow(music, artists, r2.state), 1);
  const r3 = applyGuess(music, r2.state, bts);
  assert.equal(r3.outcome, OUTCOME.CORRECT);
});

test('music bounds prefer the most widely covered artists', () => {
  // 300 moderately covered artists that are NOT far enough from BTS (45B) to be bounds,
  // two widely covered ones that are, and the fixtures above with almost no coverage.
  const fillers = Array.from({ length: 300 }, (_, i) => artist(`fill${i}`, `Filler ${i}`, 23 + (i % 60), { sitelinks: 5 }));
  const pool = [
    ...artists.map((a) => ({ ...a, sitelinks: 1 })),
    ...fillers,
    artist('fam-hi', 'Famous High', 100, { sitelinks: 150 }),
    artist('fam-lo', 'Famous Low', 2, { sitelinks: 120 }),
  ];
  const rng = E.mulberry32(11);
  for (let i = 0; i < 20; i++) {
    const b = E.pickBounds(music, pool, bts, rng); // 45B
    assert.equal(b.high.id, 'fam-hi');
    assert.equal(b.low.id, 'fam-lo');
  }
});

test('music bounds are at least a factor two away when possible', () => {
  const rng = E.mulberry32(7);
  for (let i = 0; i < 30; i++) {
    const b = E.pickBounds(music, artists, bts, rng); // 45B: high must be >= 90B, low <= 22.5B
    assert.ok(b.high.streams >= 90e9);
    assert.ok(b.low.streams <= 22.5e9);
  }
  const top = E.pickBounds(music, artists, drake, rng);
  assert.equal(top.high, null, 'nobody above Drake');
  assert.deepEqual(E.valueWindow(music, createGame({ target: drake, bounds: top })).high, Infinity);
});

test('music hints', () => {
  const h = E.hints(music);
  assert.deepEqual(
    h.map((x) => x.label),
    ['Genre', 'Solo or group', 'Gender', 'Nationality', 'Famous songs'],
  );
  assert.equal(E.hintText(h[0], drake).text, 'hip hop, R&B');
  assert.equal(E.hintText(h[1], drake).text, 'Solo artist');
  assert.equal(E.hintText(h[1], abba).text, 'Group');
  assert.equal(E.hintText(h[2], drake).text, 'Male');
  assert.equal(E.hintText(h[2], taylor).text, 'Female');
  assert.equal(E.hintText(h[2], abba).text, 'Mixed group');
  assert.equal(E.hintText(h[2], bts).text, 'All-male group');
  assert.equal(E.hintText(h[3], abba).text, 'Sweden');
  assert.equal(E.hintText(h[4], drake).text, 'Song A, Song B, Song C');
  assert.deepEqual(E.hintText(h[4], kent), { label: 'Name pattern', text: 'K___' });
  assert.equal(E.shareText(music, createGame({ target: bts, bounds: { high: drake, low: robyn }, puzzleNo: 3 })), 'Musicprox #3 X/15');
});

test('artist search handles symbols and ranks by streams', () => {
  const idx = E.buildSearchIndex(music, [...artists, artist('kd', 'Ke$ha', 5.0), artist('ab2', 'AB6IX', 0.5)]);
  assert.equal(E.searchItems(idx, 'kesha')[0].id, 'kd');
  assert.equal(E.searchItems(idx, 'ab')[0].id, 'a', 'ABBA outranks AB6IX on streams');
});

// ---------- Countryprox ----------

const country = (order, name, extra = {}) => ({
  id: name.slice(0, 2).toUpperCase(),
  name,
  flag: '🏳️',
  order,
  population: 10_000_000,
  area: 100_000,
  continents: ['Europe'],
  landlocked: false,
  neighbours: ['Somewhere'],
  answer: true,
  ...extra,
});
const world = ['Albania', 'Brazil', 'Chile', 'Denmark', 'Egypt', 'France', 'Germany', 'Hungary', 'India', 'Japan', 'Kenya', 'Laos', 'Mexico', 'Norway', 'Oman', 'Peru', 'Qatar', 'Russia', 'Sweden', 'Turkey', 'Uganda', 'Vietnam', 'Yemen', 'Zambia'].map(
  (n, i) => country(i, n),
);

test('quantity formatting for area and population', () => {
  assert.equal(formatQuantity(41291), '41K');
  assert.equal(formatQuantity(17075400), '17.1M');
  assert.equal(formatQuantity(1406585000), '1.4B');
  assert.equal(formatQuantity(999_499), '999K');
  assert.equal(formatQuantity(882), '882');
  assert.equal(formatQuantity(0.49), '0.5');
  assert.equal(formatQuantity(null), 'Unknown');
});

test('countries are ordered alphabetically and the flag stands in for the value', () => {
  const sweden = world.find((c) => c.name === 'Sweden');
  // A is the upper bound, Z the lower, as in Betweenle.
  const s = createGame({ target: sweden, bounds: { high: world[0], low: world.at(-1) } });
  const r = applyGuess(countries, s, world.find((c) => c.name === 'Norway'));
  assert.equal(r.outcome, OUTCOME.HIGH, 'Norway comes before Sweden, so it becomes the upper bound');
  const r2 = applyGuess(countries, r.state, world.find((c) => c.name === 'Turkey'));
  assert.equal(r2.outcome, OUTCOME.LOW, 'Turkey comes after Sweden, so it becomes the lower bound');
  assert.equal(E.candidatesInWindow(countries, world, r2.state), 5, 'Oman, Peru, Qatar, Russia, Sweden');
  assert.equal(E.formatValue(countries, -sweden.order, sweden), '🏳️');
  assert.equal(E.trackPosition(countries, -world.at(-1).order, world), 1, 'Z on the right');
  assert.equal(E.trackPosition(countries, 0, world), 0, 'A on the left');
  const edge = createGame({ target: sweden, bounds: { high: null, low: null } });
  assert.deepEqual(E.valueWindow(countries, edge), { low: -Infinity, high: 1 });
  assert.equal(E.candidatesInWindow(countries, world, edge), world.length);
  const ticks = E.trackTicks(countries, world);
  assert.equal(ticks[0].label, 'A');
  assert.equal(ticks.at(-1).label, 'Z');
});

test('country hints', () => {
  const h = E.hints(countries);
  assert.deepEqual(
    h.map((x) => x.label),
    ['Landlocked', 'Area', 'Population', 'Continent', 'Neighboring countries'],
  );
  const ch = country(0, 'Switzerland', { landlocked: true, area: 41291, population: 9104063, neighbours: ['Austria', 'France'] });
  assert.equal(E.hintText(h[0], ch).text, 'Yes');
  assert.equal(E.hintText(h[1], ch).text, '41K km²');
  assert.equal(E.hintText(h[2], ch).text, '9.1M');
  assert.equal(E.hintText(h[3], ch).text, 'Europe');
  assert.equal(E.hintText(h[4], ch).text, 'Austria, France');
  const jp = country(1, 'Japan', { continents: ['Asia'], neighbours: [] });
  assert.equal(E.hintText(h[0], jp).text, 'No');
  assert.equal(E.hintText(h[4], jp).text, 'None, it has no land borders');
  assert.equal(E.hintText(h[3], country(2, 'Russia', { continents: ['Europe', 'Asia'] })).text, 'Europe / Asia');
});

test('country search finds aliases and ISO codes', () => {
  const idx = E.buildSearchIndex(countries, [
    country(0, 'United States', { id: 'US', aliases: ['USA', 'America'], population: 340e6 }),
    country(1, 'United Kingdom', { id: 'GB', aliases: ['UK', 'Britain'], population: 69e6 }),
    country(2, 'Czechia', { id: 'CZ', aliases: ['Czech Republic'] }),
  ]);
  assert.equal(E.searchItems(idx, 'usa')[0].id, 'US');
  assert.equal(E.searchItems(idx, 'britain')[0].id, 'GB');
  assert.equal(E.searchItems(idx, 'czech rep')[0].id, 'CZ');
  assert.equal(E.searchItems(idx, 'united')[0].id, 'US', 'ties on prefix go to the larger population');
});
