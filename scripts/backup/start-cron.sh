#!/bin/sh

set -eu

BACKUP_ROOT="${BACKUP_ROOT:-/backups}"
SCHEDULE="${BACKUP_SCHEDULE_TIME:-00:00}"
KEEP_COUNT="${BACKUP_KEEP_COUNT:-14}"

case "$SCHEDULE" in
  [0-1][0-9]:[0-5][0-9]|2[0-3]:[0-5][0-9]) ;;
  *)
    echo "Invalid BACKUP_SCHEDULE_TIME=$SCHEDULE (expected HH:MM, 24-hour format)" >&2
    exit 1
    ;;
esac

hour="${SCHEDULE%:*}"
minute="${SCHEDULE#*:}"

mkdir -p "$BACKUP_ROOT"

echo "[backup-init] schedule=$SCHEDULE (minute=$minute hour=$hour) keep=$KEEP_COUNT tz=${TZ:-unset}"
printf '%s %s * * * %s\n' "$minute" "$hour" '/bin/sh /opt/backup/backup.sh >>/proc/1/fd/1 2>>/proc/1/fd/2' > /etc/crontabs/root
echo "[backup-init] crontab entry: $(cat /etc/crontabs/root)"
echo "[backup-init] starting crond in foreground"

exec crond -f -l 8
