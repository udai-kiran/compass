# Build context is the repo root: docker build -f apps/extractor/Dockerfile .
FROM node:24-slim AS base
WORKDIR /app
COPY package.json package-lock.json ./
COPY apps/extractor/package.json apps/extractor/
COPY packages/shared/package.json packages/shared/
COPY packages/ai/package.json packages/ai/

# Typecheck with dev deps — the runtime runs TS via Node 24 type stripping,
# so this stage is the "compile" gate.
FROM base AS check
RUN npm ci
COPY tsconfig.base.json ./
COPY packages/shared ./packages/shared
COPY packages/ai ./packages/ai
COPY apps/extractor ./apps/extractor
RUN npm run typecheck -w apps/extractor
RUN touch /tmp/typecheck-ok

FROM base AS proddeps
RUN npm ci --omit=dev -w apps/extractor

FROM node:24-slim AS runtime
ENV NODE_ENV=production
WORKDIR /app
COPY --from=proddeps /app ./
# Depend on the check stage so `docker build` fails on type errors.
COPY --from=check /tmp/typecheck-ok /tmp/typecheck-ok
COPY packages/shared/src ./packages/shared/src
COPY packages/ai/src ./packages/ai/src
COPY apps/extractor/src ./apps/extractor/src
USER node
CMD ["node", "apps/extractor/src/index.ts"]
