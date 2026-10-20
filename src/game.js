/**
 * Game engine. Pure functions, no DOM, shared by the browser app and the tests.
 *
 * Rules
 * - A secret movie is chosen from the answer pool. You start with two bound movies,
 *   one rated above the secret movie and one below.
 * - Each guess is a movie. Its IMDb rating is revealed and compared to the secret:
 *     * rated above the secret and below the current upper bound -> it becomes the new upper bound
 *     * rated below the secret and above the current lower bound -> it becomes the new lower bound
 *     * exactly the secret's rating -> the rating is "pinned": you now know the exact rating
 *     * otherwise the guess falls outside the current range and is wasted
 * - 15 guesses. Hints unlock after 2, 5, 8, 11 and 14 guesses.
 */

export const GAME_TITLE = 'Ratingle';
export const MAX_GUESSES = 15;
export const LAUNCH_DATE = '2026-10-20';
export const SHUFFLE_SEED = 0x5eed1e;

export const HINTS = [
  { key: 'genre', label: 'Genre', after: 2 },
  { key: 'year', label: 'Release year', after: 5 },
  { key: 'director', label: 'Director', after: 8 },
  { key: 'cast', label: 'Featured actors', after: 11 },
  { key: 'keywords', label: 'Plot keywords', after: 14 },
];

export const OUTCOME = {
  HIGH: 'high', // became the new upper bound
  LOW: 'low', // became the new lower bound
  SAME: 'same', // same rating as the secret movie
  OUTSIDE: 'outside', // outside the current range, no new information
  CORRECT: 'correct',
};

export const OUTCOME_EMOJI = {
  high: '🔼',
  low: '🔽',
  same: '🟰',
  outside: '⬜',
  correct: '🎯',
};

// ---------- deterministic randomness ----------

