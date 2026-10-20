import * as E from './engine.js';
import { GAMES, gameHref } from './games/index.js';

const $ = (sel) => document.querySelector(sel);
const esc = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

/** Boot a game from its config. Called by each page. */
export function start(cfg) {
  const app = {
    cfg,
    items: [],
    byId: new Map(),
    index: null,
    game: null,
    recorded: false,
    selected: null,
    suggestions: [],
    activeIdx: -1,
    countdownTimer: null,
  };
  const PREFIX = `${cfg.storageKey}:v1:`;
  const KEY_STATS = PREFIX + 'stats';
  const keyDaily = (no) => `${PREFIX}daily:${no}`;
  const fmt = (v, item) => E.formatValue(cfg, v, item);
  const val = (item) => E.valueOf(cfg, item);
  const fmtItem = (item) => fmt(val(item), item);

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
      /* storage unavailable; the game still works for this session */
    }
  }

  // ---------- game setup ----------

  function startDaily() {
    const date = E.localDateString();
    const puzzleNo = E.puzzleNumber(cfg, date);
    const target = E.pickDailyTarget(cfg, app.items, puzzleNo);
    const bounds = E.pickBounds(cfg, app.items, target, E.mulberry32(E.hashString(`${cfg.id}:bounds:${date}`)));
    let game = E.createGame({ target, bounds, mode: 'daily', puzzleNo, date });

    const saved = loadJSON(keyDaily(puzzleNo), null);
    if (saved && saved.targetId === target.id && Array.isArray(saved.guessIds)) {
      for (const id of saved.guessIds) {
        const item = app.byId.get(id);
        if (item) game = E.applyGuess(cfg, game, item).state;
      }
    }
    app.game = game;
    app.recorded = Boolean(saved?.recorded);
    afterStateChange({ persist: false });
  }

  function startRandom() {
    const target = E.pickRandomTarget(app.items);
    const bounds = E.pickBounds(cfg, app.items, target);
    app.game = E.createGame({ target, bounds, mode: 'random' });
    app.recorded = true; // random games never touch the stats
    afterStateChange({ persist: false });
  }

  function persistDaily() {
    if (app.game.mode !== 'daily') return;
    saveJSON(keyDaily(app.game.puzzleNo), {
      targetId: app.game.target.id,
      guessIds: app.game.guesses.map((g) => g.item.id),
      recorded: app.recorded,
    });
  }

  function afterStateChange({ persist = true } = {}) {
    const g = app.game;
    if (g.status !== 'playing' && g.mode === 'daily' && !app.recorded) {
      saveJSON(KEY_STATS, E.recordResult(loadJSON(KEY_STATS, E.emptyStats()), g));
      app.recorded = true;
    }
    if (persist) persistDaily();
    render();
  }

  // ---------- guessing ----------

  function submitGuess() {
    let item = app.selected;
    if (!item) {
      const input = $('#guess-input');
      const q = input ? input.value : '';
      const matches = E.searchItems(app.index, q, 2);
      if (matches.length === 1 || (matches.length > 1 && E.normalizeText(cfg.name(matches[0])) === E.normalizeText(q))) {
        item = matches[0];
      }
    }
    if (!item) {
      toast(`Pick ${cfg.noun === 'artist' ? 'an' : 'a'} ${cfg.noun} from the list`);
      return;
    }
    const { state, error } = E.applyGuess(cfg, app.game, item);
    if (error) {
      toast(error);
      return;
    }
    app.game = state;
    app.selected = null;
    afterStateChange();
    $('#guess-input')?.focus();
  }

  // ---------- rendering ----------

  function render() {
    const g = app.game;
    const over = g.status !== 'playing';
    $('#app').innerHTML = [renderMeta(g), renderBounds(g), over ? renderResult(g) : renderForm(g), renderHints(g), renderHistory(g)].join('');
    wireForm();
    wireResult();
    const modeBtn = $('#btn-mode');
    modeBtn.classList.toggle('active', g.mode === 'random');
    modeBtn.title = g.mode === 'random' ? 'Back to today’s puzzle' : 'Random puzzle';
    startCountdown();
  }

  function renderMeta(g) {
    const left = g.mode === 'daily' ? `Puzzle #${g.puzzleNo} · ${g.date}` : 'Random puzzle';
    const n = g.guesses.length;
    return `<div class="puzzle-meta"><span>${esc(left)}</span><span>Guess ${Math.min(n + 1, E.MAX_GUESSES)} of ${E.MAX_GUESSES}</span></div>`;
  }

  function nameWithSub(item) {
    const sub = cfg.sub(item);
    return `${esc(cfg.name(item))}${sub ? ` <span class="muted">(${esc(sub)})</span>` : ''}`;
  }

  function boundCard(kind, item) {
    if (!item) {
      const edge = kind === 'high' ? cfg.metric.scale.edgeHigh : cfg.metric.scale.edgeLow;
      return `<div class="bound ${kind} edge"><div class="rating">${esc(edge.value)}</div><div><div class="title">${esc(edge.label)}</div><div class="sub">${esc(edge.sub)}</div></div></div>`;
    }
    const sub =
      kind === 'high'
        ? `Upper bound · the secret ${cfg.noun} has ${cfg.metric.lessText}`
        : `Lower bound · the secret ${cfg.noun} has ${cfg.metric.moreText}`;
    return `<div class="bound ${kind}"><div class="rating">${fmtItem(item)}</div><div><div class="title">${nameWithSub(item)}</div><div class="sub">${esc(sub)}</div></div></div>`;
  }

  function renderBounds(g) {
    const count = E.candidatesInWindow(cfg, app.items, g);
    const w = E.valueWindow(cfg, g);
    const nounCount = count === 1 ? cfg.noun : cfg.nounPlural;
    const between =
      'pinned' in w
        ? `<div class="between pinned"><span class="line"></span><span>${esc(cap(cfg.metric.shortLabel))} pinned at <strong>${fmt(w.pinned)}</strong> · ${count} possible ${nounCount}</span><span class="line"></span></div>`
        : `<div class="between"><span class="line"></span><span><strong>${count}</strong> possible ${nounCount} in this range</span><span class="line"></span></div>`;
    return `<section class="panel bounds">${boundCard('high', g.high)}${between}${boundCard('low', g.low)}${renderTrack(g)}</section>`;
  }

  function renderTrack(g) {
    const pos = (v) => `${E.trackPosition(cfg, v, app.items) * 100}%`;
    const w = E.valueWindow(cfg, g);
    // A scale may run the other way on the track (Geoprox: A is "high" but drawn on the left).
    const [a, b] = 'pinned' in w ? [w.pinned, w.pinned] : [w.low, w.high];
    const [leftV, rightV] = E.trackPosition(cfg, a, app.items) <= E.trackPosition(cfg, b, app.items) ? [a, b] : [b, a];
    const lowP = pos(leftV);
    const highP = 'pinned' in w ? `calc(${pos(rightV)} + 2px)` : pos(rightV);
    const marks = g.guesses
      .map((x) => `<span class="mark ${x.outcome}" style="left:${pos(val(x.item))}" title="${esc(cfg.name(x.item))} ${fmtItem(x.item)}"></span>`)
      .join('');
    const target = g.status !== 'playing' ? `<span class="mark target" style="left:${pos(val(g.target))}" title="${esc(cfg.name(g.target))}"></span>` : '';
    const ticks = E.trackTicks(cfg, app.items)
      .map((t) => `<span class="tick" style="left:${pos(t.value)}">${esc(t.label)}</span>`)
      .join('');
    return `<div class="track" aria-hidden="true"><div class="rail"></div><div class="window" style="left:${lowP};width:calc(${highP} - ${lowP})"></div>${marks}${target}${ticks}</div>`;
  }

  function renderForm(g) {
    const next = E.nextHint(cfg, g);
    const nextText = next ? `Next hint (${next.label.toLowerCase()}) after guess ${next.after}` : 'All hints unlocked';
    const left = E.guessesLeft(g);
    return `<section class="panel guess-form">
      <form id="guess-form" autocomplete="off">
        <div class="input-row">
          <input id="guess-input" type="text" placeholder="Type ${cfg.noun === 'artist' ? 'an' : 'a'} ${esc(cfg.noun)} name…" aria-label="${esc(cap(cfg.noun))} name" aria-autocomplete="list" aria-controls="suggestions" spellcheck="false" autofocus />
          <button class="btn" type="submit" id="guess-btn">Guess</button>
        </div>
        <ul class="suggestions" id="suggestions" role="listbox"></ul>
      </form>
      <div class="form-meta"><span>${left} ${left === 1 ? 'guess' : 'guesses'} left</span><span>${esc(nextText)}</span></div>
    </section>`;
  }

  function renderHints(g) {
    const unlocked = new Set(E.unlockedHints(cfg, g).map((h) => h.key));
    const showAll = g.status !== 'playing';
    const cards = E.hints(cfg)
      .map((h) => {
        if (unlocked.has(h.key) || showAll) {
          const { label, text } = E.hintText(h, g.target);
          return `<div class="hint unlocked"><div class="label">${esc(label)}</div><div class="value">${esc(text)}</div></div>`;
        }
        return `<div class="hint locked"><div class="label">🔒 ${esc(h.label)}</div><div class="value">Unlocks after guess ${h.after}</div></div>`;
      })
      .join('');
    return `<section class="hints" aria-label="Hints">${cards}</section>`;
  }

  const outcomeText = {
    high: 'New upper bound',
    low: 'New lower bound',
    same: `Same ${cfg.metric.shortLabel} as the secret ${cfg.noun}!`,
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
          <span><div class="t">${E.OUTCOME_EMOJI[x.outcome]} ${nameWithSub(x.item)}</div><div class="o">${outcomeText[x.outcome]}</div></span>
          <span class="r">${fmtItem(x.item)}</span>
        </li>`,
      )
      .join('');
    return `<section class="panel"><ul class="history">${items}</ul></section>`;
  }

  function renderResult(g) {
    const won = g.status === 'won';
    const t = g.target;
    const share = E.shareText(cfg, g, { url: location.origin + location.pathname });
    return `<section class="panel result">
      <h2>${won ? `🎉 Got it in ${g.guesses.length}!` : '😵 Out of guesses'}</h2>
      <div class="answer">
        <div class="rating">${fmtItem(t)}</div>
        <div><div class="title">${esc(cfg.name(t))}</div><div class="details">${esc(cfg.details(t))}</div></div>
      </div>
      <pre id="share-text">${esc(share)}</pre>
      <div class="actions">
        <button class="btn" id="btn-share">Share result</button>
        <button class="btn secondary" id="btn-random">Play a random one</button>
      </div>
      ${g.mode === 'daily' ? '<div class="next">Next puzzle in <span id="countdown"></span></div>' : ''}
      ${renderOtherGames()}
    </section>`;
  }

  function renderOtherGames() {
    const others = GAMES.filter((x) => x.id !== cfg.id);
    if (!others.length) return '';
    return `<div class="next">Also try ${others.map((x) => `<a href="${gameHref(x)}">${x.icon} ${esc(x.title)}</a>`).join(', ')}</div>`;
  }

  // ---------- autocomplete ----------

  function wireForm() {
    const form = $('#guess-form');
    if (!form) return;
    const input = $('#guess-input');
    const list = $('#suggestions');

    const renderSuggestions = () => {
      list.innerHTML = app.suggestions
        .map((item, i) => {
          const sub = cfg.sub(item);
          return `<li role="option" data-i="${i}" class="${i === app.activeIdx ? 'active' : ''}" aria-selected="${i === app.activeIdx}"><span>${esc(cfg.name(item))}</span>${sub ? `<span class="year">${esc(sub)}</span>` : ''}</li>`;
        })
        .join('');
    };
    const close = () => {
      app.suggestions = [];
      app.activeIdx = -1;
      renderSuggestions();
    };
    const choose = (item) => {
      app.selected = item;
      const sub = cfg.sub(item);
      input.value = sub ? `${cfg.name(item)} (${sub})` : cfg.name(item);
      close();
    };

    input.addEventListener('input', () => {
      app.selected = null;
      app.suggestions = E.searchItems(app.index, input.value, 8);
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

  // ---------- header, help, stats ----------

  function renderHeader() {
    const switcher = GAMES.map((x) => {
      const active = x.id === cfg.id;
      return `<a class="game-link ${active ? 'active' : ''}" href="${gameHref(x)}" ${active ? 'aria-current="page"' : ''} title="${esc(x.title)}">${x.icon}<span class="game-name"> ${esc(x.title)}</span></a>`;
    }).join('');
    $('#brand').innerHTML = `<span class="brand-icon" aria-hidden="true">${cfg.icon}</span> ${esc(cfg.title)}`;
    $('#switcher').innerHTML = switcher;
    document.title = cfg.title;
  }

  function renderHelp() {
    const rows = E.hints(cfg)
      .map((h) => `<tr><td>After ${h.after} guesses</td><td>${esc(h.label)}</td></tr>`)
      .join('');
    $('#help-body').innerHTML = `
      <p>${cfg.help.intro}</p>
      <ol class="rules">
        <li>${cfg.help.reveal}</li>
        <li>If the guess is <strong>closer to the secret</strong> than one of the two bounds, it replaces that bound and the range shrinks.</li>
        <li>${cfg.help.tie}</li>
        <li>A guess outside the current range teaches you nothing. Try to avoid those.</li>
        <li>You have <strong>${E.MAX_GUESSES} guesses</strong>. Hints unlock along the way:</li>
      </ol>
      <table class="hint-table"><tbody>${rows}</tbody></table>
      <p class="legend">
        <span>🔼 new upper bound</span>
        <span>🔽 new lower bound</span>
        <span>🟰 same ${esc(cfg.metric.shortLabel)}</span>
        <span>⬜ outside the range</span>
        <span>🎯 correct</span>
      </p>
      <p class="muted small">${cfg.help.footer}</p>`;
  }

  function renderStats() {
    const s = loadJSON(KEY_STATS, E.emptyStats());
    const pct = s.played ? Math.round((s.won / s.played) * 100) : 0;
    const max = Math.max(1, ...Object.values(s.distribution));
    const today = app.game?.mode === 'daily' && app.game.status === 'won' ? app.game.guesses.length : null;
    const rows = Array.from({ length: E.MAX_GUESSES }, (_, i) => i + 1)
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
      <div class="muted small" style="margin-bottom:6px">Guess distribution</div>
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
    $('#app').innerHTML = `<section class="panel error-box"><h2>Could not load the data</h2><p>${message}</p><p class="muted small">Generate it with the data script in <code>scripts/</code> (see the README), then reload.</p></section>`;
  }

  async function init() {
    renderHeader();
    renderHelp();
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
      const url = new URLSearchParams(location.search).get('data') || cfg.dataUrl;
      const res = await fetch(url, { cache: 'no-cache' });
      if (!res.ok) throw new Error(`HTTP ${res.status} for ${esc(url)}`);
      const data = await res.json();
      app.items = data[cfg.itemsKey];
      if (!Array.isArray(app.items)) throw new Error(`The data file has no "${cfg.itemsKey}" list.`);
      app.byId = new Map(app.items.map((m) => [m.id, m]));
      app.index = E.buildSearchIndex(cfg, app.items);
      if (E.answerPool(app.items).length === 0) throw new Error('The data file has no items flagged as possible answers.');
    } catch (err) {
      showError(esc(err.message));
      return;
    }

    if (!localStorage.getItem(PREFIX + 'seen-help')) {
      $('#dlg-help').showModal();
      saveJSON(PREFIX + 'seen-help', true);
    }
    startDaily();
  }

  init();
}
