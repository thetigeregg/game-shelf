# iOS Multi-Environment Setup

Game Shelf supports **side-by-side** prod and dev iOS apps. Each variant has its own
backend URLs, Firebase project, and bundle ID.

## Architecture

| Variant               | Angular config | Env file                               | Backend                              | Firebase plist (worktree copy)                       | Bundle ID                             |
| --------------------- | -------------- | -------------------------------------- | ------------------------------------ | ---------------------------------------------------- | ------------------------------------- |
| **Dev**               | `ios-local`    | `environment.ios.local.ts` (generated) | `http://<mac-lan-ip>:<edge-port>`    | `ios/App/App/Firebase/Dev/GoogleService-Info.plist`  | `io.github.thetigeregg.gameshelf.dev` |
| **Dev (live reload)** | `ios-live`     | `environment.local.ts` (manual copy)   | proxied via worktree `FRONTEND_PORT` | `ios/App/App/Firebase/Dev/GoogleService-Info.plist`  | `io.github.thetigeregg.gameshelf.dev` |
| **Prod**              | `ios-prod`     | `environment.ios.prod.ts` (generated)  | `https://<prod-host>`                | `ios/App/App/Firebase/Prod/GoogleService-Info.plist` | `io.github.thetigeregg.gameshelf`     |

Dev uses Docker edge on your Mac (worktree-specific port from `npx devx worktree info`),
which serves `/api`, `/manuals`, `/roms`, and `/bios` on a single origin. Prod uses the
deployed HTTPS edge host.

Web browser local dev (`npx devx worktree frontend` + dynamic proxy) is a separate
mechanism — the dev server proxies on your Mac. `npx devx worktree simulator` serves the
**web** app to Safari in Simulator; it does not configure the bundled Capacitor app.

Static device builds (`npx devx worktree ios local`) bake absolute backend URLs into
`environment.ios.local.ts` so the phone calls the Docker edge directly. Live reload
(`npx devx worktree ios live`) instead loads the app from the
worktree Angular dev server at `http://<mac-lan-ip>:<frontend-port>` and proxies API,
manuals, roms, and bios requests on your Mac — the phone only needs reachability to
`FRONTEND_PORT`, not the edge port.

## One-time setup

### 1. Backend origin env vars

Add to `.env` (see `.env.example`):

```bash
# Optional overrides for physical device testing
EDGE_BIND_HOST=0.0.0.0
IOS_LAN_HOST=192.168.x.x
IOS_BACKEND_ORIGIN_LOCAL=http://192.168.x.x:<edge-port>
IOS_BACKEND_ORIGIN_PROD=https://your-production-host
```

- **Local**: use the worktree edge port from `npx devx worktree info` (not `127.0.0.1` — the phone cannot reach localhost on your Mac)
- **Physical device access**: set `EDGE_BIND_HOST=0.0.0.0` so Docker edge is reachable from Wi‑Fi
- **Prod**: your HTTPS production edge host

`scripts/write-environment-ios.mjs` generates gitignored `environment.ios.local.ts` and
`environment.ios.prod.ts` before each iOS build (`prebuild:ios:local` / `prebuild:ios:prod`).
For local builds it auto-composes `http://<lan-host>:<edge-port>` from worktree context when
`IOS_BACKEND_ORIGIN_LOCAL` is unset, using `IOS_LAN_HOST` or auto-detected LAN IPv4 plus the
worktree `EDGE_HOST_PORT`. Set `IOS_BACKEND_ORIGIN_LOCAL` to override the full origin.
`BACKEND_ORIGIN` is an optional fallback when no local origin can be composed.
Shell exports override `.env` values.

### 2. Firebase (separate dev and prod projects)

Firebase plists are gitignored and are **not** copied with git worktrees. Store canonical
copies once per machine, then let bootstrap / iOS prebuild copy them into each worktree
(mirrors `~/.config/game-shelf/worktree.env` for `.env`).

