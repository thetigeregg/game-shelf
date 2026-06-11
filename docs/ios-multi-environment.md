# iOS Multi-Environment Setup

Game Shelf supports **side-by-side** prod and dev iOS apps. Each variant has its own
backend URLs, Firebase project, and bundle ID.

## Architecture

| Variant  | Angular config | Env file                               | Backend                           | Firebase plist                  | Bundle ID                             |
| -------- | -------------- | -------------------------------------- | --------------------------------- | ------------------------------- | ------------------------------------- |
| **Dev**  | `ios-local`    | `environment.ios.local.ts` (generated) | `http://<mac-lan-ip>:<edge-port>` | `GoogleService-Info.dev.plist`  | `io.github.thetigeregg.gameshelf.dev` |
| **Prod** | `ios-prod`     | `environment.ios.prod.ts` (generated)  | `https://<prod-host>`             | `GoogleService-Info.prod.plist` | `io.github.thetigeregg.gameshelf`     |

Dev uses Docker edge on your Mac (worktree-specific port from `npx devx worktree info`),
which serves `/api`, `/manuals`, `/roms`, and `/bios` on a single origin. Prod uses the
deployed HTTPS edge host.

Web browser local dev (`npx devx worktree frontend` + dynamic proxy) is a separate
mechanism — the dev server proxies on your Mac. `npx devx worktree simulator` serves the
**web** app to Safari in Simulator; it does not configure the bundled Capacitor app on a
physical device. The iOS app must call real URLs reachable from the phone.

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

| Firebase project | Bundle ID                             | Save plist as                               |
| ---------------- | ------------------------------------- | ------------------------------------------- |
| Prod (existing)  | `io.github.thetigeregg.gameshelf`     | `ios/App/App/GoogleService-Info.prod.plist` |
| Dev (new)        | `io.github.thetigeregg.gameshelf.dev` | `ios/App/App/GoogleService-Info.dev.plist`  |

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

`npm run run:ios:*` passes `--scheme "App DEV"` / `--scheme "App PROD"` so Capacitor deploys
the matching `App DEV.app` / `App PROD.app` bundle. Scheme names must match the built product
name (`cap run` resolves the deploy path as `${scheme}.app`).

#### Firebase plist per target

Each target's **Copy Bundle Resources** should include exactly one plist, built into
the app as `GoogleService-Info.plist`:

- `GoogleService-Info.prod.plist` → **App PROD** target only
- `GoogleService-Info.dev.plist` → **App DEV** target only

Enable Push Notifications and `remote-notification` background mode on both targets.

#### Apple Developer

Register App ID `io.github.thetigeregg.gameshelf.dev` with Push Notifications.

## Day-to-day workflow

| Task               | Command                                     | Scheme       |
| ------------------ | ------------------------------------------- | ------------ |
| Run dev on device  | `npm run run:ios:local`                     | **App DEV**  |
| Run prod on device | `npm run run:ios:prod` (alias: `run:ios`)   | **App PROD** |
| Sync only (dev)    | `npm run sync:ios:local`                    | —            |
| Sync only (prod)   | `npm run sync:ios:prod` (alias: `sync:ios`) | —            |
| Open Xcode         | `npm run open:ios`                          | —            |
| List run targets   | `npm run list:ios:targets`                  | —            |

`run:ios:*` runs the matching `sync:ios:*`, then `cap run ios --no-sync --scheme …`.
`scripts/run-ios.mjs` loads `.env` for device targeting (shell exports still override).

Connect and trust your iPhone first. To target a specific device, set `IOS_TARGET_ID` or
`IOS_TARGET_NAME` in `.env` (ID wins when both are set). Prefer `IOS_TARGET_ID` — device
names must match exactly, including apostrophe characters. Use `npm run list:ios:targets`
to discover names and IDs. `npx devx worktree info` also prints the configured run target
when set in `.env`.

Running `npx cap run ios` directly bypasses `run-ios.mjs`, so `.env` device targeting and
the documented workflow do not apply.

**Critical:** `cap sync` overwrites `ios/App/App/public/`. Always run the matching
`sync:ios:*` (or `run:ios:*`, which does this for you) before building the
corresponding scheme.

### Verify side-by-side

1. Set `EDGE_BIND_HOST=0.0.0.0` in `.env` so edge is reachable from phone Wi‑Fi.
2. `npx devx worktree stack up` — start (or restart) the worktree-isolated Docker stack.
   Restart is required after changing `EDGE_BIND_HOST`.
3. `npm run run:ios:local` — installs **GameShelf Dev** via **DEV** scheme.
4. `npm run run:ios:prod` — installs prod app via **PROD** scheme.
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

If you only have one Xcode target, swap env + plist manually before each sync:

```bash
npm run sync:ios:local   # or sync:ios:prod
cp ios/App/App/GoogleService-Info.dev.plist ios/App/App/GoogleService-Info.plist   # or .prod.
```

Side-by-side installs require both targets so each app keeps its own embedded bundle.

## Troubleshooting

See [`notifications-troubleshooting.md`](notifications-troubleshooting.md) for push
debugging. Common iOS multi-env issues:

- **Connection unavailable on dev**: wrong LAN IP, phone not on same Wi‑Fi, wrong worktree edge port, or `EDGE_BIND_HOST` still at default `127.0.0.1`
- **ATS blocked HTTP**: dev target must use `Info.dev.plist`, not `Info.plist`
- **Push works in one app only**: plist / service account mismatch with backend
- **Wrong backend after sync**: you synced local but ran the prod scheme (or vice versa)
