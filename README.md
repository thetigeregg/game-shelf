# Game Shelf

Game Shelf is an Ionic + Angular app for tracking a personal game library with metadata enrichment, box art/manual lookup, and sync support.

## Repository Structure

- `src/`: Frontend app (Ionic/Angular, web + Capacitor iOS)
- `ios/`: Capacitor iOS native project (Xcode)
- `server/`: Fastify API (sync, image proxy/cache, manuals, metadata proxy)
- `worker/`: Shared metadata logic/tests used by server routes
- `hltb-scraper/`: Playwright-backed HLTB lookup service
- `metacritic-scraper/`: Playwright-backed Metacritic lookup service
- `psprices-scraper/`: Playwright-backed PSPrices lookup service
- `edge/`: Caddy image for serving frontend and proxying `/api`
- `docs/`: Deployment and operational docs
- `.github/workflows/`: CI, release/publish, and secret scanning pipelines

## In-browser emulation (EmulatorJS)

- The app can launch EmulatorJS from a same-origin **play shell** (`src/assets/emulatorjs/play.html`). The shell sets EmulatorJS’s **`EJS_pathtodata`** to a **pinned absolute HTTPS URL** for the EmulatorJS **static distribution** hosted on **GitHub Pages** from the **`game-shelf-assets`** repository (not from the app bundle).
- **`loader.js`** is loaded **cross-origin** from that base URL with **Subresource Integrity (SRI)** so only a hash-matched build executes. Defaults and pins are in `src/app/core/config/emulatorjs.constants.ts` (after each `game-shelf-assets` deploy, align pins with `EMULATORJS_ASSETS_MANIFEST_URL`); production injection is handled by `scripts/write-environment-prod.sh` when applicable.
- **ROM** and **BIOS** files are served from your deployment (`/roms`, `/bios`). On the web they are same-origin; the Capacitor iOS app loads them from the absolute backend host configured in `environment.ios.local.ts` or `environment.ios.prod.ts`.
- **Supported platforms** are IGDB catalog entries mapped to documented `EJS_core` values ([EmulatorJS · Cores](https://emulatorjs.org/docs4devs/cores)); the map is `src/app/core/utils/emulatorjs-platform-map.ts`. **`Play in browser`** only appears when that map returns a core for the game’s canonical platform id.
- **ROM folders** on disk use names ending in `__pid-<platformIgdbId>` (see **`ROM files`** and **`EmulatorJS: supported IGDB platforms (in-browser)`** in [`docs/nas-deployment.md`](docs/nas-deployment.md)). **BIOS** paths under `/bios/...` are fixed per core in `src/app/core/utils/emulatorjs-bios-path.ts`; the NAS guide lists every core for which the app sets `EJS_biosUrl`, zip vs single-file layout, and which supported platforms have no BIOS URL today.
- Full operational layout (ROM layout, supported platform table with BIOS column, BIOS file table, `EJS_pathtodata`) lives in [`docs/nas-deployment.md`](docs/nas-deployment.md) under **ROM files**, **EmulatorJS: supported IGDB platforms (in-browser)**, **BIOS files**, and **EmulatorJS runtime (`EJS_pathtodata`)**.

## Prerequisites

- Node.js `24.14.0` (see `.nvmrc`)
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
npx devx worktree stack up
```

To start stack and auto-seed the DB only when empty:

```bash
npx devx worktree stack up-seed
```

To fully tear down and recreate the stack (for example after port or compose/env changes, or when containers are in a bad state), use:

```bash
npm run stack:recreate
```

For routine backend code changes, `npx devx worktree stack up` is usually enough (it rebuilds images). `npx devx worktree stack restart` only restarts existing containers and does not rebuild or rebind ports. Postgres data in `./nas-data/postgres` is preserved across recreate.

5. (Optional) Follow stack logs:

```bash
npx devx worktree stack logs
```

6. Run frontend:

```bash
npx devx worktree frontend
```

Frontend dev server port is derived from worktree context (shown by `npx devx worktree info`).
Manual URLs resolve through the worktree-local `edge` service during dev.
For iPhone Simulator Safari testing, use:

```bash
npx devx worktree simulator
```

When using `npx devx worktree ...` commands, ports are derived from the current worktree path and shown by:

```bash
npx devx worktree info
```

This allows multiple worktrees to run concurrently without Docker/container/port clashes.
For faster realistic testing without cross-worktree DB pollution:

1. Refresh a shared seed dump from a known-good local DB:

```bash
npx devx worktree db seed-refresh
```

2. Apply that seed into a worktree-local DB:

```bash
npx devx worktree db seed-apply
```

The default seed file path is `~/.cache/game-shelf/dev-db-seed/latest.sql.gz` (override with `DEV_DB_SEED_PATH`).
`seed:apply` restores only when the current worktree DB is empty; use `npx devx worktree db seed-apply --force` to overwrite.
When `REQUIRE_AUTH=true`, set `Settings -> Debug -> Device Write Token` on each device using a token from `nas-secrets/client_write_tokens`.
For full local Docker setup details, see [`docs/nas-deployment.md`](docs/nas-deployment.md) (`Local Docker-based API development`).

## Build

```bash
npm run build
```

## iOS App (Capacitor)

The frontend ships as a native iOS app via Capacitor. The web deployment (edge) remains for browsers.

Prod and dev iOS variants are supported (side-by-side installs with separate bundle IDs).
See [`docs/ios-multi-environment.md`](docs/ios-multi-environment.md) for the full guide.

1. For local device testing against a worktree stack, start Docker and note the edge port:

```bash
npx devx worktree stack up
npx devx worktree info   # shows edge port and suggested iOS local origin
```

Set in `.env` (or export in your shell):

```bash
EDGE_BIND_HOST=0.0.0.0              # required for physical iPhone access; restart stack after changing
IOS_LAN_HOST=<mac-lan-ip>           # optional if auto-detect works
IOS_TARGET_ID=<device-id>           # preferred for npm run run:ios:*
IOS_BACKEND_ORIGIN_LOCAL=http://<mac-lan-ip>:<edge-port>   # optional override
IOS_BACKEND_ORIGIN_PROD=https://<your-production-host>
```

`npm run build:ios:local` / `build:ios:prod` generate gitignored `environment.ios.*.ts` via
`scripts/write-environment-ios.mjs`. Local builds auto-compose the origin from worktree edge
port plus `IOS_LAN_HOST` (or auto-detected LAN IPv4) when `IOS_BACKEND_ORIGIN_LOCAL` is unset.

2. Build, sync, and run on a connected device:

```bash
npm run run:ios:prod    # production backend (alias: npm run run:ios)
npm run run:ios:local   # local Docker edge on your Mac (worktree-aware)
```

Connect and trust your iPhone first. `npm run run:ios:*` loads `.env` for `IOS_TARGET_ID` /
`IOS_TARGET_NAME` (prefer ID). Use `npm run list:ios:targets` to discover values, or
`npx devx worktree info` to see the configured target. First-time code signing may still
require opening Xcode once.

**Alternate workflows:**

```bash
npm run sync:ios:prod    # build + sync only (alias: npm run sync:ios)
npm run sync:ios:local
npm run open:ios         # open Xcode (debugger, manual scheme/run)
```

Signing uses automatic provisioning (team is configured in the Xcode project; adjust to your Apple Developer team if needed). Side-by-side dev + prod apps use **App DEV** and **App PROD** targets/schemes — see the multi-environment doc.

### Push notifications (release notifications)

Release notifications use native push via `@capacitor-firebase/messaging` (APNs through FCM).

- **Prod app**: Firebase prod project, bundle `io.github.thetigeregg.gameshelf`
- **Dev app**: Firebase dev project, bundle `io.github.thetigeregg.gameshelf.dev`

One-time setup per Firebase project:

1. Add the iOS app with the matching bundle ID and download the plist. Save shared copies as
   `~/.config/game-shelf/ios/GoogleService-Info.prod.plist` and
   `~/.config/game-shelf/ios/GoogleService-Info.dev.plist`
   (worktree bootstrap and `prebuild:ios` copy these into gitignored `ios/App/App/Firebase/` paths).
2. Upload your **APNs Auth Key** in Firebase project settings > Cloud Messaging.
3. In Xcode, enable Push Notifications and `remote-notification` background mode on each target (`App.entitlements`, `Info.plist` / `Info.dev.plist`).

See [`docs/ios-multi-environment.md`](docs/ios-multi-environment.md) for migration from an existing checkout.

Local Docker should use the **dev** Firebase service account; production uses **prod**. The plist in each app must match the Firebase project behind that app's API.

The backend contract is unchanged: tokens register via `POST /v1/notifications/fcm/register` and the server sends through `firebase-admin`. Web browsers do not support push notifications; use the iOS app.

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

## Discovery Match Admin

- Settings includes a **Discovery Match Admin** page for discovery-queue enrichment triage.
- The page uses the existing device write token from Settings. There is no separate admin token for discovery match controls.
- Admin controls support filtering unmatched discovery rows by provider/state, loading full match state, manually saving or clearing HLTB/review/pricing matches, resetting visible permanent misses for HLTB or review, and requeueing targeted discovery enrichment for either one row or the current visible results.
- Candidate search is built into the modal for HLTB, review, and pricing so operators can search upstream metadata and paste or apply a chosen match.
- List-level and per-row requeue actions enqueue targeted discovery enrichment keyed by the visible discovery rows, which reduces unnecessary churn across unrelated discovery items.
- Detailed behavior, state rules, and side effects are documented in [docs/discovery-match-admin.md](docs/discovery-match-admin.md).

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
  - `src/environments/environment.ios.local.ts` and `environment.ios.prod.ts` are generated and ignored
  - set `IOS_BACKEND_ORIGIN_LOCAL` / `IOS_BACKEND_ORIGIN_PROD` in `.env` (see `.env.example`)
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
