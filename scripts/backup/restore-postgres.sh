#!/usr/bin/env bash

set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/backup/restore-postgres.sh --file <path-to-postgres.sql.gz|.sql> --yes

Restores PostgreSQL from a logical dump into the running docker compose postgres service.
This replaces objects in the target database (`pg_dump --clean` compatible).
EOF
}

DUMP_FILE=""
CONFIRMED="false"

while [[ $# -gt 0 ]]; do
  case "$1" in
    --file)
      DUMP_FILE="${2:-}"
      shift 2
      ;;
    --yes)
      CONFIRMED="true"
      shift
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage
      exit 1
      ;;
  esac
done

if [[ "$CONFIRMED" != "true" ]]; then
  echo "Refusing to restore without --yes." >&2
  usage
  exit 1
fi

if [[ -z "$DUMP_FILE" ]]; then
  echo "--file is required." >&2
  usage
  exit 1
fi

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "Dump file not found: $DUMP_FILE" >&2
  exit 1
fi

echo "Restoring postgres from: $DUMP_FILE"

if [[ "$DUMP_FILE" == *.gz ]]; then
  gzip -dc "$DUMP_FILE" \
    | docker compose exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
else
  cat "$DUMP_FILE" \
    | docker compose exec -T postgres sh -lc 'psql -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB"'
fi

echo "Restore complete."
