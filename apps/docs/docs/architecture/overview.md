---
sidebar_position: 1
title: Architecture Overview
---

# Architecture

Compass is an npm-workspaces monorepo on Node 24 + TypeScript. The backend runs without a build step — Node executes `.ts` files directly via native type stripping, which is why relative imports carry the `.ts` extension.

## Workspaces

### `apps/api` — Fastify REST API

- **Layering: routes → services → (Drizzle) db**
  - Routes are thin: validate with a Zod schema, call a service, return the result.
  - Business logic and all DB access live in `services/*.ts`.
  - Each service takes a `Db | Tx` handle plus `userId`.
  - `repositories/` is nearly empty (only `users.ts`) — write new logic in `services/`, not `repositories/`.

- **Wiring:** `app.ts` decorates the Fastify instance with `config`, `pg`, `db`, `redis`, `queues`, and `storage`, installs two security plugins, then registers every `routes/*.ts`. A new feature = new Zod schema in `packages/shared`, new `services/x.ts`, new `routes/x.ts`, and registration in `app.ts`.

- **Validation:** `fastify-type-provider-zod` — request/response schemas are Zod objects from `@compass/shared`, providing end-to-end types.

- **Sessions:** `plugins/auth.ts` provides Redis-backed sessions with argon2 password hashing and signed httpOnly SameSite=Lax cookies. Includes a single demo-mode chokepoint: demo sessions are rejected on any mutating HTTP method, so seeded demo data is immutable and every new POST/PATCH/DELETE route is demo-safe automatically.

- **Security:** `plugins/security.ts` is deliberately hand-rolled (no `@fastify/helmet` or `rate-limit`): security headers, CSRF via Origin check on state-changing requests, and Redis fixed-window rate-limit buckets.

- **Jobs:** BullMQ on Redis, started in `jobs/index.ts`. Config validated at boot via Zod in `config.ts`.

### `apps/web` — React SPA

Vite + React Router + `@tanstack/react-query` + Tailwind v4. Pages live in `routes/<feature>/*`, with shared components in `components/`, query hooks in `lib/`, and layout in `layouts/AppLayout.tsx`. Consumes `@compass/shared` schemas and types directly.

### `packages/shared`

Zod schemas (`src/schemas/*.ts`, re-exported from `index.ts`) plus money and date utilities — the contract shared by API and web. Add or modify a schema here first; both sides consume it.

### `packages/ai` (optional)

An isolated AI module that uses plain `fetch`, no vendor SDK. ESLint bans importing any AI SDK outside `packages/ai`. All providers (Anthropic, DeepSeek, Ollama, Custom) share one HTTP path: `src/http.ts` `postJson`. The app runs fully functional with AI disabled.

### `apps/ingestor` + `apps/extractor` — Email pipeline (optional)

Separate containers behind the compose `email` profile (a plain `docker compose up` never starts them). The ingestor polls Gmail over OAuth2 IMAP with per-user credentials (captured by a local `connect` CLI, stored encrypted) → writes `email_ingestions` (raw RFC822 retained) → enqueues BullMQ jobs → the extractor runs the mailbox owner's AI provider to produce **reviewable** `extracted_transactions` (nothing reaches the ledger without user accept). For privacy: alert emails send the LLM only Subject/From/category-names/stripped-capped body, never raw headers; PDF statement attachments are decrypted and up to 60,000 characters of their extracted text are sent in a separate, non-redacted call.

### `apps/docs` — Docusaurus documentation

This documentation site.

## Key properties

- **Every user-facing table is `user_id`-scoped.** Services filter by `req.session!.userId`. There is no admin/owner-privileged data path.
- **Money is always integer paise (minor units), never float rupees.** Use `packages/shared/src/money.ts` helpers (`rupeesToPaise`, `formatINR`). Formatting is `en-IN` INR.
- **No auto-categorization of transactions.** Category is manual; AI is assist-only. Do not add a rules engine.
- **No build step for the backend** — Node runs `.ts` files directly, so relative imports must include the `.ts` extension.
