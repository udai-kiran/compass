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

## Email → transaction pipeline (optional)

An opt-in module that reads bank/card alert emails over OAuth2 IMAP and turns
them into **reviewable** transactions — nothing is written to your ledger
automatically; extracted items land in an in-app review inbox for accept/reject.
It's disabled by default and needs a real `AI_PROVIDER` plus a Google OAuth
client. The workers (`ingestor`, `extractor`) run behind a compose `email`
profile, so a default `docker compose up` never starts them.

1. In `.env` set an AI provider (e.g. `AI_PROVIDER=deepseek` + `DEEPSEEK_API_KEY`),
   the Google client (`GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`, see below), and
   `MAILBOX_SECRET` (or reuse `SESSION_SECRET`, ≥32 chars — it encrypts stored
   refresh tokens).
2. Onboard a mailbox once (opens a Google consent flow in your browser):
   ```bash
   docker compose run --rm ingestor npm run connect -w apps/ingestor -- you@gmail.com
   ```
3. Start the workers:
   ```bash
   docker compose --profile email up -d
   ```

### Creating the Google `CLIENT_ID` and `CLIENT_SECRET`

The pipeline authenticates to Gmail over IMAP with XOAUTH2, so you need your own
OAuth client. There is **no `credentials.json`** — Compass reads the client id
and secret from `.env` like every other setting.

1. In the target Gmail account, enable IMAP: **Gmail → Settings → See all
   settings → Forwarding and POP/IMAP → Enable IMAP → Save**.
2. Open the [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in an app
   name and your support email. Under **Scopes** add `https://mail.google.com/`.
   Under **Test users** add the Google account whose mail you'll ingest.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `http://127.0.0.1:53682` (must match
     `OAUTH_REDIRECT_PORT` in `.env` — the `connect` flow listens on a loopback
     redirect).
5. Copy the generated **Client ID** and **Client secret** into `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET` in `.env`.

> **Refresh-token longevity:** while the OAuth app's publishing status is
> **Testing**, Google expires refresh tokens after ~7 days, which will stall
> ingestion. For a long-lived self-hosted setup, set the app to **In production**
> (you can dismiss the "unverified app" warning during consent since you're the
> only user) and re-run `connect`.

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
