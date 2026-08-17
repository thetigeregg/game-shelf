# Emulation Compatibility Scraper

Service that serves per-platform emulator compatibility data (normalized to
`perfect | playable | incomplete`) for platforms with imperfect emulation coverage
(GameCube, Wii today; more emulators/platforms are added as isolated parser modules).

## Endpoints

- `GET /health` -> `{ "ok": true }`
- `GET /v1/compat/:platformIgdbId` -> `{ "emulator": "dolphin", "sourceUrl": "...", "fetchedAt": "...", "entries": [{ rawTitle, rawLabel, normalizedStatus, sourceId, sourceUrl }] }`

## Why this exists

Emulator compatibility lists are maintained per-emulator, each with its own label
taxonomy and upstream source. This service centralizes ingestion behind one API
shaped generically enough that adding a new platform is: one parser module + one
entry in `src/registry.mjs` + one entry in `config/emulation-compat-platform-map.json`.

## Dolphin (GameCube / Wii): manual dump, not live scraping

Both `dolphin-emu.org/compat/` and `wiki.dolphin-emu.org` (the wiki that actually
backs the compat list) sit behind proof-of-work anti-scraping challenges (BunnyCDN
Shield and Anubis respectively) that explicitly exist to block automated access —
including this kind of scraper. Rather than defeat those challenges, the Dolphin
parser (`src/parsers/dolphin.mjs`) reads a manually downloaded copy of the wiki's
per-platform game list page instead of fetching it live.

To (re)populate data:

1. Visit `https://wiki.dolphin-emu.org/index.php?title=Nintendo_GameCube` (or
   `...?title=Wii`) in a regular browser and save the page as HTML.
2. Place the file at `<dumpDir>/gamecube.html` / `<dumpDir>/wii.html`, where
   `<dumpDir>` is `COMPAT_DUMP_DIR` (default `/data/compat-dumps`, mounted from
   `nas-data/compat-dumps/` on the host — see root `docker-compose.yml`).
3. The scheduled refresh job (`COMPAT_PERIODIC_REFRESH_DAYS` on the API service,
   default `7`) re-parses whatever's currently in that directory — there's no
   separate "upload" step, just replace the file periodically to keep data fresh.

A parser for a platform whose upstream source isn't bot-walled (a future emulator)
can use `getBrowser()` (passed into `fetchList`) to scrape live with Playwright
instead — see `src/server.mjs`'s route handler.

## Setup

1. `cd compat-scraper`
2. `npm install`
3. `npm run dev`

(No `playwright install` step is required for the Dolphin parser specifically,
since it doesn't launch a browser — only needed if you add a live-scraping parser.)

## Environment

- `PORT` (optional, default `8791`)
- `COMPAT_SCRAPER_TOKEN_FILE` (optional bearer token file path)
- `COMPAT_SCRAPER_TIMEOUT_MS` (optional, default `25000`; used by browser-based parsers)
- `COMPAT_SCRAPER_BROWSER_IDLE_MS` (optional, default `30000`; used by browser-based parsers)
- `COMPAT_DUMP_DIR` (optional, default `/data/compat-dumps`)
- `DEBUG_COMPAT_SCRAPER_LOGS=true` (optional debug logs per fetch)

## Server integration

Configure in the API environment:

- `COMPAT_SCRAPER_BASE_URL` (for example `http://localhost:8791`)
- `COMPAT_SCRAPER_TOKEN` (if token auth is enabled)
- `COMPAT_PERIODIC_REFRESH_DAYS` (default `7`; days between scheduled refreshes, tracked per platform/emulator)

Manual correction of matches (fuzzy-match misses/errors) is done via a CLI, not an
admin API/UI — see `server/src/scripts/compat-match-cli.ts`
(`npm run compat:match -- <coverage|list|set|clear>` from `server/`).
