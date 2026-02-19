# Game Shelf IGDB + TheGamesDB Proxy Worker

## Endpoints

- `GET /v1/games/search?q=<term>&platformIgdbId=<id>` returns `{ "items": GameCatalogResult[] }`.
- `GET /v1/games/:id` returns `{ "item": GameCatalogResult }`.
- `GET /v1/platforms` returns `{ "items": [{ "id": number, "name": string }] }`.
- `GET /v1/images/boxart/search?q=<term>&platformIgdbId=<id>` returns `{ "items": string[] }`.
- `GET /v1/hltb/search?q=<term>&releaseYear=<year>&platform=<name>` returns `{ "item": HltbCompletionTimes | null }`.

Search flow:

- IGDB provides game metadata and fallback cover.
- TheGamesDB is queried for box art and, when found, it becomes the primary `coverUrl`.

## Local setup

1. Copy `.dev.vars.example` to `.dev.vars` and set real credentials.
2. Install dependencies with `npm install` inside `worker/`.
3. Run `npm run dev`.

Required secrets:

- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `THEGAMESDB_API_KEY`

Optional dev-only logging:

- `DEBUG_HTTP_LOGS=true` logs outgoing HTTP request/response details (with sensitive query params redacted).
- `DEBUG_HLTB_LOGS=true` logs HLTB lookup path decisions and match outcomes.

Optional HLTB scraper integration:

- `HLTB_SCRAPER_BASE_URL` points to a browser-backed scraper service (recommended for reliable HLTB lookups).
- `HLTB_SCRAPER_TOKEN` bearer token for scraper service auth (optional).
- When scraper lookup is unavailable or returns no match, worker returns `item: null` (no direct HLTB fallback calls).

## Deploy

1. Create Worker secrets:
   - `wrangler secret put TWITCH_CLIENT_ID`
   - `wrangler secret put TWITCH_CLIENT_SECRET`
   - `wrangler secret put THEGAMESDB_API_KEY`
2. Deploy with `npm run deploy`.
