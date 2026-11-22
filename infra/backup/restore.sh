#!/bin/sh
# Restaura una copia de la base de datos.
#
#   infra/backup/restore.sh backups/db/hr-2026-11-12.dump            # en la base de la app (pide confirmación)
#   infra/backup/restore.sh backups/db/hr-2026-11-12.dump prueba     # en otra base, para comprobar la copia
#
# Usa el contenedor postgres del compose. Para los archivos: con MinIO,
#   docker compose run --rm --entrypoint sh backup-files -c \
#     'mc alias set local http://minio:9000 $S3_ACCESS_KEY $S3_SECRET_KEY && mc mirror /backups/files/$S3_BUCKET local/$S3_BUCKET'
# y con STORAGE_DRIVER=local, descomprimir backups/storage/storage-AAAA-MM-DD.tar.gz en el volumen api_storage.
set -eu
DUMP="${1:?Indica el archivo .dump}"
TARGET="${2:-}"
[ -f "$DUMP" ] || { echo "No existe $DUMP" >&2; exit 1; }
DB_USER="${POSTGRES_USER:-hr}"
DB_NAME="${POSTGRES_DB:-hr_gestion}"

if [ -z "$TARGET" ]; then
  printf 'Esto SUSTITUYE los datos de %s por los de %s. Escribe RESTAURAR para seguir: ' "$DB_NAME" "$DUMP"
  read -r answer
  [ "$answer" = "RESTAURAR" ] || { echo "Cancelado."; exit 1; }
  docker compose stop api
  docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$DB_NAME" --clean --if-exists --no-owner < "$DUMP"
  docker compose start api
else
  docker compose exec -T postgres psql -U "$DB_USER" -d postgres -c "DROP DATABASE IF EXISTS \"$TARGET\"" -c "CREATE DATABASE \"$TARGET\""
  docker compose exec -T postgres pg_restore -U "$DB_USER" -d "$TARGET" --no-owner < "$DUMP"
  docker compose exec -T postgres psql -U "$DB_USER" -d "$TARGET" -tAc "SELECT 'usuarios: ' || count(*) FROM users UNION ALL SELECT 'fichajes: ' || count(*) FROM time_entries"
fi
echo "Restauración terminada."
