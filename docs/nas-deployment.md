# NAS Deployment (Synology + Docker + Tailscale)

## 1. Branch and directories

1. Deploy from branch `main`.
2. Create persistent directories on your NAS host:
   - `nas-data/postgres`
   - `nas-data/image-cache`
   - `nas-data/manuals`

## 2. Create Portainer stack

Use `docker-compose.portainer.yml` in Portainer (`Repository` or `Upload`), then set env vars in the stack UI.

Before first deploy, publish images from GitHub Actions:

1. Push to `main` (or run `Publish Docker Images` workflow manually).
2. Confirm images exist in GHCR:
   - `ghcr.io/thetigeregg/game-shelf-edge:main`
   - `ghcr.io/thetigeregg/game-shelf-api:main`
   - `ghcr.io/thetigeregg/game-shelf-hltb-scraper:main`
   - `ghcr.io/thetigeregg/game-shelf-metacritic-scraper:main`
   - `ghcr.io/thetigeregg/game-shelf-psprices-scraper:main`
   - `ghcr.io/thetigeregg/game-shelf-backup:main`
   - Postgres image defaults to immutable digest-pinned `pgvector/pgvector@sha256:7d400e340efb42f4d8c9c12c6427adb253f726881a9985d2a471bf0eed824dff`.
     Set `POSTGRES_IMAGE` only when you explicitly want to override this pin.
3. In Portainer, add a registry credential for `ghcr.io`:
   - Username: your GitHub username
   - Password/token: GitHub PAT with `read:packages` (and `repo` if repo/packages are private)

Required app secrets (one secret per file):

- `api_token`
- `client_write_tokens` (required for browser sync when `REQUIRE_AUTH=true`)
- `database_url`
- `twitch_client_id`
- `twitch_client_secret`
- `thegamesdb_api_key`
- `hltb_scraper_token` (optional)
- `psprices_scraper_token` (optional)
- `openai_api_key` (required for semantic recommendation embeddings)
- `postgres_user`
- `postgres_password`

Common stack env vars:

