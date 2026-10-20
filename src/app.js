import * as G from './game.js';

const DATA_URL = 'data/movies.json';
const STORAGE_PREFIX = 'movieprox:v1:';
const KEY_STATS = STORAGE_PREFIX + 'stats';
const keyDaily = (no) => `${STORAGE_PREFIX}daily:${no}`;

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);

const app = {
  movies: [],
  byId: new Map(),
  index: null,
  game: null,
  selected: null,
  suggestions: [],
  activeIdx: -1,
  countdownTimer: null,
};

// ---------- storage ----------

function loadJSON(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
}
function saveJSON(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* private mode or full storage; the game still works for this session */
  }
}

// ---------- game setup ----------

function startDaily() {
  const date = G.localDateString();
  const puzzleNo = G.puzzleNumber(date);
  const target = G.pickDailyTarget(app.movies, puzzleNo);
  const bounds = G.pickBounds(app.movies, target, G.mulberry32(G.hashString('bounds:' + date)));
  let game = G.createGame({ target, bounds, mode: 'daily', puzzleNo, date });

  const saved = loadJSON(keyDaily(puzzleNo), null);
  if (saved && saved.targetId === target.id && Array.isArray(saved.guessIds)) {
    for (const id of saved.guessIds) {
      const m = app.byId.get(id);
      if (m) game = G.applyGuess(game, m).state;
    }
  }
  app.game = game;
  app.recorded = Boolean(saved?.recorded);
  afterStateChange({ persist: false });
}

function startRandom() {
  const target = G.pickRandomTarget(app.movies);
  const bounds = G.pickBounds(app.movies, target);
  app.game = G.createGame({ target, bounds, mode: 'random' });
  app.recorded = true; // random games never touch the stats
  afterStateChange({ persist: false });
}

function persistDaily() {
  if (app.game.mode !== 'daily') return;
  saveJSON(keyDaily(app.game.puzzleNo), {
    targetId: app.game.target.id,
    guessIds: app.game.guesses.map((g) => g.movie.id),
    recorded: app.recorded,
  });
}

function afterStateChange({ persist = true } = {}) {
  const g = app.game;
  if (g.status !== 'playing' && g.mode === 'daily' && !app.recorded) {
    saveJSON(KEY_STATS, G.recordResult(loadJSON(KEY_STATS, G.emptyStats()), g));
    app.recorded = true;
  }
  if (persist) persistDaily();
  render();
}

// ---------- guessing ----------

function submitGuess() {
  let movie = app.selected;
  if (!movie) {
    const input = $('#guess-input');
    const q = input ? input.value : '';
    const matches = G.searchMovies(app.index, q, 2);
    if (matches.length === 1 || (matches.length > 1 && G.normalizeTitle(matches[0].title) === G.normalizeTitle(q))) {
      movie = matches[0];
    }
  }
  if (!movie) {
    toast('Pick a movie from the list');
    return;
  }
  const { state, error } = G.applyGuess(app.game, movie);
  if (error) {
    toast(error);
    return;
  }
  app.game = state;
  app.selected = null;
  afterStateChange();
  const input = $('#guess-input');
  if (input) input.focus();
}

// ---------- rendering ----------

function render() {
  const g = app.game;
  const main = $('#app');
  const over = g.status !== 'playing';
  main.innerHTML = [renderMeta(g), renderBounds(g), over ? renderResult(g) : renderForm(g), renderHints(g), renderHistory(g)].join('');
  wireForm();
  wireResult();
  $('#btn-mode').classList.toggle('active', g.mode === 'random');
  $('#btn-mode').title = g.mode === 'random' ? 'Back to today’s puzzle' : 'Random puzzle';
  startCountdown();
}

function renderMeta(g) {
  const left = g.mode === 'daily' ? `Puzzle #${g.puzzleNo} · ${g.date}` : 'Random puzzle';
  const n = g.guesses.length;
  return `<div class="puzzle-meta"><span>${esc(left)}</span><span>Guess ${Math.min(n + 1, G.MAX_GUESSES)} of ${G.MAX_GUESSES}</span></div>`;
}

