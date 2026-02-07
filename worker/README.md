# Game Shelf IGDB Proxy Worker

## Endpoints
- `GET /v1/games/search?q=<term>` returns `{ "items": GameCatalogResult[] }`.

## Local setup
1. Copy `.dev.vars.example` to `.dev.vars` and set `TWITCH_CLIENT_ID` and `TWITCH_CLIENT_SECRET`.
2. Install dependencies with `npm install` inside `worker/`.
3. Run `npm run dev`.

## Deploy
1. Create Worker secrets:
   - `wrangler secret put TWITCH_CLIENT_ID`
   - `wrangler secret put TWITCH_CLIENT_SECRET`
2. Deploy with `npm run deploy`.
