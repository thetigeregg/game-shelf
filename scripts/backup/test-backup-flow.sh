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

if [[ -z "${BACKUP_HOST_DIR:-}" ]]; then
  BACKUP_HOST_DIR="$(docker compose config | awk '/source:/{src=$NF} /target: \/backups/{print src; exit}')"
fi
if [[ -z "${BACKUP_HOST_DIR:-}" ]]; then
  echo "[backup-test] ERROR: could not determine BACKUP_HOST_DIR from docker compose config; export it explicitly" >&2
  exit 1
fi

count_timestamp_backup_dirs() {
  find "$BACKUP_HOST_DIR" -mindepth 1 -maxdepth 1 -type d -print \
    | while IFS= read -r path; do
        name="${path##*/}"
        if echo "$name" | grep -Eq '^(2[0-9]{3})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]Z$'; then
          printf '%s\n' "$path"
        fi
      done \
    | wc -l \
    | tr -d ' '
}

echo "[backup-test] Ensuring services are running"
docker compose up -d postgres backup

echo "[backup-test] Triggering manual backup #1"
docker compose exec -T backup /bin/sh /opt/backup/backup.sh
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

if ! gzip -t "$LATEST_PATH/postgres.sql.gz"; then
  echo "[backup-test] FAIL: postgres.sql.gz failed gzip integrity check" >&2
  exit 1
fi

if ! zgrep -Fq 'PostgreSQL database dump' "$LATEST_PATH/postgres.sql.gz"; then
  echo "[backup-test] FAIL: postgres.sql.gz does not look like a PostgreSQL SQL dump" >&2
  exit 1
fi

echo "[backup-test] Backup artifact integrity assertions passed"

KEEP_COUNT="$(docker compose exec -T backup sh -lc 'printf "%s" "${BACKUP_KEEP_COUNT:-}"')"
if [[ "$KEEP_COUNT" == "1" ]]; then
  DIR_COUNT="$(count_timestamp_backup_dirs)"
  if [[ "$DIR_COUNT" != "1" ]]; then
    echo "[backup-test] FAIL: expected 1 retained backup dir, found $DIR_COUNT" >&2
    exit 1
  fi
  echo "[backup-test] Retention assertion passed (BACKUP_KEEP_COUNT=1)"
else
  echo "[backup-test] Retention assertion skipped (BACKUP_KEEP_COUNT=$KEEP_COUNT)"
fi

echo "[backup-test] PASS"
