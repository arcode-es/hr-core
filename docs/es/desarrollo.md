# HR-Core · desarrollo y arquitectura

[← Documentación](README.md)

Plataforma propia de **control horario geolocalizado, cuadrantes, gastos/dietas y gestión documental con firma**, pensada para trabajo de campo: rápida, fiable sin cobertura (*offline-first*) y utilizable tanto en **modo personal** (registro propio del trabajador) como **corporativo** (equipos gestionados por responsables).

## Estructura

```
hr-gestion/
├── docker-compose.yml        Postgres+PostGIS, MinIO, API, web y copias de seguridad
├── .env.example              Toda la configuración (copiar a .env)
├── infra/postgres/init.sql   Extensiones al crear el volumen
├── infra/backup/             Copias diarias y restauración
├── .github/workflows/ci.yml  Pruebas en cada cambio
├── apps/e2e/              Recorridos de navegador (Playwright)
├── docs/manuales/         Manuales en PDF por perfil y cómo regenerarlos
├── packages/
│   └── shared/               Enumerados y tipos comunes a API y web
└── apps/
    ├── api/                  NestJS + Prisma
    │   ├── prisma/
    │   │   ├── schema.prisma
    │   │   └── migrations/   SQL versionado (incluye PostGIS y triggers)
    │   └── src/
    │       ├── config/       Validación del entorno
    │       ├── prisma/       Acceso a datos
    │       ├── auth/         Sesión JWT, guard de espacio y roles
    │       ├── account/      Perfil y espacios del usuario
    │       ├── organizations/ Empresas, miembros e invitaciones
    │       ├── locations/    Ubicaciones y evaluación de geocercas
    │       ├── reports/      Informes mensuales en PDF, Excel y CSV
    │       ├── shifts/       Cuadrantes: turnos, publicación y copia entre semanas
    │       ├── documents/    Envío, seguimiento y firma estampada en PDF
    │       ├── expenses/     Gastos, aprobación y liquidación
    │       ├── notifications/ Avisos en la app y Web Push
│       ├── mail/         Correo (Resend o registro) y plantillas
│       ├── deployment/   Modo de instalación (demo, cliente, abierta) y ruta base
│       ├── demo/         Empresa de demostración y su reinicio nocturno
│       ├── install/      Alta de la empresa en el servidor de un cliente (cli.ts)
│       ├── jobs/         Tareas programadas, una sola ejecución por turno
│       ├── privacy/      Aviso de geolocalización, exportar datos, baja y plazo de las fotos
│       ├── absences/     Festivos (importación de los oficiales) y ausencias con aprobación
    │       ├── dashboard/    Panel de pendientes
    │       ├── ocr/          Lectura de tickets: interfaz y proveedor por defecto
    │       ├── time/         Motor de fichaje (máquina de estados de la jornada)
    │       ├── storage/      Archivos privados: S3 o disco, con enlaces firmados
    │       ├── geo/          Direcciones (Nominatim) con caché y límite de uso
    │       └── health/       Estado y hora oficial del servidor
    └── web/                  React + Vite + Tailwind (PWA)
        └── src/
            ├── ui/           Sistema de diseño (componentes base)
            ├── app/          Navegación y selector de espacio
            ├── pages/        Pantallas
            ├── stores/       Sesión, tema y avisos
            ├── i18n/         Español e inglés
            └── lib/          Cliente de la API
```

## Puesta en marcha

Requisitos: Node 22+, pnpm 10+, Docker.

```bash
cp .env.example .env
pnpm install
pnpm infra:up        # Postgres+PostGIS (los archivos van al disco: STORAGE_DRIVER=local)
pnpm db:deploy       # aplica las migraciones
pnpm dev             # API en :3000, web en :5173
# Para probar la app instalable y el modo sin conexión (service worker):
pnpm --filter @hr/web build && pnpm --filter @hr/web preview   # web en :4173
```

Todo en contenedores: `pnpm docker:up` (puertos solo en 127.0.0.1; la API aplica las migraciones al arrancar).

| Servicio | URL |
|---|---|
| Web | http://localhost:5173 |
| API | http://localhost:3000/api/v1/health |
| Consola de MinIO | http://localhost:9001 |

## Pruebas

```bash
pnpm typecheck
pnpm test            # API: unitarios e integración contra la base de datos local
# Opcional: prueba también el driver S3 contra MinIO o un emulador
S3_TEST_ENDPOINT=http://localhost:9000 pnpm test

# Recorridos de navegador de extremo a extremo (apps/e2e), contra la app compilada
pnpm build && pnpm db:deploy
pnpm e2e             # arranca API y web si no están en marcha
```

