# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Compass (PennyPilot) — a self-hosted personal-finance app for the **Indian context** (INR, TDS, EPF contributions from payslips, MF folios). npm-workspaces monorepo on **Node 24 + TypeScript ~5.9**, ESM throughout. There is no build/transpile step for the backend — Node runs the `.ts` files directly (native type stripping), so **relative imports include the `.ts` extension** (e.g. `import { postJson } from "./http.ts"`).

Postgres and Redis are **external services** (not in the compose stack); endpoints come from `DATABASE_URL` / `REDIS_URL`. See `PRD.md` for the spec and `tasks/` for the phased build plan (`status:` frontmatter is the source of truth; `tasks/README.md` is the index).

## Commands

Run from the repo root unless noted. Scripts fan out across workspaces via `--workspaces --if-present`.

```bash
npm install
npm run db:migrate          # apply Drizzle migrations (needed on first run + after upgrades)
npm run db:seed             # optional demo user: demo@compass.local / demo1234
npm run dev                 # api + web together (api :3001, web :5173)

npm run typecheck           # tsc --noEmit across all 6 workspaces
npm run lint                # eslint . (root)
npm run test                # node --test across all workspaces
npm run build -w apps/web   # production SPA build
```

Migrations (offline schema diff — no DB connection needed to generate):
```bash
npm run db:generate         # after editing apps/api/src/db/schema.ts, generates drizzle/NNNN_*.sql
npm run db:migrate          # applies pending migrations
```

Tests are `*.test.ts` **colocated** next to source and run with the built-in `node --test` (no Jest/Vitest). Run one workspace or one file:
```bash
npm run test -w apps/api
node --test apps/api/src/services/capital-gains.test.ts
```

## Architecture

### Backend — `apps/api` (Fastify)
- **Layering: routes → services → (Drizzle) db.** Routes are thin: validate with a shared Zod schema, call a service, return. Business logic and all DB access live in `modules/<domain>/services/*.ts`; DB-backed service operations take a `Db | Tx` handle and, where user-scoped, a `userId` (some services are pure, e.g. `cycle-math`/`xirr`). The flat `services/`/`routes/`/`repositories/` source dirs are gone — **all domain code lives under `modules/`; cross-cutting, domain-neutral helpers live in `lib/` (e.g. `cache.ts`, `ownership.ts`, `periods.ts`).**
- `app.ts` wires everything: decorates the instance with `config`, `pg`, `db`, `redis`, `queues`, `storage`, installs the two plugins, then registers each module's `plugin.ts`. The shared Zod/API contract lives in `packages/shared` (distinct from a module's Drizzle persistence `schema.ts`); a feature in an EXISTING domain adds/updates files inside that `modules/<domain>/` and registers its route in that module's existing `plugin.ts`, while a NEW domain adds a `modules/<domain>/` (`schema.ts` for new tables, `services/x.ts`, `routes/x.ts`, `plugin.ts`) and registers its `plugin.ts` in `app.ts`.
- **Validation & typing:** `fastify-type-provider-zod` — request/response schemas are Zod objects from `@compass/shared`, giving end-to-end types. Use `app.withTypeProvider<ZodTypeProvider>()`.
- **Every user-facing table is `user_id`-scoped;** services filter by `req.session!.userId`. There is no admin/owner-privileged data path.
- **`plugins/auth.ts`** — Redis-backed sessions (argon2 password hash, signed httpOnly SameSite=Lax cookie). It also holds the **single demo-mode chokepoint**: a demo session is rejected on any mutating HTTP method (`MUTATING_METHODS`), so seeded demo data is immutable and every new POST/PATCH/DELETE route is demo-safe automatically.
- **`plugins/security.ts`** — hand-rolled (deliberately no `@fastify/helmet`/`rate-limit`/`csrf`): security headers, **CSRF via Origin check** on state-changing requests, and Redis fixed-window rate-limit buckets (`AUTH_BUCKET` etc.).
- **Jobs:** BullMQ on Redis, started in `jobs/index.ts` (`startJobs`). Config is validated at boot in `config.ts` (Zod) — add new env vars there.
- **Module layout (Phase 1 complete):** every domain lives in `modules/<domain>/` (`schema.ts`, `services/`, `routes/`, `plugin.ts`); `app.ts` registers each module's `plugin.ts`, not routes directly. Schema ownership is physical: each `modules/<domain>/schema.ts` defines the real `pgTable()`/`pgEnum()` for its RESIDENT tables/enums, imports from `db/shared/*` the cross-domain tables its residents FK to, and separately re-exports the shared tables/enums that make up its module-facing schema surface (the referenced and re-exported sets need not coincide). The 12 tables referenced across modules (and their shared enums) are physically defined in DAG-layered files under `db/shared/` (`foundation` → `hubs` → `recurring` → `spines` → `ledger`; each layer may import `db/core-schema.ts` and only PRECEDING shared layers), and `db/core-schema.ts` holds the cycle-free core identity (`users`) that the shared layers and module schemas depend on. A module's `schema.ts` imports its cross-domain FK targets from `db/shared/*` and `users` from `db/core-schema.ts` — it NEVER imports another module's `schema.ts`. `db/schema.ts` is now a pure re-export barrel that re-exports every table + enum exactly once and remains the single Drizzle Kit entry point (`drizzle.config.ts` points only at it); service/runtime code may still import tables from `db/schema.ts`, but module `schema.ts` files import from the shared layers directly to keep the schema graph acyclic. Runtime cross-module SERVICE imports are still allowed — only cross-module SCHEMA imports are forbidden.

