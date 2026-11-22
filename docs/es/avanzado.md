# Guía de despliegue

[← Documentación](README.md)

> **Estado:** `docker compose`, los `Dockerfile`, las migraciones y la siembra de la demo están probados con Docker, también
> publicada bajo una ruta (p. ej. `/HR-core`) con un proxy delante.

## 0. Tipos de instalación (`DEPLOY_MODE`)

| Modo | Para qué | Qué cambia |
|---|---|---|
| `demo` | Una demo pública | Sin registro ni correo. Acceso de un clic con las cuentas de prueba, aviso fijo de demo. No se pueden cambiar contraseñas ni el rol de las cuentas de prueba. Se borra y se vuelve a sembrar cada noche a las 03:00 |
| `client` | El servidor de un cliente | Una sola empresa, sin espacio personal. La crea la línea de comandos (abajo) y solo se entra con invitación |
| `open` | Registro libre | Cualquiera crea su cuenta y sus empresas tras confirmar el correo |

## 1. Requisitos

- Un servidor con Docker y Docker Compose, y un dominio con HTTPS.
- HTTPS no es opcional: sin él no funcionan la geolocalización, la cámara, la instalación como app ni las notificaciones push.

## 2. Publicar bajo una ruta (p. ej. tuempresa.es/HR-core)

La web y la API pueden vivir en una carpeta de un dominio que ya sirve otra web. El proxy quita la carpeta antes de pasar la
petición; la app sabe que vive ahí por `BASE_PATH` (API) y `VITE_BASE_PATH` (web, al compilar):

```
BASE_PATH=/HR-core
VITE_BASE_PATH=/HR-core
VITE_API_URL=/HR-core/api/v1
APP_PUBLIC_URL=https://tuempresa.es/HR-core
API_PUBLIC_URL=https://tuempresa.es/HR-core
CORS_ORIGINS=https://tuempresa.es
```

Con nginx delante:

```nginx
location = /HR-core { return 301 /HR-core/; }
location /HR-core/api/ {
    proxy_pass http://127.0.0.1:3000/api/;     # quita /HR-core
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    client_max_body_size 12m;
}
location /HR-core/ {
    proxy_pass http://127.0.0.1:5173/;          # quita /HR-core
    proxy_set_header Host $host;
}
```

Con Caddy en otro contenedor, sin publicar puertos: une `web` y `api` a la red del proxy con
`docker-compose.proxy.yml` (ver sección 5) y añade al sitio:

```
@hr_core path /HR-core /HR-core/*
handle @hr_core {
    redir /HR-core /HR-core/ 308
    uri strip_prefix /HR-core
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
```

Si delante de Caddy hay una CDN o un túnel (Cloudflare), pasa a la API la IP del visitante y no la del túnel:
`header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}` dentro de `reverse_proxy`.

La cookie de sesión va limitada a `/HR-core/api/v1/auth` y el service worker a `/HR-core/`: la app no interfiere con el resto
del dominio.

## 3. Un solo dominio para web y API

La sesión usa una cookie `SameSite=Lax` limitada a `/api/v1/auth`. Lo más sencillo y seguro es servir la web y la API
bajo el **mismo dominio**, con un proxy inverso delante:

```
https://app.tuempresa.com/          → contenedor web (nginx, puerto 80)
https://app.tuempresa.com/api/      → contenedor api (puerto 3000)
```

Ejemplo con Caddy (gestiona los certificados solo):

```
app.tuempresa.com {
    handle /api/* {
        reverse_proxy api:3000
    }
    handle {
        reverse_proxy web:80
    }
}
```

Si prefieres dominios separados (`app.` y `api.`), deben compartir dominio raíz y hay que añadir el de la web a `CORS_ORIGINS`.

La web lleva su propia política de seguridad (`apps/web/security-headers.conf`): solo admite scripts propios y no se puede
incrustar en otra página. Si la API va en otro dominio, su origen ya está permitido (`connect-src https:`).

## 4. Configuración (`.env`)

Copia `.env.example` a `.env` y cambia, como mínimo:

