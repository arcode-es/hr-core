# Deployment guide

[← Documentation](README.md) · [Español](../es/avanzado.md)

> **Status:** `docker compose`, the `Dockerfile`s, the migrations and the demo seeding have been tested with Docker,
> including published under a path (e.g. `/HR-core`) behind a proxy.

## 0. Installation types (`DEPLOY_MODE`)

| Mode | What it is for | What changes |
|---|---|---|
| `demo` | A public demo | No sign-up or email. One-click access with the test accounts, fixed demo banner. Passwords and the role of the test accounts cannot be changed. It is wiped and re-seeded every night at 03:00 |
| `client` | A client's server | A single company, no personal space. It is created from the command line (below) and sign-in is by invitation only |
| `open` | Open sign-up | Anyone creates their account and their companies after confirming their email |

## 1. Requirements

- A server with Docker and Docker Compose, and a domain with HTTPS.
- HTTPS is not optional: without it, geolocation, the camera, installing as an app and push notifications do not work.

## 2. Publishing under a path (e.g. yourcompany.com/HR-core)

The web app and the API can live in a folder of a domain that already serves another website. The proxy strips the
folder before passing the request on; the app knows it lives there through `BASE_PATH` (API) and `VITE_BASE_PATH`
(web, at build time):

```
BASE_PATH=/HR-core
VITE_BASE_PATH=/HR-core
VITE_API_URL=/HR-core/api/v1
APP_PUBLIC_URL=https://yourcompany.com/HR-core
API_PUBLIC_URL=https://yourcompany.com/HR-core
CORS_ORIGINS=https://yourcompany.com
```

With nginx in front:

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

(The comments `quita /HR-core` mean "strips /HR-core".)

With Caddy in another container, without publishing ports: join `web` and `api` to the proxy's network with
`docker-compose.proxy.yml` (see section 5) and add this to the site:

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

If there is a CDN or a tunnel (Cloudflare) in front of Caddy, pass the visitor's IP to the API, not the tunnel's:
`header_up X-Forwarded-For {http.request.header.Cf-Connecting-Ip}` inside `reverse_proxy`.

The session cookie is limited to `/HR-core/api/v1/auth` and the service worker to `/HR-core/`: the app does not
interfere with the rest of the domain.

## 3. A single domain for web and API

The session uses a `SameSite=Lax` cookie limited to `/api/v1/auth`. The simplest and safest approach is to serve
the web app and the API under the **same domain**, with a reverse proxy in front:

```
https://app.yourcompany.com/          → web container (nginx, port 80)
https://app.yourcompany.com/api/      → api container (port 3000)
```

Example with Caddy (it manages certificates by itself):

```
app.yourcompany.com {
    handle /api/* {
        reverse_proxy api:3000
    }
    handle {
        reverse_proxy web:80
    }
}
```

If you prefer separate domains (`app.` and `api.`), they must share a root domain and you must add the web app's
domain to `CORS_ORIGINS`.

The web app has its own security policy (`apps/web/security-headers.conf`): it only allows its own scripts and
cannot be embedded in another page. If the API is on another domain, its origin is already allowed
(`connect-src https:`).

## 4. Configuration (`.env`)

Copy `.env.example` to `.env` and change, at a minimum:

| Variable | Production value |
|---|---|
| `NODE_ENV` | `production` (enables the `Secure` cookie) |
| `POSTGRES_PASSWORD`, `S3_SECRET_KEY` | Your own passwords, long and different from each other |
| `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` | `openssl rand -base64 48` (one for each) |
| `CORS_ORIGINS` | `https://app.yourcompany.com` |
| `VITE_API_URL` | `https://app.yourcompany.com/api/v1` (fixed when the web app is **built**) |
| `API_PUBLIC_URL` | `https://app.yourcompany.com` |
| `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` | `npx web-push generate-vapid-keys`; without them there is no push, everything else works |
| `VAPID_SUBJECT` | A real contact `mailto:` |
| `GEOCODER_USER_AGENT` | Your app's name and a contact (Nominatim requires it) |
| `DEPLOY_MODE` | `demo`, `client` or `open` (section 0) |
| `BASE_PATH`, `VITE_BASE_PATH` | The folder, if there is one (section 2) |
| `DEMO_PASSWORD` | Demo only: the public password of the test accounts |
| `VITE_APP_NAME` | Product name in the installable app and in the title (fixed when the web app is **built**); `HR-Core` if not set |
| `INVITES_PER_DAY` | Invitation emails per company in 24 h (bulk imports included); 200 by default |
| `LEGAL_NAME`, `LEGAL_TAX_ID`, `LEGAL_ADDRESS`, `LEGAL_EMAIL` | Site owner for the legal notice and the privacy policy. On a client's server, the client company |
| `LEGAL_PROVIDER` | Whoever provides the service as data processor (e.g. the company that maintains the server) |
| `APP_PUBLIC_URL` | `https://app.yourcompany.com`: base of the links in emails (invitation and recovery) |
| `EMAIL_DRIVER` | `resend` to really send emails; with `log` they are only written to the API log |
| `RESEND_API_KEY` | [Resend](https://resend.com) key with send permission. It goes in the server's `.env`, never in the repository |
| `EMAIL_FROM` | Sender, e.g. `Time Clock <no-reply@yourcompany.com>` (with Resend, from a verified domain) |
| `EMAIL_REPLY_TO` | Optional: a real address where replies arrive |

Email (`EMAIL_DRIVER=resend`): the sender's domain must be verified in Resend (SPF, DKIM and, recommended, DMARC
records). Three emails are sent: invitation to a company, link to reset the password (single use, expires in 60
minutes) and a password-changed notice. If Resend fails, the action is not blocked: the invitation still has its
link to copy, and the forgotten-password flow responds the same way (it does not reveal whether the account exists).

File storage (`STORAGE_DRIVER`):

- `s3` with the MinIO in `docker-compose.yml` (profile `s3`, see the warning in section 5), or with AWS S3 /
  Cloudflare R2 by changing `S3_ENDPOINT`, `S3_REGION` and the credentials.
  `S3_PUBLIC_ENDPOINT` must be a URL the browser can reach: photos are served with presigned links.
- `local` stores on the API container's disk: mount a volume at `STORAGE_LOCAL_DIR` or you will lose the files when
  it is recreated.

## 5. Starting up

`docker-compose.yml` **publishes no ports** on the server (Docker bypasses the machine's firewall: a published port
is open to the internet). Choose how the reverse proxy reaches it:

- **Proxy in another container** (Caddy, Traefik…): create a shared network once, `docker network create hr-core-proxy`,
  connect the proxy to it and set `COMPOSE_FILE=docker-compose.yml:docker-compose.proxy.yml` in `.env`. The proxy
  reaches the app at `hr-core-web:80` and `hr-core-api:3000`.
- **Proxy installed on the server** (nginx): `COMPOSE_FILE=docker-compose.yml:docker-compose.dev.yml` publishes the
  API and the web app only on `127.0.0.1` (ports `API_PORT` and `WEB_PORT`).

MinIO and its backup only start with `COMPOSE_PROFILES=s3`; with `STORAGE_DRIVER=local` or an external S3, leave it
empty. **That profile could not be tested:** the official `minio/minio` and `minio/mc` images are no longer
published (neither on Docker Hub nor on quay.io) and must be replaced in the compose file with others before you use
it. Each container has a memory limit (`*_MEM_LIMIT` in the compose file).

```bash
docker compose up -d --build
docker compose logs -f api      # you should see «All migrations have been successfully applied»
```

The API applies pending migrations every time it starts. Check `https://app.yourcompany.com/api/v1/health`.

On a client's server (`DEPLOY_MODE=client`), create their company and their first administrator:

```bash
docker compose exec api node dist/cli.js create-organization \
  --name "Construcciones Pérez S.L." --tax-id B12345678 \
  --admin-email jefa@construccionesperez.es --admin-name "Marta Pérez"
```

They receive an email to choose their password (the link is valid for 7 days and is also printed on screen). From
there they invite everyone else.

In the demo, the API seeds the sample company on first start and resets it every night. To do it by hand:
`docker compose exec api node dist/cli.js demo-reset`.

### Scheduled tasks