### Money & domain rules
- **Money is always integer paise** (minor units) end to end — never float rupees. Use `packages/shared/src/money.ts` (`rupeesToPaise`, `formatINR`, `standardEmiPaise`). Formatting is `en-IN` INR.
- **No auto-categorization of transactions** — category is manual; AI is assist-only and only in the AI phase. Do not add a rules engine that auto-classifies.
- A mutual-fund position is keyed by **scheme + folio**, not scheme alone.

### `packages/shared`
Zod schemas (`src/schemas/*.ts`, re-exported from `index.ts`) plus money/date utils — the contract shared by API and web. Add/modify a schema here first; both sides consume it. `deepEqual` schema tests exist, so adding a field can require updating an expected object in a `*.test.ts`.

### `packages/ai` — optional AI module
- **The app must run with AI fully disabled.** ESLint bans importing any AI SDK (`@anthropic-ai/*`, `openai`, `ollama`) **outside `packages/ai`** — this package uses **plain `fetch`, no vendor SDK**. All providers (anthropic, ollama, openai-compat, null) share one HTTP path: `src/http.ts` `postJson`.
- **AI is configured per-user, not via env** — stored encrypted in the `ai_settings` table (Settings → AI in the app). There is no global provider; it's resolved per request. OpenRouter/DeepSeek both use the `openai-compat` provider (only base URL + default model differ).
- `postJson` accepts an `observe?: AiObserver` fired **fire-and-forget** (`void report(...)`) at the HTTP boundary — this powers the AI event log without ever gating/slowing a model call. `parseResponseBody` tolerates OpenRouter keep-alive padding (`: OPENROUTER PROCESSING` before the JSON). Keep both properties intact when touching this file.

### Web — `apps/web` (React SPA)
Vite + React Router + `@tanstack/react-query` + **Tailwind v4**. `routes/<feature>/*` pages, `components/`, `lib/` (query hooks like `ai-event-queries.ts`), `layouts/AppLayout.tsx` (nav). Consumes `@compass/shared` schemas/types directly.

### Email → transaction pipeline (opt-in) — `apps/ingestor` + `apps/extractor`
Separate containers behind the compose **`email` profile** (a plain `docker compose up` never starts them). `ingestor` polls Gmail over OAuth2 IMAP (per-user creds captured by the local `connect` CLI, stored encrypted) → writes `email_ingestions` (raw RFC822 retained) → enqueues BullMQ jobs → `extractor` runs the mailbox owner's AI provider to produce **reviewable** `extracted_transactions` (nothing hits the ledger without user accept). **Privacy:** the extractor sends the LLM only Subject/From/category-names/stripped-capped body — never raw headers.

## Database & migrations

- Drizzle ORM; schema in `apps/api/src/db/schema.ts`; migrations in `apps/api/drizzle/*.sql` (+ `meta/` snapshots). Workflow: edit schema → `db:generate` → review the SQL → `db:migrate`.
- **Migrate as the `compass` app role**, not `postgres`, or tables end up owned wrong and the app hits "permission denied". A repair script exists for fixing ownership.
- **Backup coverage is test-enforced:** every schema table must be listed in `ALL_TABLES` / `USER_TABLES` in `services/backup.ts`, or `backup.test.ts` fails. Add new tables there in the same change.
- Object storage goes through the `Storage` abstraction (`lib/storage.ts`) — self-hosted MinIO in prod, disk fallback in dev.

## Conventions & guardrails

- **Stage files explicitly for commits — never `git add -A`.** The repo working tree may contain private artifacts (`Pasted image.png`, statement PDFs like `*.pdf` at root, `data/`) that must never be committed or dumped.
- Commit messages end with a `Co-Authored-By: Claude ...` trailer; PR bodies end with the Claude Code trailer (per session/global instructions).
- `cat` is aliased to `batcat` in this shell and `cp` is aliased — use Read/Write tools, `/bin/cp`, or `\cat`.
- Deploy: git tag `vX.Y.Z` → CI builds/publishes images (`.github/workflows/publish.yml`) → bump `COMPASS_VERSION` on the host → `make update`. CI checks live in `.github/workflows/ci.yml` (audit, typecheck/lint/test, publish for api/web/ingestor/extractor).

## Deployed infrastructure

See `INFRA.md` for the full reference. Key facts:

- **Host:** 192.168.2.228, infra directory: `~/infra`
- **Public URL:** `https://compass.udaikiran.dev` (Cloudflare Tunnel → `pennypilot-web:80`)
- **Update:** bump `COMPASS_VERSION` in `~/infra/.env` → `make update` (pulls new images from GHCR, recreates changed containers; the `pennypilot-migrate` one-shot runs migrations automatically)
- **Rollback:** set `COMPASS_VERSION` back to the previous tag → `make update`
- **Backup:** `make backup` (writes a timestamped `pg_dump` custom-format file into `~/infra/backups/`)
- **Logs:** `make logs S=<service>` — e.g. `make logs S=pennypilot-api`
- **State:** all data lives on named Docker volumes (`infra_pgdata`, `infra_valkey_data`, `infra_minio_data`, `infra_pennypilot_data`) on this host — there is no external DB server
