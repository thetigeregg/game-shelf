# Metacritic Scraper Service (Playwright)

Browser-backed service for Metacritic score lookup.

## Endpoints

- `GET /health` -> `{ "ok": true }`
- `GET /v1/metacritic/search?q=<term>&releaseYear=<year>&platform=<name>&includeCandidates=true` -> `{ "item": { metacriticScore, metacriticUrl } | null, "candidates": [...] }`

## Why this exists

Metacritic has no public API suitable for this app. This service runs requests inside a real browser context using Playwright.

## Environment

- `PORT` (optional, default `8789`)
- `METACRITIC_SCRAPER_TOKEN_FILE` (optional bearer token file path)
- `METACRITIC_SCRAPER_TIMEOUT_MS` (optional, default `25000`)
- `METACRITIC_SCRAPER_BROWSER_IDLE_MS` (optional, default `30000`)
- `DEBUG_METACRITIC_SCRAPER_LOGS=true` (optional debug logs per lookup attempt)
