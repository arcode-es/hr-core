#!/bin/sh
# Espejo diario del bucket de MinIO en /backups/files. No borra lo que ya no está
# en el bucket: una eliminación por error se puede recuperar de la copia.
set -eu
HOUR="${BACKUP_HOUR:-02}"
mkdir -p /backups/files
mc alias set local http://minio:9000 "$S3_ACCESS_KEY" "$S3_SECRET_KEY" >/dev/null

while true; do
  stamp="/backups/files/.last-$(date +%F)"
  if [ "$(date +%H)" = "$HOUR" ] && [ ! -f "$stamp" ]; then
    echo "[backup] $(date -Iseconds) espejo del bucket $S3_BUCKET"
    if mc mirror --overwrite --quiet "local/$S3_BUCKET" "/backups/files/$S3_BUCKET"; then
      rm -f /backups/files/.last-* && touch "$stamp"
    else
      echo "[backup] ERROR: mc mirror ha fallado" >&2
    fi
  fi
  sleep 600
done