function boundCard(kind, movie, edgeLabel) {
  if (!movie) {
    const rating = kind === 'high' ? '10.0' : '0.0';
    return `<div class="bound ${kind} edge"><div class="rating">${rating}</div><div><div class="title">${esc(edgeLabel)}</div><div class="sub">No movie in the pool is rated ${kind === 'high' ? 'higher' : 'lower'}</div></div></div>`;
  }
  return `<div class="bound ${kind}"><div class="rating">${G.formatRating(movie.rating)}</div><div><div class="title">${esc(movie.title)} <span class="muted">(${movie.year})</span></div><div class="sub">${kind === 'high' ? 'Upper bound · the secret movie is rated lower' : 'Lower bound · the secret movie is rated higher'}</div></div></div>`;
}

function renderBounds(g) {
  const count = G.candidatesInWindow(app.movies, g);
  const w = G.ratingWindow(g);
  let between;
  if ('pinned' in w) {
    between = `<div class="between pinned"><span class="line"></span><span>Rating pinned at <strong>${G.formatRating(w.pinned)}</strong> · ${count} possible ${count === 1 ? 'movie' : 'movies'}</span><span class="line"></span></div>`;
  } else {
    between = `<div class="between"><span class="line"></span><span><strong>${count}</strong> possible ${count === 1 ? 'movie' : 'movies'} in this range</span><span class="line"></span></div>`;
  }
  return `<section class="panel bounds">
    ${boundCard('high', g.high, 'Top of the scale')}
    ${between}
    ${boundCard('low', g.low, 'Bottom of the scale')}
    ${renderTrack(g)}
  </section>`;
}

function renderTrack(g) {
  const pct = (r) => `${(r / 10) * 100}%`;
  const w = G.ratingWindow(g);
  const lowR = 'pinned' in w ? w.pinned - 0.05 : w.low;
  const highR = 'pinned' in w ? w.pinned + 0.05 : w.high;
  const marks = g.guesses
    .map((x) => `<span class="mark ${x.outcome}" style="left:${pct(x.movie.rating)}" title="${esc(x.movie.title)} ${G.formatRating(x.movie.rating)}"></span>`)
    .join('');
  const target = g.status !== 'playing' ? `<span class="mark target" style="left:${pct(g.target.rating)}" title="${esc(g.target.title)}"></span>` : '';
  const ticks = [0, 2, 4, 6, 8, 10].map((t) => `<span class="tick" style="left:${pct(t)}">${t}</span>`).join('');
  return `<div class="track" aria-hidden="true"><div class="rail"></div><div class="window" style="left:${pct(lowR)};width:calc(${pct(highR)} - ${pct(lowR)})"></div>${marks}${target}${ticks}</div>`;
}

function renderForm(g) {
  const next = G.nextHint(g);
  const nextText = next ? `Next hint (${next.label.toLowerCase()}) after guess ${next.after}` : 'All hints unlocked';
  return `<section class="panel guess-form">
    <form id="guess-form" autocomplete="off">
      <div class="input-row">
        <input id="guess-input" type="text" placeholder="Type a movie title…" aria-label="Movie title" aria-autocomplete="list" aria-controls="suggestions" spellcheck="false" autofocus />
        <button class="btn" type="submit" id="guess-btn">Guess</button>
      </div>
      <ul class="suggestions" id="suggestions" role="listbox"></ul>
    </form>
    <div class="form-meta"><span>${G.guessesLeft(g)} ${G.guessesLeft(g) === 1 ? 'guess' : 'guesses'} left</span><span>${esc(nextText)}</span></div>
  </section>`;
}

function renderHints(g) {
  const unlocked = new Set(G.unlockedHints(g).map((h) => h.key));
  const showAll = g.status !== 'playing';
  const cards = G.HINTS.map((h) => {
    if (unlocked.has(h.key) || showAll) {
      const { label, text } = G.hintText(h, g.target);
      return `<div class="hint unlocked"><div class="label">${esc(label)}</div><div class="value">${esc(text)}</div></div>`;
    }
    return `<div class="hint locked"><div class="label">🔒 ${esc(h.label)}</div><div class="value">Unlocks after guess ${h.after}</div></div>`;
  }).join('');
  return `<section class="hints" aria-label="Hints">${cards}</section>`;
}

