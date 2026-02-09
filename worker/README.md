# Game Shelf IGDB + TheGamesDB Proxy Worker

## Endpoints
- `GET /v1/games/search?q=<term>` returns `{ "items": GameCatalogResult[] }`.
- `GET /v1/games/:id` returns `{ "item": GameCatalogResult }`.
- `GET /v1/images/boxart/search?q=<term>&platformIgdbId=<id>` returns `{ "items": string[] }`.

Search flow:
- IGDB provides game metadata and fallback cover.
- TheGamesDB is queried for box art and, when found, it becomes the primary `coverUrl`.

## Local setup
1. Copy `.env.example` values into `.dev.vars` and set real credentials.
2. Install dependencies with `npm install` inside `worker/`.
3. Run `npm run dev`.

Required secrets:
- `TWITCH_CLIENT_ID`
- `TWITCH_CLIENT_SECRET`
- `THEGAMESDB_API_KEY`

## Deploy
1. Create Worker secrets:
   - `wrangler secret put TWITCH_CLIENT_ID`
   - `wrangler secret put TWITCH_CLIENT_SECRET`
   - `wrangler secret put THEGAMESDB_API_KEY`
2. Deploy with `npm run deploy`.
