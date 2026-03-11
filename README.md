# Game Shelf

Game Shelf is an Ionic + Angular app for tracking a personal game library with metadata enrichment, box art/manual lookup, and sync support.

## Repository Structure

- `src/`: Frontend app (Ionic/Angular PWA)
- `server/`: Fastify API (sync, image proxy/cache, manuals, metadata proxy)
- `worker/`: Shared metadata logic/tests used by server routes
- `hltb-scraper/`: Playwright-backed HLTB lookup service
- `metacritic-scraper/`: Playwright-backed Metacritic lookup service
- `psprices-scraper/`: Playwright-backed PSPrices lookup service
- `edge/`: Caddy image for serving frontend and proxying `/api`
- `docs/`: Deployment and operational docs
- `.github/workflows/`: CI, release/publish, and secret scanning pipelines

## Prerequisites

- Node.js `22.21.1` (see `.nvmrc`)
- npm
- Docker + Docker Compose (for local dependency containers and production stack)

## Local Development

1. Install root dependencies:

```bash
npm ci
```

2. Create local non-secret env file:

```bash
cp .env.example .env
```

3. Create required local secret files under `./nas-secrets`:

- `nas-secrets/database_url`
- `nas-secrets/api_token`
- `nas-secrets/client_write_tokens` (required if `REQUIRE_AUTH=true` and browser sync is enabled)
- `nas-secrets/twitch_client_id`
- `nas-secrets/twitch_client_secret`
- `nas-secrets/thegamesdb_api_key`
- `nas-secrets/postgres_user`
- `nas-secrets/postgres_password`
- `nas-secrets/hltb_scraper_token` (optional)
- `nas-secrets/psprices_scraper_token` (optional)

4. Start local stack (`postgres` + `hltb-scraper` + `metacritic-scraper` + `psprices-scraper` + `api` + `worker-general` + `worker-recommendations` + `edge`) in worktree-safe mode (isolated project name + ports):

```bash
npm run dev:stack:up
```

To start stack and auto-seed the DB only when empty:

```bash
npm run dev:stack:up:seed
```

5. (Optional) Follow stack logs:

```bash
npm run dev:stack:logs
```

6. Run frontend:

```bash
npm run dev:start
```

Frontend dev server port is derived from worktree context (shown by `npm run dev:info`).
Manual URLs resolve through the worktree-local `edge` service during dev.
When using `dev:*` commands, ports are derived from the current worktree path and shown by:

```bash
npm run dev:info
```

This allows multiple worktrees to run concurrently without Docker/container/port clashes.
For faster realistic testing without cross-worktree DB pollution:

1. Refresh a shared seed dump from a known-good local DB:

```bash
npm run dev:db:seed:refresh
```

2. Apply that seed into a worktree-local DB:

```bash
npm run dev:db:seed:apply
```

The default seed file path is `~/.cache/game-shelf/dev-db-seed/latest.sql.gz` (override with `DEV_DB_SEED_PATH`).
`seed:apply` restores only when the current worktree DB is empty; use `npm run dev:db:seed:apply:force` to overwrite.
When `REQUIRE_AUTH=true`, set `Settings -> Debug -> Device Write Token` on each device using a token from `nas-secrets/client_write_tokens`.
For full local Docker setup details, see [`docs/nas-deployment.md`](docs/nas-deployment.md) (`Local Docker-based API development`).

## Build

```bash
npm run build
```

## Pricing Metadata

