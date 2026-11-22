# Private network with Tailscale

[← Documentation](README.md) · [Español](../es/tailscale.md)

With this option HR-Core is **not published on the internet**: it can only be reached from devices connected to your
private [Tailscale](https://tailscale.com) network, a VPN that installs in minutes. The server opens no ports, and
Tailscale provides the HTTPS (required to install the app on a phone and to use GPS, the camera and notifications).

The address ends up like this: `https://time.your-tailnet.ts.net`.

You need a prepared server ([Install on a VPS](vps.md), steps 1 to 5, **without** opening ports 80 and 443) or a
machine in your office.

## 1. Create the network and connect the server

1. Create an account at [tailscale.com](https://tailscale.com) (for example with the company's Google or Microsoft
   account). Check their plans: there is a free one for small teams.
2. On the server:

   ```bash
   curl -fsSL https://tailscale.com/install.sh -o instalar-tailscale.sh
   less instalar-tailscale.sh          # have a look at it
   sudo sh instalar-tailscale.sh
   sudo tailscale up                   # open the link it shows and sign in
   ```

3. In the [Tailscale admin console](https://login.tailscale.com/admin/machines), rename the machine to something
   clear, for example `time` (⋯ menu → *Edit machine name*). That will be the start of the address.

## 2. Turn on MagicDNS and HTTPS

In the console, on the **DNS** page:

- **MagicDNS:** enabled (it usually is by default).
- **HTTPS Certificates:** click *Enable HTTPS*.

This gives the machine a name `time.your-tailnet.ts.net` with a valid certificate.

## 3. Install HR-Core

```bash
cd hr-core
./instalar/instalar.sh
```

- **Access:** `tailscale`

The installer detects the machine's Tailscale name, makes HR-Core listen only inside the server, and publishes it
on your network with `tailscale serve` (it survives reboots). When it finishes it shows you the address.

Check that it is published:

```bash
tailscale serve status
```

## 4. Connect your staff

Every device that will use HR-Core (phones, computers, the kiosk tablet) needs Tailscale:

1. **Invite each person** to your network: console → *Users* → *Invite users*. You can also share just this
   machine with people who use their own Tailscale account: *Machines* → `time` → *Share*.
2. Each person installs Tailscale from [tailscale.com/download](https://tailscale.com/download) (Android, iPhone,
   Windows, Mac and Linux) and signs in.
3. With Tailscale connected, open `https://time.your-tailnet.ts.net`, sign in with the HR-Core invitation and, if
   they want, install the app on their home screen.

> Tailscale must be **connected** on the phone to clock in. If it disconnects, the app stores clock-ins offline
> and sends them when it reconnects.

## 5. (Optional) Let staff see only HR-Core

By default, anyone on your Tailscale network can reach all of its machines. To let staff reach only HR-Core:

1. On the server, tag it: `sudo tailscale up --advertise-tags=tag:hr-core` (first, declare the tag in the policy:
   `"tagOwners": { "tag:hr-core": ["autogroup:admin"] }`).
2. In **Access controls**, create a group with your staff and limit their access to port 443 of that machine:

   ```json
   "groups": { "group:staff": ["ana@yourcompany.com", "luis@yourcompany.com"] },
   "grants": [
     { "src": ["autogroup:admin"], "dst": ["*"], "ip": ["*"] },
     { "src": ["group:staff"], "dst": ["tag:hr-core"], "ip": ["tcp:443"] }
   ]
   ```

Read the [Tailscale documentation](https://tailscale.com/kb/1393/access-control) before changing the policy: a
badly written rule can lock you out of your own machines.

## Notifications on the phone

Push notifications work the same way: the server sends them through Google's and Apple's services, so it needs
outbound internet access (it has it by default). What is not needed is for anyone to connect in from the internet.
