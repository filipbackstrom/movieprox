# Ratingle

A daily movie guessing game in the spirit of [Betweenle](https://betweenle.com/), but for IMDb ratings.

You are shown two movies: one rated above the secret movie, one below. Every guess reveals a movie's IMDb rating. If it is closer to the secret than one of the bounds, it replaces that bound and the range shrinks. Guess a movie with the exact same rating and the rating is pinned; from there it is about figuring out *which* movie it is. You have 15 guesses, and hints unlock along the way:

| After guess | Hint              |
| ----------- | ----------------- |
| 2           | Genre             |
| 5           | Release year      |
| 8           | Director          |
| 11          | Featured actors   |
| 14          | Plot keywords     |

(The plot keyword hint needs the optional TMDB step below. Without it the final hint is the title pattern, e.g. `I L___ Y__, M__`.)

There is one secret movie per day for everyone, plus a random mode for practice. Progress, streaks and stats are stored in the browser.

## Running it

It is a static site with no build step.

```sh
npm run serve      # http://localhost:8080
npm test           # game engine unit tests
```

Or open `index.html` through any static file server. It must be served over HTTP (not `file://`) because the movie data is fetched.

## Data

`data/movies.json` is generated from [IMDb's Non-Commercial Datasets](https://developer.imdb.com/non-commercial-datasets/), which IMDb publishes daily at `https://datasets.imdbws.com/`. The script streams the five relevant files, keeps feature films with enough votes, and joins in directors and billed cast.

```sh
npm run build:data
```

Defaults: movies with at least 25,000 votes are guessable, and movies with at least 150,000 votes can be the daily answer. Tweak with flags:

```sh
node scripts/build-data.mjs --guess-min-votes 20000 --answer-min-votes 200000 --min-year 1970
node scripts/build-data.mjs --cache-dir data/raw     # keep the downloads for faster re-runs
node scripts/build-data.mjs --from-dir ~/Downloads   # use files you downloaded yourself
```

The download is about 1.3 GB compressed (mostly `title.principals`) and takes a few minutes. The generated JSON is about 1.8 MB and is committed so the site deploys without a build.

### Optional: plot keywords from TMDB

```sh
TMDB_API_KEY=your_key npm run enrich:tmdb
```

Adds up to eight keywords per answer-pool movie, used for the fifth hint. Get a free key at https://www.themoviedb.org/settings/api.

### Data license

IMDb's datasets are for personal and non-commercial use only. See https://developer.imdb.com/non-commercial-datasets/ for the terms before publishing the game anywhere.

## Deploying

Any static host works. For GitHub Pages: Settings → Pages → deploy from the branch root. Re-run `npm run build:data` now and then and commit the result so ratings stay current.

## Project layout

```
index.html              page shell and dialogs
src/game.js             pure game engine (rules, hints, daily seed, search, stats)
src/app.js              browser UI
src/style.css
test/game.test.js       node:test unit tests for the engine
scripts/build-data.mjs  IMDb dataset -> data/movies.json
scripts/enrich-tmdb.mjs optional TMDB keyword enrichment
scripts/serve.mjs       tiny dev server
data/movies.json        generated movie data
```

## Design notes

- **Ties.** IMDb ratings have one decimal, so hundreds of movies share a rating. A guess that matches the secret's rating exactly "pins" the rating instead of moving a bound. After that, only the hints can separate the candidates.
- **Wasted guesses.** A guess outside the current range still reveals its rating but moves nothing, as in Betweenle.
- **Candidate count.** The number under the bounds is how many answer-pool movies are rated inside the current range. It is the equivalent of Betweenle's distance meter.
- **Daily selection.** The answer pool is shuffled once with a fixed seed and the day number indexes into it, so the daily movie is the same for everyone and does not repeat until the pool is exhausted.