Los recorridos cubren la demo publicada bajo `/HR-core` (con la política de seguridad de producción), acceso y sesión, recuperación de contraseña e invitación por correo, empresa e invitaciones, fichaje con GPS y foto, jornadas manuales y validación,
ubicaciones, cuadrantes y bolsa de horas, ausencias y festivos, privacidad, QR de ubicación, foto obligatoria, quiosco con PIN,
alertas de jornada, alta masiva, departamentos, reparto de nóminas, registro mensual, avisos por correo, gestoría, coste por obra, marca del cliente, turnos rotativos, gastos y liquidación, documentos y firma, modo sin conexión, informes, avisos y una auditoría de accesibilidad WCAG 2 A/AA. No dependen de internet. Necesitan Chromium y Playwright instalados.

## Decisiones de arquitectura

- **Sesión.** Token de acceso JWT de 15 min guardado solo en memoria; token de renovación rotatorio en cookie `httpOnly` limitada a `/api/v1/auth`. Reutilizar un token ya rotado revoca toda su cadena.
- **Espacio activo.** El cliente envía `X-Workspace` (`personal` o el id de la organización). La API comprueba la pertenencia en cada petición, así que desactivar a un miembro corta su acceso al instante.
- **Temas.** Los componentes solo usan tokens semánticos (`bg-surface`, `text-fg-muted`…) definidos en `apps/web/src/index.css`; claro, oscuro y «Sol» (alto contraste para exteriores) salen del mismo sitio.

