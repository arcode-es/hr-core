# Instalar en un VPS

[← Documentación](README.md) · [English](../en/vps.md)

Un VPS es un servidor en la nube que alquilas por meses. Esta guía va desde contratarlo hasta tener HR-Core
funcionando. Después eliges cómo llega la plantilla: [con dominio](dominio.md) o [con Tailscale](tailscale.md).

## 1. Contratar el servidor

Cualquier proveedor sirve (Hetzner, OVHcloud, IONOS, Contabo, DigitalOcean, Scaleway…). Para que los datos de tu
plantilla no salgan de la Unión Europea, elige un **centro de datos en la UE**.

| Plantilla | Tamaño mínimo |
|---|---|
| Hasta 50 personas | 2 vCPU, 4 GB de RAM, 40 GB SSD |
| Hasta 200 personas | 4 vCPU, 8 GB de RAM, 80 GB SSD |

- **Sistema:** Ubuntu Server 24.04 LTS (o Debian 12).
- **Acceso:** añade tu **clave SSH** al crearlo, en vez de usar contraseña. Si no tienes una, créala en tu ordenador
  con `ssh-keygen -t ed25519` y copia el contenido de `~/.ssh/id_ed25519.pub`.
- Activa las **copias del proveedor** si las ofrece: son un seguro extra además de las de HR-Core.
- Firma con el proveedor el **contrato de encargo de tratamiento** (casi todos lo tienen en su panel): alojará datos
  personales de tu plantilla.

Apunta la **dirección IP** del servidor.

## 2. Primer acceso y usuario propio

Desde tu ordenador (sustituye la IP):

```bash
ssh root@203.0.113.10
```

Actualiza el sistema y crea un usuario para trabajar, sin usar `root`:

```bash
apt update && apt upgrade -y
adduser rrhh                       # elige una contraseña
usermod -aG sudo rrhh
rsync --archive --chown=rrhh:rrhh ~/.ssh /home/rrhh   # tu clave SSH también vale para él
```

Comprueba desde otra terminal que `ssh rrhh@203.0.113.10` funciona antes de seguir.

## 3. Cerrar la puerta a las contraseñas

Con la clave ya funcionando, desactiva el acceso por contraseña y el de `root`. Edita
`/etc/ssh/sshd_config` (`sudo nano /etc/ssh/sshd_config`) y deja:

```
PermitRootLogin no
PasswordAuthentication no
```

```bash
sudo systemctl restart ssh
```

## 4. Cortafuegos

```bash
sudo ufw allow OpenSSH
sudo ufw allow 80/tcp     # solo si vas a usar dominio
sudo ufw allow 443/tcp    # solo si vas a usar dominio
sudo ufw enable
```

> Con Tailscale no abras el 80 ni el 443: HR-Core no escucha fuera del propio servidor.

Instala también las actualizaciones de seguridad automáticas:

```bash
sudo apt install -y unattended-upgrades
sudo dpkg-reconfigure --priority=low unattended-upgrades
```

## 5. Docker

```bash
curl -fsSL https://get.docker.com -o instalar-docker.sh
less instalar-docker.sh            # échale un vistazo antes de ejecutarlo
sudo sh instalar-docker.sh
sudo usermod -aG docker rrhh
exit                                # vuelve a entrar para que el grupo surta efecto
```

Comprueba: `docker compose version`.

> **Docker y el cortafuegos:** Docker se salta `ufw` con los puertos que publica. HR-Core solo publica los del proxy
> (80 y 443 con dominio; nada hacia fuera con Tailscale o en local), así que no hay sorpresas. Si instalas otras
> cosas en el mismo servidor, tenlo en cuenta.

## 6. Instalar HR-Core

```bash
sudo apt install -y git
git clone https://github.com/arcode-es/hr-core.git
cd hr-core
./instalar/instalar.sh
```

Responde a las preguntas. Lo que cambia según cómo vaya a entrar la plantilla:

- **Con dominio** → antes de ejecutar el instalador, sigue el paso 1 de [Con dominio y HTTPS](dominio.md).
- **Con Tailscale** → antes, sigue los pasos 1 y 2 de [Red privada con Tailscale](tailscale.md).

Si prefieres no responder por pantalla, copia `instalar/configuracion.env.ejemplo` a `instalar/configuracion.env`,
rellénalo y ejecuta el instalador: tomará las respuestas de ahí.

Al terminar, el instalador muestra el **enlace para que la persona administradora elija su contraseña** (vale 7
días; si configuraste el correo, también le llega por email).

## 7. Copias fuera del servidor

HR-Core hace una copia de la base de datos y de los archivos cada noche en `/var/backups/hr-core` (o la carpeta que
indicaste), pero **en el mismo servidor**. Si el servidor se pierde, se pierden con él. Llévalas a otro sitio:
lee [Gestionar → Copias de seguridad](gestionar.md#copias-de-seguridad).

El registro de jornada debe conservarse **cuatro años** (art. 34.9 del Estatuto de los Trabajadores).