/** FNV-1a 32-bit hash of a string. */
export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/** Small, fast seeded PRNG. Returns a function producing floats in [0, 1). */
export function mulberry32(seed) {
  let a = seed >>> 0;
  return function next() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function seededShuffle(items, seed) {
  const arr = items.slice();
  const rng = mulberry32(seed);
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ---------- dates and puzzle numbers ----------

/** Local calendar date as YYYY-MM-DD. */
export function localDateString(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

function dayIndex(dateStr) {
  const [y, m, d] = dateStr.split('-').map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / 86_400_000);
}

/** Puzzle #1 is LAUNCH_DATE. Dates before launch count backwards (still deterministic). */
export function puzzleNumber(dateStr) {
  return dayIndex(dateStr) - dayIndex(LAUNCH_DATE) + 1;
}

// ---------- ratings ----------

/** Ratings have one decimal; compare in tenths to dodge float noise. */
export const tenths = (rating) => Math.round(rating * 10);
export const sameRating = (a, b) => tenths(a) === tenths(b);
export const formatRating = (rating) => rating.toFixed(1);

// ---------- setup ----------

export function answerPool(movies) {
  return movies.filter((m) => m.answer);
}

/**
 * Pick the daily secret. The answer pool is shuffled once with a fixed seed, so the
 * order is stable as long as the pool is; a new day walks to the next entry.
 */
export function pickDailyTarget(movies, puzzleNo) {
  const pool = answerPool(movies).slice().sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pool.length === 0) throw new Error('No movies in the answer pool');
  const order = seededShuffle(pool, SHUFFLE_SEED);
  const idx = (((puzzleNo - 1) % order.length) + order.length) % order.length;
  return order[idx];
}

export function pickRandomTarget(movies, rng = Math.random) {
  const pool = answerPool(movies);
  if (pool.length === 0) throw new Error('No movies in the answer pool');
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Starting bounds: well-known movies at least a full point above/below the target
 * when possible, otherwise the nearest thing available. `null` means the edge of
 * the scale (no movie rated higher/lower exists in the pool).
 */
export function pickBounds(movies, target, rng = Math.random) {
  const pool = answerPool(movies).filter((m) => m.id !== target.id);
  const t = target.rating;

  const pick = (candidates) => candidates[Math.floor(rng() * candidates.length)];

  let highs = pool.filter((m) => m.rating >= t + 1);
  if (highs.length === 0) {
    const above = pool.filter((m) => m.rating > t);
    if (above.length) {
      const max = Math.max(...above.map((m) => m.rating));
      highs = above.filter((m) => sameRating(m.rating, max));
    }
  }
  let lows = pool.filter((m) => m.rating <= t - 1);
  if (lows.length === 0) {
    const below = pool.filter((m) => m.rating < t);
    if (below.length) {
      const min = Math.min(...below.map((m) => m.rating));
      lows = below.filter((m) => sameRating(m.rating, min));
    }
  }
  return {
    high: highs.length ? pick(highs) : null,
    low: lows.length ? pick(lows) : null,
  };
}

export function createGame({ target, bounds, mode = 'daily', puzzleNo = null, date = null }) {
  return {
    mode,
    puzzleNo,
    date,
    target,
    high: bounds.high,
    low: bounds.low,
    pinned: null, // rating (number) once a guess matched the secret's rating exactly
    guesses: [],
    status: 'playing', // 'playing' | 'won' | 'lost'
  };
}

// ---------- play ----------

/** Apply a guess. Returns { state, outcome } or { state, error }. Never mutates. */
export function applyGuess(state, movie) {
  if (state.status !== 'playing') return { state, error: 'The game is over.' };
  if (!movie || typeof movie.rating !== 'number') return { state, error: 'Pick a movie from the list.' };
  if (state.guesses.some((g) => g.movie.id === movie.id)) return { state, error: 'You already guessed that one.' };

  const t = state.target.rating;
  let { high, low, pinned } = state;
  let outcome;

  if (movie.id === state.target.id) {
    outcome = OUTCOME.CORRECT;
  } else if (sameRating(movie.rating, t)) {
    outcome = OUTCOME.SAME;
    pinned = t;
  } else if (pinned !== null) {
    outcome = OUTCOME.OUTSIDE;
  } else if (movie.rating > t) {
    if (high === null || movie.rating < high.rating) {
      outcome = OUTCOME.HIGH;
      high = movie;
    } else {
      outcome = OUTCOME.OUTSIDE;
    }
  } else if (low === null || movie.rating > low.rating) {
    outcome = OUTCOME.LOW;
    low = movie;
  } else {
    outcome = OUTCOME.OUTSIDE;
  }

  const guesses = [...state.guesses, { movie, outcome }];
  let status = 'playing';
  if (outcome === OUTCOME.CORRECT) status = 'won';
  else if (guesses.length >= MAX_GUESSES) status = 'lost';

  return { state: { ...state, high, low, pinned, guesses, status }, outcome };
}

export function guessesLeft(state) {
  return MAX_GUESSES - state.guesses.length;
}

/** The current rating window as numbers: [lowRating, highRating], exclusive, or the pinned rating. */
export function ratingWindow(state) {
  if (state.pinned !== null) return { pinned: state.pinned };
  return {
    low: state.low ? state.low.rating : 0,
    high: state.high ? state.high.rating : 10,
  };
}

/** Is this rating still possible for the secret movie? */
export function ratingInWindow(state, rating) {
  const w = ratingWindow(state);
  if ('pinned' in w) return sameRating(rating, w.pinned);
  return tenths(rating) > tenths(w.low) && tenths(rating) < tenths(w.high);
}

/** How many answer-pool movies could still be the secret, judging by rating alone. */
export function candidatesInWindow(movies, state) {
  return answerPool(movies).filter((m) => ratingInWindow(state, m.rating)).length;
}

// ---------- hints ----------

export function unlockedHints(state) {
  const n = state.guesses.length;
  return HINTS.filter((h) => n >= h.after);
}

export function nextHint(state) {
  const n = state.guesses.length;
  return HINTS.find((h) => n < h.after) || null;
}

/**
 * Turn "I Love You, Man" into "I L___ Y__, M__". The first letter of each word stays,
 * every other letter becomes "_". Digits and punctuation are kept as they are.
 */
export function titlePattern(title) {
  return title
    .split(/(\s+)/)
    .map((part) => {
      if (/^\s*$/.test(part)) return part;
      let revealed = false;
      return Array.from(part)
        .map((ch) => {
          if (!/\p{L}/u.test(ch)) return ch;
          if (!revealed) {
            revealed = true;
            return ch;
          }
          return '_';
        })
        .join('');
    })
    .join('');
}

/** Text for a hint. Returns { label, text }. */
export function hintText(hint, target) {
  switch (hint.key) {
    case 'genre':
      return { label: hint.label, text: target.genres?.length ? target.genres.join(', ') : 'Unknown' };
    case 'year':
      return { label: hint.label, text: String(target.year) };
    case 'director':
      return { label: hint.label, text: target.directors?.length ? target.directors.join(', ') : 'Unknown' };
    case 'cast':
      return { label: hint.label, text: target.cast?.length ? target.cast.slice(0, 3).join(', ') : 'Unknown' };
    case 'keywords':
      if (target.keywords?.length) return { label: hint.label, text: target.keywords.slice(0, 6).join(', ') };
      return { label: 'Title pattern', text: titlePattern(target.title) };
    default:
      return { label: hint.label, text: '' };
  }
}

// ---------- sharing ----------

export function shareText(state, { title = GAME_TITLE, url = '' } = {}) {
  const won = state.status === 'won';
  const n = state.guesses.length;
  const header =
    state.mode === 'daily' && state.puzzleNo !== null
      ? `${title} #${state.puzzleNo} ${won ? n : 'X'}/${MAX_GUESSES}`
      : `${title} (random) ${won ? n : 'X'}/${MAX_GUESSES}`;
  const emoji = state.guesses.map((g) => OUTCOME_EMOJI[g.outcome]);
  const rows = [];
  for (let i = 0; i < emoji.length; i += 5) rows.push(emoji.slice(i, i + 5).join(''));
  return [header, ...rows, url].filter(Boolean).join('\n');
}

// ---------- search ----------

export function normalizeTitle(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

/** Build a search index once; `searchMovies` uses it. */
export function buildSearchIndex(movies) {
  return movies.map((m) => ({
    movie: m,
    norm: normalizeTitle(m.title),
    normOriginal: m.originalTitle ? normalizeTitle(m.originalTitle) : null,
  }));
}

export function searchMovies(index, query, limit = 8) {
  const q = normalizeTitle(query);
  if (q.length < 2) return [];
  const scored = [];
  for (const entry of index) {
    let score = null;
    if (entry.norm === q) score = 0;
    else if (entry.norm.startsWith(q)) score = 1;
    else if (entry.norm.includes(' ' + q) || entry.norm.includes(q)) score = 2;
    else if (entry.normOriginal && entry.normOriginal.includes(q)) score = 3;
    if (score !== null) scored.push({ score, entry });
  }
  scored.sort((a, b) => a.score - b.score || b.entry.movie.votes - a.entry.movie.votes);
  return scored.slice(0, limit).map((s) => s.entry.movie);
}

// ---------- stats ----------

export function emptyStats() {
  return { played: 0, won: 0, streak: 0, maxStreak: 0, lastPuzzle: null, distribution: {} };
}

/** Record a finished daily game. Returns new stats; never mutates. */
export function recordResult(stats, state) {
  if (state.status === 'playing') return stats;
  const s = { ...stats, distribution: { ...stats.distribution } };
  s.played += 1;
  if (state.status === 'won') {
    s.won += 1;
    const n = state.guesses.length;
    s.distribution[n] = (s.distribution[n] || 0) + 1;
    const consecutive = s.lastPuzzle !== null && state.puzzleNo === s.lastPuzzle + 1;
    s.streak = consecutive ? s.streak + 1 : 1;
    s.maxStreak = Math.max(s.maxStreak, s.streak);
  } else {
    s.streak = 0;
  }
  s.lastPuzzle = state.puzzleNo;
  return s;
}
