# Customize

[← Documentation](README.md) · [Español](../es/personalizar.md)

Almost everything is adjusted from the app itself, with the administrator account, under **Company**. The few
things that depend on the server are in the `.env` file in the HR-Core folder.

## From the app (Company)

| Section | What you can adjust |
|---|---|
| **Company details** | Name, tax ID, address |
| **Company branding** and **Logo** | Trading name, main color and logo, seen by all staff |
| **Working time and clocking** | Lateness tolerance, mandatory photo when clocking in, photo retention period, night hours |
| **Working time alerts** | Alerts for missed clock-ins, long days, short breaks and the overtime cap |
| **Monthly timesheet** | Automatic sending of each month's record so each person can sign it |
| **Export for the payroll provider** | Monthly file with what the accounting firm (*gestoría*) needs for payroll |
| **Expenses** | Your own categories and price per kilometer |
| **Privacy and disconnection** | Geolocation notice text and notification-free hours (right to disconnect) |
| **Working calendar and holidays** | Vacation days, annual and weekly hours |
| **Public holidays** | National, regional and local; the official ones can be imported |
| **Clock-in kiosks** | Shared tablets for clocking in with a PIN or card |

Also from the app: **Locations** (work sites with their radius on the map and their QR poster), **Team**
(people, profiles and departments) and **Schedule** (rosters and rotating shifts).

## From the server (`.env`)

Edit the file with `nano .env` in the HR-Core folder and apply the changes with:

```bash
docker compose up -d
```

> Running `./instalar/instalar.sh` again regenerates the `.env` (keeping the keys). For lasting changes to the
> name, email or legal details, the simplest way is to run the installer again with the new answers.

### App name

```
APP_NAME="Smith & Co Time Clock"
```

It appears in the title, in the app installed on phones and on screens. Maximum 40 characters: letters, numbers,
spaces and `. _ ' ( ) -`. People who already had the app installed will see the new name when they reinstall it.

### Legal details

They appear in the legal notice and the privacy policy (linked from the sign-in screen):

```
LEGAL_NAME="Smith & Co Ltd"
LEGAL_TAX_ID=B12345678
LEGAL_ADDRESS="1 High Street, London"
LEGAL_EMAIL=privacy@yourcompany.com
LEGAL_PROVIDER="Whoever maintains the server, if it is not the company itself"
LEGAL_SUBPROCESSORS="Hetzner Online GmbH (hosting; Germany); Google (email)"
```

The base texts are in `apps/web/src/legal/texts.ts`. They are written for Spain (GDPR and Spanish law): **review
them with your adviser** and adapt them to your local law if you are outside Spain.

### Email

| Variable | What it is for |
|---|---|
| `EMAIL_DRIVER` | `smtp`, `resend` or `log` (no email: links are copied by hand) |
| `EMAIL_FROM` | Sender: `"Time Clock <no-reply@yourcompany.com>"` |
| `EMAIL_REPLY_TO` | Where replies go |
| `SMTP_HOST`, `SMTP_PORT` | Server and port: 587 (STARTTLS) or 465 (TLS) |
| `SMTP_USER`, `SMTP_PASSWORD` | Credentials |
| `RESEND_API_KEY` | [Resend](https://resend.com) key, if you use `resend` |

SMTP examples:

| Provider | Server | Port | Notes |
|---|---|---|---|
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | Use an [app password](https://support.google.com/accounts/answer/185833) |
| Microsoft 365 | `smtp.office365.com` | 587 | Requires SMTP AUTH to be enabled on the mailbox |
| Your hosting | The one they give you | 587 or 465 | |

Email must be sent from a domain with **SPF and DKIM** configured, or it will end up in spam.

### Other options

| Variable | Default | What it is for |
|---|---|---|
| `JOBS_TIMEZONE` | `Europe/Madrid` | Time zone for scheduled tasks (alerts, monthly records) |
| `BACKUP_HOUR`, `BACKUP_KEEP_DAYS`, `BACKUP_DIR` | `02`, `14`, `/var/backups/hr-core` | Daily backups |
| `GEOCODER_URL` | OpenStreetMap Nominatim | Service that turns coordinates into addresses |
| `VITE_MAP_TILES_URL` | OpenStreetMap | Maps (only when you build the web app yourself) |
| `STORAGE_DRIVER` | `local` | `s3` to store photos and documents on S3, Cloudflare R2 or MinIO |
| `HR_CORE_VERSION` | `latest` | Image version |

The full, commented list is in [`.env.example`](../../.env.example).

## Changing the code

HR-Core is free software (AGPL-3.0): you can adapt it. To build your own images:

```bash
docker compose build
docker compose up -d
```

If you offer a modified HR-Core to other people over a network, the license requires you to publish your modified
code. Read [CONTRIBUTING.md](../../CONTRIBUTING.md) if you want to propose your changes to the project.
