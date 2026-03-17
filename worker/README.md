# Game Shelf Metadata Module

This folder now contains shared metadata logic consumed by the server runtime.

Current server-exposed metadata routes are defined in:
- `server/src/index.ts`
- `server/src/metadata.ts`

## Purpose

Search flow:
- IGDB provides game metadata and fallback cover.
- TheGamesDB is queried for box art and, when found, it becomes the primary `coverUrl`.

## Testing

Run unit tests for this module:

```bash
npm --prefix worker test
```
