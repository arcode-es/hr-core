# Contexto de build: raíz del monorepo.
FROM node:22-alpine AS base
RUN apk add --no-cache openssl && corepack enable
WORKDIR /repo

FROM base AS build
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/api/package.json apps/api/
RUN pnpm install --frozen-lockfile --filter @hr/api... 
COPY packages/shared packages/shared
COPY apps/api apps/api
RUN pnpm --filter @hr/shared build && pnpm --filter @hr/api build

FROM node:22-alpine AS runtime
RUN apk add --no-cache openssl
ENV NODE_ENV=production
COPY --from=build --chown=node:node /repo /repo
WORKDIR /repo/apps/api
# Carpeta de archivos para STORAGE_DRIVER=local (se monta como volumen).
RUN mkdir -p storage && chown node:node storage
# Sin privilegios: un fallo en la API no da acceso de root al contenedor.
USER node
EXPOSE 3000
# Aplica migraciones pendientes y arranca.
CMD ["sh", "-c", "./node_modules/.bin/prisma migrate deploy && node dist/main.js"]
