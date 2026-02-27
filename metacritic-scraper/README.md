# Metacritic Scraper Service (Playwright)

Browser-backed service for Metacritic score lookup.

## Endpoints

- `GET /health` -> `{ "ok": true }`
- `GET /v1/metacritic/search?q=<term>&releaseYear=<year>&platform=<name>&includeCandidates=true` -> `{ "item": { metacriticScore, metacriticUrl } | null, "candidates": [...] }`

## Why this exists

Metacritic has no public API suitable for this app. This service runs requests inside a real browser context using Playwright.
