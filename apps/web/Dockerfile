# Build context is the repo root: docker build -f apps/web/Dockerfile .
FROM node:24-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY apps/docs/package.json apps/docs/
COPY packages/shared/package.json packages/shared/
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/web ./apps/web
# Version provenance baked into the bundle via Vite `define` (see vite.config.ts).
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME
RUN npm run typecheck -w apps/web && npm run build -w apps/web
# Docs are copied after the web build so a docs-only edit doesn't invalidate it.
# They ship inside the same image, served at /docs/ by Caddy.
COPY apps/docs ./apps/docs
RUN npm run build -w apps/docs

FROM caddy:2-alpine
COPY apps/web/Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/apps/web/dist /srv
COPY --from=build /app/apps/docs/build /srv/docs
EXPOSE 80
