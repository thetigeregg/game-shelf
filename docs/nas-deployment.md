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
3. In Portainer, add a registry credential for `ghcr.io`:
   - Username: your GitHub username
   - Password/token: GitHub PAT with `read:packages` (and `repo` if repo/packages are private)

Required app secrets:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `THEGAMESDB_API_KEY`

Common stack env vars:

- `NAS_DATA_ROOT` (recommended absolute host path for `postgres`, `image-cache`, `manuals`)
- `TZ` (optional; defaults to `Europe/Zurich`, can be overridden)
- `DATABASE_URL` (default works for bundled postgres service)
- `CORS_ORIGIN`
- `API_TOKEN` (required when `REQUIRE_AUTH=true`)
- `REQUIRE_AUTH` (defaults to true)
- `HLTB_SCRAPER_TOKEN` (optional, but recommended)
- `DEBUG_HLTB_SCRAPER_LOGS` (optional)
- `HLTB_SCRAPER_BASE_URL` (optional; defaults to internal service URL)
- `BACKUP_SCHEDULE_TIME` (optional; defaults to `00:00` in container timezone)
- `BACKUP_KEEP_COUNT` (optional; defaults to `14`)
- `BACKUP_PGDUMP_RETRIES` (optional; defaults to `3`)
- `BACKUP_PGDUMP_RETRY_DELAY_SECONDS` (optional; defaults to `5`)

Protected POST endpoints (`/api/v1/sync/push`, `/api/v1/sync/pull`, `/api/v1/images/cache/purge`, `/api/v1/manuals/refresh`) require:

- `Authorization: Bearer <API_TOKEN>`
- The bundled `edge` service injects this header automatically for `/api/*` requests.

Example:

- `NAS_DATA_ROOT=/volume1/docker/game-shelf/nas-data`

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

## Local host-based API development (without running `api` container)

For local dev, use only `server/.env`:

`DATABASE_URL=postgres://gameshelf:gameshelf@localhost:5432/gameshelf`
`IMAGE_CACHE_DIR=./server/.data/images`
`HLTB_SCRAPER_BASE_URL=http://localhost:8788`
`HLTB_SCRAPER_TIMEOUT_MS=30000`

Use the dev override so postgres/scraper are bound to localhost only:

```bash
docker compose -f docker-compose.yml -f docker-compose.dev.yml up -d postgres hltb-scraper
```

Run host dev server:

```bash
npm --prefix server run dev
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