The API runs them itself (no cron needed). With several instances, each task runs only once per slot. Times follow
`JOBS_TIMEZONE` (`Europe/Madrid` by default); all of them are disabled with `JOBS_ENABLED=false`.

| Task | When | What it does |
|---|---|---|
| `alertas-de-jornada` | every 5 min | Missed clock-ins, working days left open too long and breaks shorter than 12 h |
| `avisos-tras-desconexion` | every 5 min | Sends (push and email) what was held back during disconnection hours |
| `limpiar-nominas-subidas` | every hour | Deletes uploaded payroll PDFs that were not sent within 24 h |
| `restablecer-demo` | 03:00 | Demo only: wipes and re-seeds it |
| `conservacion-de-fotos` | 04:00 | Deletes clock-in photos older than each company's retention period |
| `limpiar-historial-de-tareas` | 04:30 | Deletes run history older than 30 days |
| `alertas-diarias` | 06:00 | More than 9 regular hours yesterday and overtime for the year (70 % and 100 %) |
| `registro-mensual` | 07:00 | From the day each company chooses, sends the previous month's working-time record |
| `resumen-diario` | 08:00 | Email with pending items for supervisors (if enabled) |
| `recordatorios-de-documentos` | 09:00 | Reminders for documents with a deadline |

(Task names are identifiers and stay in Spanish; they translate to: working-day alerts, notices after disconnection,
clean up uploaded payrolls, reset demo, photo retention, clean up task history, daily alerts, monthly record, daily
summary, document reminders.)

## 6. Backups

The compose file includes two services that back up every day, at `BACKUP_HOUR`, into the server's `BACKUP_DIR` folder:

- `backup-db`: `pg_dump` of the database into `backups/db/hr-YYYY-MM-DD.dump`, plus the files if `STORAGE_DRIVER=local`.
  It keeps `BACKUP_KEEP_DAYS` days (14 by default).
- `backup-files`: a mirror of the MinIO bucket in `backups/files/` (photos, receipts and documents). It does not
  delete what was removed from the bucket.

That folder must be copied **off the server** (another machine, external storage): a copy on the same disk does not
protect against its failure. The working-time record must be kept for four years (Spanish labour law).

Check a backup without touching the real data (it restores into another database and counts users and clock-ins):

```bash
infra/backup/restore.sh backups/db/hr-2026-11-12.dump prueba_restauracion
```

Restore for real: `infra/backup/restore.sh backups/db/hr-2026-11-12.dump` (it asks you to type RESTAURAR (restore);
stop the API in the meantime).

## 7. Before using it with real data

- **Maps and addresses.** OpenStreetMap's public servers have usage limits. With real traffic, get a tile provider
  or run your own instances and change `VITE_MAP_TILES_URL` and `GEOCODER_URL`.
- **Outbound proxy.** If the API reaches the internet through a proxy, add `NODE_USE_ENV_PROXY=1`.
- **Reverse proxy.** The API trusts one proxy hop (`trust proxy`) to record the real IP in signatures and audit logs.
  With more hops (CDN + proxy) you need to adjust it in `apps/api/src/main.ts`.
- **Data protection.** The app handles locations, photos, national ID numbers and employment documents. It includes
  base legal pages (`/legal/privacidad`, `/legal/aviso-legal`, `/legal/cookies`), the prior geolocation notice,
  download of one's own data, account deletion, the photo retention period and disconnection hours. They are written
  for Spain (GDPR and Spanish law). Before production: review the texts with your adviser
  (`apps/web/src/legal/texts.ts`), fill in `LEGAL_*`, sign the data processing agreement with the hosting provider
  and adjust the periods on the Company page.
- **Document signing.** It is a simple electronic signature with evidence, not a qualified one.

## 8. Updating

```bash
git pull
docker compose up -d --build
```

Users get the new version of the app when they reopen it (the service worker updates itself).

## 9. Guides by profile

The web app serves `/manuales/manual-trabajadores.pdf`, `manual-responsables.pdf` and `manual-administracion.pdf`
(copied from `docs/manuales/` when the image is built; the guides are in Spanish). Each person receives the one for
their profile by email when they join the company and when their profile changes; administration can resend it from
Team.