| Variable | Valor en producción |
|---|---|
| `NODE_ENV` | `production` (activa la cookie `Secure`) |
| `POSTGRES_PASSWORD`, `S3_SECRET_KEY` | Contraseñas propias, largas y distintas |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48` (una para cada una) |
| `CORS_ORIGINS` | `https://app.tuempresa.com` |
| `VITE_API_URL` | `https://app.tuempresa.com/api/v1` (se fija al **compilar** la web) |
| `API_PUBLIC_URL` | `https://app.tuempresa.com` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys`; sin ellas no hay push, el resto funciona |
| `VAPID_SUBJECT` | `mailto:` de contacto real |
| `GEOCODER_USER_AGENT` | Nombre de tu app y un contacto (lo exige Nominatim) |
| `DEPLOY_MODE` | `demo`, `client` u `open` (sección 0) |
| `BASE_PATH`, `VITE_BASE_PATH` | La carpeta, si la hay (sección 2) |
| `DEMO_PASSWORD` | Solo en la demo: la contraseña pública de las cuentas de prueba |
| `VITE_APP_NAME` | Nombre del producto en la app instalable y en el título (se fija al **compilar** la web); `HR-Core` si no se indica |
| `INVITES_PER_DAY` | Correos de invitación por empresa en 24 h (alta masiva incluida); 200 por defecto |
| `LEGAL_NAME`, `LEGAL_TAX_ID`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | Titular del sitio para el aviso legal y la política de privacidad. En el servidor de un cliente, la empresa cliente |
| `LEGAL_PROVIDER` | Quien presta el servicio como encargado del tratamiento (p. ej. la empresa que mantiene el servidor) |
| `APP_PUBLIC_URL` | `https://app.tuempresa.com`: base de los enlaces de los correos (invitación y recuperación) |
| `EMAIL_DRIVER` | `resend` para enviar correos de verdad; con `log` solo se escriben en el registro de la API |
| `RESEND_API_KEY` | Clave de [Resend](https://resend.com) con permiso de envío. Va en el `.env` del servidor, nunca en el repositorio |
| `EMAIL_FROM` | Remitente, p. ej. `Fichajes <no-reply@tuempresa.es>` (con Resend, de un dominio verificado) |
| `EMAIL_REPLY_TO` | Opcional: dirección real a la que llegan las respuestas |

Correo (`EMAIL_DRIVER=resend`): el dominio del remitente tiene que estar verificado en Resend (registros SPF, DKIM y,
recomendado, DMARC). Se envían tres correos: invitación a una empresa, enlace para restablecer la contraseña (un solo uso,
caduca en 60 minutos) y aviso de contraseña cambiada. Si Resend falla, la acción no se bloquea: la invitación sigue
teniendo su enlace para copiarlo y el olvido de contraseña responde igual (no revela si la cuenta existe).

Almacenamiento de archivos (`STORAGE_DRIVER`):

- `s3` con el MinIO del `docker-compose.yml` (perfil `s3`, ver el aviso de la sección 5), o con AWS S3 / Cloudflare R2 cambiando `S3_ENDPOINT`, `S3_REGION` y credenciales.
  `S3_PUBLIC_ENDPOINT` debe ser una URL que el navegador alcance: las fotos se sirven con enlaces prefirmados.
- `local` guarda en el disco del contenedor de la API: monta un volumen en `STORAGE_LOCAL_DIR` o perderás los archivos al recrearlo.

## 5. Arranque

El `docker-compose.yml` **no publica ningún puerto** en el servidor (Docker se salta el cortafuegos del equipo: un puerto
publicado queda abierto a internet). Elige cómo llega el proxy inverso:

- **Proxy en otro contenedor** (Caddy, Traefik…): crea una red compartida una sola vez, `docker network create hr-core-proxy`,
  conéctale el proxy y pon en `.env` `COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml`. El proxy alcanza la app en
  `hr-core-web:80` y `hr-core-api:3000`.
- **Proxy instalado en el servidor** (nginx): `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml` publica la API y la web
  solo en `127.0.0.1` (puertos `API_PORT` y `WEB_PORT`).

MinIO y su copia solo arrancan con `COMPOSE_PROFILES=s3`; con `STORAGE_DRIVER=local` o un S3 externo, déjalo vacío.
**Ese perfil no se ha podido probar:** las imágenes oficiales `minio/minio` y `minio/mc` ya no se publican (ni en Docker Hub
ni en quay.io) y hay que sustituirlas en el compose por otras antes de usarlo.
Cada contenedor lleva un límite de memoria (`*_MEM_LIMIT` en el compose).

```bash
docker compose up -d --build
docker compose logs -f api      # debe verse «All migrations have been successfully applied»
```

La API aplica las migraciones pendientes cada vez que arranca. Comprueba `https://app.tuempresa.com/api/v1/health`.

En el servidor de un cliente (`DEPLOY_MODE=client`), crea su empresa y su primer administrador:

```bash
docker compose exec api node dist/cli.js create-organization \
  --name "Construcciones Pérez S.L." --tax-id B12345678 \
  --admin-email jefa@construccionesperez.es --admin-name "Marta Pérez"
```

Le llega un correo para elegir su contraseña (el enlace vale 7 días y también se imprime en pantalla). Desde ahí invita al resto.

En la demo, la API siembra la empresa de ejemplo al arrancar por primera vez y la restablece cada noche. Para hacerlo a mano:
`docker compose exec api node dist/cli.js demo-reset`.

### Tareas programadas

La propia API las ejecuta (no hace falta cron). Con varias instancias, cada tarea corre una sola vez por turno. Las horas son de
`JOBS_TIMEZONE` (por defecto `Europe/Madrid`); se desactivan todas con `JOBS_ENABLED=false`.

| Tarea | Cuándo | Qué hace |
|---|---|---|
| `alertas-de-jornada` | cada 5 min | Entradas sin fichar, jornadas abiertas demasiado tiempo y descansos de menos de 12 h |
| `avisos-tras-desconexion` | cada 5 min | Envía (push y correo) lo retenido durante el horario de desconexión |
| `limpiar-nominas-subidas` | cada hora | Borra los PDF de nóminas subidos y no enviados en 24 h |
| `restablecer-demo` | 03:00 | Solo en la demo: la borra y la vuelve a sembrar |
| `conservacion-de-fotos` | 04:00 | Borra las fotos de fichaje que superan el plazo de cada empresa |
| `limpiar-historial-de-tareas` | 04:30 | Borra el historial de ejecuciones de más de 30 días |
| `alertas-diarias` | 06:00 | Más de 9 h ordinarias ayer y horas extra del año (70 % y 100 %) |
| `registro-mensual` | 07:00 | A partir del día elegido por cada empresa, envía el registro de jornada del mes anterior |
| `resumen-diario` | 08:00 | Correo con lo pendiente para quien supervisa (si lo tiene activado) |
| `recordatorios-de-documentos` | 09:00 | Recordatorios de documentos con fecha límite |

## 6. Copias de seguridad

El compose incluye dos servicios que copian cada día, a la hora `BACKUP_HOUR`, en la carpeta `BACKUP_DIR` del servidor:

- `backup-db`: `pg_dump` de la base de datos en `backups/db/hr-AAAA-MM-DD.dump`, más los archivos si `STORAGE_DRIVER=local`.
  Guarda `BACKUP_KEEP_DAYS` días (14 por defecto).
- `backup-files`: espejo del bucket de MinIO en `backups/files/` (fotos, tickets y documentos). No borra lo eliminado del bucket.

Esa carpeta debe copiarse **fuera del servidor** (otro equipo, un almacenamiento externo): una copia en el mismo disco no protege
de su avería. El registro de jornada debe conservarse cuatro años.

Comprobar una copia sin tocar los datos reales (la restaura en otra base y cuenta usuarios y fichajes):

```bash
infra/backup/restore.sh backups/db/hr-2026-11-12.dump prueba_restauracion
```

Restaurar de verdad: `infra/backup/restore.sh backups/db/hr-2026-11-12.dump` (pide escribir RESTAURAR; para la API mientras tanto).

## 7. Antes de usarlo con datos reales

- **Mapas y direcciones.** Los servidores públicos de OpenStreetMap tienen límites de uso. Con tráfico real, contrata un proveedor
  de teselas o monta instancias propias y cambia `VITE_MAP_TILES_URL` y `GEOCODER_URL`.
- **Proxy saliente.** Si la API sale a internet a través de un proxy, añade `NODE_USE_ENV_PROXY=1`.
- **Proxy inverso.** La API confía en un salto de proxy (`trust proxy`) para registrar la IP real en firmas y auditoría.
  Con más saltos (CDN + proxy) hay que ajustarlo en `apps/api/src/main.ts`.
- **Protección de datos.** La app trata ubicaciones, fotos, DNI y documentos laborales. Incluye páginas legales base
  (`/legal/privacidad`, `/legal/aviso-legal`, `/legal/cookies`), el aviso previo de geolocalización, la descarga de los propios
  datos, la baja de la cuenta, el plazo de conservación de las fotos y el horario de desconexión. Antes de producción: revisa
  los textos con la asesoría (`apps/web/src/legal/texts.ts`), rellena `LEGAL_*`, firma el encargo de tratamiento con el
  proveedor de alojamiento y ajusta los plazos en la página Empresa.
- **Firma de documentos.** Es firma electrónica simple con evidencias, no cualificada.

## 8. Actualizar

```bash
git pull
docker compose up -d --build
```

Los usuarios reciben la versión nueva de la app al volver a abrirla (el service worker se actualiza solo).

## 9. Manuales por perfil


La web sirve `/manuales/manual-trabajadores.pdf`, `manual-responsables.pdf` y `manual-administracion.pdf` (se copian de
`docs/manuales/` al construir la imagen). Cada persona recibe por correo el de su perfil al entrar en la empresa y al
cambiar de perfil; la administración puede reenviarlo desde Equipo.
