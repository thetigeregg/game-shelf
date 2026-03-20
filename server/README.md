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
- `GET /v1/steam/prices`
- `GET /v1/psprices/prices`
- `GET /v1/images/proxy`
- `GET /v1/background-jobs/stats` (admin/debug)
- `GET /v1/background-jobs/failed` (admin/debug)
- `POST /v1/background-jobs/replay` (admin/debug)
- `POST /v1/notifications/fcm/register`
- `POST /v1/notifications/fcm/unregister`
- `GET /v1/notifications/observability` (optional, debug/admin)
- `POST /v1/notifications/test` (optional, debug/admin)
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
  - Optional: `releaseYear` (YYYY), `platform`, `includeCandidates` (`1|true|yes`), `preferredHltbGameId`, `preferredHltbUrl`
- `GET /v1/metacritic/search`
  - Required: `q` (min length 2)
  - Optional: `releaseYear` (YYYY), `platform`, `platformIgdbId`, `includeCandidates` (`1|true|yes`)
- `GET /v1/mobygames/search`
  - Required: `q` (or `title`) (min length 2)
  - Optional: `platform` (MobyGames platform ID), `limit`, `offset`, `id`, `genre`, `group`, `format` (`id|brief|normal`), `include` (comma-separated field list)
- `GET /v1/steam/prices`
  - Required: `igdbGameId`, `platformIgdbId` (Windows-only: `6`)
  - Optional: `cc` (ISO alpha-2 country code, defaults to `CH`)
- `GET /v1/psprices/prices`
  - Required: `igdbGameId`, `platformIgdbId` (supported: `48|167|130|508`)
  - Optional: `title`, `includeCandidates` (`1|true|yes`), `preferredPsPricesUrl`
- `GET /v1/recommendations/top`
  - Required: `target` (`BACKLOG|WISHLIST|DISCOVERY`)
  - Optional: `runtimeMode` (`NEUTRAL|SHORT|LONG`), `limit` (`1..200`, default `20`)
- `GET /v1/recommendations/lanes`
  - Required: `target` (`BACKLOG|WISHLIST|DISCOVERY`)
  - Optional: `runtimeMode` (`NEUTRAL|SHORT|LONG`), `limit` (default `20`)
- `GET /v1/recommendations/similar/:igdbGameId`
  - Required query: `target` (`BACKLOG|WISHLIST|DISCOVERY`), `platformIgdbId`
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
- `FIREBASE_SERVICE_ACCOUNT_JSON_FILE` (defaults to `/run/secrets/firebase_service_account_json`) for FCM push notifications

### Non-secret env vars (metadata/caching/rate limit)

- Rate limiting is configured only through the canonical policy env vars:
  - inbound route policies: `RATE_LIMIT_INBOUND_<POLICY>_MAX_REQUESTS` and `RATE_LIMIT_INBOUND_<POLICY>_WINDOW_MS`
  - outbound provider policies: `RATE_LIMIT_OUTBOUND_<POLICY>_*`
- `HLTB_SCRAPER_BASE_URL`
- `HLTB_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `HLTB_CACHE_FRESH_TTL_SECONDS`
- `HLTB_CACHE_STALE_TTL_SECONDS`
- `METACRITIC_SCRAPER_BASE_URL`
- `METACRITIC_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `METACRITIC_CACHE_FRESH_TTL_SECONDS`
- `METACRITIC_CACHE_STALE_TTL_SECONDS`
- `MOBYGAMES_API_BASE_URL`
  - default: `https://api.mobygames.com/v2`
- `STEAM_STORE_API_BASE_URL`
  - default: `https://store.steampowered.com`
- `STEAM_STORE_API_TIMEOUT_MS`
  - default: `10000`
- `STEAM_DEFAULT_COUNTRY`
  - default: `CH`
