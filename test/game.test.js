import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  MAX_GUESSES,
  HINTS,
  OUTCOME,
  applyGuess,
  buildSearchIndex,
  candidatesInWindow,
  createGame,
  hintText,
  localDateString,
  mulberry32,
  pickBounds,
  pickDailyTarget,
  puzzleNumber,
  recordResult,
  emptyStats,
  searchMovies,
  shareText,
  titlePattern,
  unlockedHints,
  ratingWindow,
} from '../src/game.js';

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

test('the example from the design: The Lobster replaces Shawshank as the upper bound', () => {
  const { state, outcome } = applyGuess(game(), lobster);
  assert.equal(outcome, OUTCOME.HIGH);
  assert.equal(state.high.id, lobster.id);
  assert.equal(state.low.id, scaryMovie.id);
  assert.equal(state.status, 'playing');
});

test('a guess below the secret replaces the lower bound', () => {
  const { state, outcome } = applyGuess(game(), stepBrothers);
  assert.equal(outcome, OUTCOME.LOW);
  assert.equal(state.low.id, stepBrothers.id);
  assert.equal(state.high.id, shawshank.id);
});

test('a guess outside the current range is wasted and moves nothing', () => {
  let s = applyGuess(game(), lobster).state; // range is now 6.3 .. 7.1
  const r = applyGuess(s, hangover); // 7.7, above the new upper bound
  assert.equal(r.outcome, OUTCOME.OUTSIDE);
  assert.equal(r.state.high.id, lobster.id);
  assert.equal(r.state.low.id, scaryMovie.id);
  assert.equal(r.state.guesses.length, 2);
});

test('a guess equal to a bound rating is not an improvement', () => {
  let s = applyGuess(game(), lobster).state; // high = 7.1
  const r = applyGuess(s, anchorman); // also 7.1
  assert.equal(r.outcome, OUTCOME.OUTSIDE);
  assert.equal(r.state.high.id, lobster.id);
});

test('a guess with the exact secret rating pins the rating', () => {
  const sameRated = movie('tt9999999', 'Some 7.0 Movie', 7.0);
  const r = applyGuess(game(), sameRated);
  assert.equal(r.outcome, OUTCOME.SAME);
  assert.equal(r.state.pinned, 7.0);
  assert.deepEqual(ratingWindow(r.state), { pinned: 7.0 });
  // once pinned, anything else rated differently is outside
  const r2 = applyGuess(r.state, lobster);
  assert.equal(r2.outcome, OUTCOME.OUTSIDE);
  // the real answer still wins
  const r3 = applyGuess(r2.state, iLoveYouMan);
  assert.equal(r3.outcome, OUTCOME.CORRECT);
  assert.equal(r3.state.status, 'won');
});

test('float noise does not break equality (6.9 + 0.1 style ratings)', () => {
  const target = movie('a', 'A', 0.1 + 0.2); // 0.30000000000000004
  const guess = movie('b', 'B', 0.3);
  const r = applyGuess(createGame({ target, bounds: { high: null, low: null } }), guess);
  assert.equal(r.outcome, OUTCOME.SAME);
});

test('correct guess wins; duplicates and post-game guesses are rejected without consuming a turn', () => {
  const r = applyGuess(game(), iLoveYouMan);
  assert.equal(r.outcome, OUTCOME.CORRECT);
  assert.equal(r.state.status, 'won');
  const again = applyGuess(r.state, lobster);
  assert.ok(again.error);
  assert.equal(again.state.guesses.length, 1);

  let s = game();
  s = applyGuess(s, lobster).state;
  const dup = applyGuess(s, lobster);
  assert.ok(dup.error);
  assert.equal(dup.state.guesses.length, 1);
});

test('the game is lost after MAX_GUESSES wrong guesses', () => {
  let s = game();
  for (let i = 0; i < MAX_GUESSES; i++) {
    s = applyGuess(s, movie(`x${i}`, `X${i}`, 8.0 + i / 100)).state;
  }
  assert.equal(s.status, 'lost');
  assert.equal(s.guesses.length, MAX_GUESSES);
});

