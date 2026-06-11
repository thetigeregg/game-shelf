# iOS Multi-Environment Setup

Game Shelf supports **side-by-side** prod and dev iOS apps. Each variant has its own
backend URLs, Firebase project, and (after manual Xcode setup) bundle ID.

## Architecture

| Variant  | Angular config | Env file                               | Backend                    | Firebase plist                  | Bundle ID                             |
| -------- | -------------- | -------------------------------------- | -------------------------- | ------------------------------- | ------------------------------------- |
| **Dev**  | `ios-local`    | `environment.ios.local.ts` (generated) | `http://<mac-lan-ip>:8080` | `GoogleService-Info.dev.plist`  | `io.github.thetigeregg.gameshelf.dev` |
| **Prod** | `ios-prod`     | `environment.ios.prod.ts` (generated)  | `https://<prod-host>`      | `GoogleService-Info.prod.plist` | `io.github.thetigeregg.gameshelf`     |

Dev uses Docker edge on your Mac (`:8080`), which serves `/api`, `/manuals`, `/roms`,
and `/bios` on a single origin. Prod uses the deployed HTTPS edge host.

Web browser local dev (`ng serve --configuration local` + `proxy.conf.json`) is a
separate mechanism — the dev server proxies on your Mac; the iOS app must call real
URLs reachable from the phone.

## One-time setup

### 1. Backend origin env vars

Add to `.env` (see `.env.example`):

```bash
IOS_BACKEND_ORIGIN_LOCAL=http://192.168.x.x:8080
IOS_BACKEND_ORIGIN_PROD=https://your-production-host
```

- **Local**: your Mac's LAN IP on port `8080` (not `127.0.0.1` — the phone cannot reach localhost on your Mac)
- **Prod**: your HTTPS production edge host

`scripts/write-environment-ios.mjs` generates gitignored `environment.ios.local.ts` and
`environment.ios.prod.ts` before each iOS build (`prebuild:ios:local` / `prebuild:ios:prod`).
`BACKEND_ORIGIN` is an optional fallback when the variant-specific variable is unset.
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

### 3. Xcode (manual — second target and schemes)

Capacitor ships one `ios/` tree. A second installable app requires duplicating the
**App** target in Xcode. Do **not** change `capacitor.config.ts` `appId` (stays prod).

#### Duplicate target

1. `npm run open:ios`
2. Duplicate **App** target → rename to **App Dev**
3. **App Dev** build settings:
   - `PRODUCT_BUNDLE_IDENTIFIER` = `io.github.thetigeregg.gameshelf.dev`
   - `INFOPLIST_FILE` = `App/Info.dev.plist` (LAN HTTP via `NSAllowsLocalNetworking`)
   - Display name is `GameShelf Dev` in `Info.dev.plist`

#### Firebase plist per target

Add both plists to the Xcode project. Each target's **Copy Bundle Resources** should
include exactly one plist, built into the app as `GoogleService-Info.plist` (rename
in the copy phase or verify `@capacitor-firebase/messaging` resolves your filename).

- `GoogleService-Info.prod.plist` → **App** target only
- `GoogleService-Info.dev.plist` → **App Dev** target only

#### Schemes

- **App** → prod target
- **GameShelf Dev** (duplicate scheme) → **App Dev** target

Enable Push Notifications and `remote-notification` background mode on both targets.

#### Apple Developer

Register App ID `io.github.thetigeregg.gameshelf.dev` with Push Notifications.

## Day-to-day workflow

| Task            | Command                  | Xcode scheme      |
| --------------- | ------------------------ | ----------------- |
| Build/sync dev  | `npm run sync:ios:local` | **GameShelf Dev** |
| Build/sync prod | `npm run sync:ios:prod`  | **App**           |

`sync:ios` is an alias for `sync:ios:prod`.

**Critical:** `cap sync` overwrites `ios/App/App/public/`. Always run the matching
`sync:ios:*` before building the corresponding Xcode target.

### Verify side-by-side

1. Start Docker edge on Mac (port `8080` reachable from phone Wi‑Fi).
2. `npm run sync:ios:local` → run **GameShelf Dev** on device.
3. `npm run sync:ios:prod` → run **App** on device.
4. Confirm two home-screen icons; dev hits LAN Docker, prod hits production.

### Push smoke test

Enable release notifications in each app, then:

```bash
# Dev (local API, dev Firebase)
curl -X POST http://<mac-lan-ip>:8080/api/v1/notifications/test \
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

Side-by-side installs require the second target so each app keeps its own embedded bundle.

## Troubleshooting

See [`notifications-troubleshooting.md`](notifications-troubleshooting.md) for push
debugging. Common iOS multi-env issues:

- **Connection unavailable on dev**: wrong LAN IP, phone not on same Wi‑Fi, or Docker not listening on `0.0.0.0:8080`
- **ATS blocked HTTP**: dev target must use `Info.dev.plist`, not `Info.plist`
- **Push works in one app only**: plist / service account mismatch with backend
- **Wrong backend after sync**: you synced local but built the prod scheme (or vice versa)
