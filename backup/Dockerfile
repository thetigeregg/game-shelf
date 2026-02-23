FROM postgres:16-alpine

WORKDIR /opt/backup

COPY scripts/backup/start-cron.sh scripts/backup/backup.sh /opt/backup/

RUN chmod 755 /opt/backup/start-cron.sh /opt/backup/backup.sh

CMD ["/bin/sh", "-ec", "/opt/backup/start-cron.sh"]
