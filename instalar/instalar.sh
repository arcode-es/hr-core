#!/usr/bin/env bash
# HR-Core · instalador / installer
#
#   ./instalar/instalar.sh                 pregunta lo que falte / asks for anything missing
#   ./instalar/instalar.sh configuracion.env   toma las respuestas de un archivo / reads answers from a file
#
# Se puede repetir: conserva las claves, la base de datos y los archivos de una instalación anterior.
# Safe to re-run: keeps the keys, database and files of a previous installation.
set -euo pipefail
INSTALADOR="$(cd "$(dirname "$0")" && pwd)"
APP="$(cd "$INSTALADOR/.." && pwd)"
ENVF="$APP/.env"
PROXY="$INSTALADOR/proxy"

# ── Idioma / language ──────────────────────────────────────────────────
case "${HR_LANG:-${LANG:-}}" in es*|ES*) ES=1 ;; *) ES=0 ;; esac
t() { if [ "$ES" = 1 ]; then printf '%s' "$1"; else printf '%s' "$2"; fi; }
rojo() { printf '\033[31m%s\033[0m\n' "$*" >&2; }
paso() { printf '\n\033[1m▸ %s\033[0m\n' "$*"; }
nota() { printf '  %s\n' "$*"; }

# ── 0. Requisitos / requirements ───────────────────────────────────────
command -v docker >/dev/null || { rojo "$(t 'Falta Docker. Instálalo: https://docs.docker.com/engine/install/' 'Docker is missing. Install it: https://docs.docker.com/engine/install/')"; exit 1; }
docker compose version >/dev/null 2>&1 || { rojo "$(t 'Falta el complemento Docker Compose (docker compose).' 'The Docker Compose plugin (docker compose) is missing.')"; exit 1; }
docker info >/dev/null 2>&1 || { rojo "$(t 'Este usuario no puede usar Docker: ejecuta con sudo o añádelo al grupo docker.' 'This user cannot use Docker: run with sudo or add it to the docker group.')"; exit 1; }
command -v openssl >/dev/null || { rojo "$(t 'Falta openssl.' 'openssl is missing.')"; exit 1; }
[ -f "$APP/docker-compose.yml" ] || { rojo "$(t 'No encuentro docker-compose.yml: ejecuta el instalador desde el código de HR-Core.' 'docker-compose.yml not found: run the installer from the HR-Core source folder.')"; exit 1; }

# ── 1. Respuestas / answers ────────────────────────────────────────────
# El archivo se lee línea a línea (CLAVE=valor), no se ejecuta. Lo que venga en el entorno manda.
# The file is read line by line (KEY=value), never executed. Environment variables take precedence.
RESPUESTAS="${1:-$INSTALADOR/configuracion.env}"
if [ -f "$RESPUESTAS" ]; then
  while IFS= read -r linea || [ -n "$linea" ]; do
    case "$linea" in ''|'#'*) continue;; esac
    clave="${linea%%=*}"; valor="${linea#*=}"
    [[ "$clave" =~ ^[A-Z_][A-Z0-9_]*$ ]] || continue
    valor="${valor%$'\r'}"; valor="${valor//\"/}"; valor="${valor//\'/}"
    [ -n "${!clave:-}" ] || printf -v "$clave" '%s' "$valor"
  done < "$RESPUESTAS"
fi
preguntar() { # variable, texto, por defecto, obligatorio (1/0)
  local var="$1" texto="$2" def="${3:-}" oblig="${4:-1}" valor="${!1:-}"
  while [ -z "$valor" ]; do
    if [ ! -t 0 ]; then
      valor="$def"
      [ -n "$valor" ] || [ "$oblig" = 0 ] || { rojo "$(t "Falta $var" "Missing $var")"; exit 1; }
      break
    fi
    read -r -p "$texto${def:+ [$def]}: " valor
    valor="${valor:-$def}"
    [ "$oblig" = 0 ] && break
  done
  printf -v "$var" '%s' "$valor"
}
elegir() { # variable, texto, opciones separadas por |, por defecto
  local var="$1" texto="$2" opciones="$3" def="$4" valor="${!1:-}"
  while ! [[ "|$opciones|" == *"|$valor|"* ]]; do
    if [ ! -t 0 ]; then valor="$def"; break; fi
    read -r -p "$texto [$opciones] ($def): " valor
    valor="${valor:-$def}"
  done
  printf -v "$var" '%s' "$valor"
}

