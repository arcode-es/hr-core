# HR-Core documentation

[Español](../es/README.md)

HR-Core is a time tracking, absence, expense and document app for companies, installed on your own server. This
guide explains how to install it, make it available to your staff, adapt it to your company and keep it running.

## Choose how to install it

| I want to… | Guide |
|---|---|
| Try it on my computer in 5 minutes | [Quick start](quick-start.md) |
| Install it on a cloud server (VPS) | [Install on a VPS](vps.md) |
| Let staff sign in from anywhere at `https://time.yourcompany.com` | [With a domain and HTTPS](domain.md) |
| Allow access only from company devices, with nothing exposed to the internet | [Private network with Tailscale](tailscale.md) |

### Domain or Tailscale?

| | With a domain | With Tailscale |
|---|---|---|
| How staff sign in | From any browser, with their email and password | Only from devices running Tailscale, inside your network |
| What you need | A domain and a server with ports 80 and 443 open | A Tailscale account (there is a free plan for small teams; check their pricing for your headcount) |
| Internet exposure | The app is public (password-protected) | None: the server opens no ports |
| Install the app on a phone, GPS, camera and notifications | Yes | Yes (Tailscale provides HTTPS) |
| Best for | Staff who clock in from sites, routes or their own phone | Small teams or especially sensitive data |

## After installing

- [Customize](customize.md): name, logo, colors, legal details, email, working hours, privacy.
- [Manage](manage.md): adding your staff, backups and restore, updating, logs, moving to another server.
- [Troubleshooting](troubleshooting.md).
- [Advanced options](advanced.md): publishing under a path, your own nginx, S3 storage, every setting.
- [Development and architecture](../es/desarrollo.md) (in Spanish).
- PDF user guides with screenshots, ready to hand out: [employees](../manuales/manual-trabajadores.pdf) (in Spanish),
  [managers](../manuales/manual-responsables.pdf) (in Spanish) and [administration](../manuales/manual-administracion.pdf) (in Spanish).

## Server requirements

| Staff | CPU | Memory | Disk |
|---|---|---|---|
| Up to 50 people | 2 vCPU | 4 GB | 40 GB SSD |
| Up to 200 people | 4 vCPU | 8 GB | 80 GB SSD |

64-bit Linux (Ubuntu Server 24.04 or Debian 12 recommended) with Docker. Images are published for x86 (amd64) and
ARM (arm64) processors.

## Legal notice

HR-Core ships with base privacy and legal notice texts written for Spain (GDPR, the Spanish data protection law
LOPDGDD, and the working-time record required by Spain's Workers' Statute). They are a starting point: **review
them with your adviser** before using the app with your staff. Outside Spain, adapt them to your local law with an
adviser. Whoever installs HR-Core is the data controller for their company's data.

Prefer not to deal with any of this? [ARcode](https://arcode.es/HR-core/) offers managed HR-Core: installation,
server, backups, updates and support.