- `STEAM_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `STEAM_PRICE_CACHE_FRESH_TTL_SECONDS`
- `STEAM_PRICE_CACHE_STALE_TTL_SECONDS`
- `PSPRICES_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS`
- `PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS`
- `PRICING_REFRESH_ENABLED` (defaults to `true`; consumed by `worker-general`)
- `PRICING_REFRESH_INTERVAL_MINUTES` (defaults to `60`; consumed by `worker-general`)
- `PRICING_REFRESH_BATCH_SIZE` (defaults to `200`; consumed by `worker-general`)
- `PRICING_REFRESH_STALE_HOURS` (defaults to `24`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_ENABLED` (defaults to `true`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_INTERVAL_MINUTES` (defaults to `60`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_BATCH_SIZE` (defaults to `200`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_STALE_HOURS` (defaults to `24`; consumed by `worker-general`)
- `MOBYGAMES_CACHE_ENABLE_STALE_WHILE_REVALIDATE`
- `MOBYGAMES_CACHE_FRESH_TTL_SECONDS`
- `MOBYGAMES_CACHE_STALE_TTL_SECONDS`
- `DEBUG_HTTP_LOGS` (`true|false`, default `false`) enables sanitized upstream request/response logs for IGDB/TheGamesDB, HLTB, Metacritic, and MobyGames.
- `RELEASE_MONITOR_ENABLED` (`true|false`, default `true`)
- `RELEASE_MONITOR_INTERVAL_SECONDS` (default `900`)
- `RELEASE_MONITOR_BATCH_SIZE` (default `100`)
- `RELEASE_MONITOR_JOB_CONCURRENCY` (consumed by `worker-general`; default `2`)
- `RELEASE_MONITOR_DEBUG_LOGS` (`true|false`, default `false`)
- `NOTIFICATIONS_TEST_ENDPOINT_ENABLED` (`true|false`, default `false`) enables `POST /v1/notifications/test` for controlled testing
- `NOTIFICATIONS_OBSERVABILITY_ENDPOINT_ENABLED` (`true|false`, default `false`) enables `GET /v1/notifications/observability`
- `HLTB_PERIODIC_REFRESH_YEARS` (default `3`)
- `HLTB_PERIODIC_REFRESH_DAYS` (default `30`)
- `METACRITIC_PERIODIC_REFRESH_YEARS` (default `3`)
- `METACRITIC_PERIODIC_REFRESH_DAYS` (default `30`)
- `FCM_TOKEN_CLEANUP_ENABLED` (`true|false`, default `true`)
- `FCM_TOKEN_CLEANUP_INTERVAL_HOURS` (default `24`)
- `FCM_TOKEN_STALE_DEACTIVATE_DAYS` (default `60`)
- `FCM_TOKEN_INACTIVE_PURGE_DAYS` (default `180`)
- `RELEASE_MONITOR_WARN_SEND_FAILURE_RATIO` (default `0.5`)
- `RELEASE_MONITOR_WARN_INVALID_TOKEN_RATIO` (default `0.2`)

Release notification preference defaults:

- If `game-shelf:notifications:release:enabled` is missing in settings, notifications are treated as disabled (opt-in).
- Event toggles default to enabled once notifications are explicitly enabled by the user.
- Preferences are currently global (single-user deployment assumption). A multi-user deployment must scope notification preferences per user/device before enabling shared use.

### Non-secret env vars (recommendations)

- `BACKGROUND_WORKER_MODE` (`all|general|recommendations`; runtime fallback `all` if unset/invalid; compose default for `worker-general` is `general`)
- `BACKGROUND_WORKER_MODE_RECOMMENDATIONS` (docker-compose/Portainer stack variable only; sets `BACKGROUND_WORKER_MODE` for `worker-recommendations`; compose default `recommendations`; not read directly by Node runtime)
- `RECOMMENDATIONS_SCHEDULER_ENABLED` (consumed by `worker-general`; API process no longer runs scheduler ticks)
- `RECOMMENDATIONS_JOB_CONCURRENCY` (read by worker runtime; applies when `BACKGROUND_WORKER_MODE` includes recommendations work (`all` or `recommendations`); default `1`)
- `DISCOVERY_ENRICHMENT_JOB_CONCURRENCY` (consumed by `worker-general`; default `1`)
- `RECOMMENDATIONS_ENRICH_API_BASE_URL` (worker-only; defaults to `http://api:3000` for discovery enrichment lookups)
- `RECOMMENDATIONS_DAILY_STALE_HOURS`
- `RECOMMENDATIONS_TOP_LIMIT`
- `RECOMMENDATIONS_SIMILARITY_K`
- `RECOMMENDATIONS_EMBEDDING_MODEL`
- `RECOMMENDATIONS_EMBEDDING_DIMENSIONS` (must be `1536` to match pgvector schema)
- `RECOMMENDATIONS_EMBEDDING_BATCH_SIZE`
- `RECOMMENDATIONS_EMBEDDING_TIMEOUT_MS`
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
- `RECOMMENDATIONS_DISCOVERY_POPULAR_REFRESH_HOURS`
- `RECOMMENDATIONS_DISCOVERY_RECENT_REFRESH_HOURS`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_ENABLED`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_STARTUP_DELAY_MS`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_INTERVAL_MINUTES`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_MAX_GAMES_PER_RUN`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_REQUEST_TIMEOUT_MS`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_MAX_ATTEMPTS`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_BACKOFF_BASE_MINUTES`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_BACKOFF_MAX_HOURS`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_AFTER_DAYS`
- `RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_RECENT_RELEASE_YEARS`

### Non-secret env vars (popularity)

- `POPULARITY_INGEST_ENABLED` (consumed by `worker-general`; default `true`)
- `POPULARITY_INGEST_INTERVAL_MINUTES` (consumed by `worker-general`; default `30`)
- `POPULARITY_FEED_ROW_LIMIT` (consumed by API routes; default `50`; max `200`; values above the max are clamped before mapping and dedupe)
- `POPULARITY_SCORE_THRESHOLD` (consumed by API routes; default `50`; minimum persisted popularity score required for feed eligibility)

### Non-secret env vars (metadata enrichment)

- `IGDB_METADATA_ENRICH_ENABLED` (default `true`)
- `IGDB_METADATA_ENRICH_BATCH_SIZE` (default `200`)
- `IGDB_METADATA_ENRICH_MAX_GAMES_PER_RUN` (default `5000`)
- `IGDB_METADATA_ENRICH_STARTUP_DELAY_MS` (default `5000`)
- `METADATA_ENRICHMENT_JOB_CONCURRENCY` (consumed by `worker-general`; default `1`)
- `METADATA_ENRICHMENT_QUEUE_INTERVAL_MINUTES` (consumed by `worker-general`; default `60`)

### Rate-limit policy env vars

Inbound policies:

- `RATE_LIMIT_INBOUND_GLOBAL_BASELINE_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_GLOBAL_BASELINE_WINDOW_MS`
- `RATE_LIMIT_INBOUND_PUBLIC_READ_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_PUBLIC_READ_WINDOW_MS`
- `RATE_LIMIT_INBOUND_SEARCH_READ_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_SEARCH_READ_WINDOW_MS`
- `RATE_LIMIT_INBOUND_METADATA_GAME_BY_ID_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_METADATA_GAME_BY_ID_WINDOW_MS`
- `RATE_LIMIT_INBOUND_IMAGE_PROXY_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_IMAGE_PROXY_WINDOW_MS`
- `RATE_LIMIT_INBOUND_IMAGE_PURGE_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_IMAGE_PURGE_WINDOW_MS`
- `RATE_LIMIT_INBOUND_CACHE_STATS_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_CACHE_STATS_WINDOW_MS`
- `RATE_LIMIT_INBOUND_SYNC_PUSH_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_SYNC_PUSH_WINDOW_MS`
- `RATE_LIMIT_INBOUND_SYNC_PULL_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_SYNC_PULL_WINDOW_MS`
- `RATE_LIMIT_INBOUND_RECOMMENDATIONS_READ_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_RECOMMENDATIONS_READ_WINDOW_MS`
- `RATE_LIMIT_INBOUND_RECOMMENDATIONS_REBUILD_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_RECOMMENDATIONS_REBUILD_WINDOW_MS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_REGISTER_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_REGISTER_WINDOW_MS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_UNREGISTER_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_UNREGISTER_WINDOW_MS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_TEST_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_TEST_WINDOW_MS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_OBSERVABILITY_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_NOTIFICATIONS_OBSERVABILITY_WINDOW_MS`
- `RATE_LIMIT_INBOUND_ADMIN_READ_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_ADMIN_READ_WINDOW_MS`
- `RATE_LIMIT_INBOUND_ADMIN_DETAIL_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_ADMIN_DETAIL_WINDOW_MS`
- `RATE_LIMIT_INBOUND_ADMIN_MUTATION_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_ADMIN_MUTATION_WINDOW_MS`
- `RATE_LIMIT_INBOUND_BACKGROUND_JOBS_STATS_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_BACKGROUND_JOBS_STATS_WINDOW_MS`
- `RATE_LIMIT_INBOUND_BACKGROUND_JOBS_FAILED_LIST_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_BACKGROUND_JOBS_FAILED_LIST_WINDOW_MS`
- `RATE_LIMIT_INBOUND_BACKGROUND_JOBS_REPLAY_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_BACKGROUND_JOBS_REPLAY_WINDOW_MS`
- `RATE_LIMIT_INBOUND_MANUALS_READ_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_MANUALS_READ_WINDOW_MS`
- `RATE_LIMIT_INBOUND_MANUALS_REFRESH_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_MANUALS_REFRESH_WINDOW_MS`
- `RATE_LIMIT_INBOUND_POPULARITY_FEED_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_POPULARITY_FEED_WINDOW_MS`
- `RATE_LIMIT_INBOUND_STEAM_PRICES_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_STEAM_PRICES_WINDOW_MS`
- `RATE_LIMIT_INBOUND_PSPRICES_PRICES_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_PSPRICES_PRICES_WINDOW_MS`
- `RATE_LIMIT_INBOUND_HLTB_SEARCH_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_HLTB_SEARCH_WINDOW_MS`
- `RATE_LIMIT_INBOUND_METACRITIC_SEARCH_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_METACRITIC_SEARCH_WINDOW_MS`
- `RATE_LIMIT_INBOUND_MOBYGAMES_SEARCH_MAX_REQUESTS`
- `RATE_LIMIT_INBOUND_MOBYGAMES_SEARCH_WINDOW_MS`

Outbound policies:

- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_REQUEST_TIMEOUT_MS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_REQUESTS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_REQUESTS_PER_SECOND`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_WINDOW_MS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_CONCURRENT`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MIN_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_DEFAULT_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_PROXY_MAX_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_DISCOVERY_REQUEST_TIMEOUT_MS`
- `RATE_LIMIT_OUTBOUND_IGDB_DISCOVERY_REQUESTS_PER_SECOND`
- `RATE_LIMIT_OUTBOUND_IGDB_DISCOVERY_MAX_CONCURRENT`
- `RATE_LIMIT_OUTBOUND_IGDB_DISCOVERY_MIN_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_DISCOVERY_DEFAULT_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_DISCOVERY_MAX_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_ENRICHMENT_REQUEST_TIMEOUT_MS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_ENRICHMENT_REQUESTS_PER_SECOND`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_ENRICHMENT_MAX_CONCURRENT`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_ENRICHMENT_MIN_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_ENRICHMENT_DEFAULT_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_METADATA_ENRICHMENT_MAX_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_POPULARITY_REQUEST_TIMEOUT_MS`
- `RATE_LIMIT_OUTBOUND_IGDB_POPULARITY_REQUESTS_PER_SECOND`
- `RATE_LIMIT_OUTBOUND_IGDB_POPULARITY_MAX_CONCURRENT`
- `RATE_LIMIT_OUTBOUND_IGDB_POPULARITY_MIN_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_POPULARITY_DEFAULT_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_IGDB_POPULARITY_MAX_COOLDOWN_SECONDS`
- `RATE_LIMIT_OUTBOUND_MOBYGAMES_MIN_INTERVAL_MS`
- `RATE_LIMIT_OUTBOUND_MOBYGAMES_MAX_DELAY_MS`

Scope note:

- IGDB metadata enrichment is intentionally limited to `games.payload.listType = 'wishlist'`.
- Discovery rows use the separate discovery enrichment pipeline (`RECOMMENDATIONS_DISCOVERY_ENRICH_*`).

### Non-secret env vars (queued maintenance jobs)

- `BACKGROUND_JOBS_RETENTION_DAYS` (consumed by `worker-general`; default `30`)
- `BACKGROUND_JOBS_CLEANUP_INTERVAL_MINUTES` (consumed by `worker-general`; default `60`)
- `BACKGROUND_JOBS_CLEANUP_BATCH_SIZE` (consumed by `worker-general`; default `1000`)
- `BACKGROUND_JOBS_STALE_RUNNING_MINUTES` (consumed by `worker-general`; default `30`)
- `BACKGROUND_JOBS_STALE_RECOVERY_INTERVAL_MINUTES` (consumed by `worker-general`; default `5`)
- `BACKGROUND_JOBS_LOCK_HEARTBEAT_SECONDS` (consumed by `worker-general` and `worker-recommendations`; default `30`)
- `RECOMMENDATION_RUN_STALE_MINUTES` (consumed by `worker-general`; default `30`)
- `CACHE_REVALIDATION_JOB_CONCURRENCY` (consumed by `worker-general`; default `2`)
- `MANUALS_CATALOG_JOB_CONCURRENCY` (consumed by `worker-general`; default `1`)
- `MANUALS_DIR` (used by API and worker; default `/data/manuals` in Docker)

Stale recovery behavior:

- Worker refreshes `background_jobs.locked_at` while a job is running (heartbeat).
- Worker periodically re-queues stale `running` background jobs whose lock age exceeds `BACKGROUND_JOBS_STALE_RUNNING_MINUTES`.
- Worker periodically marks stale `recommendation_runs` rows stuck in `RUNNING` as `FAILED` when older than `RECOMMENDATION_RUN_STALE_MINUTES`.

Runtime mode resolution for recommendation reads:

- request query `runtimeMode` (if provided)
- fallback setting `recommendations.runtime_mode_default` from `settings` table
- fallback env `RECOMMENDATIONS_RUNTIME_MODE_DEFAULT`

Mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`) require auth when `REQUIRE_AUTH=true`.
Provide either:

- `Authorization: Bearer <API_TOKEN>`
- `X-Game-Shelf-Client-Token: <device-token>` (must match configured `CLIENT_WRITE_TOKENS`)

Background job admin routes:

- `GET /v1/background-jobs/stats`
- `GET /v1/background-jobs/failed`
- `POST /v1/background-jobs/replay`

These require API bearer authorization when `REQUIRE_AUTH=true` (client write tokens are not accepted).

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

## Critic Score Policy

- `reviewScore` is a unified critic score field and must only represent provider-backed critic data.
- Valid `reviewSource` values are `metacritic` and `mobygames`.
- Discovery IGDB ingestion does not populate `reviewScore`.
- Discovery enrichment treats `reviewScore` as authoritative only when `reviewSource` is set to a supported provider.

### Cleanup migration behavior

- On startup, API/worker processes run idempotent DB migrations automatically.
- The migration performs three cleanup steps for legacy rows:
  1. Backfill unified review fields from existing `metacriticScore` / `metacriticUrl` where possible.
  2. Backfill unified review fields from existing `mobyScore` where possible.
  3. Clear non-provider `reviewScore`/`reviewSource`/`reviewUrl` values and clear discovery `enrichmentRetry` so provider enrichment can repopulate.
- No manual SQL is required under normal deployment.

### Post-deploy operational recommendation

- After deploying this change, queue recommendation rebuilds so ranking artifacts reflect cleaned critic data:
  - `POST /v1/recommendations/rebuild` with `{"target":"DISCOVERY","force":true}`
  - `POST /v1/recommendations/rebuild` with `{"target":"BACKLOG","force":true}`
  - `POST /v1/recommendations/rebuild` with `{"target":"WISHLIST","force":true}`
- Discovery rebuild also triggers a discovery enrichment pass, so Metacritic/HLTB repopulation starts immediately (in addition to scheduled worker runs).
