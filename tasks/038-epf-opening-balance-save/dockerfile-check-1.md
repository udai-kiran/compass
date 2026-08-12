# Dockerfile / CI / tsconfig check — task 038

## 1. `apps/web/Dockerfile` (full)

```dockerfile
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
```

Key observations:
- Base image: `node:24-slim`
- Typecheck command in Docker: `npm run typecheck -w apps/web`
- Only copies `apps/api/package.json` (not the api source), `apps/web`, `packages/shared`, and `tsconfig.base.json` into the build context — `apps/api/src/` is NOT present in the Docker build.

## 2. `.github/workflows/ci.yml` — typecheck step

```yaml
- uses: actions/setup-node@v5
  with:
    node-version: 24
    cache: npm
- run: npm ci
- run: npm run typecheck
```

The CI typecheck command: `npm run typecheck` (repo root, runs across ALL workspaces).

## 3. `apps/web/tsconfig.json` (full)

```json
{
  "extends": "../../tsconfig.base.json",
  "compilerOptions": {
    "module": "esnext",
    "moduleResolution": "bundler",
    "lib": ["es2024", "dom", "dom.iterable"],
    "jsx": "react-jsx",
    "rewriteRelativeImportExtensions": false,
    "types": ["vite/client"]
  },
  "include": ["src", "vite.config.ts"]
}
```

The web tsconfig overrides `module`/`moduleResolution` to `esnext`/`bundler` (Vite-friendly), overrides `lib` to add DOM, sets `rewriteRelativeImportExtensions: false`, and includes only `src` and `vite.config.ts`.

### `tsconfig.base.json` (full, for reference)

```json
{
  "compilerOptions": {
    "target": "es2024",
    "lib": ["es2024"],
    "module": "nodenext",
    "moduleResolution": "nodenext",
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "verbatimModuleSyntax": true,
    "erasableSyntaxOnly": true,
    "allowImportingTsExtensions": true,
    "rewriteRelativeImportExtensions": true,
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "skipLibCheck": true,
    "forceConsistentCasingInFileNames": true,
    "noEmit": true
  }
}
```

## 4. `git log --oneline -12`

```
0da6688 fix epf save in accounts page
a89ef79 fix epf save in accounts page
caa5f2d revamped the EPF (#188)
42bb176 fixed recent transactions
bb93985 fix(web): UI polish — stat tile font, date formatting across all pages (#187)
847f8c2 feat(web): add "Reprocess all" button to MailboxesPanel (#186)
3a37636 feat(ingest): add POST /api/mailboxes/:id/reset-watermark (#185)
d1bd222 fix(ledger): remove transactions alias in listTransactions totals CTE (#184)
9ca5e31 fix(ledger): remove transactions alias in listTransactions totals CTE (#183)
2251a16 Fix/030 misc bug fixes (#182)
3539239 fix(ingest): remove dead transfer_links survivingPartners block and update stale comments (#181)
4556345 fix(ledger/credit): resolve 4 PR-G1 follow-ups F7/F10/F11/F12 (#180)
```

## Digest

| | Docker (`apps/web/Dockerfile`) | Local / CI |
|---|---|---|
| Typecheck command | `npm run typecheck -w apps/web` | Docker: workspace-scoped; CI: `npm run typecheck` (all workspaces from root) |
| Node version | `node:24-slim` | `node-version: 24` (CI) |
| TypeScript | inherited from package.json (no explicit pin in Dockerfile) | same |
| What's available to tsc in Docker | only `packages/shared` + `apps/web` + `tsconfig.base.json`; `apps/api/src` is NOT copied | all workspaces present |

**Critical difference:** In the Dockerfile, `apps/api/src/` is absent — only `apps/api/package.json` is copied (line 5). If any file under `apps/web/src` imports from `apps/api/src/` (or a shared package that transitively resolves into api source), the Docker typecheck would fail with a missing-module error that does NOT surface locally (where the full tree is present). However, since `moduleResolution: bundler` is used for the web workspace and the `include` is limited to `src` and `vite.config.ts`, this is only a risk for paths that tsc actually resolves through.

The two uncommitted commits on `main` (`0da6688`, `a89ef79`) are both "fix epf save in accounts page" — the current working area of task 038.