paso "$(t 'Cómo se accederá a HR-Core' 'How HR-Core will be reached')"
nota "$(t 'dominio   → por internet con tu dominio y HTTPS (p. ej. https://fichajes.tuempresa.es)' 'domain    → over the internet with your domain and HTTPS (e.g. https://time.yourcompany.com)')"
nota "$(t 'tailscale → solo dentro de tu red privada Tailscale, con HTTPS de Tailscale' 'tailscale → only inside your private Tailscale network, with Tailscale HTTPS')"
nota "$(t 'local     → solo en este equipo (http://localhost), para probarlo' 'local     → only on this machine (http://localhost), to try it out')"
[ "${ACCESO:-}" = domain ] && ACCESO=dominio
elegir ACCESO "$(t 'Acceso' 'Access')" "dominio|tailscale|local" "dominio"

PUERTO_LOCAL="${PUERTO_LOCAL:-8080}"
case "$ACCESO" in
  dominio)
    preguntar DOMINIO "$(t 'Dominio, sin https:// (su registro DNS A/AAAA debe apuntar ya a este servidor)' 'Domain, without https:// (its DNS A/AAAA record must already point to this server)')"
    case "$DOMINIO" in *://*|*/*|*' '*|"") rojo "$(t 'El dominio va sin https:// ni barras: fichajes.tuempresa.es' 'Write the domain without https:// or slashes: time.yourcompany.com')"; exit 1;; esac
    URL="https://$DOMINIO${PUERTO_HTTPS:+:$PUERTO_HTTPS}"
    ;;
  tailscale)
    command -v tailscale >/dev/null || { rojo "$(t 'Falta Tailscale en este servidor: https://tailscale.com/download/linux (y después: sudo tailscale up)' 'Tailscale is not installed on this server: https://tailscale.com/download/linux (then: sudo tailscale up)')"; exit 1; }
    TS_NOMBRE="$(tailscale status --json 2>/dev/null | sed -n 's/.*"DNSName": *"\([^"]*\)".*/\1/p' | head -1)"
    TS_NOMBRE="${TS_NOMBRE%.}"
    [ -n "$TS_NOMBRE" ] || { rojo "$(t 'Tailscale no está conectado: ejecuta sudo tailscale up y repite.' 'Tailscale is not connected: run sudo tailscale up and try again.')"; exit 1; }
    case "$TS_NOMBRE" in *.ts.net) ;; *) rojo "$(t "Activa MagicDNS en tu red Tailscale (consola → DNS): nombre actual $TS_NOMBRE" "Enable MagicDNS in your Tailscale network (admin console → DNS): current name $TS_NOMBRE")"; exit 1;; esac
    URL="https://$TS_NOMBRE"
    ;;
  local)
    URL="http://localhost:$PUERTO_LOCAL"
    ;;
esac

paso "$(t 'Empresa y administración' 'Company and administrator')"
preguntar EMPRESA_NOMBRE "$(t 'Nombre de la empresa' 'Company name')"
preguntar EMPRESA_NIF "$(t 'NIF / número fiscal (opcional)' 'Tax ID (optional)')" "" 0
preguntar EMPRESA_DIRECCION "$(t 'Dirección (opcional)' 'Address (optional)')" "" 0
preguntar EMPRESA_CORREO "$(t 'Correo de contacto de la empresa' 'Company contact email')"
preguntar ADMIN_NOMBRE "$(t 'Nombre de la persona administradora' 'Administrator name')"
preguntar ADMIN_CORREO "$(t 'Correo de la persona administradora' 'Administrator email')"
preguntar NOMBRE_APP "$(t 'Nombre de la aplicación' 'App name')" "HR-Core"
preguntar ZONA_HORARIA "$(t 'Zona horaria' 'Time zone')" "Europe/Madrid"

