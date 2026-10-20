import { titlePattern } from '../engine.js';

const B = 1e9;
const M = 1e6;

export function formatStreams(v) {
  if (v >= 100 * B) return `${Math.round(v / B)}B`;
  if (v >= B) return `${Number((v / B).toFixed(1))}B`; // Number() drops a trailing ".0"
  return `${Math.round(v / M)}M`;
}

const SCALE_MIN = 1 * B;
const SCALE_MAX = 300 * B;
const logPos = (v) => (Math.log10(Math.max(v, SCALE_MIN)) - Math.log10(SCALE_MIN)) / (Math.log10(SCALE_MAX) - Math.log10(SCALE_MIN));

function genderText(a) {
  if (a.type === 'group') {
    if (a.gender === 'male') return 'All-male group';
    if (a.gender === 'female') return 'All-female group';
    if (a.gender === 'mixed') return 'Mixed group';
    return 'Group';
  }
  if (a.gender === 'male') return 'Male';
  if (a.gender === 'female') return 'Female';
  if (a.gender === 'non-binary') return 'Non-binary';
  return undefined;
}

/** Musicprox: guess the artist by total Spotify streams. */
export default {
  id: 'music',
  storageKey: 'musicprox',
  title: 'Musicprox',
  icon: '🎧',
  tagline: 'Guess the artist by total Spotify streams',
  noun: 'artist',
  nounPlural: 'artists',
  launchDate: '2026-10-20',
  shuffleSeed: 0x5eed2a,
  dataUrl: new URL('../../data/artists.json', import.meta.url).href,
  itemsKey: 'artists',

  metric: {
    label: 'Spotify streams',
    shortLabel: 'stream count',
    value: (a) => a.streams,
    quantize: (v) => Math.round(v / M),
    format: formatStreams,
    moreText: 'more streams',
    lessText: 'fewer streams',
    scale: {
      min: 0,
      max: Infinity,
      position: logPos,
      ticks: [1 * B, 3 * B, 10 * B, 30 * B, 100 * B].map((v) => ({ value: v, label: formatStreams(v) })),
      edgeHigh: { value: '∞', label: 'Top of the list', sub: 'No artist in the pool has more streams' },
      edgeLow: { value: '0', label: 'Bottom of the list', sub: 'No artist in the pool has fewer streams' },
    },
  },

  /**
   * Starting bounds should have at least twice (or half) the streams, and preferably be
   * household names: the artists with articles in the most Wikipedia editions.
   */
  farEnough: (candidate, target) => candidate.streams >= 2 * target.streams || candidate.streams <= target.streams / 2,
  boundCandidates: (pool) =>
    pool
      .slice()
      .sort((a, b) => (b.sitelinks || 0) - (a.sitelinks || 0) || b.streams - a.streams)
      .slice(0, 300),

  name: (a) => a.name,
  sub: () => '',
  searchTexts: (a) => [a.name],
  weight: (a) => a.streams,
  details: (a) =>
    [
      a.type === 'group' ? genderText(a) : [genderText(a), 'solo artist'].filter(Boolean).join(' '),
      a.countries?.join(' / '),
      a.genres?.join(', '),
      a.songs?.length ? `known for ${a.songs.slice(0, 3).join(', ')}` : null,
    ]
      .filter(Boolean)
      .join(' · '),

  hints: [
    { key: 'genre', label: 'Genre', text: (a) => a.genres?.join(', ') },
    { key: 'type', label: 'Solo or group', text: (a) => (a.type === 'group' ? 'Group' : a.type === 'solo' ? 'Solo artist' : undefined) },
    { key: 'gender', label: 'Gender', text: genderText },
    { key: 'country', label: 'Nationality', text: (a) => a.countries?.join(' / ') },
    {
      key: 'songs',
      label: 'Famous songs',
      text: (a) => (a.songs?.length ? a.songs.slice(0, 3).join(', ') : { label: 'Name pattern', text: titlePattern(a.name) }),
    },
  ],

  help: {
    intro: 'Find the secret artist. You know their <strong>total Spotify streams</strong> fall somewhere between those of two other artists.',
    reveal: "Guess any artist. Their total stream count is revealed.",
    tie: 'If a guess has the <strong>exact same stream count</strong> as the secret artist, the count gets pinned. That almost never happens here.',
    footer:
      'A new secret artist every day. Stream totals are a snapshot from kworb.net and only cover the 3,000 most streamed artists; artist facts come from Wikidata.',
  },
};
