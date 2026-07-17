# Build context is the repo root: docker build -f apps/ingestor/Dockerfile .
FROM node:24-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/ingestor/package.json apps/ingestor/
COPY packages/shared/package.json packages/shared/

# Typecheck with dev deps — the runtime runs TS via Node 24 type stripping,
# so this stage is the "compile" gate.
FROM base AS check
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY apps/ingestor ./apps/ingestor
RUN npm run typecheck -w apps/ingestor
RUN touch /tmp/typecheck-ok

FROM base AS proddeps
RUN npm ci --omit=dev -w apps/ingestor

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=proddeps /app ./
# Depend on the check stage so `docker build` fails on type errors.
COPY --from=check /tmp/typecheck-ok /tmp/typecheck-ok
COPY packages/shared/src ./packages/shared/src
COPY apps/ingestor/src ./apps/ingestor/src
USER node
CMD ["node", "apps/ingestor/src/index.ts"]
