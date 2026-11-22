# Con dominio y HTTPS

[← Documentación](README.md) · [English](../en/domain.md)

Con esta opción la plantilla entra desde cualquier sitio, en el móvil o el ordenador, con una dirección como
`https://fichajes.tuempresa.es`. El certificado HTTPS lo pide y lo renueva solo el proxy (Caddy) con Let's
Encrypt.

Necesitas un servidor preparado ([Instalar en un VPS](vps.md), pasos 1 a 5) y un dominio.

## 1. Apuntar el dominio al servidor

Usa un subdominio de tu dominio, por ejemplo `fichajes.tuempresa.es`. En el panel donde gestionas el DNS (tu
registrador, Cloudflare…) crea:

| Tipo | Nombre | Valor |
|---|---|---|
| A | `fichajes` | La IPv4 del servidor (p. ej. `203.0.113.10`) |
| AAAA | `fichajes` | La IPv6 del servidor, si tiene (opcional) |

Comprueba que ya resuelve (puede tardar desde unos minutos hasta un par de horas):

```bash
dig +short fichajes.tuempresa.es       # debe devolver la IP del servidor
```

> **Cloudflare:** deja el registro en **«Solo DNS» (nube gris)**. Si activas el proxy (nube naranja), Let's Encrypt
> y la detección de la IP de cada persona (los límites de intentos de acceso) dejan de funcionar bien.

## 2. Puertos

El servidor debe aceptar conexiones en los puertos **80 y 443** desde internet:

```bash
sudo ufw allow 80/tcp && sudo ufw allow 443/tcp
```

Algunos proveedores tienen además un cortafuegos en su panel: ábrelos también ahí.

## 3. Instalar

```bash
cd hr-core
./instalar/instalar.sh
```

- **Acceso:** `dominio`
- **Dominio:** `fichajes.tuempresa.es` (sin `https://`)

El primer arranque pide el certificado; puede tardar unos segundos. Al terminar, abre `https://fichajes.tuempresa.es`.

Si el navegador avisa de un certificado no válido, mira los registros del proxy:

```bash
docker logs hr-core-proxy --tail 30
```

Lo habitual es que el DNS aún no apunte al servidor o que los puertos estén cerrados.

## 4. Dar acceso a la plantilla

1. Entra con la cuenta de administración y ve a **Equipo**.
2. Invita a cada persona (una a una o importando una hoja de cálculo). Le llega un correo con su enlace; sin correo
   configurado, copia el enlace y envíaselo por otro medio.
3. Cada persona elige su contraseña y, en el móvil, puede **instalar la app**: en Android, menú del navegador →
   *Instalar aplicación*; en iPhone, *Compartir* → *Añadir a pantalla de inicio*.

Solo entra quien tiene invitación: no hay registro abierto.

## Qué protege la instalación

- Todo va cifrado (HTTPS) y el navegador recuerda que debe usarlo siempre (HSTS).
- La base de datos, la API y la web no están expuestas: solo el proxy escucha en internet.
- Las cuentas se bloquean un rato tras varios intentos fallidos y hay límites de peticiones por IP.
- Cada persona ve solo lo suyo; cada responsable, lo de su equipo.

Mantén el servidor actualizado (`unattended-upgrades`) y HR-Core también ([Gestionar → Actualizar](gestionar.md#actualizar)).