| Firebase project | Bundle ID                             | Shared machine file (one-time)                           | Worktree destination (auto-copied)                   |
| ---------------- | ------------------------------------- | -------------------------------------------------------- | ---------------------------------------------------- |
| Prod (existing)  | `io.github.thetigeregg.gameshelf`     | `~/.config/game-shelf/ios/GoogleService-Info.prod.plist` | `ios/App/App/Firebase/Prod/GoogleService-Info.plist` |
| Dev (new)        | `io.github.thetigeregg.gameshelf.dev` | `~/.config/game-shelf/ios/GoogleService-Info.dev.plist`  | `ios/App/App/Firebase/Dev/GoogleService-Info.plist`  |

One-time machine setup:

```bash
mkdir -p ~/.config/game-shelf/ios
# Download each plist from Firebase Console and save with the shared filenames above.
```

If you already have plists in a primary checkout, migrate them once:

```bash
mkdir -p ~/.config/game-shelf/ios
cp ios/App/App/Firebase/Dev/GoogleService-Info.plist ~/.config/game-shelf/ios/GoogleService-Info.dev.plist
cp ios/App/App/Firebase/Prod/GoogleService-Info.plist ~/.config/game-shelf/ios/GoogleService-Info.prod.plist
```

Copy behavior:

- `node scripts/worktree-dev.mjs bootstrap` (also run by `npx devx task start` and the
  worktree post-checkout hook) copies missing worktree plists from the shared directory
- `npm run prebuild:ios:*` requires shared plists and fails with setup instructions if missing
- `bootstrap --force` overwrites existing worktree copies from shared templates
- Override the shared directory with `WORKTREE_IOS_FIREBASE_DIR`

Check status with `npx devx worktree info` (prints shared + worktree plist presence).

Upload your APNs Auth Key (`.p8`) to **both** Firebase projects (Cloud Messaging).

Wire each backend to its Firebase service account:

- Local Docker: `FIREBASE_SERVICE_ACCOUNT_JSON` from the **dev** project
- Production NAS: **prod** service account

The plist bundled in each app must match the Firebase project whose service account
the corresponding API uses, or push token registration and delivery will fail.

### 3. Xcode targets and schemes

The repo ships two native targets and shared schemes:

| Target       | Scheme       | Bundle ID                             | Info plist            |
| ------------ | ------------ | ------------------------------------- | --------------------- |
| **App DEV**  | **App DEV**  | `io.github.thetigeregg.gameshelf.dev` | `App/Info.dev.plist`  |
| **App PROD** | **App PROD** | `io.github.thetigeregg.gameshelf`     | `App/Info.prod.plist` |

Do **not** change `capacitor.config.ts` `appId` (stays prod).

`npx devx worktree ios <local|prod|live>` passes
`--scheme "App DEV"` / `--scheme "App PROD"` so Capacitor deploys the matching
`App DEV.app` / `App PROD.app` bundle. Scheme names must match the built product name
(`cap run` resolves the deploy path as `${scheme}.app`). Implementation lives in
`scripts/run-ios.mjs`.

#### Firebase plist per target

Each target's **Copy Bundle Resources** includes exactly one plist from
`ios/App/App/Firebase/`, built into the app as `GoogleService-Info.plist`:

- `Firebase/Prod/GoogleService-Info.plist` → **App PROD** target only
- `Firebase/Dev/GoogleService-Info.plist` → **App DEV** target only

Enable Push Notifications and `remote-notification` background mode on both targets.

#### Apple Developer

Register App ID `io.github.thetigeregg.gameshelf.dev` with Push Notifications.

## Day-to-day workflow

| Task                  | Command                                     | Scheme       |
| --------------------- | ------------------------------------------- | ------------ |
| Run dev on device     | `npx devx worktree ios local`               | **App DEV**  |
| Live reload on device | `npx devx worktree ios live`                | **App DEV**  |
| Run prod on device    | `npx devx worktree ios prod`                | **App PROD** |
| Sync only (dev)       | `npm run sync:ios:local`                    | —            |
| Sync only (prod)      | `npm run sync:ios:prod` (alias: `sync:ios`) | —            |
| Open Xcode            | `npm run open:ios`                          | —            |
| List run targets      | `npm run list:ios:targets`                  | —            |

`npx devx worktree ios local|prod` runs the matching `sync:ios:*`, then
`cap run ios --no-sync --scheme …`. `npx devx worktree ios live` starts a worktree dev
server and deploys with `cap run --live-reload`. `scripts/run-ios.mjs` loads `.env` for
device targeting (shell exports still override).

