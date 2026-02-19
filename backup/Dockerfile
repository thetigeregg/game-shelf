FROM postgres:16-alpine

WORKDIR /opt/backup

COPY scripts/backup/ /opt/backup/

RUN chmod 755 /opt/backup/*.sh

CMD ["/bin/sh", "-ec", "/opt/backup/start-cron.sh"]
