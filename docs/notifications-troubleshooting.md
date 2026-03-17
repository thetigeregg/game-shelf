# Notifications Troubleshooting

## 1. Browser/Device Preconditions

- Confirm browser/site notification permission is `granted`.
- Confirm OS-level notifications are enabled for the browser/app.
- Confirm service worker is registered (`firebase-messaging-sw.js`).

## 2. Frontend Registration Checks

- Open app settings and enable release notifications.
- Verify token registration request succeeds:
  - `POST /v1/notifications/fcm/register`
- In browser logs, verify no:
  - `[notifications] service_worker_register_failed`
  - `[notifications] token_registration_failed`
  - `[notifications] backend_register_failed`

## 3. Backend Smoke Test

- Enable test endpoint in env:
  - `NOTIFICATIONS_TEST_ENDPOINT_ENABLED=true`
- Send test push:

```bash
curl -X POST http://127.0.0.1:3000/v1/notifications/test \
  -H 'authorization: Bearer <API_TOKEN>' \
  -H 'content-type: application/json' \
  -d '{}'
```

Expected: `{"ok":true,...}` with `successCount >= 1`.
If `REQUIRE_AUTH=false`, the authorization header is optional.

## 4. Observability Endpoint

- Enable endpoint in env:
  - `NOTIFICATIONS_OBSERVABILITY_ENDPOINT_ENABLED=true`
- Query:

```bash
curl http://127.0.0.1:3000/v1/notifications/observability \
  -H 'authorization: Bearer <API_TOKEN>'
```

If `REQUIRE_AUTH=false`, the authorization header is optional.

Use this to check:

- active/inactive token counts
- tokens invalidated in last 24h
- event counts and sent totals by event type for last 24h

## 5. Release Monitor Logs

Look for:

- `[release-monitor] run_summary`
- `[release-monitor] run_health_warning`

If warnings appear frequently, tune:

- `RELEASE_MONITOR_WARN_SEND_FAILURE_RATIO`
- `RELEASE_MONITOR_WARN_INVALID_TOKEN_RATIO`
- `FCM_TOKEN_*` cleanup settings

## 6. Database Spot Checks

Check recent release notifications:

```bash
psql -U gameshelf -d gameshelf -c "
select event_type, event_key, sent_count, created_at
from release_notification_log
order by id desc
limit 20;
"
```

Check token activity:

```bash
psql -U gameshelf -d gameshelf -c "
select is_active, count(*) from fcm_tokens group by is_active;
"
```
