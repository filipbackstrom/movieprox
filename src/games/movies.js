import { titlePattern } from '../engine.js';

/** Movieprox: guess the movie by its IMDb rating. */
export default {
  id: 'movies',
  storageKey: 'movieprox',
  title: 'Movieprox',
  icon: '🎬',
  tagline: 'Guess the movie by its IMDb rating',
  noun: 'movie',
  nounPlural: 'movies',
  launchDate: '2026-10-20',
  shuffleSeed: 0x5eed1e,
  dataUrl: new URL('../../data/movies.json', import.meta.url).href,
  itemsKey: 'movies',

  metric: {
    label: 'IMDb rating',
    shortLabel: 'rating',
    value: (m) => m.rating,
    quantize: (v) => Math.round(v * 10),
    format: (v) => v.toFixed(1),
    moreText: 'a higher rating',
    lessText: 'a lower rating',
    scale: {
      min: 0,
      max: 10,
      position: (v) => v / 10,
      ticks: [0, 2, 4, 6, 8, 10].map((v) => ({ value: v, label: String(v) })),
      edgeHigh: { value: '10.0', label: 'Top of the scale', sub: 'No movie in the pool is rated higher' },
      edgeLow: { value: '0.0', label: 'Bottom of the scale', sub: 'No movie in the pool is rated lower' },
    },
  },

  /** Starting bounds should be at least a full point away, and preferably famous. */
  farEnough: (candidate, target) => Math.abs(candidate.rating - target.rating) >= 1,
  boundCandidates: (pool) => pool.filter((m) => m.votes >= 500000),

  name: (m) => m.title,
  sub: (m) => String(m.year),
  searchTexts: (m) => [m.title, m.originalTitle],
  weight: (m) => m.votes,
  details: (m) =>
    [m.year, m.genres?.join(', '), m.directors?.length ? `dir. ${m.directors.join(', ')}` : null, m.cast?.slice(0, 3).join(', ')]
      .filter(Boolean)
      .join(' · '),

  hints: [
    { key: 'genre', label: 'Genre', text: (m) => m.genres?.join(', ') },
    { key: 'year', label: 'Release year', text: (m) => String(m.year) },
    { key: 'director', label: 'Director', text: (m) => m.directors?.join(', ') },
    { key: 'cast', label: 'Featured actors', text: (m) => m.cast?.slice(0, 3).join(', ') },
    {
      key: 'keywords',
      label: 'Plot keywords',
      text: (m) => (m.keywords?.length ? m.keywords.slice(0, 6).join(', ') : { label: 'Title pattern', text: titlePattern(m.title) }),
    },
  ],

  help: {
    intro: 'Find the secret movie. You know it is rated <strong>somewhere between</strong> two movies on IMDb.',
    reveal: 'Guess any movie. Its IMDb rating is revealed.',
    tie: 'If it has the <strong>exact same rating</strong> as the secret movie, the rating gets pinned. Now it is all about which movie it is.',
    footer: "A new secret movie every day. Ratings come from IMDb's public datasets and may lag the live site slightly.",
  },
};
