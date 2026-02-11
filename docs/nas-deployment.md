# NAS Deployment (Synology + Docker + Tailscale)

## 1. Prepare files
1. Copy `server/.env.example` to `server/.env`.
2. Fill secrets in `server/.env`:
   - `TWITCH_CLIENT_ID`
   - `TWITCH_CLIENT_SECRET`
   - `THEGAMESDB_API_KEY`
   - `HLTB_SCRAPER_TOKEN` (optional)
3. Create persistent directories:
   - `nas-data/postgres`
   - `nas-data/image-cache`

## 2. Start stack
```bash
docker compose build
docker compose up -d
docker compose ps
```

Services:
- `edge` serves the PWA and proxies `/api/*`.
- `api` hosts metadata + sync endpoints.
- `postgres` stores authoritative app data.
- `hltb-scraper` provides browser-backed HLTB lookups.

## 3. Publish over Tailscale only
Run on Synology host (where Tailscale is installed):
```bash
tailscale serve --https=443 http://127.0.0.1:8080
```

Verify:
```bash
tailscale status
tailscale serve status
```

Then access with your tailnet URL shown by `tailscale serve status`.

## 4. Health checks
```bash
curl http://127.0.0.1:8080/api/v1/health
docker compose logs -f api
```

## 5. Manual backup
Postgres dump:
```bash
docker compose exec -T postgres pg_dump -U gameshelf -d gameshelf > backup-gameshelf-$(date +%F).sql
```

Image cache archive:
```bash
tar -czf backup-image-cache-$(date +%F).tar.gz nas-data/image-cache
```

## 6. Restore
Restore Postgres:
```bash
cat backup-gameshelf-YYYY-MM-DD.sql | docker compose exec -T postgres psql -U gameshelf -d gameshelf
```

Restore image cache:
```bash
tar -xzf backup-image-cache-YYYY-MM-DD.tar.gz
```