- `NAS_DATA_ROOT` (recommended absolute host path for `postgres`, `image-cache`, `manuals`)
- `SECRETS_HOST_DIR` (required: absolute host path to your secrets directory, e.g. `/volume1/docker/secrets/gameshelf`)
- `TZ` (optional; defaults to `Europe/Zurich`, can be overridden)
- `DATABASE_URL_FILE`
- `CORS_ORIGIN`
- `API_TOKEN_FILE`
- `CLIENT_WRITE_TOKENS_FILE`
- `REQUIRE_AUTH` (defaults to true)
- `HLTB_SCRAPER_TOKEN_FILE` (optional, but recommended)
- `TWITCH_CLIENT_ID_FILE`
- `TWITCH_CLIENT_SECRET_FILE`
- `THEGAMESDB_API_KEY_FILE`
- `STEAM_STORE_API_BASE_URL` (optional; defaults to `https://store.steampowered.com`)
- `STEAM_STORE_API_TIMEOUT_MS` (optional; defaults to `10000`)
- `STEAM_DEFAULT_COUNTRY` (optional; defaults to `CH`)
- `STEAM_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE` (optional; defaults to `true`)
- `STEAM_PRICE_CACHE_FRESH_TTL_SECONDS` (optional; defaults to `86400`)
- `STEAM_PRICE_CACHE_STALE_TTL_SECONDS` (optional; defaults to `7776000`)
- `PSPRICES_SCRAPER_BASE_URL` (optional; defaults to internal service URL)
- `PSPRICES_SCRAPER_TOKEN_FILE` (optional, but recommended)
- `PSPRICES_REGION_PATH` (optional; defaults `region-ch`)
- `PSPRICES_SHOW` (optional; defaults `games`)
- `PSPRICES_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE` (optional; defaults `true`)
- `PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS` (optional; defaults `86400`)
- `PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS` (optional; defaults `7776000`)
- `PRICING_REFRESH_ENABLED` (optional; defaults `true`; consumed by `worker-general`)
- `PRICING_REFRESH_INTERVAL_MINUTES` (optional; defaults `60`; consumed by `worker-general`)
- `PRICING_REFRESH_BATCH_SIZE` (optional; defaults `200`; consumed by `worker-general`)
- `PRICING_REFRESH_STALE_HOURS` (optional; defaults `24`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_ENABLED` (optional; defaults `true`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_INTERVAL_MINUTES` (optional; defaults `60`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_BATCH_SIZE` (optional; defaults `200`; consumed by `worker-general`)
- `DISCOVERY_PRICING_REFRESH_STALE_HOURS` (optional; defaults `24`; consumed by `worker-general`)
- `OPENAI_API_KEY_FILE`
- `POSTGRES_USER_FILE`
- `POSTGRES_PASSWORD_FILE`
- `POSTGRES_IMAGE` (optional override; keep digest-pinned reference to avoid mutable-tag supply-chain risk)
- `PGUSER_FILE` (backup service DB user)
- `PGPASSWORD_FILE` (backup service DB password)
- `DEBUG_HLTB_SCRAPER_LOGS` (optional)
- `HLTB_SCRAPER_BASE_URL` (optional; defaults to internal service URL)
- `METACRITIC_SCRAPER_BASE_URL` (optional; defaults to internal service URL)
- `FIREBASE_SERVICE_ACCOUNT_JSON_FILE` (required for FCM notifications; defaults to `/run/secrets/firebase_service_account_json`)
- `RELEASE_MONITOR_ENABLED` (optional; defaults `true`)
- `RELEASE_MONITOR_INTERVAL_SECONDS` (optional; defaults `900`)
- `RELEASE_MONITOR_BATCH_SIZE` (optional; defaults `100`)
- `RELEASE_MONITOR_JOB_CONCURRENCY` (optional; defaults `2`; consumed by `worker-general`)
- `RELEASE_MONITOR_DEBUG_LOGS` (optional; defaults `false`)
- `NOTIFICATIONS_TEST_ENDPOINT_ENABLED` (optional; defaults `false`; enables `POST /v1/notifications/test`)
- `NOTIFICATIONS_OBSERVABILITY_ENDPOINT_ENABLED` (optional; defaults `false`; enables `GET /v1/notifications/observability`)
- `HLTB_PERIODIC_REFRESH_YEARS` (optional; defaults `3`)
- `HLTB_PERIODIC_REFRESH_DAYS` (optional; defaults `30`)
- `METACRITIC_PERIODIC_REFRESH_YEARS` (optional; defaults `3`)
- `METACRITIC_PERIODIC_REFRESH_DAYS` (optional; defaults `30`)
- `FCM_TOKEN_CLEANUP_ENABLED` (optional; defaults `true`)
- `FCM_TOKEN_CLEANUP_INTERVAL_HOURS` (optional; defaults `24`)
- `FCM_TOKEN_STALE_DEACTIVATE_DAYS` (optional; defaults `60`)
- `FCM_TOKEN_INACTIVE_PURGE_DAYS` (optional; defaults `180`)
- `RELEASE_MONITOR_WARN_SEND_FAILURE_RATIO` (optional; defaults `0.5`)
- `RELEASE_MONITOR_WARN_INVALID_TOKEN_RATIO` (optional; defaults `0.2`)
- `BACKUP_SCHEDULE_TIME` (optional; defaults to `00:00` in container timezone)
- `BACKUP_KEEP_COUNT` (optional; defaults to `14`)
- `BACKUP_PGDUMP_RETRIES` (optional; defaults to `3`)
- `BACKUP_PGDUMP_RETRY_DELAY_SECONDS` (optional; defaults to `5`)
- `BACKGROUND_WORKER_MODE` (optional; compose default is `general` for `worker-general`; worker runtime fallback is `all` if unset/invalid)
- `BACKGROUND_WORKER_MODE_RECOMMENDATIONS` (optional; compose/Portainer substitution var used to set `BACKGROUND_WORKER_MODE` for `worker-recommendations`; compose default is `recommendations`; if set to an invalid value, worker runtime falls back to `all`)
- `RECOMMENDATIONS_SCHEDULER_ENABLED` (optional; defaults `true`; consumed by `worker-general`)
- `RECOMMENDATIONS_JOB_CONCURRENCY` (optional; defaults `1`; read by worker runtime; applies when `BACKGROUND_WORKER_MODE` includes recommendations work (`all` or `recommendations`))
- `DISCOVERY_ENRICHMENT_JOB_CONCURRENCY` (optional; defaults `1`; consumed by `worker-general`)
- `RECOMMENDATIONS_ENRICH_API_BASE_URL` (optional; defaults `http://api:3000`; worker-only)
- `RECOMMENDATIONS_RUNTIME_MODE_DEFAULT` (optional; `NEUTRAL|SHORT|LONG`, default `NEUTRAL`)
- `RECOMMENDATIONS_EXPLORATION_WEIGHT` (optional; default `0.3`)
- `RECOMMENDATIONS_DIVERSITY_PENALTY_WEIGHT` (optional; default `0.5`)
- `RECOMMENDATIONS_REPEAT_PENALTY_STEP` (optional; default `0.2`)
- `RECOMMENDATIONS_TUNING_MIN_RATED` (optional; default `8`)
- `RECOMMENDATIONS_LANE_LIMIT` (optional; default `20`)
- `RECOMMENDATIONS_KEYWORDS_STRUCTURED_MAX` (optional; default `100`)
- `RECOMMENDATIONS_KEYWORDS_EMBEDDING_MAX` (optional; default `40`)
- `RECOMMENDATIONS_KEYWORDS_GLOBAL_MAX_RATIO` (optional; default `0.7`)
- `RECOMMENDATIONS_KEYWORDS_STRUCTURED_MAX_RATIO` (optional; default `0.3`)
- `RECOMMENDATIONS_KEYWORDS_MIN_LIBRARY_COUNT` (optional; default `3`)
- `RECOMMENDATIONS_KEYWORDS_WEIGHT` (optional; default `0.6`)
- `RECOMMENDATIONS_THEMES_WEIGHT` (optional; default `1.3`)
- `RECOMMENDATIONS_SIMILARITY_THEME_WEIGHT` (optional; default `0.35`)
- `RECOMMENDATIONS_SIMILARITY_GENRE_WEIGHT` (optional; default `0.25`)
- `RECOMMENDATIONS_SIMILARITY_SERIES_WEIGHT` (optional; default `0.20`)
- `RECOMMENDATIONS_SIMILARITY_DEVELOPER_WEIGHT` (optional; default `0.10`)
- `RECOMMENDATIONS_SIMILARITY_PUBLISHER_WEIGHT` (optional; default `0.10`)
- `RECOMMENDATIONS_SIMILARITY_KEYWORD_WEIGHT` (optional; default `0.05`)
- `RECOMMENDATIONS_DISCOVERY_ENABLED` (optional; default `true`)
- `RECOMMENDATIONS_DISCOVERY_POOL_SIZE` (optional; default `2000`)
- `RECOMMENDATIONS_DISCOVERY_REFRESH_HOURS` (optional; default `24`)
- `RECOMMENDATIONS_DISCOVERY_POPULAR_REFRESH_HOURS` (optional; default `24`)
- `RECOMMENDATIONS_DISCOVERY_RECENT_REFRESH_HOURS` (optional; default `6`)
- `RECOMMENDATIONS_DISCOVERY_IGDB_REQUEST_TIMEOUT_MS` (optional; default `15000`)
- `RECOMMENDATIONS_DISCOVERY_IGDB_MAX_REQUESTS_PER_SECOND` (optional; default `4`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_ENABLED` (optional; default `true`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_STARTUP_DELAY_MS` (optional; default `5000`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_INTERVAL_MINUTES` (optional; default `30`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_MAX_GAMES_PER_RUN` (optional; default `500`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_REQUEST_TIMEOUT_MS` (optional; default `15000`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_MAX_ATTEMPTS` (optional; default `6`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_BACKOFF_BASE_MINUTES` (optional; default `60`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_BACKOFF_MAX_HOURS` (optional; default `168`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_AFTER_DAYS` (optional; default `30`)
- `RECOMMENDATIONS_DISCOVERY_ENRICH_REARM_RECENT_RELEASE_YEARS` (optional; default `1`)
- `IGDB_METADATA_ENRICH_ENABLED` (optional; default `true`)
- `IGDB_METADATA_ENRICH_BATCH_SIZE` (optional; default `200`)
- `IGDB_METADATA_ENRICH_MAX_GAMES_PER_RUN` (optional; default `5000`)
- `IGDB_METADATA_ENRICH_STARTUP_DELAY_MS` (optional; default `5000`)
- `IGDB_METADATA_ENRICH_REQUEST_TIMEOUT_MS` (optional; default `15000`)
- `METADATA_ENRICHMENT_JOB_CONCURRENCY` (optional; default `1`; consumed by `worker-general`)
- `METADATA_ENRICHMENT_QUEUE_INTERVAL_MINUTES` (optional; default `60`; consumed by `worker-general`)
- `BACKGROUND_JOBS_RETENTION_DAYS` (optional; default `30`; consumed by `worker-general`)
- `BACKGROUND_JOBS_CLEANUP_INTERVAL_MINUTES` (optional; default `60`; consumed by `worker-general`)
- `BACKGROUND_JOBS_CLEANUP_BATCH_SIZE` (optional; default `1000`; consumed by `worker-general`)
- `BACKGROUND_JOBS_STALE_RUNNING_MINUTES` (optional; default `30`; consumed by `worker-general`)
- `BACKGROUND_JOBS_STALE_RECOVERY_INTERVAL_MINUTES` (optional; default `5`; consumed by `worker-general`)
- `BACKGROUND_JOBS_LOCK_HEARTBEAT_SECONDS` (optional; default `30`; consumed by worker services (`worker-general` and `worker-recommendations`))
- `RECOMMENDATION_RUN_STALE_MINUTES` (optional; default `30`; consumed by `worker-general`)
- `CACHE_REVALIDATION_JOB_CONCURRENCY` (optional; default `2`; consumed by `worker-general`)
- `MANUALS_CATALOG_JOB_CONCURRENCY` (optional; default `1`; consumed by `worker-general`)
- `MANUALS_DIR` (optional; default `/data/manuals`; should match mounted manuals path)

Queue recovery behavior:

- The worker sends lock heartbeats for in-flight jobs (`locked_at` refresh).
- Stale `running` background jobs are automatically re-queued after `BACKGROUND_JOBS_STALE_RUNNING_MINUTES`.
- Stale `RUNNING` recommendation runs are automatically failed after `RECOMMENDATION_RUN_STALE_MINUTES`.

Release notification defaults:

- Notifications are opt-in. If no synced setting exists for `game-shelf:notifications:release:enabled`, the backend treats notifications as disabled.

Security note:

- File-based secrets are required for sensitive values in this stack.
- The stack mounts `SECRETS_HOST_DIR` to `/run/secrets` read-only in relevant containers.
- `api`, `backup`, and `hltb-scraper` runtime config read sensitive values from secret files.

Rate limiting env vars (optional):

- `RATE_LIMIT_WINDOW_MS` (defaults to `60000` — 1 minute window)
- `IMAGE_PROXY_MAX_REQUESTS_PER_WINDOW` (defaults to `120` req/min per IP for the image proxy endpoint)
- `IMAGE_PURGE_MAX_REQUESTS_PER_WINDOW` (defaults to `30` req/min per IP for the cache purge endpoint)

> **Note:** The rate limiter is in-memory and scoped to a single `api` container instance. If you scale the `api` service to multiple replicas, each replica maintains its own independent counter, so the effective per-IP limit is multiplied by the number of running replicas. This deployment guide assumes a single `api` replica, which is the expected use case for a personal NAS. If you require multi-instance deployments, a shared rate-limiting backend (e.g. Redis) would be needed.

Protected POST endpoints require:

- one of:
  - `Authorization: Bearer <API_TOKEN>`
  - `X-Game-Shelf-Client-Token: <device-token>`
- `edge` does not inject auth headers for `/api/*`.
- Browser write operations (`/api/v1/sync/push`, `/api/v1/sync/pull`, `/api/v1/images/cache/purge`) rely on a per-device token configured in app Settings.

Create one or more device write tokens in `client_write_tokens` (newline or comma separated), for example:

```text
device-token-phone
device-token-tablet
```

Example:

- `NAS_DATA_ROOT=/volume1/docker/game-shelf/nas-data`
- `SECRETS_HOST_DIR=/volume1/docker/secrets/gameshelf`

Create one file per secret under `SECRETS_HOST_DIR`:

- `/volume1/docker/secrets/gameshelf/api_token`
- `/volume1/docker/secrets/gameshelf/client_write_tokens`
- `/volume1/docker/secrets/gameshelf/database_url`
- `/volume1/docker/secrets/gameshelf/twitch_client_id`
- `/volume1/docker/secrets/gameshelf/twitch_client_secret`
- `/volume1/docker/secrets/gameshelf/thegamesdb_api_key`
- `/volume1/docker/secrets/gameshelf/hltb_scraper_token` (optional)
- `/volume1/docker/secrets/gameshelf/psprices_scraper_token` (optional)
- `/volume1/docker/secrets/gameshelf/openai_api_key` (required for semantic recommendation embeddings)
- `/volume1/docker/secrets/gameshelf/postgres_user`
- `/volume1/docker/secrets/gameshelf/postgres_password`
- `/volume1/docker/secrets/gameshelf/firebase_service_account_json` (required for FCM notifications)

You can override individual directories if needed:

- `POSTGRES_HOST_DIR`
- `IMAGE_CACHE_HOST_DIR`
- `MANUALS_HOST_DIR`

## 3. Start stack

```bash
docker compose up -d
docker compose ps
```

For production, use only `docker-compose.portainer.yml` (do not include `docker-compose.dev.yml`).

Services:

- `edge` serves the PWA and proxies `/api/*`.
- `api` hosts metadata + sync endpoints.
- `postgres` stores authoritative app data.
- `hltb-scraper` provides browser-backed HLTB lookups.
- `metacritic-scraper` provides browser-backed Metacritic lookups.
- `psprices-scraper` provides browser-backed PSPrices lookups.
- `backup` creates nightly Postgres dump artifacts under `nas-data/backups`.

Manual PDFs:

- Store PDFs under `nas-data/manuals`.
- Use platform folders that end with `__pid-<platformIgdbId>` (example: `PlayStation 2__pid-8`).
- The app serves files at `/manuals/...` and the API scans `/data/manuals` for fuzzy matching.

## Local Docker-based API development

Local development runs `api` in Docker (no host-run API process).

1. Create local secret files (required, one file per secret) under `./nas-secrets`:

`nas-secrets/database_url`
`nas-secrets/api_token`
`nas-secrets/client_write_tokens` (required if `REQUIRE_AUTH=true` and you use browser sync)
`nas-secrets/twitch_client_id`
`nas-secrets/twitch_client_secret`
`nas-secrets/thegamesdb_api_key`
`nas-secrets/postgres_user`
`nas-secrets/postgres_password`
`nas-secrets/hltb_scraper_token` (optional)
`nas-secrets/psprices_scraper_token` (optional)
`nas-secrets/firebase_service_account_json` (required for FCM notifications)
`nas-secrets/metacritic_scraper_token` (optional)
`nas-secrets/mobygames_api_key` (required for MobyGames review lookups)
`nas-secrets/openai_api_key` (required for semantic recommendation embeddings)

2. Create local non-secret env file:

```bash
cp .env.example .env
```

Key metadata env vars in `.env`:

- `METACRITIC_SCRAPER_BASE_URL=http://metacritic-scraper:8789`
- `METACRITIC_SEARCH_RATE_LIMIT_MAX_PER_MINUTE=240`
- `MOBYGAMES_API_BASE_URL=https://api.mobygames.com/v2`
- `MOBYGAMES_SEARCH_RATE_LIMIT_MAX_PER_MINUTE=12` (0.2 requests/second)
- `STEAM_STORE_API_BASE_URL=https://store.steampowered.com`
- `STEAM_STORE_API_TIMEOUT_MS=10000`
- `STEAM_DEFAULT_COUNTRY=CH`
- `STEAM_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE=true`
- `STEAM_PRICE_CACHE_FRESH_TTL_SECONDS=86400`
- `STEAM_PRICE_CACHE_STALE_TTL_SECONDS=7776000`
- `PSPRICES_SCRAPER_BASE_URL=http://psprices-scraper:8790`
- `PSPRICES_REGION_PATH=region-ch`
- `PSPRICES_SHOW=games`
- `PSPRICES_PRICE_CACHE_ENABLE_STALE_WHILE_REVALIDATE=true`
- `PSPRICES_PRICE_CACHE_FRESH_TTL_SECONDS=86400`
- `PSPRICES_PRICE_CACHE_STALE_TTL_SECONDS=7776000`
- `PRICING_REFRESH_ENABLED=true`
- `PRICING_REFRESH_INTERVAL_MINUTES=60`
- `PRICING_REFRESH_BATCH_SIZE=200`
- `PRICING_REFRESH_STALE_HOURS=24`
- `DISCOVERY_PRICING_REFRESH_ENABLED=true`
- `DISCOVERY_PRICING_REFRESH_INTERVAL_MINUTES=60`
- `DISCOVERY_PRICING_REFRESH_BATCH_SIZE=200`
- `DISCOVERY_PRICING_REFRESH_STALE_HOURS=24`

Key recommendation env vars in `.env`:

- `RECOMMENDATIONS_RUNTIME_MODE_DEFAULT=NEUTRAL`
- `RECOMMENDATIONS_EXPLORATION_WEIGHT=0.3`
- `RECOMMENDATIONS_DIVERSITY_PENALTY_WEIGHT=0.5`
- `RECOMMENDATIONS_REPEAT_PENALTY_STEP=0.2`
- `RECOMMENDATIONS_TUNING_MIN_RATED=8`
- `RECOMMENDATIONS_LANE_LIMIT=20`

3. Start the dev stack with worktree-safe commands:

```bash
npm run dev:stack:up
npm run dev:start
```

To start with seed restore when DB is empty:

```bash
npm run dev:stack:up:seed
```

Inspect the derived project/ports with:

```bash
npm run dev:info
```

Shared-seed workflow (recommended for realistic local test data without cross-worktree DB pollution):

1. Refresh a shared DB seed dump from a known-good local DB:

```bash
npm run dev:db:seed:refresh
```

2. Apply seed into current worktree-local DB:

```bash
npm run dev:db:seed:apply
```

`seed:apply` only restores when the target DB is empty; force overwrite with:

```bash
npm run dev:db:seed:apply:force
```

Default seed path is `~/.cache/game-shelf/dev-db-seed/latest.sql.gz` and can be overridden with `DEV_DB_SEED_PATH`.

4. Ports are derived per worktree. Check current URLs with:

```bash
npm run dev:info
```

In local dev, Angular proxies `/manuals/...` requests to the worktree-local `edge` service so manual PDF links resolve without a separate host script.
After first launch on each device, open `Settings -> Debug -> Device Write Token` and set a token listed in `client_write_tokens`.

## 4. Publish over Tailscale only

Run on Synology host (where Tailscale is installed):

```bash
tailscale serve --https=443 http://127.0.0.1:8080
```

Verify:

```bash
tailscale status
tailscale serve status
```

Then access with your tailnet URL shown by `tailscale serve status`.

## 5. Health checks

```bash
curl http://127.0.0.1:8080/api/v1/health
docker compose logs -f api
```

## 6. Backup workflow (Backrest/Restic friendly)

App-consistent Postgres dump artifacts are created automatically by the `backup` service.
The service exists in both compose files, but for NAS/production use `docker-compose.portainer.yml`.
In NAS/Portainer deployments, `backup` runs from `${BACKUP_IMAGE:-ghcr.io/thetigeregg/game-shelf-backup:main}` and already includes `/opt/backup` scripts.

What it produces under `nas-data/backups/<timestamp>/`:

- `postgres.sql.gz` (logical dump via `pg_dump --clean --if-exists`)
- `manifest.txt`

`nas-data/backups/latest` is updated to the most recent backup.

Recommended Backrest/Restic includes:

- `nas-data/backups`
- `nas-data/image-cache`
- `docker-compose.portainer.yml`
- stack env/config files (`.env` in your deployment location)

Recommended excludes:

- `nas-data/postgres` (raw live DB files)
- `nas-data/manuals` (explicitly excluded per current backup policy)
- transient container/cache data outside your intended persisted dirs

Nightly scheduling is handled by the `backup` container itself (cron inside container).
By default it runs at `00:00` container local time (`TZ`).
This may differ from your own local timezone if `TZ` is set differently.
Adjust schedule/retention via stack env vars:

- `BACKUP_SCHEDULE_TIME=00:00`
- `BACKUP_KEEP_COUNT=14`

Trigger an immediate manual backup run from a shell inside `gameshelf-backup` (Portainer Console):

```bash
/bin/sh /opt/backup/backup.sh
```

## 7. Restore

Restore Postgres dump:

```bash
npm run backup:restore:postgres -- --file nas-data/backups/latest/postgres.sql.gz --yes
```

Restore image cache by restoring `nas-data/image-cache` from your Backrest/Restic snapshot.

## 8. Backup smoke test (local/dev)

Run:

```bash
npm run test:backup:ops
```

This validates:

- backup container can run on demand
- `latest/postgres.sql.gz` and `latest/manifest.txt` exist
- retention behavior when `BACKUP_KEEP_COUNT=1`