paso "$(t 'Correo saliente (invitaciones, avisos, recuperar contraseña)' 'Outgoing email (invitations, notices, password reset)')"
nota "$(t 'smtp = tu servidor de correo · resend = API de Resend · ninguno = sin correo (los enlaces se copian a mano)' 'smtp = your mail server · resend = Resend API · none = no email (links are copied by hand)')"
[ "${CORREO:-}" = none ] && CORREO=ninguno
elegir CORREO "$(t 'Correo' 'Email')" "smtp|resend|ninguno" "ninguno"
case "$CORREO" in
  smtp)
    preguntar SMTP_HOST "$(t 'Servidor SMTP' 'SMTP server')"
    preguntar SMTP_PORT "$(t 'Puerto (587 STARTTLS / 465 TLS)' 'Port (587 STARTTLS / 465 TLS)')" "587"
    preguntar SMTP_USER "$(t 'Usuario SMTP' 'SMTP user')" "" 0
    if [ -z "${SMTP_PASSWORD:-}" ] && [ -n "$SMTP_USER" ] && [ -t 0 ]; then read -r -s -p "$(t 'Contraseña SMTP' 'SMTP password'): " SMTP_PASSWORD; echo; fi
    preguntar CORREO_REMITENTE "$(t 'Remitente (p. ej. Fichajes <no-reply@tuempresa.es>)' 'Sender (e.g. Timesheets <no-reply@yourcompany.com>)')"
    ;;
  resend)
    if [ -z "${RESEND_API_KEY:-}" ] && [ -t 0 ]; then read -r -s -p "$(t 'Clave de Resend' 'Resend API key'): " RESEND_API_KEY; echo; fi
    [ -n "${RESEND_API_KEY:-}" ] || { rojo "$(t 'Falta RESEND_API_KEY' 'Missing RESEND_API_KEY')"; exit 1; }
    preguntar CORREO_REMITENTE "$(t 'Remitente, de un dominio verificado en Resend' 'Sender, from a domain verified in Resend')"
    ;;
esac

CORREO_CERTIFICADOS="${CORREO_CERTIFICADOS:-$EMPRESA_CORREO}"
PROVEEDOR="${PROVEEDOR:-}"
CARPETA_COPIAS="${CARPETA_COPIAS:-/var/backups/hr-core}"
DIAS_COPIAS="${DIAS_COPIAS:-14}"
PROXY_NETWORK="${PROXY_NETWORK:-hr-core-proxy}"
HR_CORE_VERSION="${HR_CORE_VERSION:-latest}"

# ── 2. Configuración (.env) ────────────────────────────────────────────
valor_env() { grep -E "^$1=" "$ENVF" 2>/dev/null | head -1 | cut -d= -f2- || true; }
secreto() { openssl rand -base64 48 | tr -d '\n/+=' | cut -c1-48; }
if [ -f "$ENVF" ]; then
  paso "$(t 'Ya hay una instalación: se conservan sus claves y sus datos' 'An installation already exists: its keys and data are kept')"
  cp -p "$ENVF" "$ENVF.bak-$(date +%Y%m%d%H%M%S)"
  PG_PASS="$(valor_env POSTGRES_PASSWORD)"; JWT_A="$(valor_env JWT_ACCESS_SECRET)"; JWT_R="$(valor_env JWT_REFRESH_SECRET)"
  VAPID_PUB="$(valor_env VAPID_PUBLIC_KEY)"; VAPID_PRI="$(valor_env VAPID_PRIVATE_KEY)"
  # Una contraseña SMTP o clave de Resend ya guardada no se vuelve a pedir.
  SMTP_PASSWORD="${SMTP_PASSWORD:-$(valor_env SMTP_PASSWORD)}"; RESEND_API_KEY="${RESEND_API_KEY:-$(valor_env RESEND_API_KEY)}"
else
  paso "$(t 'Generando claves' 'Generating keys')"
  PG_PASS="$(secreto)"; JWT_A="$(secreto)"; JWT_R="$(secreto)"; VAPID_PUB=""; VAPID_PRI=""
