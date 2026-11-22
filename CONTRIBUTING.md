# Contribuir / Contributing

**Español** · [English](#english)

¡Gracias por querer mejorar HR-Core! Toda ayuda cuenta: avisar de un fallo, mejorar la documentación, traducir o
escribir código.

## Antes de empezar

- **Fallos y propuestas:** abre una incidencia con la plantilla que corresponda. Para fallos de seguridad, lee
  [SECURITY.md](SECURITY.md).
- **Cambios grandes:** coméntalo antes en una incidencia, para acordar el enfoque.
- Las incidencias con la etiqueta `good first issue` son buenas para empezar.

## Entorno de desarrollo

Necesitas Node 22, pnpm 10 y Docker.

```bash
pnpm install
cp .env.example .env          # valores de desarrollo
pnpm infra:up                 # PostgreSQL + PostGIS en Docker
pnpm db:deploy                # migraciones
pnpm dev                      # API en :3000 y web en :5173
```

## Antes de abrir un pull request

```bash
pnpm -r typecheck
pnpm test                     # pruebas de la API (necesitan la base de datos de desarrollo)
pnpm e2e                      # recorridos de navegador (opcional; la CI los pasa siempre)
```

- Un pull request por cambio, con una descripción de qué y por qué.
- Si cambias la interfaz, añade una captura. Si cambias textos, actualiza español (`es.ts`) e inglés (`en.ts`).
- Las migraciones de base de datos se crean con Prisma y nunca se editan una vez publicadas.
- Al contribuir aceptas que tu código se publique con la licencia del proyecto, [AGPL-3.0](LICENSE).

---

## English

Thanks for helping improve HR-Core! Every contribution counts: bug reports, documentation, translations or code.

### Before you start

- **Bugs and ideas:** open an issue using the matching template. For security issues, read [SECURITY.md](SECURITY.md).
- **Large changes:** discuss them in an issue first so we can agree on the approach.
- Issues labelled `good first issue` are a good starting point.

### Development setup

You need Node 22, pnpm 10 and Docker.

```bash
pnpm install
cp .env.example .env          # development values
pnpm infra:up                 # PostgreSQL + PostGIS in Docker
pnpm db:deploy                # migrations
pnpm dev                      # API on :3000 and web on :5173
```

### Before opening a pull request

```bash
pnpm -r typecheck
pnpm test                     # API tests (need the development database)
pnpm e2e                      # browser tests (optional; CI always runs them)
```

- One pull request per change, describing what and why.
- For UI changes, add a screenshot. If you change texts, update both Spanish (`es.ts`) and English (`en.ts`).
- Database migrations are created with Prisma and never edited once released.
- By contributing you agree that your code is released under the project licence, [AGPL-3.0](LICENSE).
