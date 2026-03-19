# Postman Collections

This folder is the source of truth for Game Shelf operational API checks.

## Files

- `game-shelf.postman_collection.json`
  - Production ops collection (read-only observability + controlled admin probes).
  - Uses Postman Vault token variable: `{{vault:AUTH_TOKEN}}`.
  - Includes a `Discovery Match Admin` folder covering unmatched-list reads, match-state reads, manual match writes, permanent-miss reset, and targeted requeue endpoints.
  - Discovery match requests use the same device write token header as the app, not a separate admin bearer token.

## Import

1. Open Postman.
2. Import `postman/game-shelf.postman_collection.json`.
3. Set `edgeBaseUrl` (for example: `https://your-prod-host`).
4. Ensure your Vault secret `AUTH_TOKEN` exists.
5. For discovery match requests, set your Vault secret `CLIENT_WRITE_TOKEN` and update `sampleDiscoveryGameId`, `sampleDiscoveryPlatformIgdbId`, and related sample variables before sending write operations.

## Maintenance Rules (Living Doc)

- Keep this collection aligned with `server/src` route definitions.
- Add new prod observability/admin routes here in the same PR that adds the endpoint.
- Do not store real secrets or fixed prod tokens in this repo.
- Prefer stable smoke checks (`limit=1`, small payloads) to avoid heavy prod load.
- For controlled write endpoints, keep default payloads scoped to a single known sample row or a tiny explicit `gameKeys` set.