fi
if [ -z "$VAPID_PUB" ] || [ -z "$VAPID_PRI" ]; then
  # Claves de los avisos push del móvil. Sin salida a internet la app funciona igual, sin esos avisos.
  if claves="$(docker run --rm node:22-alpine npx -y web-push@3 generate-vapid-keys --json 2>/dev/null)"; then
    VAPID_PUB="$(printf '%s' "$claves" | sed -n 's/.*"publicKey":"\([^"]*\)".*/\1/p')"
    VAPID_PRI="$(printf '%s' "$claves" | sed -n 's/.*"privateKey":"\([^"]*\)".*/\1/p')"
  fi
  [ -n "$VAPID_PUB" ] || rojo "$(t 'Aviso: no se han podido generar las claves de avisos push; repite el instalador más tarde.' 'Warning: push notification keys could not be generated; run the installer again later.')"
fi
case "$CORREO" in smtp) DRIVER=smtp ;; resend) DRIVER=resend ;; *) DRIVER=log ;; esac
DOMINIO_CORREO="${CORREO_REMITENTE:-}"; DOMINIO_CORREO="${DOMINIO_CORREO##*@}"; DOMINIO_CORREO="${DOMINIO_CORREO%>}"
umask 077
cat > "$ENVF" <<FIN
# $(t 'Generado por instalar.sh' 'Generated by instalar.sh') $(date -Iseconds). $(t 'Contiene claves: no lo compartas.' 'Contains secrets: do not share it.')
NODE_ENV=production
TZ=UTC
COMPOSE_PROJECT_NAME=${COMPOSE_PROJECT_NAME:-hr-core}
COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml${COMPOSE_EXTRA:+:$COMPOSE_EXTRA}
PROXY_NETWORK=$PROXY_NETWORK
HR_CORE_VERSION=$HR_CORE_VERSION
${HR_CORE_REGISTRY:+HR_CORE_REGISTRY=$HR_CORE_REGISTRY}
ACCESO=$ACCESO

POSTGRES_USER=hr
POSTGRES_PASSWORD=$PG_PASS
POSTGRES_DB=hr_gestion

DEPLOY_MODE=client
BASE_PATH=
APP_NAME="$NOMBRE_APP"
APP_PUBLIC_URL=$URL
API_PUBLIC_URL=$URL
CORS_ORIGINS=$URL
JOBS_ENABLED=true
JOBS_TIMEZONE=$ZONA_HORARIA

LEGAL_NAME="$EMPRESA_NOMBRE"
LEGAL_TAX_ID="${EMPRESA_NIF:-}"
LEGAL_ADDRESS="${EMPRESA_DIRECCION:-}"
LEGAL_EMAIL=$EMPRESA_CORREO
LEGAL_PROVIDER="$PROVEEDOR"

JWT_ACCESS_SECRET=$JWT_A
JWT_REFRESH_SECRET=$JWT_R
VAPID_PUBLIC_KEY=$VAPID_PUB
VAPID_PRIVATE_KEY=$VAPID_PRI
VAPID_SUBJECT=mailto:$EMPRESA_CORREO

STORAGE_DRIVER=local
BACKUP_DIR=$CARPETA_COPIAS
BACKUP_HOUR=02
BACKUP_KEEP_DAYS=$DIAS_COPIAS

EMAIL_DRIVER=$DRIVER
EMAIL_FROM="${CORREO_REMITENTE:-$NOMBRE_APP <no-reply@${DOMINIO_CORREO:-example.com}>}"
EMAIL_REPLY_TO=$EMPRESA_CORREO
SMTP_HOST=${SMTP_HOST:-}
SMTP_PORT=${SMTP_PORT:-587}
SMTP_USER=${SMTP_USER:-}
SMTP_PASSWORD=${SMTP_PASSWORD:-}
RESEND_API_KEY=${RESEND_API_KEY:-}

GEOCODER_USER_AGENT="HR-Core (${EMPRESA_CORREO})"
FIN
chmod 600 "$ENVF"

# Proxy: Caddyfile y puertos según el acceso.
if [ "$ACCESO" = dominio ]; then
  SITIO="$DOMINIO"; GLOBAL="email $CORREO_CERTIFICADOS"; HSTS='header Strict-Transport-Security "max-age=31536000"'
  ESCUCHA_HTTP="${PUERTO_HTTP:-80}:80"; ESCUCHA_HTTPS="${PUERTO_HTTPS:-443}:443"
else
  # Solo en este equipo: con Tailscale, el HTTPS lo pone `tailscale serve`; en local, localhost ya es un origen seguro.
  SITIO=":80"; GLOBAL="auto_https off"; HSTS=""
  ESCUCHA_HTTP="127.0.0.1:$PUERTO_LOCAL:80"; ESCUCHA_HTTPS="127.0.0.1:$((PUERTO_LOCAL + 1)):443"
fi
cat > "$PROXY/Caddyfile" <<FIN
# $(t 'Generado por instalar.sh: se reescribe al repetir la instalación.' 'Generated by instalar.sh: rewritten when the installer runs again.')
{
	$GLOBAL
}

$SITIO {
	encode zstd gzip
	$HSTS

	handle /api/* {
		request_body {
			max_size 12MB
		}
		reverse_proxy hr-core-api:3000
	}

	handle {
		reverse_proxy hr-core-web:80
	}
}
FIN
cat > "$PROXY/.env" <<FIN
PROXY_NETWORK=$PROXY_NETWORK
ESCUCHA_HTTP=$ESCUCHA_HTTP
ESCUCHA_HTTPS=$ESCUCHA_HTTPS
FIN
mkdir -p "$CARPETA_COPIAS" 2>/dev/null || { rojo "$(t "No puedo crear $CARPETA_COPIAS: créala o cambia CARPETA_COPIAS." "Cannot create $CARPETA_COPIAS: create it or change CARPETA_COPIAS.")"; exit 1; }

# ── 3. Arranque / start ────────────────────────────────────────────────
paso "$(t 'Descargando y arrancando HR-Core' 'Downloading and starting HR-Core')"
docker network inspect "$PROXY_NETWORK" >/dev/null 2>&1 || docker network create "$PROXY_NETWORK" >/dev/null
cd "$APP"
if [ "${CONSTRUIR:-0}" = 1 ]; then
  docker compose up -d --build
elif ! docker compose pull --quiet api web; then
  # Sin acceso al registro de imágenes (o sin imagen de esta versión): se compilan aquí.
  nota "$(t 'No se han podido descargar las imágenes: se compilan en este equipo (tarda unos minutos).' 'Images could not be downloaded: building them on this machine (takes a few minutes).')"
  docker compose up -d --build
else
  docker compose up -d
fi
printf '%s' "$(t 'Esperando a la API' 'Waiting for the API')"
lista=0
for _ in $(seq 1 90); do
  if docker compose exec -T api wget -qO- http://127.0.0.1:3000/api/v1/health >/dev/null 2>&1; then lista=1; break; fi
  printf '.'; sleep 2
done
echo
[ "$lista" = 1 ] || { rojo "$(t 'La API no responde. Mira: docker compose logs api' 'The API is not responding. Check: docker compose logs api')"; exit 1; }

paso "$(t 'Arrancando el proxy' 'Starting the proxy')"
( cd "$PROXY" && docker compose up -d --force-recreate )
sleep 4
[ "$(docker inspect -f '{{.State.Status}}' hr-core-proxy 2>/dev/null)" = running ] || { rojo "$(t 'El proxy no arranca:' 'The proxy does not start:')"; docker logs --tail 5 hr-core-proxy >&2 || true; exit 1; }

if [ "$ACCESO" = tailscale ]; then
  paso "$(t 'Publicando en tu red Tailscale (HTTPS)' 'Publishing on your Tailscale network (HTTPS)')"
  if ! tailscale serve --bg --https=443 "http://127.0.0.1:$PUERTO_LOCAL" >/dev/null 2>&1 && ! sudo tailscale serve --bg --https=443 "http://127.0.0.1:$PUERTO_LOCAL"; then
    rojo "$(t 'No se pudo activar tailscale serve. Activa HTTPS en la consola de Tailscale (DNS → HTTPS Certificates) y repite.' 'tailscale serve failed. Enable HTTPS in the Tailscale admin console (DNS → HTTPS Certificates) and try again.')"
    exit 1
  fi
fi

# ── 4. Empresa y primera cuenta / company and first account ────────────
paso "$(t 'Empresa y cuenta de administración' 'Company and administrator account')"
if [ -f "$APP/.empresa-creada" ]; then
  nota "$(t 'La empresa ya se creó en una instalación anterior: no se repite.' 'The company was created by a previous run: skipped.')"
else
  docker compose exec -T api node dist/cli.js create-organization \
    --name "$EMPRESA_NOMBRE" ${EMPRESA_NIF:+--tax-id "$EMPRESA_NIF"} \
    --admin-email "$ADMIN_CORREO" --admin-name "$ADMIN_NOMBRE" </dev/null && date -Iseconds > "$APP/.empresa-creada"
fi

paso "$(t 'Hecho' 'Done')"
nota "$(t 'Aplicación' 'App'):    $URL"
nota "$(t 'Estado' 'Health'):     $URL/api/v1/health"
nota "$(t 'Copias' 'Backups'):    $CARPETA_COPIAS ($(t "cada día a las 02:00 UTC, $DIAS_COPIAS días" "daily at 02:00 UTC, $DIAS_COPIAS days"))"
echo
nota "$(t "Abre el enlace de arriba para que $ADMIN_CORREO elija su contraseña (vale 7 días)." "Open the link above so $ADMIN_CORREO can choose a password (valid for 7 days).")"
[ "$ACCESO" = tailscale ] && nota "$(t 'Cada persona necesita Tailscale en su móvil u ordenador, en tu red: https://tailscale.com/download' 'Each person needs Tailscale on their phone or computer, in your network: https://tailscale.com/download')"
nota "$(t 'Guía de uso y mantenimiento: docs/es/README.md' 'Usage and maintenance guide: docs/en/README.md')"
