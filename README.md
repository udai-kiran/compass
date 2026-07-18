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
It's disabled by default and needs a real `AI_PROVIDER`. The workers (`ingestor`,
`extractor`) run behind a compose `email` profile, so a default `docker compose
up` never starts them.

Mailbox credentials are **per user** — each user brings their own Google OAuth
client; nothing is baked into the deploy `.env`. Onboarding is decoupled from the
server so it works even when Compass is headless (e.g. on a Tailscale IP): you run
a small CLI on your own machine, and paste what it prints into the UI.

1. On the server, set an AI provider (e.g. `AI_PROVIDER=deepseek` +
   `DEEPSEEK_API_KEY`) and `MAILBOX_SECRET` (or reuse `SESSION_SECRET`, ≥32 chars —
   it encrypts stored client secrets and refresh tokens), then start the workers:
   ```bash
   docker compose --profile email up -d
   ```
2. Create your own Google OAuth client (see below).
3. On **your own machine** (the one with a browser), from a checkout of this repo,
   capture a refresh token — this runs the loopback OAuth flow and needs no access
   to the server:
   ```bash
   npm install
   npm run connect -w apps/ingestor -- you@gmail.com \
     --client-id <CLIENT_ID> --client-secret <CLIENT_SECRET>
   ```
   Open the printed Google URL, consent, and copy the base64 **bundle** it prints.
4. In Compass, go to **Settings → Mailboxes**, paste the bundle, and click **Add
   mailbox**. The ingestor picks it up on its next pass.

### Creating your Google OAuth client

Gmail is accessed over IMAP with XOAUTH2, so you need your own OAuth client. There
is **no `credentials.json`** and nothing goes in `.env` — the client id/secret
travel inside the bundle and are stored (encrypted) against your user.

1. In the target Gmail account, confirm IMAP is available under **Gmail →
   Settings → See all settings → Forwarding and POP/IMAP**. Personal Gmail no
   longer has an "Enable IMAP" toggle — IMAP is always on, so seeing the
   Auto-Expunge / folder-size options there means you're set. (Google Workspace
   accounts control IMAP from the admin console instead.)
2. Open the [Google Cloud Console](https://console.cloud.google.com/), create (or
   pick) a project.
3. **APIs & Services → OAuth consent screen**: choose **External**, fill in an app
   name and your support email. Under **Scopes** add `https://mail.google.com/`.
   Under **Test users** add the Google account whose mail you'll ingest.
4. **APIs & Services → Credentials → Create credentials → OAuth client ID**:
   - Application type: **Web application**.
   - Authorized redirect URI: `http://127.0.0.1:53682` (the `connect` CLI listens
     on this loopback redirect; override the port with `--port` if 53682 is taken,
     and add the matching URI here).
5. Copy the **Client ID** and **Client secret** — you pass them to `connect` in
   step 3 above (not to `.env`).

> **Refresh-token longevity:** while the OAuth app's publishing status is
> **Testing**, Google expires refresh tokens after ~7 days, which will stall
> ingestion. For a long-lived self-hosted setup, set the app to **In production**
> (you can dismiss the "unverified app" warning during consent since you're the
> only user) and re-run `connect` to capture a fresh bundle.

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