const OUTCOME_TEXT = {
  high: 'New upper bound',
  low: 'New lower bound',
  same: 'Same rating as the secret movie!',
  outside: 'Outside the range',
  correct: 'Correct!',
};

function renderHistory(g) {
  if (g.guesses.length === 0) return '';
  const items = g.guesses
    .map((x, i) => ({ ...x, n: i + 1 }))
    .reverse()
    .map(
      (x) => `<li class="${x.outcome}">
        <span class="n">${x.n}</span>
        <span><div class="t">${G.OUTCOME_EMOJI[x.outcome]} ${esc(x.movie.title)} <span class="year">(${x.movie.year})</span></div><div class="o">${OUTCOME_TEXT[x.outcome]}</div></span>
        <span class="r">${G.formatRating(x.movie.rating)}</span>
      </li>`,
    )
    .join('');
  return `<section class="panel"><ul class="history">${items}</ul></section>`;
}

function renderResult(g) {
  const won = g.status === 'won';
  const t = g.target;
  const details = [t.year, t.genres?.join(', '), t.directors?.length ? `dir. ${t.directors.join(', ')}` : null, t.cast?.slice(0, 3).join(', ')]
    .filter(Boolean)
    .join(' · ');
  const share = G.shareText(g, { title: G.GAME_TITLE, url: shareUrl() });
  return `<section class="panel result">
    <h2>${won ? `🎉 Got it in ${g.guesses.length}!` : '😵 Out of guesses'}</h2>
    <div class="answer">
      <div class="rating">${G.formatRating(t.rating)}</div>
      <div><div class="title">${esc(t.title)}</div><div class="details">${esc(details)}</div></div>
    </div>
    <pre id="share-text">${esc(share)}</pre>
    <div class="actions">
      <button class="btn" id="btn-share">Share result</button>
      <button class="btn secondary" id="btn-random">Play a random one</button>
    </div>
    ${g.mode === 'daily' ? '<div class="next">Next puzzle in <span id="countdown"></span></div>' : ''}
  </section>`;
}

function shareUrl() {
  return location.origin + location.pathname;
}

// ---------- autocomplete ----------

function wireForm() {
  const form = $('#guess-form');
  if (!form) return;
  const input = $('#guess-input');
  const list = $('#suggestions');

  const renderSuggestions = () => {
    list.innerHTML = app.suggestions
      .map(
        (m, i) =>
          `<li role="option" data-i="${i}" class="${i === app.activeIdx ? 'active' : ''}" aria-selected="${i === app.activeIdx}"><span>${esc(m.title)}</span><span class="year">${m.year}</span></li>`,
      )
      .join('');
  };
  const close = () => {
    app.suggestions = [];
    app.activeIdx = -1;
    renderSuggestions();
  };
  const choose = (m) => {
    app.selected = m;
    input.value = `${m.title} (${m.year})`;
    close();
  };

  input.addEventListener('input', () => {
    app.selected = null;
    app.suggestions = G.searchMovies(app.index, input.value, 8);
    app.activeIdx = app.suggestions.length ? 0 : -1;
    renderSuggestions();
  });
  input.addEventListener('keydown', (e) => {
    if (!app.suggestions.length) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      app.activeIdx = (app.activeIdx + 1) % app.suggestions.length;
      renderSuggestions();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      app.activeIdx = (app.activeIdx - 1 + app.suggestions.length) % app.suggestions.length;
      renderSuggestions();
    } else if (e.key === 'Escape') {
      close();
    } else if (e.key === 'Enter' && app.activeIdx >= 0) {
      e.preventDefault();
      choose(app.suggestions[app.activeIdx]);
      submitGuess();
    }
  });
  list.addEventListener('mousedown', (e) => {
    const li = e.target.closest('li');
    if (!li) return;
    e.preventDefault();
    choose(app.suggestions[Number(li.dataset.i)]);
    submitGuess();
  });
  input.addEventListener('blur', () => setTimeout(close, 150));
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    if (app.activeIdx >= 0 && app.suggestions.length && !app.selected) choose(app.suggestions[app.activeIdx]);
    submitGuess();
  });
  input.focus();
}

