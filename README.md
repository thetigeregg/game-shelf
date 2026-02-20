# Game Shelf

Game Shelf is an Ionic + Angular app for tracking a personal game library with metadata enrichment, box art/manual lookup, and sync support.

## Repository Structure

- `src/`: Frontend app (Ionic/Angular PWA)
- `server/`: Fastify API (sync, image proxy/cache, manuals, metadata proxy)
- `worker/`: Shared metadata logic/tests used by server routes
- `hltb-scraper/`: Playwright-backed HLTB lookup service
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
- `nas-secrets/twitch_client_id`
- `nas-secrets/twitch_client_secret`
- `nas-secrets/thegamesdb_api_key`
- `nas-secrets/postgres_user`
- `nas-secrets/postgres_password`
- `nas-secrets/hltb_scraper_token` (optional)

4. Start local stack (`postgres` + `hltb-scraper` + `api` + `edge`):

```bash
npm run dev:stack:up
```

5. (Optional) Follow API logs:

```bash
npm run dev:backend:logs
```

6. Run frontend:

```bash
npm start
```

Frontend dev server runs on `http://localhost:8100`.
Manual URLs under `/manuals/...` are proxied to local `edge` (`http://127.0.0.1:8080`) during dev.
For full local Docker setup details, see `/Users/sixtopia/projects/game-shelf/docs/nas-deployment.md` (`Local Docker-based API development`).

## Build

```bash
npm run build
```

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
