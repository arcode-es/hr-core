#!/bin/sh
# Copia diaria de PostgreSQL (formato personalizado de pg_dump) a /backups/db.
# Si la API guarda archivos en disco (STORAGE_DRIVER=local), también los empaqueta.
# Se ejecuta en bucle dentro del contenedor backup-db; hora y retención por entorno.
set -eu
HOUR="${BACKUP_HOUR:-02}"
KEEP="${BACKUP_KEEP_DAYS:-14}"
mkdir -p /backups/db /backups/storage

while true; do
  today="$(date +%F)"
  if [ "$(date +%H)" = "$HOUR" ] && [ ! -f "/backups/db/hr-$today.dump" ]; then
    echo "[backup] $(date -Iseconds) copia de la base de datos"
    if pg_dump -Fc -f "/backups/db/hr-$today.dump.part"; then
      mv "/backups/db/hr-$today.dump.part" "/backups/db/hr-$today.dump"
    else
      echo "[backup] ERROR: pg_dump ha fallado" >&2
      rm -f "/backups/db/hr-$today.dump.part"
    fi
    if [ -d /storage ] && [ -n "$(ls -A /storage 2>/dev/null)" ]; then
      tar -czf "/backups/storage/storage-$today.tar.gz" -C /storage .
    fi
    find /backups/db /backups/storage -type f -mtime +"$KEEP" -delete
  fi
  sleep 600
done
