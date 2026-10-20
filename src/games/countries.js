/** Countryprox: guess the country by where its name falls in the alphabet. */

/** 41291 -> "41K", 17075400 -> "17.1M", 0.49 -> "0.5", 882 -> "882". */
export function formatQuantity(n) {
  if (n == null) return 'Unknown';
  if (n >= 1e9) return `${Number((n / 1e9).toFixed(1))}B`;
  if (n >= 1e6) return `${Number((n / 1e6).toFixed(1))}M`;
  if (n >= 1e3) return `${Math.round(n / 1e3)}K`;
  if (n >= 10) return String(Math.round(n));
  return String(Number(n.toFixed(1)));
}

const letterOf = (c) => c.name.normalize('NFD').replace(/[̀-ͯ]/g, '')[0].toUpperCase();

export default {
  id: 'countries',
  storageKey: 'countryprox',
  title: 'Countryprox',
  icon: '🌍',
  tagline: 'Guess the country by its place in the alphabet',
  noun: 'country',
  nounPlural: 'countries',
  launchDate: '2026-10-20',
  shuffleSeed: 0x5eed3b,
  dataUrl: new URL('../../data/countries.json', import.meta.url).href,
  itemsKey: 'countries',

  metric: {
    label: 'alphabetical position',
    shortLabel: 'name',
    /**
     * The value is the negated position in the alphabetical list, so that A is the
     * "high" end: the earlier name sits in the upper bound card, as in Betweenle.
     */
    value: (c) => -c.order,
    quantize: (v) => Math.round(v),
    /** The big value slot shows the flag; the name itself carries the information. */
    format: (v, item) => (item ? item.flag : ''),
    moreText: 'a name earlier in the alphabet',
    lessText: 'a name later in the alphabet',
    scale: {
      min: -Infinity,
      max: 1,
      /** The track still reads A to Z from left to right. */
      position: (v, items) => (items && items.length > 1 ? -v / (items.length - 1) : 0),
      ticks: (items) => {
        if (!items?.length) return [];
        const sorted = items.slice().sort((a, b) => a.order - b.order);
        const out = [];
        for (let k = 0; k <= 8; k++) {
          const c = sorted[Math.round((k / 8) * (sorted.length - 1))];
          const label = letterOf(c);
          if (!out.length || out[out.length - 1].label !== label) out.push({ value: -c.order, label });
        }
        return out;
      },
      edgeHigh: { value: 'A', label: 'Start of the alphabet', sub: 'No country comes earlier' },
      edgeLow: { value: 'Z', label: 'End of the alphabet', sub: 'No country comes later' },
    },
  },

  /** Starting bounds should be at least 25 places apart in the alphabetical list. */
  farEnough: (candidate, target) => Math.abs(candidate.order - target.order) >= 25,
  boundCandidates: (pool) => pool.filter((c) => c.population >= 5_000_000),

  name: (c) => c.name,
  sub: () => '',
  searchTexts: (c) => [c.name, ...(c.aliases || []), c.id],
  weight: (c) => c.population || 0,
  details: (c) =>
    [
      c.continents?.join(' / '),
      c.capital ? `capital ${c.capital}` : null,
      `${formatQuantity(c.area)} km²`,
      `${formatQuantity(c.population)} people`,
      c.landlocked ? 'landlocked' : null,
      c.neighbours?.length ? `borders ${c.neighbours.join(', ')}` : 'no land borders',
    ]
      .filter(Boolean)
      .join(' · '),

  hints: [
    { key: 'landlocked', label: 'Landlocked', text: (c) => (c.landlocked ? 'Yes' : 'No') },
    { key: 'area', label: 'Area', text: (c) => `${formatQuantity(c.area)} km²` },
    { key: 'population', label: 'Population', text: (c) => formatQuantity(c.population) },
    { key: 'continent', label: 'Continent', text: (c) => c.continents?.join(' / ') },
    { key: 'neighbours', label: 'Neighboring countries', text: (c) => (c.neighbours?.length ? c.neighbours.join(', ') : 'None, it has no land borders') },
  ],

  help: {
    intro: 'Find the secret country. Its name falls <strong>alphabetically between</strong> two other countries.',
    reveal: 'Guess any country. It gets slotted into the alphabet.',
    tie: 'Two countries never share a name, so every guess inside the range makes it shrink.',
    footer:
      'A new secret country every day, drawn from the 196 sovereign states. Facts come from Wikidata and GeoNames; neighbors are land borders only.',
  },
};
