# Postman Collections

This folder is the source of truth for Game Shelf operational API checks.

## Files

- `game-shelf.postman_collection.json`
  - Production observability/admin ping collection.
  - Uses Postman Vault token variable: `{{vault:AUTH_TOKEN}}`.

## Import

1. Open Postman.
2. Import `postman/game-shelf.postman_collection.json`.
3. Set `edgeBaseUrl` (for example: `https://your-prod-host`).
4. Ensure your Vault secret `AUTH_TOKEN` exists.

## Maintenance Rules (Living Doc)

- Keep this collection aligned with `server/src` route definitions.
- Add new prod observability/admin routes here in the same PR that adds the endpoint.
- Do not store real secrets or fixed prod tokens in this repo.
- Prefer stable smoke checks (`limit=1`, small payloads) to avoid heavy prod load.
