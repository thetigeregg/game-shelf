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
   - `ghcr.io/thetigeregg/game-shelf-backup:main`
3. In Portainer, add a registry credential for `ghcr.io`:
   - Username: your GitHub username
   - Password/token: GitHub PAT with `read:packages` (and `repo` if repo/packages are private)

Required app secrets (one secret per file):

- `api_token`
- `database_url`
- `twitch_client_id`
- `twitch_client_secret`
- `thegamesdb_api_key`
- `hltb_scraper_token` (optional)
- `postgres_user`
- `postgres_password`

Common stack env vars:

- `NAS_DATA_ROOT` (recommended absolute host path for `postgres`, `image-cache`, `manuals`)
- `SECRETS_HOST_DIR` (recommended: `/volume1/docker/secrets/gameshelf`)
- `TZ` (optional; defaults to `Europe/Zurich`, can be overridden)
- `DATABASE_URL_FILE`
- `CORS_ORIGIN`
- `API_TOKEN_FILE`
- `REQUIRE_AUTH` (defaults to true)
- `HLTB_SCRAPER_TOKEN_FILE` (optional, but recommended)
- `TWITCH_CLIENT_ID_FILE`
- `TWITCH_CLIENT_SECRET_FILE`
- `THEGAMESDB_API_KEY_FILE`
- `POSTGRES_USER_FILE`
- `POSTGRES_PASSWORD_FILE`
- `PGUSER_FILE` (backup service DB user)
- `PGPASSWORD_FILE` (backup service DB password)
- `DEBUG_HLTB_SCRAPER_LOGS` (optional)
- `HLTB_SCRAPER_BASE_URL` (optional; defaults to internal service URL)
- `BACKUP_SCHEDULE_TIME` (optional; defaults to `00:00` in container timezone)
- `BACKUP_KEEP_COUNT` (optional; defaults to `14`)
- `BACKUP_PGDUMP_RETRIES` (optional; defaults to `3`)
- `BACKUP_PGDUMP_RETRY_DELAY_SECONDS` (optional; defaults to `5`)

Security note:

- File-based secrets are required for sensitive values in this stack.
- The stack mounts `SECRETS_HOST_DIR` to `/run/secrets` read-only in relevant containers.
- `api`, `backup`, and `hltb-scraper` runtime config read sensitive values from secret files.

Rate limiting env vars (optional):

- `RATE_LIMIT_WINDOW_MS` (defaults to `60000` — 1 minute window)
- `IMAGE_PROXY_MAX_REQUESTS_PER_WINDOW` (defaults to `120` req/min per IP for the image proxy endpoint)
- `IMAGE_PURGE_MAX_REQUESTS_PER_WINDOW` (defaults to `30` req/min per IP for the cache purge endpoint)

> **Note:** The rate limiter is in-memory and scoped to a single `api` container instance. If you scale the `api` service to multiple replicas, each replica maintains its own independent counter, so the effective per-IP limit is multiplied by the number of running replicas. This deployment guide assumes a single `api` replica, which is the expected use case for a personal NAS. If you require multi-instance deployments, a shared rate-limiting backend (e.g. Redis) would be needed.

Protected POST endpoints (`/api/v1/sync/push`, `/api/v1/sync/pull`, `/api/v1/images/cache/purge`, `/api/v1/manuals/refresh`) require:

- `Authorization: Bearer <API_TOKEN>`
- The bundled `edge` service injects this header automatically for `/api/*` requests from `API_TOKEN_FILE`.

Example:

- `NAS_DATA_ROOT=/volume1/docker/game-shelf/nas-data`
- `SECRETS_HOST_DIR=/volume1/docker/secrets/gameshelf`

Create one file per secret under `SECRETS_HOST_DIR`:

- `/volume1/docker/secrets/gameshelf/api_token`
- `/volume1/docker/secrets/gameshelf/database_url`
- `/volume1/docker/secrets/gameshelf/twitch_client_id`
- `/volume1/docker/secrets/gameshelf/twitch_client_secret`
- `/volume1/docker/secrets/gameshelf/thegamesdb_api_key`
- `/volume1/docker/secrets/gameshelf/hltb_scraper_token` (optional)
- `/volume1/docker/secrets/gameshelf/postgres_user`
- `/volume1/docker/secrets/gameshelf/postgres_password`

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
`nas-secrets/twitch_client_id`
`nas-secrets/twitch_client_secret`
`nas-secrets/thegamesdb_api_key`
`nas-secrets/postgres_user`
`nas-secrets/postgres_password`
`nas-secrets/hltb_scraper_token` (optional)

2. Start the dev stack:

```bash
npm run dev:stack:up
```

3. API is reachable at `http://127.0.0.1:3000` and frontend can run with:

```bash
npm start
```

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
