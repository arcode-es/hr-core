#!/usr/bin/env bash
# HR-Core · actualizar / update
#
#   ./instalar/actualizar.sh            a la última versión publicada / to the latest release
#   ./instalar/actualizar.sh 1.2.0      a una versión concreta / to a given version
#
# Hace antes una copia de la base de datos. Conserva la configuración, los datos y los archivos.
# Backs up the database first. Keeps settings, data and files.
set -euo pipefail
APP="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP"
case "${HR_LANG:-${LANG:-}}" in es*|ES*) ES=1 ;; *) ES=0 ;; esac
t() { if [ "$ES" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
paso() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
[ -f .env ] || { echo "$(t 'Aquí no hay una instalación (falta .env). Usa instalar/instalar.sh.' 'No installation here (.env missing). Use instalar/instalar.sh.')" >&2; exit 1; }
VERSION="${1:-latest}"
case "$VERSION" in latest|[0-9]*.[0-9]*.[0-9]*) ;; *) echo "$(t 'Versión no válida: usa latest o p. ej. 1.2.0' 'Invalid version: use latest or e.g. 1.2.0')" >&2; exit 1;; esac

paso "$(t 'Copia de la base de datos antes de actualizar' 'Database backup before updating')"
# La escribe el contenedor de copias, dueño de la carpeta de copias.
COPIA="antes-de-actualizar-$(date +%Y%m%d%H%M%S).dump"
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' | \
  docker compose exec -T backup-db sh -c "mkdir -p /backups/db && cat > /backups/db/$COPIA && test -s /backups/db/$COPIA" \
  || { echo "$(t 'No se ha podido hacer la copia: no se actualiza nada.' 'The backup failed: nothing was updated.')" >&2; exit 1; }
echo "  $(t 'Copia' 'Backup'): db/$COPIA"

if [ -d .git ]; then
  paso "$(t 'Código nuevo (archivos de instalación)' 'New code (installation files)')"
  if [ "$VERSION" = latest ]; then git pull --ff-only; else git fetch --tags --quiet && git checkout --quiet "v$VERSION"; fi
fi

paso "$(t "Imágenes de la versión $VERSION" "Images for version $VERSION")"
sed -i "s/^HR_CORE_VERSION=.*/HR_CORE_VERSION=$VERSION/" .env
grep -q '^HR_CORE_VERSION=' .env || echo "HR_CORE_VERSION=$VERSION" >> .env
if docker compose pull --quiet api web; then
  docker compose up -d
else
  echo "$(t 'No se han podido descargar: se compilan aquí.' 'Could not download them: building here.')"
  docker compose up -d --build
fi
echo "$(t 'Hecho. Las migraciones se aplican solas al arrancar la API.' 'Done. Database migrations run automatically when the API starts.')"
