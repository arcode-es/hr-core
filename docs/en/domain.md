# With a domain and HTTPS

[← Documentation](README.md) · [Español](../es/dominio.md)

With this option your staff can sign in from anywhere, on a phone or computer, using an address like
`https://time.yourcompany.com`. The proxy (Caddy) requests and renews the HTTPS certificate by itself with Let's
Encrypt.

You need a prepared server ([Install on a VPS](vps.md), steps 1 to 5) and a domain.

## 1. Point the domain at the server

Use a subdomain of your domain, for example `time.yourcompany.com`. In the panel where you manage DNS (your
registrar, Cloudflare…) create:

| Type | Name | Value |
|---|---|---|
| A | `time` | The server's IPv4 (e.g. `203.0.113.10`) |
| AAAA | `time` | The server's IPv6, if it has one (optional) |

Check that it already resolves (it can take from a few minutes to a couple of hours):

```bash
dig +short time.yourcompany.com       # must return the server's IP
```

> **Cloudflare:** leave the record as **"DNS only" (grey cloud)**. If you turn on the proxy (orange cloud), Let's
> Encrypt and detection of each person's IP (used for login attempt limits) stop working properly.

## 2. Ports

The server must accept connections on ports **80 and 443** from the internet:

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

Some providers also have a firewall in their dashboard: open them there too.

## 3. Install

```bash
cd hr-core
./instalar/instalar.sh
```

- **Access:** `dominio` (domain)
- **Domain:** `time.yourcompany.com` (without `https://`)

The first start requests the certificate; it can take a few seconds. When it finishes, open
`https://time.yourcompany.com`.

If the browser warns about an invalid certificate, check the proxy logs:

```bash
docker logs hr-core-proxy --tail 30
```

Usually the DNS does not point at the server yet, or the ports are closed.

## 4. Give your staff access

1. Sign in with the administrator account and go to **Team**.
2. Invite each person (one by one or by importing a spreadsheet). They receive an email with their link; if email
   is not configured, copy the link and send it to them another way.
3. Each person chooses their password and, on a phone, can **install the app**: on Android, browser menu →
   *Install app*; on iPhone, *Share* → *Add to Home Screen*.

Only people with an invitation can sign in: there is no open sign-up.

## What protects the installation

- Everything is encrypted (HTTPS) and the browser remembers to always use it (HSTS).
- The database, the API and the web app are not exposed: only the proxy listens on the internet.
- Accounts are locked for a while after several failed attempts, and there are per-IP request limits.
- Each person sees only their own data; each manager, their team's.

Keep the server updated (`unattended-upgrades`) and HR-Core too ([Manage → Updating](manage.md#updating)).
