# Problemas frecuentes

[← Documentación](README.md) · [English](../en/troubleshooting.md)

### El navegador dice que el certificado no es válido (con dominio)

El proxy no ha podido conseguir el certificado. Mira `docker logs hr-core-proxy --tail 30`. Casi siempre es:

- El DNS aún no apunta al servidor: `dig +short tu-dominio` debe devolver su IP.
- Los puertos 80 y 443 están cerrados en `ufw` o en el cortafuegos del panel del proveedor.
- El dominio está detrás del proxy de Cloudflare (nube naranja): déjalo en «Solo DNS».

Cuando lo corrijas, reinicia el proxy: `docker restart hr-core-proxy`.

### `all predefined address pools have been fully subnetted`

Docker se ha quedado sin rangos de red porque el equipo tiene muchas redes creadas por otros proyectos. Borra las
que no se usan con `docker network prune` (revisa antes qué borra) o amplía los rangos en
`/etc/docker/daemon.json` (`default-address-pools`).

### No llegan los correos

- Con `EMAIL_DRIVER=log` no se envía nada: los enlaces aparecen en `docker compose logs api`.
- Con SMTP, revisa servidor, puerto, usuario y contraseña. El puerto 25 suele estar bloqueado en los VPS: usa 587
  o 465.
- Si el servidor no ofrece cifrado, HR-Core no envía (para no mandar contraseñas en claro). Solo para un relé en la
  misma máquina o red privada: `SMTP_REQUIRE_TLS=false`.
- Si llegan a spam: configura SPF y DKIM en el dominio del remitente.

Los errores de envío aparecen en `docker compose logs api | grep -i correo`.

### No puedo instalar la app en el móvil, o no funcionan el GPS ni la cámara

El navegador solo los permite con HTTPS (o en `localhost`). Usa el acceso [con dominio](dominio.md) o
[con Tailscale](tailscale.md); con una IP y `http://` no funcionan.

### Con Tailscale, el móvil no abre la dirección

- Tailscale debe estar **conectado** en el móvil.
- La persona tiene que estar en tu red o tener la máquina compartida.
- Comprueba en el servidor `tailscale serve status`; si no aparece, repite `./instalar/instalar.sh`.

### La API no arranca

```bash
docker compose logs api --tail 50
```

El mensaje `Variables de entorno no válidas` dice qué variable del `.env` falta o está mal. Tras corregirla:
`docker compose up -d`.

### Olvidé la contraseña de administración y no hay correo

Desde el servidor, en la carpeta de HR-Core:

```bash
docker compose exec api node dist/cli.js reset-link --email jefa@tuempresa.es
```

Muestra un enlace para elegir contraseña nueva (vale 24 horas) y quita el bloqueo por intentos fallidos.

### ¿Dónde pido ayuda?

En las [Discussions del proyecto](https://github.com/arcode-es/hr-core/discussions). Para fallos, abre una
incidencia con los pasos para reproducirlo. Si prefieres que nos ocupemos nosotros de todo,
[ARcode](https://arcode.es/HR-core/) ofrece HR-Core gestionado.
