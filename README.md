# Movieprox & Musicprox

Daily guessing games in the spirit of [Betweenle](https://betweenle.com/), built on one shared engine.

- **Movieprox** (`/`): guess the secret movie by its **IMDb rating**.
- **Musicprox** (`/music/`): guess the secret artist by their **total Spotify streams**.

You are shown two items: one above the secret, one below. Every guess reveals its value. If it is closer to the secret than one of the bounds, it replaces that bound and the range shrinks. Guess something with the exact same value and the value is pinned; from there it is about figuring out *which* one it is. You have 15 guesses, and hints unlock along the way:

| After guess | Movieprox        | Musicprox       |
| ----------- | ---------------- | --------------- |
| 2           | Genre            | Genre           |
| 5           | Release year     | Solo or group   |
| 8           | Director         | Gender          |
| 11          | Featured actors  | Nationality     |
| 14          | Plot keywords    | Famous songs    |

(The plot keyword hint needs the optional TMDB step below. Without it the final movie hint is the title pattern, e.g. `I L___ Y__, M__`.)

Each game has one secret per day for everyone, plus a random mode for practice. Progress, streaks and stats are stored in the browser, separately per game.

## Running it

It is a static site with no build step.

```sh
npm run serve      # http://localhost:8080 and http://localhost:8080/music/
npm test           # engine unit tests
```

Or serve the folder with any static file server. It must be served over HTTP (not `file://`) because the data files are fetched.

## Data

### Movies: `data/movies.json`

Generated from [IMDb's Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/), which IMDb publishes daily at `https://datasets.imdbws.com/`. The script streams the five relevant files, keeps feature films with enough votes, and joins in directors and billed cast.

```sh
npm run build:data
```

Defaults: movies with at least 25,000 votes are guessable, and movies with at least 150,000 votes can be the daily answer. Tweak with flags:

```sh
node scripts/build-data.mjs --guess-min-votes 20000 --answer-min-votes 200000 --min-year 1970
node scripts/build-data.mjs --cache-dir data/raw     # keep the downloads for faster re-runs
node scripts/build-data.mjs --from-dir ~/Downloads   # use files you downloaded yourself
```

The download is about 1.3 GB compressed and takes a few minutes. The generated JSON is about 1.8 MB and is committed so the site deploys without a build.

Optional plot keywords for the fifth hint come from TMDB (free key at https://www.themoviedb.org/settings/api):

```sh
TMDB_API_KEY=your_key npm run enrich:tmdb
```

### Artists: `data/artists.json`

Spotify does not publish stream totals, so the numbers come from [kworb.net](https://kworb.net/spotify/artists.html), a long-running fan site that aggregates Spotify's charts into total streams per artist. The list covers the 3,000 most streamed artists and includes each one's Spotify ID. Artist facts (solo or group, gender, country, genres) come from [Wikidata](https://www.wikidata.org/) (CC0), matched exactly on that Spotify ID. Famous songs come from each artist's kworb page.

```sh
npm run build:music
```

Defaults: all 3,000 artists are guessable; the top 1,000 with complete hints can be the daily answer. Downloaded pages are cached in `data/raw/kworb/` (ignored by git) and reused for three days, and song pages are fetched two at a time to be polite. Flags:

```sh
node scripts/build-music-data.mjs --answer-count 800 --songs 5
node scripts/build-music-data.mjs --skip-songs          # quick run without the per-artist pages
node scripts/build-music-data.mjs --max-age-hours 0     # force fresh downloads
```

Stream totals are a snapshot. Order between artists moves slowly, so refreshing monthly is plenty.

### Data license

IMDb's datasets are for personal and non-commercial use only; see https://developer.imdb.com/non-commercial-datasets/. kworb.net is an unofficial source with no stated license; keep the game non-commercial and scrape gently. Wikidata is CC0.

## Deploying

Any static host works. The workflow in `.github/workflows/pages.yml` runs the tests and deploys the repository root to GitHub Pages on every push to `main`. Pages must be set to "GitHub Actions" as the source once, in the repository settings. Re-run the data scripts now and then and commit the result so the numbers stay current.

A GitHub Pages site is public on the internet even when the repository is private. The URL is just unlisted.

## Adding another game

Everything game-specific lives in one config file. Copy `src/games/music.js`, point it at a new data file, describe the metric (how to read, compare and format the number), the five hints, and the help text, then add a page like `music/index.html` and a line in `src/games/index.js` for the switcher.

## Project layout

```
index.html                     Movieprox page
music/index.html               Musicprox page
src/engine.js                  shared game engine (rules, hints, daily seed, search, stats)
src/app.js                     browser UI, takes a game config
src/games/movies.js            Movieprox config
src/games/music.js             Musicprox config
src/games/index.js             list of games for the switcher
src/style.css
test/engine.test.js            node:test unit tests
scripts/build-data.mjs         IMDb datasets -> data/movies.json
scripts/build-music-data.mjs   kworb + Wikidata -> data/artists.json
scripts/enrich-tmdb.mjs        optional TMDB keyword enrichment for movies
scripts/serve.mjs              tiny dev server
data/movies.json               generated movie data
data/artists.json              generated artist data
```

## Design notes

- **Ties.** IMDb ratings have one decimal, so hundreds of movies share a rating. A guess that matches the secret's rating exactly "pins" the rating instead of moving a bound. Stream counts almost never tie, so in Musicprox the range just keeps shrinking.
- **Wasted guesses.** A guess outside the current range still reveals its value but moves nothing, as in Betweenle.
- **Candidate count.** The number under the bounds is how many answer-pool items sit inside the current range. It is the equivalent of Betweenle's distance meter, and matters more in Musicprox where the raw numbers mean little to most players.
- **Scale.** Movie ratings are shown on a linear 0–10 track. Streams span two orders of magnitude, so the Musicprox track is logarithmic.
- **Starting bounds.** Movies: at least a full rating point away from the secret. Artists: at least twice, or at most half, the secret's streams.
- **Daily selection.** The answer pool is shuffled once with a fixed seed and the day number indexes into it, so the daily answer is the same for everyone and does not repeat until the pool is exhausted.