- **Una cuenta, varios espacios.** `users` no lleva `organization_id`: la tabla `memberships` une usuario y organización con un rol (`ADMIN`, `MANAGER`, `EMPLOYEE`, `INSPECTOR`). El espacio personal son las filas con `organization_id` nulo. El administrador de plataforma es `users.is_superadmin`.
- **Jornada = tramos.** Cada fila de `time_entries` es un tramo (`WORK`, `BREAK`, `TRAVEL`); los tramos de una jornada comparten `workday_id`. Solo puede haber un tramo abierto por usuario y espacio.
- **Hora oficial del servidor.** `start_time`/`end_time` los fija el servidor; la hora del dispositivo se guarda aparte (`client_*_time`) para detectar desfases. Los eventos offline llevan `client_uuid` para sincronizar sin duplicados.
- **Nada se borra.** Un trigger impide borrar fichajes y modificar o borrar `time_entry_audits`. Corregir una jornada anula sus tramos (`voided_at`) y crea otros nuevos con origen `MANUAL`; cada paso deja una fila de auditoría con autor, valores anterior y nuevo, motivo e IP.
- **Validación.** En una empresa, lo que declara o corrige un empleado queda `PENDING` y no sustituye a la jornada original hasta que un responsable lo aprueba. Nadie valida sus propios registros. En el espacio personal y para responsables se aplica al momento.
- **Geocercas en PostGIS.** `locations.geom` (geography) se deriva por trigger de latitud/longitud y tiene índice GiST. Al evaluar una posición, la imprecisión del GPS cuenta a favor del trabajador, con un tope de 50 m.
- **Mapas sin coste de API.** Teselas de OpenStreetMap y direcciones de Nominatim, ambas configurables (`VITE_MAP_TILES_URL`, `GEOCODER_URL`). Los servidores públicos de OSM tienen límites de uso: para producción con tráfico real conviene un proveedor de teselas o una instancia propia.
- **Archivos privados.** En base de datos se guarda la clave del objeto, no una URL; los archivos solo se leen con enlaces firmados que caducan. `STORAGE_DRIVER` elige entre S3 (MinIO, AWS, R2) y disco local.
- **Cuadrantes.** Un turno nace como borrador y el empleado solo lo ve al publicarse. Copiar una semana conserva la hora local aunque haya cambio de hora. Con turno asignado, la geocerca al fichar es la de su ubicación, no la más cercana.
- **Festivos y ausencias.** Los festivos nacionales y autonómicos se importan de Nager.Date (servicio público) según la comunidad de la empresa; los locales se añaden a mano y pueden afectar solo a una ubicación (otro municipio). Las vacaciones se cuentan en días laborables o naturales según la empresa, y cada persona puede tener sus propios días; las bajas, en naturales. Lo que pide un empleado queda pendiente; lo que registra un responsable, aprobado. Al aprobar se avisa de los turnos publicados esos días y se pueden quitar. En la bolsa de horas, un turno en festivo o en ausencia aprobada no cuenta como previsto (en ausencia, son horas justificadas), y el informe mensual anota cada día y compara con la jornada anual del convenio.
- **Bolsas de horas.** Cada jornada se imputa al día local en que empieza. Lo trabajado hasta lo planificado es ordinario y el resto extraordinario; las nocturnas son las trabajadas en el tramo configurado (22:00–06:00 por defecto). Solo cuentan jornadas aprobadas y turnos publicados; sin ningún turno en el periodo, todo es ordinario.
- **Gastos.** El de un empleado nace pendiente; nadie aprueba lo suyo. Aprobado o pagado ya no se edita. El kilometraje lo calcula el servidor con la tarifa de la empresa (`mileageRatePerKm`, 0,26 €/km por defecto). La foto se comprime en el móvil por debajo de 1 MB.
- **OCR preparado, no activo.** `OcrProvider` define el contrato; el proveedor por defecto no propone nada (no inventa importes). Conectar uno real es implementar esa clase y registrarla en `ocr.module.ts`.
- **Documentos y firma.** El archivo se guarda una vez y se crea una fila por destinatario. El PDF firmado conserva el original intacto, añade una línea de firma al pie de cada página y una página final de certificado con la rúbrica, nombre, DNI, fecha, IP, navegador y SHA-256 del original; antes de firmar se comprueba que el archivo guardado coincide con ese hash. Es una firma electrónica simple con evidencias, no una firma con certificado cualificado. El visor recibe el archivo a través de la API con la sesión del usuario, así que no hace falta exponer el almacenamiento al navegador.
- **Sin conexión.** Fichajes y gastos nuevos se guardan en una cola en IndexedDB (`apps/web/src/lib/outbox.ts`) y se envían en orden al volver la red, al reabrir la app o cada 20 s. Cada acción lleva un identificador único y el servidor la aplica una sola vez (`clock_events`, `expenses.client_uuid`). Un fichaje sin conexión conserva su hora real, acotada por el servidor, y queda marcado como tal. El service worker guarda la aplicación para que abra sin red; no se usa Background Sync, que no existe en iOS.
- **Informes.** Se generan al pedirlos, en español y con la zona horaria de la empresa; solo incluyen jornadas aprobadas. El CSV neutraliza las celdas que empezarían una fórmula.
- **Tipos de instalación.** `DEPLOY_MODE=demo` es la demo pública (sin registro ni correo, acceso de un clic, se restablece cada noche); `client`, el servidor de un cliente (una empresa, alta solo con invitación); `open`, registro libre con verificación del correo. Ver [avanzado.md](avanzado.md).
- **Demo que se restablece.** Los fichajes no se pueden borrar por trigger. La única excepción es la empresa marcada como demo (`organizations.is_demo`), y solo en una transacción que active `hr.demo_purge`: las empresas reales siguen igual de protegidas.
- **Tareas programadas.** Un programador propio (`apps/api/src/jobs`) mira cada minuto qué toca. Antes de ejecutar una tarea reserva su turno en `job_runs`, que es único: con varias instancias de la API, cada tarea corre una sola vez.
- **Seguridad de la cuenta.** Tras 5 intentos fallidos seguidos la cuenta se bloquea 15 minutos (en la demo no, para que nadie bloquee las cuentas de prueba). En Ajustes se ven las sesiones abiertas y se pueden cerrar.
- **Privacidad por defecto.** La pantalla de fichar no pide la ubicación hasta que la persona ha leído el aviso de geolocalización de su empresa (art. 90 LOPDGDD); se guarda cuándo. Cada empresa fija cuántos meses conserva las fotos de fichaje (una tarea diaria las borra y deja anotado cuándo, sin tocar el registro) y su horario de desconexión: dentro de él los avisos se ven en la app pero el push espera a que termine, agrupado (art. 88 LOPDGDD). Cada persona descarga sus datos en un ZIP; en instalaciones abiertas puede borrar su cuenta, y si trabajó en una empresa su registro de jornada se conserva bloqueado los cuatro años que exige la ley.
- **Correo.** Se envía con la API HTTP de Resend (`EMAIL_DRIVER=resend`) desde un dominio verificado; en desarrollo y pruebas, `EMAIL_DRIVER=log` lo escribe en el registro (y en `EMAIL_LOG_DIR`, de donde los recorridos de navegador leen los enlaces). La recuperación de contraseña usa enlaces de un solo uso que caducan en 60 min, guardados como hash; pedir uno no revela si la cuenta existe, hay un minuto de espera entre envíos y al usarlo se cierran todas las sesiones. Un correo que falla nunca bloquea la acción que lo provoca.
- **Fichar nunca se bloquea.** Fuera de perímetro o sin GPS, el evento se registra y queda señalado. La foto se sella en el dispositivo (fecha, hora local y UTC, coordenadas) antes de subirse, para que funcione también sin conexión.
- **Cómo se demuestra la presencia.** Cada tramo guarda su método (`presence_method`): GPS, el QR del cartel de la ubicación, el quiosco o ninguno. El QR abre `…/clock?l=<ubicación>&k=<código>`; el código es aleatorio, se puede regenerar (el cartel anterior deja de valer) y cuenta como presencia aunque no haya GPS. Si la posición cae dentro de una ubicación conocida, se usa su dirección y no se consulta a Nominatim.
- **Foto obligatoria y puntualidad.** Con `requirePhotoOnClock`, empezar y terminar exigen foto; quien no puede hacerla ficha igualmente y el tramo queda marcado «sin foto» (`photo_missing`). Al empezar con turno se guarda el retraso (`late_minutes`) si supera el margen de la empresa (`lateToleranceMinutes`).
- **Quiosco.** Una tablet compartida se empareja con un código de un solo uso (15 min) y recibe su propio token, revocable, guardado como hash. Cada persona elige su PIN (4–6 cifras, argon2) desde la app; tras 5 fallos se bloquea 15 min. La identificación en la tablet es un JWT firmado con un secreto distinto al de la sesión, válido solo para fichar en esa tablet; si se va la red tras identificarse, el fichaje espera en una cola propia de la tablet y conserva su hora. La tarjeta personal (PDF con QR) solo sustituye a buscar el nombre: siempre se pide el PIN.
- **Alertas de jornada.** Cada 5 minutos se revisan las entradas sin fichar (aviso a la persona y, al doble de tiempo, a quien supervisa), las jornadas abiertas más de `maxOpenHours` y los descansos de menos de 12 h entre jornadas (art. 34.3 ET); cada día, los días con más de 9 h ordinarias y las horas extra del año al 70 % y al 100 % de `overtimeYearLimit` (80 h, art. 35.2 ET). Hay una alerta por persona, tipo y día, que quien supervisa da por resuelta. Solo se revisan las empresas con actividad reciente.
- **Departamentos y alcance.** Un responsable con departamentos asignados solo ve y gestiona a su gente (y a sí mismo): fichajes, validaciones, cuadrante, gastos, ausencias, alertas, informes, equipo y panel. Sin departamentos, o con rol de administración o inspección, ve toda la empresa. Lo decide `ScopeService.visibleUserIds()`; los avisos «para validar» llegan a la administración, a los responsables sin departamentos y a los del departamento de la persona.
- **Alta masiva e invitaciones.** La plantilla (XLSX o CSV con «;» o «,») se reconoce por los nombres de columna en español o inglés; la vista previa marca los errores fila a fila (correo, DNI/NIE con letra de control, rol, horas, repetidos, ya en la empresa) sin crear nada. Los datos (puesto, departamento, jornada, DNI) viajan en la invitación y se aplican al aceptarla. Cada empresa puede enviar `INVITES_PER_DAY` invitaciones en 24 h; reenviar genera un enlace nuevo (el anterior deja de valer) y no se puede repetir antes de un minuto.
- **Nóminas en un solo PDF.** Se lee el texto de cada página (pdfjs-dist 3.11, la última versión que carga con `require`) y se buscan DNI/NIE con letra de control válida, así no se confunden con cuentas o números de afiliación. La propuesta se revisa (las páginas sin dueño no se envían) y cada persona recibe un PDF solo con sus páginas, hecho con pdf-lib. El PDF subido se borra al enviar o a las 24 h.
- **Registro mensual y plazos.** El día elegido por la empresa, cada persona que trabajó el mes anterior recibe su registro de jornada para firmar (art. 35.5 ET), con 7 días de plazo; un índice único impide enviar dos veces el del mismo mes. Cualquier documento puede llevar fecha límite: se recuerda 3 días antes, el mismo día y, vencido, cada 3 días (3 veces como mucho).
- **Correo de avisos.** Cada persona elige qué avisos le llegan también por correo (documentos, respuestas, cosas por validar, horario, alertas) y si recibe el resumen diario de lo pendiente a las 08:00 (solo quien supervisa). En el horario de desconexión el correo se guarda y sale junto con el push al terminar. La demo nunca envía correo.
- **Sesión en varias pestañas.** Si dos peticiones renuevan la sesión con el mismo token a la vez (otra pestaña, o una navegación que corta la respuesta), en los 15 s siguientes se emite otro token de la misma cadena en lugar de cerrar la sesión. Pasado ese margen, reutilizar un token rotado revoca toda la cadena; cerrar sesión cierra la cadena entera del dispositivo.
- **Gestoría y coste por obra.** El archivo mensual para la gestoría (Excel o CSV con «;») tiene una fila por persona; la empresa elige qué columnas lleva y en qué orden (`payrollColumns`). Solo cuenta lo aprobado: jornadas, ausencias y gastos aprobados o pagados. El coste por obra multiplica las horas aprobadas de cada ubicación por el coste por hora de cada persona (`memberships.hourly_cost`, que solo ve la administración) con el recargo de las extra (`overtimeSurchargePct`) en la proporción de extra de su mes, y suma los gastos imputados a esa ubicación. Quien no tiene coste por hora se avisa, no se inventa.
- **Marca del cliente.** Cada empresa puede poner su nombre comercial, su logotipo (PNG o JPEG; un SVG podría llevar código) y su color. La web calcula los tonos del acento y los oscurece o aclara hasta cumplir el contraste AA (4,5:1) del texto blanco sobre el acento y del acento sobre su fondo suave, en claro y en oscuro; el tema «Sol» no cambia. El logotipo y el nombre salen en la cabecera de la app y de los PDF. El nombre del producto en cada instalación se fija al compilar con `VITE_APP_NAME`.
- **Turnos rotativos.** Un patrón es un ciclo de hasta 28 días, cada uno con turno (hora local, pausa y ubicación) o libre. Al aplicarlo a varias personas, cada una puede ir desfasada unos días; los turnos se crean en borrador a la hora local correcta aunque haya cambio de hora (un turno de noche acaba al día siguiente), y se saltan los festivos, las ausencias aprobadas y lo que ya tenía turno.

