# Red privada con Tailscale

[← Documentación](README.md) · [English](../en/tailscale.md)

Con esta opción HR-Core **no se publica en internet**: solo se puede entrar desde dispositivos conectados a tu red
privada de [Tailscale](https://tailscale.com), una VPN que se instala en minutos. El servidor no abre ningún puerto
y Tailscale pone el HTTPS (necesario para instalar la app en el móvil, usar el GPS, la cámara y los avisos).

La dirección queda así: `https://fichajes.tu-red.ts.net`.

Necesitas un servidor preparado ([Instalar en un VPS](vps.md), pasos 1 a 5, **sin** abrir los puertos 80 y 443) o
un equipo en tu oficina.

## 1. Crear la red y conectar el servidor

1. Crea una cuenta en [tailscale.com](https://tailscale.com) (con la cuenta de Google o Microsoft de la empresa,
   por ejemplo). Revisa sus planes: hay uno gratuito para equipos pequeños.
2. En el servidor:

   ```bash
   curl -fsSL https://tailscale.com/install.sh -o instalar-tailscale.sh
   less instalar-tailscale.sh          # échale un vistazo
   sudo sh instalar-tailscale.sh
   sudo tailscale up                   # abre el enlace que muestra e inicia sesión
   ```

3. En la [consola de Tailscale](https://login.tailscale.com/admin/machines), cambia el nombre de la máquina a algo
   claro, por ejemplo `fichajes` (menú ⋯ → *Edit machine name*). Ese será el principio de la dirección.

## 2. Activar MagicDNS y HTTPS

En la consola, página **DNS**:

- **MagicDNS:** activado (suele venir activado).
- **HTTPS Certificates:** pulsa *Enable HTTPS*.

Así la máquina tiene un nombre `fichajes.tu-red.ts.net` con certificado válido.

## 3. Instalar HR-Core

```bash
cd hr-core
./instalar/instalar.sh
```

- **Acceso:** `tailscale`

El instalador detecta el nombre de la máquina en Tailscale, deja HR-Core escuchando solo dentro del servidor y lo
publica en tu red con `tailscale serve` (sobrevive a los reinicios). Al terminar te muestra la dirección.

Comprueba que está publicado:

```bash
tailscale serve status
```

## 4. Conectar a la plantilla

Cada dispositivo que vaya a usar HR-Core (móviles, ordenadores, la tableta del quiosco) necesita Tailscale:

1. **Invita a cada persona** a tu red: consola → *Users* → *Invite users*. También puedes compartir solo esta
   máquina con personas que usan su propia cuenta de Tailscale: *Machines* → `fichajes` → *Share*.
2. Cada persona instala Tailscale desde [tailscale.com/download](https://tailscale.com/download) (Android, iPhone,
   Windows, Mac y Linux) e inicia sesión.
3. Con Tailscale conectado, abre `https://fichajes.tu-red.ts.net`, entra con la invitación de HR-Core y, si quiere,
   instala la app en la pantalla de inicio.

> Tailscale tiene que estar **conectado** en el móvil para fichar. Si se desconecta, la app guarda los fichajes
> sin conexión y los envía al volver a conectar.

## 5. (Opcional) Que la plantilla solo vea HR-Core

Por defecto, quien está en tu red Tailscale puede llegar a todos sus equipos. Para que la plantilla solo llegue a
HR-Core:

1. En el servidor, etiquétalo: `sudo tailscale up --advertise-tags=tag:hr-core` (antes, declara la etiqueta en la
   política: `"tagOwners": { "tag:hr-core": ["autogroup:admin"] }`).
2. En **Access controls**, crea un grupo con la plantilla y limita su acceso al puerto 443 de esa máquina:

   ```json
   "groups": { "group:plantilla": ["ana@tuempresa.es", "luis@tuempresa.es"] },
   "grants": [
     { "src": ["autogroup:admin"], "dst": ["*"], "ip": ["*"] },
     { "src": ["group:plantilla"], "dst": ["tag:hr-core"], "ip": ["tcp:443"] }
   ]
   ```

Revisa la [documentación de Tailscale](https://tailscale.com/kb/1393/access-control) antes de cambiar la política:
una regla mal escrita puede dejarte sin acceso a tus propios equipos.

## Avisos en el móvil

Los avisos push funcionan igual: el servidor los envía a través de los servicios de Google y Apple, así que
necesita salida a internet (la tiene por defecto). Lo que no hace falta es que nadie entre desde internet.