test('null bounds mean the edge of the scale', () => {
  const s = createGame({ target: godfather, bounds: { high: null, low: scaryMovie } });
  assert.deepEqual(ratingWindow(s), { low: 6.3, high: 10 });
  const r = applyGuess(s, shawshank); // 9.3 > 9.2, becomes the upper bound
  assert.equal(r.outcome, OUTCOME.HIGH);
  assert.equal(r.state.high.id, shawshank.id);
});

test('hints unlock after 2, 5, 8, 11 and 14 guesses', () => {
  assert.deepEqual(
    HINTS.map((h) => h.after),
    [2, 5, 8, 11, 14],
  );
  let s = game();
  assert.equal(unlockedHints(s).length, 0);
  s = applyGuess(s, lobster).state;
  assert.equal(unlockedHints(s).length, 0);
  s = applyGuess(s, stepBrothers).state;
  assert.deepEqual(
    unlockedHints(s).map((h) => h.key),
    ['genre'],
  );
  for (let i = 0; i < 12; i++) s = applyGuess(s, movie(`y${i}`, `Y${i}`, 8.0 + i / 100)).state;
  assert.equal(s.guesses.length, 14);
  assert.equal(unlockedHints(s).length, 5);
  assert.equal(s.status, 'playing', 'one guess left after the final hint');
});

test('hint text and the title-pattern fallback for keywords', () => {
  const target = { ...iLoveYouMan, year: 2009, genres: ['Comedy', 'Romance'], directors: ['John Hamburg'], cast: ['Paul Rudd', 'Jason Segel', 'Rashida Jones', 'Extra'] };
  assert.deepEqual(hintText(HINTS[0], target), { label: 'Genre', text: 'Comedy, Romance' });
  assert.deepEqual(hintText(HINTS[1], target), { label: 'Release year', text: '2009' });
  assert.deepEqual(hintText(HINTS[2], target), { label: 'Director', text: 'John Hamburg' });
  assert.deepEqual(hintText(HINTS[3], target), { label: 'Featured actors', text: 'Paul Rudd, Jason Segel, Rashida Jones' });
  assert.deepEqual(hintText(HINTS[4], target), { label: 'Title pattern', text: 'I L___ Y__, M__' });
  assert.deepEqual(hintText(HINTS[4], { ...target, keywords: ['bromance', 'wedding'] }), { label: 'Plot keywords', text: 'bromance, wedding' });
  assert.equal(titlePattern("Ocean's Eleven"), "O____'_ E_____");
  assert.equal(titlePattern('2001: A Space Odyssey'), '2001: A S____ O______');
  assert.equal(titlePattern('Amélie'), 'A_____');
});

test('candidate count reflects the rating window', () => {
  let s = game(); // 6.3 .. 9.3 exclusive
  // answers strictly between 6.3 and 9.3: lobster 7.1, iLoveYouMan 7.0, superbad 7.6, anchorman 7.1, stepBrothers 6.9, zoolander 6.5, hangover 7.7, godfather 9.2
  assert.equal(candidatesInWindow(all, s), 8);
  s = applyGuess(s, lobster).state; // 6.3 .. 7.1
  assert.equal(candidatesInWindow(all, s), 3); // 7.0, 6.9, 6.5
  s = applyGuess(s, movie('p', 'P', 7.0)).state; // pinned at 7.0
  assert.equal(candidatesInWindow(all, s), 1);
});

test('daily target is deterministic and walks the pool without repeating', () => {
  const a = pickDailyTarget(all, 1);
  const b = pickDailyTarget(all, 1);
  assert.equal(a.id, b.id);
  const seen = new Set();
  for (let i = 1; i <= all.length; i++) seen.add(pickDailyTarget(all, i).id);
  assert.equal(seen.size, all.length);
  assert.equal(pickDailyTarget(all, all.length + 1).id, pickDailyTarget(all, 1).id);
  assert.equal(pickDailyTarget(all, 0).id, pickDailyTarget(all, all.length).id, 'pre-launch dates still work');
});

