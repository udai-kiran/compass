# Compass (PennyPilot)

Self-hosted personal finance: budgets, transactions, goals, investments, net worth — with full data ownership and an **optional** AI module (the app is fully functional with AI disabled).

Stack: Node 24 + TypeScript, Fastify API, React SPA (Vite + Tailwind), Drizzle ORM + PostgreSQL, Redis (sessions, BullMQ jobs, caching). See `PRD.md` for the product spec and `tasks/` for the build plan and status.

## Quickstart (Docker)

Postgres and Redis are **external services** — the compose stack runs only the app and reads their endpoints from `.env`.

```bash
git clone <repo-url> && cd PennyPilot
cp .env.example .env    # set DATABASE_URL, REDIS_URL, SESSION_SECRET
docker compose up -d --build
```

Then open http://localhost:8080 (override with `WEB_PORT` in `.env`). On first run you'll be asked to create the owner account.

Apply database migrations (first run and after upgrades):

```bash
npm install && npm run db:migrate
```

## Development

```bash
nvm use                 # Node 24
npm install
npm run db:migrate      # apply migrations
npm run db:seed         # optional demo user: demo@compass.local / demo1234
npm run dev             # api on :3001, web on :5173
```

Checks: `npm run typecheck && npm run lint`

## Layout

- `apps/api` — Fastify REST API (routes → services → repositories)
- `apps/web` — React SPA
- `packages/shared` — Zod schemas, money/date utils shared by both
- `packages/ai` — optional AI provider module (Phase 7; `AI_PROVIDER=none` by default)
- `tasks/` — one file per task with `status:` frontmatter; `tasks/README.md` is the index
