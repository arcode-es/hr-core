# Troubleshooting

[← Documentation](README.md) · [Español](../es/problemas.md)

### The browser says the certificate is not valid (with a domain)

The proxy could not get the certificate. Check `docker logs hr-core-proxy --tail 30`. It is almost always one of:

- The DNS does not point at the server yet: `dig +short your-domain` must return its IP.
- Ports 80 and 443 are closed in `ufw` or in the firewall in the provider's dashboard.
- The domain is behind Cloudflare's proxy (orange cloud): leave it as "DNS only".

Once you have fixed it, restart the proxy: `docker restart hr-core-proxy`.

### `all predefined address pools have been fully subnetted`

Docker has run out of network ranges because the machine has many networks created by other projects. Remove the
unused ones with `docker network prune` (check first what it will delete) or widen the ranges in
`/etc/docker/daemon.json` (`default-address-pools`).

### Emails are not arriving

- With `EMAIL_DRIVER=log` nothing is sent: the links appear in `docker compose logs api`.
- With SMTP, check server, port, user and password. Port 25 is usually blocked on VPS providers: use 587 or 465.
- If the server does not offer encryption, HR-Core does not send (so as not to send passwords in clear text). Only
  for a relay on the same machine or a private network: `SMTP_REQUIRE_TLS=false`.
- If they land in spam: configure SPF and DKIM on the sender's domain.

Sending errors appear in `docker compose logs api | grep -i correo` (the app's log messages are in Spanish; `correo`
means email).

### I can't install the app on my phone, or GPS and camera don't work

The browser only allows them over HTTPS (or on `localhost`). Use access [with a domain](domain.md) or
[with Tailscale](tailscale.md); they do not work with an IP and `http://`.

### With Tailscale, the phone can't open the address

- Tailscale must be **connected** on the phone.
- The person must be in your network or have the machine shared with them.
- On the server, check `tailscale serve status`; if it does not appear, run `./instalar/instalar.sh` again.

### The API won't start

```bash
docker compose logs api --tail 50
```

The message `Variables de entorno no válidas` (invalid environment variables) says which `.env` variable is missing
or wrong. After fixing it: `docker compose up -d`.

### I forgot the administrator password and there is no email

From the server, in the HR-Core folder:

```bash
docker compose exec api node dist/cli.js reset-link --email admin@yourcompany.com
```

It prints a link to choose a new password (valid for 24 hours) and clears the lockout from failed attempts.

### Where do I ask for help?

In the project's [Discussions](https://github.com/arcode-es/hr-core/discussions). For bugs, open an issue with the
steps to reproduce it. If you would rather we take care of everything, [ARcode](https://arcode.es/HR-core/) offers
managed HR-Core.
