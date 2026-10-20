/**
 * Game engine shared by every "prox" game. Pure functions, no DOM.
 *
 * A game is described by a config object (see src/games/*.js). The engine only needs
 * to know how to read a numeric value from an item, how to compare and format it,
 * which hints exist and how to search items. The rules are the same for every game:
 *
 * - A secret item is chosen from the answer pool. You start with two bound items,
 *   one above the secret and one below.
 * - Each guess reveals the item's value and compares it to the secret:
 *     * above the secret and below the current upper bound -> new upper bound
 *     * below the secret and above the current lower bound -> new lower bound
 *     * exactly the secret's value -> the value is "pinned"
 *     * otherwise the guess falls outside the current range and is wasted
 * - MAX_GUESSES guesses. Hints unlock after a fixed number of guesses.
 */

export const MAX_GUESSES = 15;
export const HINT_SCHEDULE = [2, 5, 8, 11, 14];

export const OUTCOME = {
  HIGH: 'high',
  LOW: 'low',
  SAME: 'same',
  OUTSIDE: 'outside',
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

export function hashString(str) {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

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

// ---------- dates ----------

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

/** Puzzle #1 is the game's launch date. */
export function puzzleNumber(cfg, dateStr) {
  return dayIndex(dateStr) - dayIndex(cfg.launchDate) + 1;
}

// ---------- values ----------

export const valueOf = (cfg, item) => cfg.metric.value(item);
export const quantize = (cfg, v) => cfg.metric.quantize(v);
export const sameValue = (cfg, a, b) => quantize(cfg, a) === quantize(cfg, b);
/** Format a value for display. The item is passed when known, for games whose display is not the number itself. */
export const formatValue = (cfg, v, item) => cfg.metric.format(v, item);

/** Track position in [0, 1]. `items` is passed for games whose scale depends on the data. */
export const trackPosition = (cfg, v, items) => Math.min(1, Math.max(0, cfg.metric.scale.position(v, items)));

/** Track ticks: [{ value, label }], static or derived from the data. */
export const trackTicks = (cfg, items) => (typeof cfg.metric.scale.ticks === 'function' ? cfg.metric.scale.ticks(items) : cfg.metric.scale.ticks);

// ---------- setup ----------

export function answerPool(items) {
  return items.filter((m) => m.answer);
}

/** The daily secret: the answer pool shuffled once with a fixed seed, indexed by day. */
export function pickDailyTarget(cfg, items, puzzleNo) {
  const pool = answerPool(items)
    .slice()
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (pool.length === 0) throw new Error('No items in the answer pool');
  const order = seededShuffle(pool, cfg.shuffleSeed);
  const idx = (((puzzleNo - 1) % order.length) + order.length) % order.length;
  return order[idx];
}

export function pickRandomTarget(items, rng = Math.random) {
  const pool = answerPool(items);
  if (pool.length === 0) throw new Error('No items in the answer pool');
  return pool[Math.floor(rng() * pool.length)];
}

/**
 * Starting bounds. Preference order on each side of the target:
 *   1. a well-known item (cfg.boundCandidates) that is "far enough" away (cfg.farEnough)
 *   2. any answer-pool item that is far enough away
 *   3. the nearest answer-pool item(s) on that side
 * `null` means nothing lies on that side: the edge of the scale.
 */
export function pickBounds(cfg, items, target, rng = Math.random) {
  const pool = answerPool(items).filter((m) => m.id !== target.id);
  const preferred = cfg.boundCandidates ? cfg.boundCandidates(pool) : pool;
  const t = valueOf(cfg, target);
  const pick = (candidates) => candidates[Math.floor(rng() * candidates.length)];

  const side = (dir) => {
    const onSide = (m) => (dir > 0 ? valueOf(cfg, m) > t : valueOf(cfg, m) < t);
    let c = preferred.filter((m) => onSide(m) && cfg.farEnough(m, target));
    if (!c.length) c = pool.filter((m) => onSide(m) && cfg.farEnough(m, target));
    if (!c.length) {
      const all = pool.filter(onSide);
      if (!all.length) return null;
      const values = all.map((m) => valueOf(cfg, m));
      const extreme = dir > 0 ? Math.max(...values) : Math.min(...values);
      c = all.filter((m) => sameValue(cfg, valueOf(cfg, m), extreme));
    }
    return pick(c);
  };
  return { high: side(1), low: side(-1) };
}

export function createGame({ target, bounds, mode = 'daily', puzzleNo = null, date = null }) {
  return {
    mode,
    puzzleNo,
    date,
    target,
    high: bounds.high,
    low: bounds.low,
    pinned: null,
    guesses: [],
    status: 'playing',
  };
}

// ---------- play ----------

/** Apply a guess. Returns { state, outcome } or { state, error }. Never mutates. */
export function applyGuess(cfg, state, item) {
  if (state.status !== 'playing') return { state, error: 'The game is over.' };
  if (!item || typeof valueOf(cfg, item) !== 'number') return { state, error: 'Pick one from the list.' };
  if (state.guesses.some((g) => g.item.id === item.id)) return { state, error: 'You already guessed that one.' };

  const t = valueOf(cfg, state.target);
  const v = valueOf(cfg, item);
  let { high, low, pinned } = state;
  let outcome;

  if (item.id === state.target.id) {
    outcome = OUTCOME.CORRECT;
  } else if (sameValue(cfg, v, t)) {
    outcome = OUTCOME.SAME;
    pinned = t;
  } else if (pinned !== null) {
    outcome = OUTCOME.OUTSIDE;
  } else if (v > t) {
    if (high === null || v < valueOf(cfg, high)) {
      outcome = OUTCOME.HIGH;
      high = item;
    } else outcome = OUTCOME.OUTSIDE;
  } else if (low === null || v > valueOf(cfg, low)) {
    outcome = OUTCOME.LOW;
    low = item;
  } else outcome = OUTCOME.OUTSIDE;

  const guesses = [...state.guesses, { item, outcome }];
  let status = 'playing';
  if (outcome === OUTCOME.CORRECT) status = 'won';
  else if (guesses.length >= MAX_GUESSES) status = 'lost';

  return { state: { ...state, high, low, pinned, guesses, status }, outcome };
}

export function guessesLeft(state) {
  return MAX_GUESSES - state.guesses.length;
}

/** Current window: { low, high } (exclusive values) or { pinned }. */
export function valueWindow(cfg, state) {
  if (state.pinned !== null) return { pinned: state.pinned };
  return {
    low: state.low ? valueOf(cfg, state.low) : cfg.metric.scale.min,
    high: state.high ? valueOf(cfg, state.high) : cfg.metric.scale.max,
  };
}

export function valueInWindow(cfg, state, v) {
  const w = valueWindow(cfg, state);
  if ('pinned' in w) return sameValue(cfg, v, w.pinned);
  return quantize(cfg, v) > quantize(cfg, w.low) && quantize(cfg, v) < quantize(cfg, w.high);
}

/** How many answer-pool items could still be the secret, judging by value alone. */
export function candidatesInWindow(cfg, items, state) {
  return answerPool(items).filter((m) => valueInWindow(cfg, state, valueOf(cfg, m))).length;
}

// ---------- hints ----------

export function hints(cfg) {
  return cfg.hints.map((h, i) => ({ ...h, after: HINT_SCHEDULE[i] }));
}

export function unlockedHints(cfg, state) {
  const n = state.guesses.length;
  return hints(cfg).filter((h) => n >= h.after);
}

export function nextHint(cfg, state) {
  const n = state.guesses.length;
  return hints(cfg).find((h) => n < h.after) || null;
}

/** Text for a hint: { label, text }. A hint's text() may return a string or { label, text }. */
export function hintText(hint, target) {
  const r = hint.text(target);
  if (r && typeof r === 'object') return { label: r.label || hint.label, text: r.text || 'Unknown' };
  return { label: hint.label, text: r || 'Unknown' };
}

/**
 * Turn "I Love You, Man" into "I L___ Y__, M__". The first letter of each word stays,
 * every other letter becomes "_". Digits and punctuation are kept.
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

// ---------- sharing ----------

export function shareText(cfg, state, { url = '' } = {}) {
  const won = state.status === 'won';
  const n = state.guesses.length;
  const header =
    state.mode === 'daily' && state.puzzleNo !== null
      ? `${cfg.title} #${state.puzzleNo} ${won ? n : 'X'}/${MAX_GUESSES}`
      : `${cfg.title} (random) ${won ? n : 'X'}/${MAX_GUESSES}`;
  const emoji = state.guesses.map((g) => OUTCOME_EMOJI[g.outcome]);
  const rows = [];
  for (let i = 0; i < emoji.length; i += 5) rows.push(emoji.slice(i, i + 5).join(''));
  return [header, ...rows, url].filter(Boolean).join('\n');
}

// ---------- search ----------

export function normalizeText(str) {
  return str
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/&/g, 'and')
    .replace(/\$/g, 's')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

export function buildSearchIndex(cfg, items) {
  return items.map((item) => {
    const [primary, ...others] = cfg.searchTexts(item).filter(Boolean).map(normalizeText);
    return { item, norm: primary, others, weight: cfg.weight(item) };
  });
}

export function searchItems(index, query, limit = 8) {
  const q = normalizeText(query);
  if (q.length < 2) return [];
  const scored = [];
  for (const entry of index) {
    let score = null;
    if (entry.norm === q) score = 0;
    else if (entry.norm.startsWith(q)) score = 1;
    else if (entry.norm.includes(q)) score = 2;
    else if (entry.others.some((o) => o.includes(q))) score = 3;
    if (score !== null) scored.push({ score, entry });
  }
  scored.sort((a, b) => a.score - b.score || b.entry.weight - a.entry.weight);
  return scored.slice(0, limit).map((s) => s.entry.item);
}

// ---------- stats ----------

export function emptyStats() {
  return { played: 0, won: 0, streak: 0, maxStreak: 0, lastPuzzle: null, distribution: {} };
}

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