function wireResult() {
  $('#btn-share')?.addEventListener('click', async () => {
    const text = $('#share-text').textContent;
    try {
      if (navigator.share && /Mobi|Android/i.test(navigator.userAgent)) {
        await navigator.share({ text });
        return;
      }
      await navigator.clipboard.writeText(text);
      toast('Copied to clipboard');
    } catch {
      toast('Could not copy. Select the text above instead.');
    }
  });
  $('#btn-random')?.addEventListener('click', startRandom);
}

function startCountdown() {
  clearInterval(app.countdownTimer);
  const el = $('#countdown');
  if (!el) return;
  const tick = () => {
    const now = new Date();
    const midnight = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
    const ms = midnight - now;
    const h = Math.floor(ms / 3_600_000);
    const m = Math.floor((ms % 3_600_000) / 60_000);
    const s = Math.floor((ms % 60_000) / 1000);
    el.textContent = `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
    if (ms < 1000) {
      clearInterval(app.countdownTimer);
      startDaily();
    }
  };
  tick();
  app.countdownTimer = setInterval(tick, 1000);
}

// ---------- stats dialog ----------

function renderStats() {
  const s = loadJSON(KEY_STATS, G.emptyStats());
  const pct = s.played ? Math.round((s.won / s.played) * 100) : 0;
  const max = Math.max(1, ...Object.values(s.distribution));
  const today = app.game?.mode === 'daily' && app.game.status === 'won' ? app.game.guesses.length : null;
  const rows = Array.from({ length: G.MAX_GUESSES }, (_, i) => i + 1)
    .map((n) => {
      const v = s.distribution[n] || 0;
      return `<div class="bar-row"><span>${n}</span><div class="bar ${n === today ? 'hit' : ''}" style="width:${Math.max(8, (v / max) * 100)}%">${v}</div></div>`;
    })
    .join('');
  $('#stats-body').innerHTML = `
    <div class="stat-grid">
      <div><div class="v">${s.played}</div><div class="k">Played</div></div>
      <div><div class="v">${pct}%</div><div class="k">Win rate</div></div>
      <div><div class="v">${s.streak}</div><div class="k">Streak</div></div>
      <div><div class="v">${s.maxStreak}</div><div class="k">Best streak</div></div>
    </div>
    <div class="label muted small" style="margin-bottom:6px">Guess distribution</div>
    <div class="dist">${rows}</div>`;
}

// ---------- misc ----------

let toastTimer;
function toast(msg) {
  const el = $('#toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 1800);
}

function showError(message) {
  $('#app').innerHTML = `<section class="panel error-box"><h2>Could not load the movie data</h2><p>${message}</p><p class="muted small">Generate it with <code>npm run build:data</code> (see the README), then reload.</p></section>`;
}

async function init() {
  $('#btn-help').addEventListener('click', () => $('#dlg-help').showModal());
  $('#btn-stats').addEventListener('click', () => {
    renderStats();
    $('#dlg-stats').showModal();
  });
  $('#btn-mode').addEventListener('click', () => {
    if (app.game?.mode === 'random') startDaily();
    else startRandom();
  });

  try {
    const url = new URLSearchParams(location.search).get('data') || DATA_URL;
    const res = await fetch(url, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status} for ${esc(url)}`);
    const data = await res.json();
    app.movies = data.movies;
    app.byId = new Map(app.movies.map((m) => [m.id, m]));
    app.index = G.buildSearchIndex(app.movies);
    if (G.answerPool(app.movies).length === 0) throw new Error('The data file has no movies flagged as possible answers.');
  } catch (err) {
    showError(esc(err.message));
    return;
  }

  if (!localStorage.getItem(STORAGE_PREFIX + 'seen-help')) {
    $('#dlg-help').showModal();
    saveJSON(STORAGE_PREFIX + 'seen-help', true);
  }
  startDaily();
}

init();
