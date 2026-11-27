# Build your tool on HR-Core

[← Documentation](README.md) · [Español](../es/construir.md)

HR-Core already solves the foundation of any HR tool: companies and people, roles and permissions, departments,
invitations, secure sign-in, email, push notifications, an installable offline-capable app, signed documents,
audit trails and reports. If you are building something of your own (performance reviews, training, onboarding,
special rotas…), starting here saves months.

This guide shows how to add a feature following the same pattern as the rest of the app. The medium-term goal is
a [module system](https://github.com/arcode-es/hr-core/issues/21) so this can be done without touching the core;
until then, this is the recommended way.

## How it is organized

| Folder | Contents |
|---|---|
| `apps/api` | NestJS + Prisma API (PostgreSQL with PostGIS). Each feature is a folder in `src/` |
| `apps/web` | React app (PWA). Screens in `src/pages`, menu in `src/app/nav.ts`, routes in `src/router.tsx` |
| `packages/shared` | Types and validation (zod) shared by the API and the web app |
| `apps/e2e` | Playwright browser tests |

Architecture and design decisions are in [desarrollo.md](../es/desarrollo.md) (in Spanish).

## Adding a feature, step by step

Example: a per-person **training** record.

1. **Data.** Add the model to `apps/api/prisma/schema.prisma`, with an `organizationId` so each company only sees
   its own records. Create the migration:

   ```bash
   pnpm --filter @hr/api db:migrate --name training
   ```

2. **Contract.** In `packages/shared/src/schemas.ts`, the zod schema of what the API accepts (`trainingSchema`)
   and the type of what it returns (`TrainingDto`). The web app and the API share them.

3. **API.** Create `apps/api/src/training/` with its service and controller, and register them in
   `src/app.module.ts`. Copy the pattern of a similar feature (for example `alerts/`):
   - `@Roles('ADMIN', 'MANAGER')` restricts who can use each route.
   - `@CurrentWorkspace()` gives you the active company: **always filter by it** in queries.
   - To let managers see only their team, use `ScopeService` (`common/scope.service.ts`).
   - Validate input with `new ZodPipe(trainingSchema)`.

4. **API tests.** A `training.spec.ts` next to the service, booting the app with `bootApp()`
   (`src/testing/boot.ts`) like the others. Above all, check that one company cannot see another's data and that
   each role can only do what it should.

5. **Screen.** A page in `apps/web/src/pages/Training.tsx` that loads data with `useQuery` and
   `api<TrainingDto[]>('/training')`, its route in `src/router.tsx` and its entry in `src/app/nav.ts` (with the
   roles that see it). The components in `src/ui/` (cards, buttons, fields, sheets) keep the design consistent.

6. **Texts.** Every visible string goes in `src/i18n/es.ts` and `src/i18n/en.ts`, never hard-coded in the screen.

7. **Check:**

   ```bash
   pnpm -r typecheck
   pnpm test
   pnpm e2e        # optional
   ```

## Your own images

```bash
docker compose build          # builds the API and web app with your changes
docker compose up -d
```

To avoid editing `docker-compose.yml`, set your own `HR_CORE_REGISTRY` in `.env` (for example
`ghcr.io/your-account`) and publish your images there. The `.github/workflows/imagenes.yml` workflow does it
automatically in your fork when you tag a release.

## Keep getting updates

Work in a **fork** and keep your changes in your own folders where possible: pulling new releases is then a
`git fetch upstream && git rebase upstream/main` with no conflicts. If something you build could help others,
propose it: read [CONTRIBUTING.md](../../CONTRIBUTING.md) or share it in
[Discussions](https://github.com/arcode-es/hr-core/discussions/categories/ideas).

## License

HR-Core is AGPL-3.0. You can use and modify it freely in your company. If you offer your modified version to others
over a network (for example, as a service for clients), you must publish its source under the same license.
