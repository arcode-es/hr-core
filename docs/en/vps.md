# Install on a VPS

[← Documentation](README.md) · [Español](../es/vps.md)

A VPS is a cloud server that you rent by the month. This guide goes from renting it to having HR-Core running.
Afterwards you choose how your staff will reach it: [with a domain](domain.md) or [with Tailscale](tailscale.md).

## 1. Get the server

Any provider will do (Hetzner, OVHcloud, IONOS, Contabo, DigitalOcean, Scaleway…). To keep your staff's data inside
the European Union, choose a **data center in the EU**.

| Staff | Minimum size |
|---|---|
| Up to 50 people | 2 vCPU, 4 GB RAM, 40 GB SSD |
| Up to 200 people | 4 vCPU, 8 GB RAM, 80 GB SSD |

- **System:** Ubuntu Server 24.04 LTS (or Debian 12).
- **Access:** add your **SSH key** when creating it, instead of using a password. If you don't have one, create it
  on your computer with `ssh-keygen -t ed25519` and copy the contents of `~/.ssh/id_ed25519.pub`.
- Turn on the **provider's backups** if they offer them: they are an extra safety net on top of HR-Core's own.
- Sign the **data processing agreement** with the provider (almost all have it in their dashboard): it will host
  your staff's personal data.

Note the server's **IP address**.

## 2. First login and your own user

From your computer (replace the IP):

```bash
ssh root@203.0.113.10
```

Update the system and create a user to work with, instead of using `root`:

```bash
apt update && apt upgrade -y
adduser hr                         # choose a password
usermod -aG sudo hr
rsync --archive --chown=hr:hr ~/.ssh /home/hr   # your SSH key works for it too
```

Check from another terminal that `ssh hr@203.0.113.10` works before continuing.

## 3. Close the door on passwords

Once the key works, turn off password login and `root` login. Edit `/etc/ssh/sshd_config`
(`sudo nano /etc/ssh/sshd_config`) and set:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

## 4. Firewall

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp     # only if you will use a domain
sudo ufw allow 443/tcp    # only if you will use a domain
sudo ufw enable
```

> With Tailscale, do not open 80 or 443: HR-Core does not listen outside the server itself.

Also install automatic security updates:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

## 5. Docker

```bash
curl -fsSL https://get.docker.com -o instalar-docker.sh
less instalar-docker.sh            # have a look at it before running it
sudo sh instalar-docker.sh
sudo usermod -aG docker hr
exit                                # log back in so the group takes effect
```

Check: `docker compose version`.

> **Docker and the firewall:** Docker bypasses `ufw` for the ports it publishes. HR-Core only publishes the proxy's
> ports (80 and 443 with a domain; nothing outward with Tailscale or locally), so there are no surprises. If you
> install other things on the same server, keep this in mind.

## 6. Install HR-Core

```bash
sudo apt install -y git
git clone https://github.com/arcode-es/hr-core.git
cd hr-core
./instalar/instalar.sh
```

Answer the questions. What changes depending on how your staff will sign in:

- **With a domain** → before running the installer, follow step 1 of [With a domain and HTTPS](domain.md).
- **With Tailscale** → before, follow steps 1 and 2 of [Private network with Tailscale](tailscale.md).

If you would rather not answer on screen, copy `instalar/configuracion.env.ejemplo` to
`instalar/configuracion.env`, fill it in and run the installer: it will take the answers from there.

When it finishes, the installer shows the **link for the administrator to choose their password** (valid for 7
days; if you configured email, it is also sent by email).

## 7. Backups off the server

HR-Core makes a copy of the database and files every night in `/var/backups/hr-core` (or the folder you chose), but
**on the same server**. If the server is lost, they are lost with it. Take them somewhere else: read
[Manage → Backups](manage.md#backups).

Working-time records must be kept for **four years** (art. 34.9 of Spain's Workers' Statute).
