/** Every game on the site, with its path relative to the site root. */
export const GAMES = [
  { id: 'movies', title: 'Movieprox', icon: '🎬', path: '' },
  { id: 'music', title: 'Musicprox', icon: '🎧', path: 'music/' },
  { id: 'countries', title: 'Geoprox', icon: '🌍', path: 'geo/' },
];

export const SITE_ROOT = new URL('../../', import.meta.url);

export function gameHref(game) {
  return new URL(game.path, SITE_ROOT).href;
}
