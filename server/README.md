# Game Shelf NAS API (Fastify)

This service replaces the Cloudflare Worker runtime for NAS deployment.

## Endpoints
- `GET /v1/health`
- `GET /v1/games/search`
- `GET /v1/games/:id`
- `GET /v1/platforms`
- `GET /v1/images/boxart/search`
- `GET /v1/hltb/search`
- `GET /v1/images/proxy`
- `GET /v1/manuals/resolve`
- `GET /v1/manuals/search`
- `POST /v1/manuals/refresh`
- `POST /v1/sync/push`
- `POST /v1/sync/pull`

## Run locally
```bash
cd server
# create .env with required keys
# DATABASE_URL, TWITCH_CLIENT_ID, TWITCH_CLIENT_SECRET, THEGAMESDB_API_KEY
npm install
npm run dev
```

## Notes
- Metadata routes reuse the existing worker logic for response compatibility.
- Sync routes persist server-authoritative state and emit cursor-based change events.
- Image proxy uses filesystem-backed cache plus `image_assets` index rows in Postgres.
