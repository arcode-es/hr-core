# Construir tu herramienta sobre HR-Core

[← Documentación](README.md) · [English](../en/build-on.md)

HR-Core ya resuelve la base de cualquier herramienta de RR. HH.: empresas y personas, perfiles y permisos,
departamentos, invitaciones, inicio de sesión seguro, correo, avisos en el móvil, app instalable sin conexión,
documentos con firma, auditoría e informes. Si vas a crear algo propio (evaluaciones, formación, onboarding,
turnos especiales…), empezar desde aquí te ahorra meses.

Esta guía explica cómo añadir una función siguiendo el mismo patrón que el resto de la app. El objetivo a medio
plazo es un [sistema de módulos](https://github.com/arcode-es/hr-core/issues/21) para hacerlo sin tocar el
núcleo; mientras tanto, esta es la forma recomendada.

## Cómo está organizado

| Carpeta | Qué hay |
|---|---|
| `apps/api` | API en NestJS + Prisma (PostgreSQL con PostGIS). Cada función es una carpeta en `src/` |
| `apps/web` | App en React (PWA). Pantallas en `src/pages`, menú en `src/app/nav.ts`, rutas en `src/router.tsx` |
| `packages/shared` | Tipos y validaciones (zod) compartidos por la API y la web |
| `apps/e2e` | Pruebas de navegador con Playwright |

La arquitectura y las decisiones de diseño están en [desarrollo.md](desarrollo.md).

## Añadir una función, paso a paso

Ejemplo: un registro de **formaciones** por persona.

1. **Datos.** Añade el modelo a `apps/api/prisma/schema.prisma`, con `organizationId` para que cada empresa vea
   solo lo suyo. Genera la migración:

   ```bash
   pnpm --filter @hr/api db:migrate --name formaciones
   ```

2. **Contrato.** En `packages/shared/src/schemas.ts`, el esquema zod de lo que recibe la API (`trainingSchema`) y
   el tipo de lo que devuelve (`TrainingDto`). La web y la API usan los mismos.

3. **API.** Crea `apps/api/src/training/` con su servicio y su controlador, y regístralos en
   `src/app.module.ts`. Copia el patrón de una función parecida (por ejemplo `alerts/`):
   - `@Roles('ADMIN', 'MANAGER')` limita quién puede usar cada ruta.
   - `@CurrentWorkspace()` da la empresa activa: **filtra siempre por ella** en las consultas.
   - Para que un responsable vea solo a su equipo, usa `ScopeService` (`common/scope.service.ts`).
   - Valida la entrada con `new ZodPipe(trainingSchema)`.

4. **Pruebas de la API.** Un `training.spec.ts` junto al servicio, arrancando la app con `bootApp()`
   (`src/testing/boot.ts`) como hacen las demás. Comprueba sobre todo que una empresa no ve los datos de otra y
   que cada perfil solo hace lo que debe.

5. **Pantalla.** Una página en `apps/web/src/pages/Training.tsx` que pide los datos con
   `useQuery` y `api<TrainingDto[]>('/training')`, su ruta en `src/router.tsx` y su entrada en
   `src/app/nav.ts` (con los perfiles que la ven). Los componentes de `src/ui/` (tarjetas, botones, campos,
   paneles) mantienen el diseño.

6. **Textos.** Todo texto visible va en `src/i18n/es.ts` y `src/i18n/en.ts`, nunca escrito en la pantalla.

7. **Comprobar:**

   ```bash
   pnpm -r typecheck
   pnpm test
   pnpm e2e        # opcional
   ```

## Tus propias imágenes

```bash
docker compose build          # compila la API y la web con tus cambios
docker compose up -d
```

Para no tocar el `docker-compose.yml`, pon en `.env` un `HR_CORE_REGISTRY` propio (por ejemplo
`ghcr.io/tu-cuenta`) y publica ahí tus imágenes. El flujo `.github/workflows/imagenes.yml` lo hace solo en tu fork
al etiquetar una versión.

## Seguir recibiendo las mejoras

Trabaja en un **fork** y mantén tus cambios en carpetas propias en lo posible: así incorporar las versiones nuevas
es un `git fetch upstream && git rebase upstream/main` sin conflictos. Si algo de lo que construyes puede servir a
más gente, propónlo: lee [CONTRIBUTING.md](../../CONTRIBUTING.md) o cuéntalo en
[Discussions](https://github.com/arcode-es/hr-core/discussions/categories/ideas).

## Licencia

HR-Core es AGPL-3.0. Puedes usarlo y modificarlo libremente en tu empresa. Si ofreces tu versión modificada a otras
personas a través de la red (por ejemplo, como servicio para clientes), debes publicar su código con la misma
licencia.
