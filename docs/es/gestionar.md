# Gestionar

[← Documentación](README.md) · [English](../en/manage.md)

Todo se hace desde la carpeta de HR-Core en el servidor (`cd hr-core`).

## La plantilla

| Para | Dónde |
|---|---|
| Dar de alta a una persona | **Equipo** → *Invitar*. Le llega un enlace que vale 7 días |
| Dar de alta a muchas | **Equipo** → *Importar plantilla*, desde una hoja de cálculo |
| Cambiar el perfil (empleado, responsable, administración, inspección) | **Equipo** → la persona |
| Dar de baja | **Equipo** → la persona → desactivar. Sus registros se conservan, como exige la ley |
| Organizar por departamentos | **Equipo** → *Departamentos*. Cada responsable ve solo a su gente |
| Reenviar el manual de uso | **Equipo** → la persona → *Enviar el manual de su perfil* |

Perfiles:

- **Empleado:** ficha, ve su horario, pide ausencias, sube gastos y firma documentos.
- **Responsable:** además, valida jornadas, organiza el cuadrante y aprueba ausencias y gastos de su equipo.
- **Administración:** además, configura la empresa, invita, saca informes y gestiona nóminas.
- **Inspección:** solo lectura del registro de jornada (Inspección de Trabajo o representación legal).

## Estado y registros

```bash
docker compose ps                         # qué está en marcha
docker compose logs -f api                # registro de la API (Ctrl+C para salir)
docker logs hr-core-proxy --tail 50       # registro del proxy
curl -s http://127.0.0.1:8080/api/v1/health   # con Tailscale o en local; con dominio: https://tu-dominio/api/v1/health
```

## Copias de seguridad

Cada noche (02:00 UTC por defecto) el contenedor `backup-db` guarda en la carpeta de copias:

- `db/hr-AAAA-MM-DD.dump`: la base de datos completa.
- `storage/storage-AAAA-MM-DD.tar.gz`: fotos, tickets y documentos.

Se conservan 14 días (`BACKUP_KEEP_DAYS`). **Están en el mismo servidor**: llévalas a otro sitio. Por ejemplo,
cada noche a las 03:30 a otro servidor con `rsync` (en `crontab -e` del usuario root):

```
30 3 * * * rsync -a --delete /var/backups/hr-core/ copias@otro-servidor:/copias/hr-core/
```

O a un almacenamiento compatible con S3 con [rclone](https://rclone.org/), o sincronizándolas con un NAS de la
oficina. El registro de jornada se conserva **cuatro años**: guarda alguna copia mensual durante ese tiempo.

### Comprobar una copia (sin tocar los datos)

```bash
infra/backup/restore.sh /var/backups/hr-core/db/hr-2026-11-20.dump prueba_restauracion
```

La restaura en una base aparte y muestra cuántos usuarios y fichajes tiene. Hazlo de vez en cuando: una copia que
no se ha probado no es una copia.

### Restaurar

```bash
infra/backup/restore.sh /var/backups/hr-core/db/hr-2026-11-20.dump
```

Pide escribir `RESTAURAR` y **sustituye** todos los datos actuales por los de la copia. Para los archivos:

```bash
docker compose stop api
docker run --rm -v hr-core_api_storage:/destino -v /var/backups/hr-core/storage:/copias:ro alpine \
  sh -c 'rm -rf /destino/* && tar -xzf /copias/storage-2026-11-20.tar.gz -C /destino'
docker compose start api
```

(El volumen se llama `<proyecto>_api_storage`; compruébalo con `docker volume ls`.)

## Actualizar

```bash
./instalar/actualizar.sh            # a la última versión
./instalar/actualizar.sh 1.2.0      # a una versión concreta
```

Hace una copia de la base de datos, descarga las imágenes nuevas y reinicia; los cambios en la base de datos se
aplican solos. Lee antes las [notas de la versión](../../CHANGELOG.md). Para volver atrás: `./instalar/actualizar.sh`
con la versión anterior y, si la nueva cambió la base de datos, restaurar la copia `antes-de-actualizar-…` que hizo.

Avisos de versiones nuevas: en GitHub, *Watch* → *Custom* → *Releases*.

## Mover a otro servidor

1. En el servidor nuevo: prepara el sistema y clona HR-Core ([VPS](vps.md), pasos 1 a 6) **sin** ejecutar aún el
   instalador.
2. Copia desde el antiguo el `.env` (contiene las claves: sin ellas no valen las sesiones ni el cifrado de los
   avisos) y `instalar/configuracion.env` si lo usaste.
3. En el antiguo, para la API y haz una copia al momento:

   ```bash
   docker compose stop api
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -Fc "$POSTGRES_DB"' > hr-traslado.dump
   docker run --rm -v hr-core_api_storage:/origen:ro alpine tar -czf - -C /origen . > storage-traslado.tar.gz
   ```

   y lleva los dos archivos al servidor nuevo (con `scp`).
4. En el nuevo: ejecuta `./instalar/instalar.sh`, restaura la base de datos y los archivos como en *Restaurar*.
5. Cambia el DNS (con dominio) o el nombre de la máquina en Tailscale, y apaga el antiguo.

## Desinstalar

```bash
docker compose down -v          # borra la app y TODOS sus datos (las copias de la carpeta de copias se quedan)
docker rm -f hr-core-proxy
tailscale serve reset           # solo con Tailscale
```
