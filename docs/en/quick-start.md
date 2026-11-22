# Quick start: try it on your computer

[← Documentation](README.md) · [Español](../es/inicio-rapido.md)

In five minutes you will have HR-Core running on your computer, just for you, at `http://localhost:8080`. It lets
you explore it at your own pace before installing it on a server.

## What you need

- **Docker** with the Compose plugin: [Docker Desktop](https://www.docker.com/products/docker-desktop/) on
  Windows or Mac, or [Docker Engine](https://docs.docker.com/engine/install/) on Linux.
- **Git** (or download the code as a ZIP from the project page).

On Windows, run the commands inside WSL (Ubuntu), which Docker Desktop sets up for you.

## Install

```bash
git clone https://github.com/arcode-es/hr-core.git
cd hr-core
./instalar/instalar.sh
```

The installer asks a few questions:

| Question | What to answer to try it out |
|---|---|
| Access | `local` |
| Company, contact email | Your company's (or test ones) |
| Administrator | Your name and your email |
| App name | Whatever you want to see in the app; HR-Core by default |
| Email | `ninguno` (none) |

When it finishes you will see something like this:

```
Enlace para elegir la contraseña (7 días): http://localhost:8080/reset-password?token=…
▸ Hecho
  Aplicación:    http://localhost:8080
```

(The installer output is in Spanish: "Link to choose the password (7 days)", "Done", "Application".)

Open that link, choose your password and you are in as an administrator.

## First steps inside the app

1. **Company** → upload the logo and pick the color.
2. **Locations** → create your office or site on the map (this is how you check where people clock in).
3. **Team** → invite someone. If email is not configured, copy the invitation link and open it in another private
   browser window to see the app as that person.
4. **Clock** → try starting and ending a working day.

The PDF guides explain every screen (in Spanish): [employees](../manuales/manual-trabajadores.pdf) (in Spanish),
[managers](../manuales/manual-responsables.pdf) (in Spanish) and [administration](../manuales/manual-administracion.pdf) (in Spanish).

## Turn it off or delete it

```bash
docker compose stop                     # turn off (data is kept)
docker compose start                    # turn it back on
docker compose down -v                  # delete the app and ALL its data
docker rm -f hr-core-proxy              # and the proxy
```

## What's next?

When you want to use it for real with your staff, install it on a server: [Install on a VPS](vps.md).
