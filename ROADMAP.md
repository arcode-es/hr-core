# Hoja de ruta / Roadmap

**Español** · [English](#english)

Hacia dónde va HR-Core. Es orientativa: cambia según lo que pida la gente que lo usa. Propón ideas y vota las de
otros en [Discussions → Ideas](https://github.com/arcode-es/hr-core/discussions/categories/ideas); cada punto
tiene su incidencia para comentar o ayudar.

Publicamos una versión **cada mes** como mínimo (arreglos y mejoras pequeñas) y una con funciones nuevas cuando
estén listas. Los cambios de cada una están en el [CHANGELOG](CHANGELOG.md).

## 1.1 · Para todo el mundo

- Interfaz, manifiesto de la app instalable y manuales en inglés ([#11](https://github.com/arcode-es/hr-core/issues/11), [#12](https://github.com/arcode-es/hr-core/issues/12), [#13](https://github.com/arcode-es/hr-core/issues/13)).
- Más idiomas, empezando por los que pida la comunidad ([#9](https://github.com/arcode-es/hr-core/issues/9)).
- Documentación como web (GitHub Pages), con buscador.

## 1.2 · Más seguro y más cómodo

- Doble factor (TOTP) para administración y responsables.
- Lectura automática de tickets (OCR) con un motor que funcione en el propio servidor.
- Calendario de turnos y ausencias suscribible (iCal) para el móvil o Outlook.

## 1.3 · Para construir encima

- **API pública** con claves por empresa y documentación OpenAPI.
- **Webhooks**: avisar a otras herramientas cuando alguien ficha, pide una ausencia o firma un documento.
- Exportación directa a programas de nóminas habituales en España.

## 2.0 · Una base para tu herramienta de RR. HH.

- **Módulos**: añadir funciones propias (evaluaciones, formación, onboarding…) sin tocar el núcleo.
- Guía y plantilla para crear un módulo.
- Ajustes de normativa por país (registro de jornada, festivos, textos legales).

---

## English

Where HR-Core is heading. It is a guide, not a promise: it changes with what users ask for. Suggest ideas and vote
on others' in [Discussions → Ideas](https://github.com/arcode-es/hr-core/discussions/categories/ideas); every item
has an issue where you can comment or help.

We ship a release **every month** at least (fixes and small improvements), plus feature releases when they are
ready. Every change is listed in the [CHANGELOG](CHANGELOG.md).

### 1.1 · For everyone

- English UI, installable-app manifest and user guides ([#11](https://github.com/arcode-es/hr-core/issues/11), [#12](https://github.com/arcode-es/hr-core/issues/12), [#13](https://github.com/arcode-es/hr-core/issues/13)).
- More languages, starting with the ones the community asks for ([#9](https://github.com/arcode-es/hr-core/issues/9)).
- Documentation as a website (GitHub Pages), with search.

### 1.2 · Safer and easier

- Two-factor authentication (TOTP) for admins and managers.
- Automatic receipt reading (OCR) with an engine that runs on your own server.
- Subscribable shifts and absences calendar (iCal) for phones or Outlook.

### 1.3 · Build on top of it

- **Public API** with per-company keys and OpenAPI documentation.
- **Webhooks** to notify other tools when someone clocks in, requests leave or signs a document.
- Direct export to common Spanish payroll software.

### 2.0 · A foundation for your HR tool

- **Modules**: add your own features (reviews, training, onboarding…) without touching the core.
- A guide and template to build a module.
- Per-country rules (working-time records, public holidays, legal texts).
