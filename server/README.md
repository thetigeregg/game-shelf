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

Mutating routes (`POST`, `PUT`, `PATCH`, `DELETE`) require auth when `REQUIRE_AUTH=true`.
Provide either:

- `Authorization: Bearer <API_TOKEN>`
- `X-Game-Shelf-Client-Token: <device-token>` (must match configured `CLIENT_WRITE_TOKENS`)

## Run locally

```bash
cd ..
npm run dev:stack:up
```

This starts the API in Docker with Postgres + HLTB scraper dependencies.
Provide file-based secrets in `./nas-secrets` (see `docs/nas-deployment.md` for the full list).

## Notes

- Metadata routes reuse the existing worker logic for response compatibility.
- Sync routes persist server-authoritative state and emit cursor-based change events.
- Image proxy uses filesystem-backed cache plus `image_assets` index rows in Postgres.