Connect and trust your iPhone first. To target a specific device, set `IOS_TARGET_ID` or
`IOS_TARGET_NAME` in `.env` (ID wins when both are set). Prefer `IOS_TARGET_ID` — device
names must match exactly, including apostrophe characters. Use `npm run list:ios:targets`
to discover names and IDs. `npx devx worktree info` also prints the configured run target
when set in `.env`.

Running `npx cap run ios` directly bypasses `run-ios.mjs`, so `.env` device targeting and
the documented workflow do not apply.

### Live reload on a physical device

```bash
npx devx worktree stack up
npx devx worktree ios live
```

Prerequisites:

1. `src/environments/environment.local.ts` exists (copy from `environment.local.example.ts`)
2. `npm run sync:ios:local` has been run at least once so `www/browser/` exists
3. `IOS_TARGET_ID` (preferred) or `IOS_TARGET_NAME` in `.env`
4. `IOS_LAN_HOST` in `.env` when auto-detect fails; phone on same Wi‑Fi as your Mac

`scripts/run-ios.mjs` (live variant) resolves the worktree `FRONTEND_PORT`, starts `ng serve` on
`0.0.0.0` with the worktree dynamic proxy (`.tmp/proxy.worktree.*.json`), then runs
`cap run ios --live-reload --host <lan-ip> --port <frontend-port> --scheme "App DEV"`.
Use `npx devx worktree info` to see derived ports. `EDGE_BIND_HOST=0.0.0.0` is not
required for API access during live reload because requests are proxied on your Mac.

**Critical:** `cap sync` overwrites `ios/App/App/public/`. Always run the matching
`sync:ios:*` (or `npx devx worktree ios local|prod`, which does this for you) before building the
corresponding scheme.

### Verify side-by-side

1. Set `EDGE_BIND_HOST=0.0.0.0` in `.env` so edge is reachable from phone Wi‑Fi.
2. `npx devx worktree stack up` — start (or restart) the worktree-isolated Docker stack.
   Restart is required after changing `EDGE_BIND_HOST`.
3. `npx devx worktree ios local` — installs **GameShelf Dev** via **DEV** scheme.
4. `npx devx worktree ios prod` — installs prod app via **PROD** scheme.
5. Confirm two home-screen icons; dev hits LAN Docker, prod hits production.

`npx devx worktree info` prints the suggested local origin using `IOS_LAN_HOST` from `.env`
when set, otherwise auto-detected LAN IPv4 plus the worktree edge port.

### Push smoke test

Enable release notifications in each app, then:

```bash
# Dev (local API, dev Firebase) — use edge port from `npx devx worktree info`
curl -X POST http://<mac-lan-ip>:<edge-port>/api/v1/notifications/test \
  -H 'authorization: Bearer <API_TOKEN>' \
  -H 'content-type: application/json' \
  -d '{}'

# Prod
curl -X POST https://<prod-host>/api/v1/notifications/test \
  -H 'authorization: Bearer <API_TOKEN>' \
  -H 'content-type: application/json' \
  -d '{}'
```

Requires `NOTIFICATIONS_TEST_ENDPOINT_ENABLED=true` on the server.

## Single-target switching (without side-by-side)

Side-by-side installs require both targets so each app keeps its own embedded bundle.
The repo ships both **App DEV** and **App PROD** targets; use the matching
`npx devx worktree ios local|prod` command instead of swapping plists manually.

## Troubleshooting

See [`notifications-troubleshooting.md`](notifications-troubleshooting.md) for push
debugging. Common iOS multi-env issues:

- **Connection unavailable on dev**: wrong LAN IP, phone not on same Wi‑Fi, wrong worktree edge port, or `EDGE_BIND_HOST` still at default `127.0.0.1`
- **ATS blocked HTTP**: dev target must use `Info.dev.plist`, not `Info.plist`
- **Push works in one app only**: plist / service account mismatch with backend
- **Wrong backend after sync**: you synced local but ran the prod scheme (or vice versa)
- **Missing Firebase plist in new worktree**: save shared copies under `~/.config/game-shelf/ios/`,
  then run `node scripts/worktree-dev.mjs bootstrap` or any `npm run prebuild:ios:*` command
