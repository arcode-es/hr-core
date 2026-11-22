# Personalizar

[← Documentación](README.md) · [English](../en/customize.md)

Casi todo se ajusta desde la propia aplicación, con la cuenta de administración, en **Empresa**. Lo poco que
depende del servidor está en el archivo `.env` de la carpeta de HR-Core.

## Desde la aplicación (Empresa)

| Apartado | Qué se ajusta |
|---|---|
| **Datos de la empresa** | Nombre, NIF, dirección |
| **Marca de la empresa** y **Logotipo** | Nombre comercial, color principal y logotipo, que ve toda la plantilla |
| **Jornada y fichaje** | Tolerancia de retraso, foto obligatoria al fichar, plazo de conservación de las fotos, horario nocturno |
| **Alertas de jornada** | Avisos por no fichar, jornadas largas, descansos cortos y tope de horas extra |
| **Registro mensual de jornada** | Envío automático del registro de cada mes para que cada persona lo firme |
| **Exportación para la gestoría** | Archivo mensual con lo que necesita la asesoría para las nóminas |
| **Gastos** | Categorías propias y precio por kilómetro |
| **Privacidad y desconexión** | Texto del aviso de geolocalización y horario sin avisos (derecho a la desconexión) |
| **Calendario laboral y vacaciones** | Días de vacaciones, horas anuales y semanales |
| **Festivos** | Nacionales, autonómicos y locales; se pueden importar los oficiales |
| **Quioscos de fichaje** | Tabletas compartidas para fichar con PIN o tarjeta |

También desde la app: **Ubicaciones** (centros de trabajo con su radio en el mapa y su cartel QR), **Equipo**
(personas, perfiles y departamentos) y **Horario** (cuadrantes y turnos rotativos).

## Desde el servidor (`.env`)

Edita el archivo con `nano .env` en la carpeta de HR-Core y aplica los cambios con:

```bash
docker compose up -d
```

> Al repetir `./instalar/instalar.sh` el `.env` se vuelve a generar (conservando las claves). Para cambios
> duraderos de nombre, correo o datos legales, lo más sencillo es repetir el instalador con las respuestas nuevas.

### Nombre de la aplicación

```
APP_NAME="Fichajes Talleres López"
```

Aparece en el título, en la app instalada en el móvil y en las pantallas. Máximo 40 caracteres: letras, números,
espacios y `. _ ' ( ) -`. Quien ya tenía la app instalada verá el nombre nuevo al volver a instalarla.

### Datos legales

Salen en el aviso legal y en la política de privacidad (enlazados en la pantalla de acceso):

```
LEGAL_NAME="Talleres López S.L."
LEGAL_TAX_ID=B12345678
LEGAL_ADDRESS="Calle Mayor 1, 14001 Córdoba"
LEGAL_EMAIL=privacidad@talleres-lopez.es
LEGAL_PROVIDER="Quien mantiene el servidor, si no es la propia empresa"
LEGAL_SUBPROCESSORS="Hetzner Online GmbH (alojamiento; Alemania); Google (correo)"
```

Los textos base están en `apps/web/src/legal/texts.ts`: **revísalos con tu asesoría**.

### Correo

| Variable | Para qué |
|---|---|
| `EMAIL_DRIVER` | `smtp`, `resend` o `log` (sin correo: los enlaces se copian a mano) |
| `EMAIL_FROM` | Remitente: `"Fichajes <no-reply@tuempresa.es>"` |
| `EMAIL_REPLY_TO` | Dónde llegan las respuestas |
| `SMTP_HOST`, `SMTP_PORT` | Servidor y puerto: 587 (STARTTLS) o 465 (TLS) |
| `SMTP_USER`, `SMTP_PASSWORD` | Credenciales |
| `RESEND_API_KEY` | Clave de [Resend](https://resend.com), si usas `resend` |

Ejemplos de SMTP:

| Proveedor | Servidor | Puerto | Notas |
|---|---|---|---|
| Google Workspace / Gmail | `smtp.gmail.com` | 587 | Usa una [contraseña de aplicación](https://support.google.com/accounts/answer/185833) |
| Microsoft 365 | `smtp.office365.com` | 587 | Requiere tener activado SMTP AUTH en el buzón |
| Tu hosting | El que te indique | 587 o 465 | |

El correo debe salir de un dominio con **SPF y DKIM** configurados, o acabará en spam.

### Otras opciones

| Variable | Por defecto | Para qué |
|---|---|---|
| `JOBS_TIMEZONE` | `Europe/Madrid` | Zona horaria de las tareas programadas (alertas, registros mensuales) |
| `BACKUP_HOUR`, `BACKUP_KEEP_DAYS`, `BACKUP_DIR` | `02`, `14`, `/var/backups/hr-core` | Copias diarias |
| `GEOCODER_URL` | OpenStreetMap Nominatim | Servicio que convierte coordenadas en direcciones |
| `VITE_MAP_TILES_URL` | OpenStreetMap | Mapas (solo al compilar la web tú mismo) |
| `STORAGE_DRIVER` | `local` | `s3` para guardar fotos y documentos en S3, Cloudflare R2 o MinIO |
| `HR_CORE_VERSION` | `latest` | Versión de las imágenes |

La lista completa, comentada, está en [`.env.example`](../../.env.example).

## Cambiar el código

HR-Core es software libre (AGPL-3.0): puedes adaptarlo. Para compilar tus propias imágenes:

```bash
docker compose build
docker compose up -d
```

Si ofreces HR-Core modificado a otras personas a través de la red, la licencia te obliga a publicar tu código
modificado. Lee [CONTRIBUTING.md](../../CONTRIBUTING.md) si quieres proponer tus cambios al proyecto.
