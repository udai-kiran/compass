# Build context is the repo root: docker build -f apps/api/Dockerfile .
FROM node:24-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/api/package.json apps/api/
COPY apps/web/package.json apps/web/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/

# Typecheck with dev deps — the runtime runs TS via Node 24 type stripping,
# so this stage is the "compile" gate.
FROM base AS check
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/ai ./packages/ai
COPY apps/api ./apps/api
RUN npm run typecheck -w apps/api
RUN touch /tmp/typecheck-ok

FROM base AS proddeps
RUN npm ci --omit=dev -w apps/api

FROM node:24-slim AS runtime
ENV NODE_ENV=production
# Version provenance, surfaced at /health and on the web status page.
ARG APP_VERSION=dev
ARG GIT_SHA=unknown
ARG BUILD_TIME=
ENV APP_VERSION=$APP_VERSION GIT_SHA=$GIT_SHA BUILD_TIME=$BUILD_TIME
WORKDIR /app
COPY --from=proddeps /app ./
# Depend on the check stage so `docker build` fails on type errors.
COPY --from=check /tmp/typecheck-ok /tmp/typecheck-ok
COPY packages/shared/src ./packages/shared/src
COPY packages/ai/src ./packages/ai/src
COPY apps/api/src ./apps/api/src
# Migration SQL — applied by `npm run db:bootstrap` (compose `migrate` service).
COPY apps/api/drizzle ./apps/api/drizzle
USER node
EXPOSE 3001
CMD ["node", "apps/api/src/server.ts"]
