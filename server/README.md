# Game Shelf NAS API (Fastify)

This service replaces the Cloudflare Worker runtime for NAS deployment.

## Endpoints

- `GET /v1/health`
- `GET /v1/games/search`
- `GET /v1/games/:id`
- `GET /v1/platforms`
- `GET /v1/images/boxart/search`
- `GET /v1/hltb/search`
- `GET /v1/metacritic/search`
- `GET /v1/mobygames/search`
- `GET /v1/images/proxy`
- `GET /v1/manuals/resolve`
- `GET /v1/manuals/search`
- `GET /v1/recommendations/top`
- `GET /v1/recommendations/lanes`
- `GET /v1/recommendations/similar/:igdbGameId`
- `POST /v1/recommendations/rebuild`
- `POST /v1/manuals/refresh`
- `POST /v1/sync/push`
- `POST /v1/sync/pull`

### Metadata query parameters

- `GET /v1/hltb/search`
  - Required: `q` (min length 2)
  - Optional: `releaseYear` (YYYY), `platform`, `includeCandidates` (`1|true|yes`)
- `GET /v1/metacritic/search`
  - Required: `q` (min length 2)
  - Optional: `releaseYear` (YYYY), `platform`, `platformIgdbId`, `includeCandidates` (`1|true|yes`)
- `GET /v1/mobygames/search`
  - Required: `q` (or `title`) (min length 2)
  - Optional: `platform` (MobyGames platform ID), `limit`, `offset`, `id`, `genre`, `group`, `format` (`id|brief|normal`), `include` (comma-separated field list)
- `GET /v1/recommendations/top`
  - Required: `target` (`BACKLOG|WISHLIST|DISCOVERY`)
  - Optional: `runtimeMode` (`NEUTRAL|SHORT|LONG`), `limit` (`1..200`, default `20`)
- `GET /v1/recommendations/lanes`
  - Required: `target` (`BACKLOG|WISHLIST|DISCOVERY`)
  - Optional: `runtimeMode` (`NEUTRAL|SHORT|LONG`), `limit` (default `20`)
- `GET /v1/recommendations/similar/:igdbGameId`
  - Required query: `platformIgdbId`
  - Optional: `limit` (default `20`)
- `POST /v1/recommendations/rebuild`
  - Body: `{ target, force? }`

## Configuration

### Required file-based secrets

- `DATABASE_URL_FILE` (defaults to `/run/secrets/database_url`)
- `TWITCH_CLIENT_ID_FILE` (defaults to `/run/secrets/twitch_client_id`)
- `TWITCH_CLIENT_SECRET_FILE` (defaults to `/run/secrets/twitch_client_secret`)
- `THEGAMESDB_API_KEY_FILE` (defaults to `/run/secrets/thegamesdb_api_key`)

### Optional file-based secrets

- `API_TOKEN_FILE` (defaults to `/run/secrets/api_token`)
- `CLIENT_WRITE_TOKENS_FILE` (defaults to `/run/secrets/client_write_tokens`)
- `HLTB_SCRAPER_TOKEN_FILE` (defaults to `/run/secrets/hltb_scraper_token`)
- `METACRITIC_SCRAPER_TOKEN_FILE` (defaults to `/run/secrets/metacritic_scraper_token`)
- `MOBYGAMES_API_KEY_FILE` (defaults to `/run/secrets/mobygames_api_key`)
- `OPENAI_API_KEY_FILE` (defaults to `/run/secrets/openai_api_key`) for semantic recommendation embeddings

### Non-secret env vars (metadata/caching/rate limit)

- `HLTB_SCRAPER_BASE_URL`
- `HLTB_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `HLTB_CACHE_FRESH_TTL_SECONDS`
- `HLTB_CACHE_STALE_TTL_SECONDS`
- `HLTB_SEARCH_RATE_LIMIT_MAX_PER_MINUTE`
- `METACRITIC_SCRAPER_BASE_URL`
- `METACRITIC_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `METACRITIC_CACHE_FRESH_TTL_SECONDS`
- `METACRITIC_CACHE_STALE_TTL_SECONDS`
- `METACRITIC_SEARCH_RATE_LIMIT_MAX_PER_MINUTE`
- `MOBYGAMES_API_BASE_URL`
  - default: `https://api.mobygames.com/v2`
