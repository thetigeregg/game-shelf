# HLTB Scraper Service (Playwright)

Browser-backed service for HowLongToBeat lookup.

## Endpoints

- `GET /health` -> `{ "ok": true }`
- `GET /v1/hltb/search?q=<term>&releaseYear=<year>&platform=<name>` -> `{ "item": { hltbMainHours, hltbMainExtraHours, hltbCompletionistHours } | null }`

## Why this exists

HLTB has no official public API and often blocks server-side direct endpoint calls. This service runs a real browser (Playwright), so requests execute in a browser context.

## Setup

1. `cd hltb-scraper`
2. `npm install`
3. `npx playwright install chromium`
4. `npm run dev`

## Environment

- `PORT` (optional, default `8788`)
- `HLTB_SCRAPER_TOKEN` (optional bearer token requirement)
- `HLTB_SCRAPER_TIMEOUT_MS` (optional, default `25000`)
- `DEBUG_HLTB_SCRAPER_LOGS=true` (optional debug logs per lookup attempt)

## Worker integration

Configure in the worker environment:

- `HLTB_SCRAPER_BASE_URL` (for example `http://localhost:8788`)
- `HLTB_SCRAPER_TOKEN` (if token auth is enabled)

When configured, the worker tries the scraper service first.
