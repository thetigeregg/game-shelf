# PSPrices Scraper

Playwright-backed scraper service used by the API route `GET /v1/psprices/prices`.

## Endpoint

- `GET /health`
- `GET /v1/psprices/search?q=<title>&platform=<PS4|PS5|Switch|Switch2>&region=region-ch&show=games`

Optional query:

- `includeCandidates=true` to return ranked candidates array.

## Auth

If `PSPRICES_SCRAPER_TOKEN` is configured (from secret file), requests must include:

`Authorization: Bearer <token>`

## Environment

- `PORT` (default `8790`)
- `PSPRICES_BASE_URL` (default `https://psprices.com`)
- `PSPRICES_REGION_PATH` (default `region-ch`)
- `PSPRICES_SHOW` (default `games`)
- `PSPRICES_SCRAPER_TIMEOUT_MS` (default `25000`)
- `PSPRICES_SCRAPER_BROWSER_IDLE_MS` (default `30000`)
- `PSPRICES_SCRAPER_TOKEN_FILE` (optional)
- `DEBUG_PSPRICES_SCRAPER_LOGS` (default `false`)
