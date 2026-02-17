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
- `DATABASE_URL` (default works for bundled postgres service)
- `CORS_ORIGIN`
- `HLTB_SCRAPER_TOKEN` (optional, but recommended)
- `DEBUG_HLTB_SCRAPER_LOGS` (optional)
- `HLTB_SCRAPER_BASE_URL` (optional; defaults to internal service URL)
- `FIREBASE_SERVICE_ACCOUNT_JSON` (required for FCM notifications)
- `RELEASE_MONITOR_ENABLED` (optional; defaults `true`)
- `RELEASE_MONITOR_INTERVAL_SECONDS` (optional; defaults `900`)
- `RELEASE_MONITOR_BATCH_SIZE` (optional; defaults `100`)
- `RELEASE_MONITOR_DEBUG_LOGS` (optional; defaults `false`)
- `HLTB_PERIODIC_REFRESH_YEARS` (optional; defaults `3`)
- `HLTB_PERIODIC_REFRESH_DAYS` (optional; defaults `30`)

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

## 6. Manual backup
Postgres dump:
```bash
docker compose exec -T postgres pg_dump -U gameshelf -d gameshelf > backup-gameshelf-$(date +%F).sql
```

Image cache archive:
```bash
tar -czf backup-image-cache-$(date +%F).tar.gz nas-data/image-cache
```

## 7. Restore
Restore Postgres:
```bash
cat backup-gameshelf-YYYY-MM-DD.sql | docker compose exec -T postgres psql -U gameshelf -d gameshelf
```

Restore image cache:
```bash
tar -xzf backup-image-cache-YYYY-MM-DD.tar.gz
```
