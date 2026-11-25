# Recommendation evaluation

`npm run rec:eval` (in `server/`) measures how well BACKLOG ranking predicts your own
ratings, offline, without calling OpenAI or IGDB. Run it before and after a scoring change to
see whether the change actually helps.

## How it works

Each rated library game is hidden in turn. Its rating and status are cleared so it becomes an
ordinary backlog candidate, and the taste profile, semantic centroid and tuned weights are
rebuilt without it. The harness then records where it lands among your real backlog.

- **Liked** = rated ≥ 4★, **disliked** = rated ≤ 3★ (3.5★ is skipped as ambiguous).
- **hit@k**: the share of liked games that make the top k of the full ranked list (diversity
  re-ranking included). Higher is better.
- **MRR**: the mean of 1/rank for liked games. Higher is better.
- **Liked percentile**: where liked games fall by base score, where 0 is the top of the pool.
  Lower is better.
- **AUC**: the chance a liked game outscores a disliked one. 0.5 is random; higher is better.

Repeat-penalty history is ignored (each run is scored as if nothing had been recommended
before), so the numbers measure taste fit only.

## 1. Export data from the NAS

The export holds your full library and ratings. Keep it outside the repo.

```sh
sudo docker exec -i gameshelf-postgres sh -c 'psql -At -v ON_ERROR_STOP=1 -U "$(cat "$POSTGRES_USER_FILE")" -d "$POSTGRES_DB"' <<'SQL' > rec-eval-export.json
SELECT json_build_object(
  'games', (
    SELECT json_agg(json_build_object(
      'igdb_game_id', igdb_game_id,
      'platform_igdb_id', platform_igdb_id,
      'payload', payload
    ))
    FROM games
  ),
  'embeddings', (
    SELECT json_agg(json_build_object(
      'igdb_game_id', e.igdb_game_id,
      'platform_igdb_id', e.platform_igdb_id,
      'embedding', e.embedding::text
    ))
    FROM game_embeddings e
    JOIN games g
      ON g.igdb_game_id = e.igdb_game_id
     AND g.platform_igdb_id = e.platform_igdb_id
    WHERE g.payload->>'listType' = 'collection'
  )
);
SQL
```

Copy `rec-eval-export.json` to your machine.

## 2. Run

```sh
cd server
npm run rec:eval -- --input=/path/to/rec-eval-export.json
npm run rec:eval -- --input=/path/to/rec-eval-export.json --mode=SHORT --k=5,10,20
npm run rec:eval -- --input=/path/to/rec-eval-export.json --semanticWeight=1 --json
```

Any field of `RECOMMENDATION_SCORING_DEFAULTS` (`server/src/recommendations/scoring-defaults.ts`)
can be overridden with a flag of the same name. If production sets `RECOMMENDATIONS_*` env vars,
pass the same values to mirror it.

## Sweeping a setting

To choose a value for a setting, run one pass per candidate value. For example, the
personal-signal settings:

```sh
cd server
for center in 0 0.5 1; do
  for status in 0 0.5 1; do
    echo "ratingMeanCenterWeight=$center statusSignalWeight=$status"
    npm run rec:eval -s -- --input=/path/to/rec-eval-export.json \
      --ratingMeanCenterWeight=$center --statusSignalWeight=$status | grep -E 'hit@|MRR|AUC'
  done
done
```

- `ratingMeanCenterWeight`: `0` treats 3★ as neutral. `1` treats your own average rating as
  neutral, shrunk toward 3★ by 5 pseudo-ratings.
- `statusSignalWeight`: how much unrated games count toward taste based on their status.
  At `1`, replay counts +0.75 and dropped -0.75. A 5★ rating counts +1. Completed counts as 0,
  which still records the game's tags as played.

Look at AUC and the liked percentile first. Hit@k moves in steps of 1/liked games, so small
differences there are noise. Set the winner with `RECOMMENDATIONS_RATING_MEAN_CENTER_WEIGHT` and
`RECOMMENDATIONS_STATUS_SIGNAL_WEIGHT`.

## Comparing two versions

Run the same export against both versions. A worktree keeps the baseline separate from your
working tree:

```sh
git worktree add ../game-shelf-baseline <baseline-ref>
(cd ../game-shelf-baseline/server && npm ci && npm run rec:eval -- --input=/path/to/export.json)
```