- Unified price fields are persisted on each game row (`priceSource`, `priceAmount`, `priceCurrency`, `priceRegularAmount`, `priceDiscountPercent`, `priceIsFree`, `priceUrl`, `priceFetchedAt`).
- Pricing refresh is supported for IGDB platforms: `6` (Steam/Windows), `48` (PS4), `167` (PS5), `130` (Switch), and `508` (Switch 2).
- `GET /v1/psprices/prices` supports optional `title` query override for matching (useful when catalog title differs from store title).
- PSPrices matching uses ranked candidates and only persists a price on high-confidence title matches.
- Transient `unavailable` responses keep previously persisted price fields instead of clearing them.
- Pricing routes include cache diagnostics headers: `X-GameShelf-Steam-Price-Cache` and `X-GameShelf-PSPrices-Cache` (`HIT_FRESH`/`HIT_STALE`/`MISS`), plus revalidation scheduling headers when stale values are served.
- `GET /v1/cache/stats` now reports pricing cache metrics plus persisted pricing coverage counts (`steamPriceEntries`, `pspricesPriceEntries`).
- Collection/Wishlist multi-select includes **Update pricing** in bulk actions.
- Metadata Validator supports a **Pricing picker** for PSPrices platforms (PS4/PS5/Switch/Switch 2) with candidate search + manual selection.
- Game detail actions in Collection/Wishlist also support the same **Pricing picker** flow for PSPrices platforms.
- Metadata Validator includes **Missing Pricing (supported platforms)** and only evaluates the platforms above.

## Testing and Quality

Run lint:

```bash
npm run lint
```

Run frontend unit tests with coverage:

```bash
npm run test
```

Run backend tests:

```bash
npm run test:backend
```

Run backend coverage checks:

```bash
npm run test:backend:coverage
```

Run UI tests (component + e2e):

```bash
npm run test:ui
```

Run backup ops integration check (requires Docker services):

```bash
npm run test:backup:ops
```

## CI/CD Workflows

- `CI PR Checks` (`.github/workflows/ci-pr.yml`)
  - Trigger: PRs to `main`
  - Runs lint, frontend coverage tests, backend coverage tests, and UI tests

- `Release & Publish` (`.github/workflows/release-publish.yml`)
  - Trigger: pushes to `main`
  - Bumps repo version, commits/tag release, publishes Docker images to GHCR

- `Secret Scan` (`.github/workflows/secret-scan.yml`)
  - Trigger: PRs to `main`, pushes to `main`, and manual dispatch
  - Runs gitleaks with repository config from `.gitleaks.toml`

## Versioning and Releases

- Single repo-wide semver version in `package.json`
- Release workflow updates:
  - `package.json`
  - `package-lock.json`
  - `CHANGELOG.md`
- Creates and pushes git tag (for example `v0.0.5`)
- Docker images are tagged with `main`, semver tags, major/minor variants, and short SHA

## Timezone Defaults

Container/runtime defaults are set to `Europe/Zurich` and can be overridden with `TZ`.

Compose stacks use:

- `TZ=${TZ:-Europe/Zurich}`
- Postgres also sets `PGTZ=${TZ:-Europe/Zurich}`

## Security

- Local secrets should not be committed:
  - `src/environments/environment.local.ts` is ignored
  - use `src/environments/environment.local.example.ts` as template
- Secret scanning:
  - `.gitleaks.toml`
  - `.github/workflows/secret-scan.yml`
- If you suspect past exposure, use `docs/public-repo-security-checklist.md`

## Deployment

For NAS/Portainer/Tailscale deployment, see:

- `docs/nas-deployment.md`

## Backups

Containerized backups are enabled by default via the `backup` service in both `docker-compose.yml` (local/dev) and `docker-compose.portainer.yml` (NAS/Portainer production).
For deployment usage details, see `docs/nas-deployment.md`.
Default schedule is `00:00` in the container timezone (`TZ`), which may differ from your local timezone.
For NAS/Portainer deployments, the backup service pulls `${BACKUP_IMAGE:-ghcr.io/thetigeregg/game-shelf-backup:main}`.
Schedule and retention are controlled by env vars:

```bash
BACKUP_SCHEDULE_TIME=00:00
BACKUP_KEEP_COUNT=14
```

Trigger an immediate manual backup from a shell inside `gameshelf-backup`:

```bash
/bin/sh /opt/backup/backup.sh
```

Restore Postgres from a generated dump:

```bash
npm run backup:restore:postgres -- --file nas-data/backups/latest/postgres.sql.gz --yes
```

## Related Service Readmes

- `server/README.md`
- `worker/README.md`
- `hltb-scraper/README.md`
- `metacritic-scraper/README.md`
- `psprices-scraper/README.md`
