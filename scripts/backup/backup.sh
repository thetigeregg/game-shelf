#!/bin/sh

set -eu

log() {
  printf '[backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"

log "backup run started"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
dir="$BACKUP_ROOT/$ts"
log "creating backup directory $dir"
mkdir -p "$dir"

log "running pg_dump"
pg_dump --clean --if-exists --no-owner --no-privileges | gzip -c >"$dir/postgres.sql.gz"
log "pg_dump completed: $dir/postgres.sql.gz"

{
  echo "timestamp=$ts"
  echo "created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "postgres_dump=postgres.sql.gz"
  echo "image_cache=external_snapshot"
  echo "manuals=excluded"
} >"$dir/manifest.txt"
log "manifest written: $dir/manifest.txt"

ln -sfn "$ts" "$BACKUP_ROOT/latest"
log "updated latest symlink -> $ts"

if echo "$KEEP_COUNT" | grep -Eq '^[0-9]+$'; then
  count="$(find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | wc -l | tr -d ' ')"
  log "retention check: keep=$KEEP_COUNT existing=$count"
  if [ "$count" -gt "$KEEP_COUNT" ]; then
    remove=$((count - KEEP_COUNT))
    log "pruning $remove old backup folder(s)"
    find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -name '20*' | sort | head -n "$remove" | xargs -r rm -rf
  fi
else
  log "retention disabled: BACKUP_KEEP_COUNT=$KEEP_COUNT is not numeric"
fi

log "backup run completed"
