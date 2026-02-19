#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/backup/test-backup-flow.sh

Runs a lightweight integration check for the backup container:
  1) ensures postgres + backup services are running
  2) triggers two manual backup runs
  3) verifies latest backup artifacts exist
  4) optionally verifies retention if BACKUP_KEEP_COUNT=1 in container
EOF
}

if [[ "${1:-}" == "-h" || "${1:-}" == "--help" ]]; then
  usage
  exit 0
fi

BACKUP_HOST_DIR="${BACKUP_HOST_DIR:-./nas-data/backups}"

echo "[backup-test] Ensuring services are running"
docker compose up -d postgres backup

echo "[backup-test] Triggering manual backup #1"
docker compose exec -T backup /bin/sh /opt/backup/backup.sh
sleep 1
echo "[backup-test] Triggering manual backup #2"
docker compose exec -T backup /bin/sh /opt/backup/backup.sh

LATEST_PATH="$BACKUP_HOST_DIR/latest"
if [[ ! -L "$LATEST_PATH" ]]; then
  echo "[backup-test] FAIL: latest symlink missing at $LATEST_PATH" >&2
  exit 1
fi

if [[ ! -f "$LATEST_PATH/postgres.sql.gz" ]]; then
  echo "[backup-test] FAIL: postgres.sql.gz missing at $LATEST_PATH/postgres.sql.gz" >&2
  exit 1
fi

if [[ ! -f "$LATEST_PATH/manifest.txt" ]]; then
  echo "[backup-test] FAIL: manifest.txt missing at $LATEST_PATH/manifest.txt" >&2
  exit 1
fi

KEEP_COUNT="$(docker compose exec -T backup sh -lc 'printf "%s" "${BACKUP_KEEP_COUNT:-}"')"
if [[ "$KEEP_COUNT" == "1" ]]; then
  DIR_COUNT="$(find "$BACKUP_HOST_DIR" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l | tr -d ' ')"
  if [[ "$DIR_COUNT" != "1" ]]; then
    echo "[backup-test] FAIL: expected 1 retained backup dir, found $DIR_COUNT" >&2
    exit 1
  fi
  echo "[backup-test] Retention assertion passed (BACKUP_KEEP_COUNT=1)"
else
  echo "[backup-test] Retention assertion skipped (BACKUP_KEEP_COUNT=$KEEP_COUNT)"
fi

echo "[backup-test] PASS"
