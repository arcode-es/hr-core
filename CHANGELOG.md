# Cambios / Changelog

Formato basado en [Keep a Changelog](https://keepachangelog.com/es-ES/1.1.0/); versiones con [SemVer](https://semver.org/lang/es/).

## [1.0.1] - 2026-11-22

### Corregido / Fixed

- `/api/v1/health` muestra la versión real de la imagen en lugar de `0.1.0`. / `/api/v1/health` now reports the real image version instead of `0.1.0`.

## [1.0.0] - 2026-11-22

Primera versión publicada como código abierto (AGPL-3.0). / First open-source release (AGPL-3.0).

### Incluye / Includes

- **Fichaje / Time tracking:** entrada, pausas y salida desde el móvil con ubicación, código QR, quiosco en tableta con PIN o tarjeta, sin conexión, foto opcional, correcciones con aprobación y registro de cambios, nota de relevo entre turnos. / Clock in, breaks and clock out from the phone with location, QR code, shared tablet kiosk with PIN or card, offline mode, optional photo, approved corrections with an audit trail, shift handover notes.
- **Horarios / Scheduling:** cuadrante semanal y mensual, turnos rotativos, bolsa de horas. / Weekly and monthly rota, rotating shift patterns, hours bank.
- **Ausencias / Absences:** vacaciones, permisos y bajas con aprobación, calendario y festivos. / Holidays, leave and sick leave with approval, calendar and public holidays.
- **Gastos / Expenses:** foto del ticket, kilometraje, aprobación y liquidación. / Receipt photo, mileage, approval and settlement.
- **Documentos / Documents:** envío y firma en el móvil, reparto de nóminas desde un PDF, registro de jornada mensual. / Send and sign on the phone, split payslips from one PDF, monthly time record.
- **Gestión / Management:** validación de jornadas, alertas de jornada y descanso, coste por obra, informes en PDF, Excel y CSV, exportación para la gestoría. / Timesheet approval, working-time and rest alerts, cost per site, PDF/Excel/CSV reports, payroll export.
- **Empresa y privacidad / Company and privacy:** marca propia, departamentos, aviso de geolocalización, plazos de conservación, exportación y baja de datos personales. / Own branding, departments, geolocation notice, retention periods, personal data export and deletion.
- **Instalación / Installation:** imágenes para amd64 y arm64, instalador con acceso por dominio (HTTPS automático), Tailscale o local, correo por SMTP o Resend, copias diarias y actualizador. / amd64 and arm64 images, installer with domain (automatic HTTPS), Tailscale or local access, SMTP or Resend email, daily backups and updater.
- **Idiomas / Languages:** español e inglés. / Spanish and English.
