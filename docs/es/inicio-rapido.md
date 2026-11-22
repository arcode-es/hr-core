# Inicio rápido: probarlo en tu ordenador

[← Documentación](README.md) · [English](../en/quick-start.md)

En cinco minutos tendrás HR-Core funcionando en tu ordenador, solo para ti, en `http://localhost:8080`. Sirve para
verlo con calma antes de instalarlo en un servidor.

## Lo que necesitas

- **Docker** con el complemento Compose: [Docker Desktop](https://www.docker.com/products/docker-desktop/) en
  Windows o Mac, o [Docker Engine](https://docs.docker.com/engine/install/) en Linux.
- **Git** (o descargar el código en ZIP desde la página del proyecto).

En Windows, ejecuta los comandos dentro de WSL (Ubuntu), que Docker Desktop configura por ti.

## Instalar

```bash
git clone https://github.com/arcode-es/hr-core.git
cd hr-core
./instalar/instalar.sh
```

El instalador te pregunta unas pocas cosas:

| Pregunta | Qué responder para probar |
|---|---|
| Acceso | `local` |
| Empresa, correo de contacto | Los de tu empresa (o unos de prueba) |
| Persona administradora | Tu nombre y tu correo |
| Nombre de la aplicación | El que quieras ver en la app; por defecto HR-Core |
| Correo | `ninguno` |

Al terminar verás algo así:

```
Enlace para elegir la contraseña (7 días): http://localhost:8080/reset-password?token=…
▸ Hecho
  Aplicación:    http://localhost:8080
```

Abre ese enlace, elige tu contraseña y ya estás dentro como administración.

## Primeros pasos dentro de la app

1. **Empresa** → sube el logotipo y elige el color.
2. **Ubicaciones** → crea tu oficina u obra en el mapa (sirve para comprobar dónde se ficha).
3. **Equipo** → invita a alguien. Sin correo configurado, copia el enlace de la invitación y ábrelo en otra
   ventana privada del navegador para ver la app como esa persona.
4. **Fichar** → prueba a iniciar y terminar una jornada.

Los manuales en PDF explican cada pantalla: [trabajadores](../manuales/manual-trabajadores.pdf),
[responsables](../manuales/manual-responsables.pdf) y [administración](../manuales/manual-administracion.pdf).

## Apagarlo o borrarlo

```bash
docker compose stop                     # apagar (los datos se conservan)
docker compose start                    # volver a encenderlo
docker compose down -v                  # borrar la app y TODOS sus datos
docker rm -f hr-core-proxy              # y el proxy
```

## ¿Y ahora?

Cuando quieras usarlo de verdad con tu plantilla, instálalo en un servidor: [Instalar en un VPS](vps.md).