## Plan de desarrollo

| # | Fase | Estado |
|---|---|---|
| 1 | Cimientos: monorepo, Docker, esquema de datos y migraciones | Hecha |
| 2 | Sistema de diseño, autenticación y selector de espacio | Hecha |
| 3 | Ubicaciones y geocercas con mapa | Hecha |
| 4 | Motor de fichaje: cronómetro, pausas, GPS y foto | Hecha |
| 5 | Fichaje manual, validación y auditoría | Hecha |
| 6 | Cuadrantes y bolsas de horas | Hecha |
| 7 | Gastos y tickets | Hecha |
| 8 | Documentos y firma digital | Hecha |
| 9 | Modo offline e informes exportables | Hecha |
| 10 | Notificaciones, panel del responsable y cierre | Hecha |
| 11 | Producción, demo y seguridad | Hecha |
| 12 | Privacidad y legal | Hecha |
| 13 | Festivos, ausencias y bolsa de horas | Hecha |
| 14 | Fichaje ampliado: alertas, quiosco, QR, foto obligatoria, puntualidad | Hecha |
| 15 | Personas, documentos y correo: alta masiva, nóminas, firma mensual, departamentos | Hecha |
| 16 | Gestión y marca: exportación a gestoría, coste por obra, marca del cliente, turnos rotativos | Hecha |
| 17 | Cierre de la demo | Hecha |
| 18 | Rediseño, nota de relevo entre turnos y publicación como código abierto | Hecha |

Instalación: [documentación](README.md). Opciones avanzadas de despliegue: [avanzado.md](avanzado.md).

## Pendiente

Lo que queda fuera de estas fases y conviene abordar antes o poco después de salir a producción:

- **OCR real.** El punto de conexión está listo; el proveedor por defecto no propone datos.
- **Pruebas en dispositivos reales.** Cámara, lector de QR, firma táctil, quiosco en tableta, instalación y push se han probado en un navegador de escritorio emulando móvil.
- **Doble factor para la administración.** Hoy protege el bloqueo por intentos y las sesiones revocables; un segundo factor (TOTP) queda para más adelante.
- **Textos legales.** Son una base: hay que revisarlos con la asesoría y rellenar `LEGAL_*` en cada instalación.
