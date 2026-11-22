# Contexto de build: raíz del monorepo.
FROM node:26-alpine AS build
RUN corepack enable
WORKDIR /repo
COPY package.json pnpm-workspace.yaml pnpm-lock.yaml tsconfig.base.json ./
COPY packages/shared/package.json packages/shared/
COPY apps/web/package.json apps/web/
RUN pnpm install --frozen-lockfile --filter @hr/web...
COPY packages/shared packages/shared
COPY apps/web apps/web
# Por defecto la API va en el mismo dominio, en /api/v1 (detrás del mismo proxy): así sirve la imagen publicada.
ARG VITE_API_URL=/api/v1
ARG VITE_BASE_PATH=
# Marca del cliente: nombre del producto en la web y en la app instalada.
ARG VITE_APP_NAME=HR-Core
ENV VITE_API_URL=$VITE_API_URL VITE_BASE_PATH=$VITE_BASE_PATH VITE_APP_NAME=$VITE_APP_NAME
RUN pnpm --filter @hr/shared build && pnpm --filter @hr/web build

FROM nginx:1.27-alpine
COPY apps/web/nginx.conf /etc/nginx/conf.d/default.conf
COPY apps/web/security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /repo/apps/web/dist /usr/share/nginx/html
# Manuales por perfil: los correos de bienvenida enlazan a /manuales/manual-<perfil>.pdf
COPY docs/manuales/manual-*.pdf /usr/share/nginx/html/manuales/
# Nombre de la app y demás ajustes de la instalación, al arrancar (APP_NAME).
COPY apps/web/docker/40-hr-core-config.sh /docker-entrypoint.d/40-hr-core-config.sh
EXPOSE 80