- `MOBYGAMES_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `MOBYGAMES_CACHE_FRESH_TTL_SECONDS`
- `MOBYGAMES_CACHE_STALE_TTL_SECONDS`
- `MOBYGAMES_SEARCH_RATE_LIMIT_MAX_PER_MINUTE` (default `12`, matching `0.2` requests/second)
- `DEBUG_HTTP_LOGS` (`true|false`, default `false`) enables sanitized upstream request/response logs for IGDB/TheGamesDB, HLTB, Metacritic, and MobyGames.

### Non-secret env vars (recommendations)

- `RECOMMENDATIONS_SCHEDULER_ENABLED`
- `RECOMMENDATIONS_DAILY_STALE_HOURS`
- `RECOMMENDATIONS_TOP_LIMIT`
- `RECOMMENDATIONS_SIMILARITY_K`
- `RECOMMENDATIONS_EMBEDDING_MODEL`
- `RECOMMENDATIONS_EMBEDDING_DIMENSIONS`
- `RECOMMENDATIONS_EMBEDDING_BATCH_SIZE`
- `RECOMMENDATIONS_SEMANTIC_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_STRUCTURED_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_SEMANTIC_WEIGHT`
- `RECOMMENDATIONS_FAILURE_BACKOFF_MINUTES`
- `RECOMMENDATIONS_RUNTIME_MODE_DEFAULT` (`NEUTRAL|SHORT|LONG`, default `NEUTRAL`)
- `RECOMMENDATIONS_EXPLORATION_WEIGHT`
- `RECOMMENDATIONS_DIVERSITY_PENALTY_WEIGHT`
- `RECOMMENDATIONS_REPEAT_PENALTY_STEP`
- `RECOMMENDATIONS_TUNING_MIN_RATED`
- `RECOMMENDATIONS_LANE_LIMIT`
- `RECOMMENDATIONS_KEYWORDS_STRUCTURED_MAX`
- `RECOMMENDATIONS_KEYWORDS_EMBEDDING_MAX`
- `RECOMMENDATIONS_KEYWORDS_GLOBAL_MAX_RATIO`
- `RECOMMENDATIONS_KEYWORDS_STRUCTURED_MAX_RATIO`
- `RECOMMENDATIONS_KEYWORDS_MIN_LIBRARY_COUNT`
- `RECOMMENDATIONS_KEYWORDS_WEIGHT`
- `RECOMMENDATIONS_THEMES_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_THEME_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_GENRE_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_SERIES_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_DEVELOPER_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_PUBLISHER_WEIGHT`
- `RECOMMENDATIONS_SIMILARITY_KEYWORD_WEIGHT`
- `RECOMMENDATIONS_DISCOVERY_ENABLED`
- `RECOMMENDATIONS_DISCOVERY_POOL_SIZE`
- `RECOMMENDATIONS_DISCOVERY_REFRESH_HOURS`
- `RECOMMENDATIONS_DISCOVERY_IGDB_REQUEST_TIMEOUT_MS`
- `RECOMMENDATIONS_DISCOVERY_IGDB_MAX_REQUESTS_PER_SECOND`

### Non-secret env vars (metadata enrichment)

- `IGDB_METADATA_ENRICH_ENABLED` (default `true`)
- `IGDB_METADATA_ENRICH_BATCH_SIZE` (default `200`)
- `IGDB_METADATA_ENRICH_MAX_GAMES_PER_RUN` (default `5000`)
- `IGDB_METADATA_ENRICH_STARTUP_DELAY_MS` (default `5000`)
- `IGDB_METADATA_ENRICH_REQUEST_TIMEOUT_MS` (default `15000`)

Runtime mode resolution for recommendation reads:

- request query `runtimeMode` (if provided)
- fallback setting `recommendations.runtime_mode_default` from `settings` table
- fallback env `RECOMMENDATIONS_RUNTIME_MODE_DEFAULT`

Mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`) require auth when `REQUIRE_AUTH=true`.
Provide either:

- `Authorization: Bearer <API_TOKEN>`
- `X-Game-Shelf-Client-Token: <device-token>` (must match configured `CLIENT_WRITE_TOKENS`)

## Run locally

```bash
cd ..
npm run dev:stack:up
```

This starts the API in Docker with Postgres + HLTB scraper dependencies.
Provide file-based secrets in `./nas-secrets` (see `docs/nas-deployment.md` for the full list).
For MobyGames lookups, provide `mobygames_api_key` in the same secrets directory.

## Notes

- Metadata routes reuse the existing worker logic for response compatibility.
- Sync routes persist server-authoritative state and emit cursor-based change events.
- Image proxy uses filesystem-backed cache plus `image_assets` index rows in Postgres.