test('bounds are a full point away when possible, nearest otherwise, never the target', () => {
  const rng = mulberry32(42);
  for (let i = 0; i < 50; i++) {
    const b = pickBounds(all, iLoveYouMan, rng);
    assert.ok(b.high.rating >= 8.0, `high ${b.high.rating}`);
    assert.ok(b.low.rating <= 6.0, `low ${b.low.rating}`);
    assert.notEqual(b.high.id, iLoveYouMan.id);
    assert.notEqual(b.low.id, iLoveYouMan.id);
  }
  // Shawshank is the top: nothing above, so high is the edge of the scale
  const top = pickBounds(all, shawshank, rng);
  assert.equal(top.high, null);
  assert.ok(top.low.rating <= 8.3);
  // Godfather 9.2: only Shawshank is above (0.1 away) -> nearest available
  const god = pickBounds(all, godfather, rng);
  assert.equal(god.high.id, shawshank.id);
});

test('puzzle numbers count from the launch date', () => {
  assert.equal(puzzleNumber('2026-10-20'), 1);
  assert.equal(puzzleNumber('2026-10-21'), 2);
  assert.equal(puzzleNumber('2027-01-01'), 74);
  assert.match(localDateString(new Date(2026, 0, 5)), /^2026-01-05$/);
});

test('share text', () => {
  let s = game();
  s = applyGuess(s, lobster).state;
  s = applyGuess(s, hangover).state;
  s = applyGuess(s, stepBrothers).state;
  s = applyGuess(s, movie('p', 'P', 7.0)).state;
  s = applyGuess(s, iLoveYouMan).state;
  assert.equal(shareText(s, { title: 'Ratingle', url: 'https://example.com' }), 'Ratingle #1 5/15\n🔼⬜🔽🟰🎯\nhttps://example.com');
  let lost = game();
  for (let i = 0; i < MAX_GUESSES; i++) lost = applyGuess(lost, movie(`x${i}`, `X${i}`, 8.0 + i / 100)).state;
  assert.ok(shareText(lost).startsWith('Ratingle #1 X/15\n🔼⬜⬜⬜⬜\n'));
});

test('search ranks exact, prefix, then substring, then by votes', () => {
  const idx = buildSearchIndex([
    ...all,
    movie('o1', 'Oldboy', 8.4, { votes: 600000, originalTitle: 'Oldeuboi' }),
    movie('m1', 'The Matrix', 8.7, { votes: 2000000 }),
    movie('m2', 'The Matrix Reloaded', 7.2, { votes: 600000 }),
  ]);
  assert.deepEqual(
    searchMovies(idx, 'the matrix').map((m) => m.id),
    ['m1', 'm2'],
  );
  assert.equal(searchMovies(idx, 'matrix')[0].id, 'm1');
  assert.equal(searchMovies(idx, 'oldeuboi')[0].id, 'o1', 'original title is searchable');
  assert.equal(searchMovies(idx, 'x').length, 0, 'needs two characters');
  assert.equal(searchMovies(idx, 'Amélie').length, 0);
  assert.equal(searchMovies(idx, 'scary  movie!')[0].id, scaryMovie.id, 'punctuation and spacing are ignored');
});

test('stats track streaks across consecutive puzzles', () => {
  let stats = emptyStats();
  const win = (no) => ({ ...applyGuess(game(), iLoveYouMan).state, puzzleNo: no });
  const loss = (no) => {
    let s = game();
    for (let i = 0; i < MAX_GUESSES; i++) s = applyGuess(s, movie(`x${i}`, `X${i}`, 8.0 + i / 100)).state;
    return { ...s, puzzleNo: no };
  };
  stats = recordResult(stats, win(1));
  stats = recordResult(stats, win(2));
  assert.equal(stats.streak, 2);
  stats = recordResult(stats, win(4)); // skipped a day
  assert.equal(stats.streak, 1);
  assert.equal(stats.maxStreak, 2);
  stats = recordResult(stats, loss(5));
  assert.equal(stats.streak, 0);
  assert.equal(stats.played, 4);
  assert.equal(stats.won, 3);
  assert.deepEqual(stats.distribution, { 1: 3 });
  assert.equal(recordResult(stats, game()), stats, 'unfinished games are ignored');
});
