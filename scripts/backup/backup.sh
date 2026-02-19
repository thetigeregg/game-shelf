#!/bin/sh

set -eu

log() {
  printf '[backup] %s %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"
}

if ! (set -o pipefail >/dev/null 2>&1); then
  log "warning: shell does not support pipefail; pipeline failures may be less precise"
else
  set -o pipefail
fi

list_backup_dirs() {
  find "$BACKUP_ROOT" -mindepth 1 -maxdepth 1 -type d -print \
    | while IFS= read -r path; do
        name="${path##*/}"
        if echo "$name" | grep -Eq '^(2[0-9]{3})(0[1-9]|1[0-2])(0[1-9]|[12][0-9]|3[01])T([01][0-9]|2[0-3])[0-5][0-9][0-5][0-9]Z$'; then
          printf '%s\n' "$path"
        fi
      done \
    | sort
}

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"
DUMP_RETRIES="${BACKUP_PGDUMP_RETRIES:-3}"
DUMP_RETRY_DELAY_SECONDS="${BACKUP_PGDUMP_RETRY_DELAY_SECONDS:-5}"

if ! echo "$DUMP_RETRIES" | grep -Eq '^[0-9]+$'; then
  log "invalid BACKUP_PGDUMP_RETRIES=$DUMP_RETRIES, defaulting to 3"
  DUMP_RETRIES=3
fi
if ! echo "$DUMP_RETRY_DELAY_SECONDS" | grep -Eq '^[0-9]+$'; then
  log "invalid BACKUP_PGDUMP_RETRY_DELAY_SECONDS=$DUMP_RETRY_DELAY_SECONDS, defaulting to 5"
  DUMP_RETRY_DELAY_SECONDS=5
fi

log "backup run started"
ts="$(date -u +%Y%m%dT%H%M%SZ)"
dir="$BACKUP_ROOT/$ts"
staging_dir="$BACKUP_ROOT/.tmp-$ts-$$"
cleanup_staging() {
  rm -rf "$staging_dir"
}
trap cleanup_staging EXIT INT TERM
log "creating staging backup directory $staging_dir"
mkdir -p "$staging_dir"

attempt=1
dump_success=0
while [ "$attempt" -le "$DUMP_RETRIES" ]; do
  log "running pg_dump attempt $attempt/$DUMP_RETRIES"
  if pg_dump --verbose --clean --if-exists --no-owner --no-privileges | gzip -c >"$staging_dir/postgres.sql.gz"; then
    dump_success=1
    log "pg_dump completed: $staging_dir/postgres.sql.gz"
    break
  fi
  log "pg_dump failed on attempt $attempt"
  if [ "$attempt" -lt "$DUMP_RETRIES" ]; then
    log "waiting $DUMP_RETRY_DELAY_SECONDS second(s) before retry"
    sleep "$DUMP_RETRY_DELAY_SECONDS"
  fi
  attempt=$((attempt + 1))
done

if [ "$dump_success" -ne 1 ]; then
  log "pg_dump failed after $DUMP_RETRIES attempts; aborting backup"
  exit 1
fi

{
  echo "timestamp=$ts"
  echo "created_at_utc=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
  echo "postgres_dump=postgres.sql.gz"
  echo "image_cache=external_snapshot"
  echo "manuals=excluded"
} >"$staging_dir/manifest.txt"
log "manifest written: $staging_dir/manifest.txt"

log "promoting staging directory to final backup path $dir"
mv "$staging_dir" "$dir"
trap - EXIT INT TERM

ln -sfn "$ts" "$BACKUP_ROOT/latest"
log "updated latest symlink -> $ts"

if echo "$KEEP_COUNT" | grep -Eq '^[0-9]+$'; then
  count="$(list_backup_dirs | wc -l | tr -d ' ')"
  log "retention check: keep=$KEEP_COUNT existing=$count"
  if [ "$count" -gt "$KEEP_COUNT" ]; then
    remove=$((count - KEEP_COUNT))
    log "pruning $remove old backup folder(s)"
    list_backup_dirs | head -n "$remove" | xargs -r rm -rf
  fi
else
  log "retention disabled: BACKUP_KEEP_COUNT=$KEEP_COUNT is not numeric"
fi

log "backup run completed"
