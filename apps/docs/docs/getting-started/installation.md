---
sidebar_position: 1
title: Installation
---

# Docker Installation

Clone the repo, configure environment variables, and start the app.

## Prerequisites

- Docker and Docker Compose
- Postgres and Redis running on external machines (not included in the compose stack) — provide their endpoints as `DATABASE_URL` and `REDIS_URL` in `.env`

## Self-hosting notes

- **Postgres and Redis must be reachable from inside the Docker network.** Endpoints like `localhost` in `DATABASE_URL` or `REDIS_URL` will not resolve from containers. Use the actual IP/hostname or a Docker network name.
- **Database ownership:** Connect and migrate as the `compass` app role, not `postgres`. If tables are owned by `postgres`, the app will encounter "permission denied" errors.
- **Do not share a database or Redis instance between a dev and production deployment.** Sessions and BullMQ job queues are stored in both, and concurrent writes will cause data corruption (net-worth rows upserted per date, session collisions, duplicate job execution).
- **Object storage:** uploads go to `STORAGE_DIR` (disk, default `./data/attachments`) unless S3/MinIO is configured. Consult `.env.example` for S3 settings if you want bucket-based storage.

## Quick start

```bash
git clone <repo-url> && cd PennyPilot
cp .env.example .env
```

Edit `.env` to set:
- `DATABASE_URL` — PostgreSQL connection string (e.g. `postgres://user:pass@host:5432/compass`)
- `REDIS_URL` — Redis endpoint (e.g. `redis://host:6379`)
- `SESSION_SECRET` — a random string for session encryption (at least 32 characters)
- `OWNER_EMAIL` — email address for the owner account
- `OWNER_PASSWORD` — password for the owner account (minimum 8 characters)
- `SIGNUP_ENABLED` — set to `false` for a private single-user instance. **Defaults to `true`**, which lets anyone who can reach the deployment create an account.

Then build and run:

```bash
docker compose up -d --build
```

The `migrate` service runs automatically on first start, applying database migrations and provisioning the owner account from `OWNER_EMAIL` and `OWNER_PASSWORD`. Once migrations are complete, the API starts. The web UI is served by Caddy on `WEB_PORT` — `.env.example` sets `8090`, so the app is at http://localhost:8090. The API itself stays internal on port 3001.

> **This documentation is served without authentication.** Caddy serves it from the same port as the app at `/docs/` (e.g. http://localhost:8090/docs/), so anyone who can reach the deployment can read it even without logging in. It contains no credentials or user data — only operator documentation, including environment-variable names, the backup procedure, and what the AI/email pipeline sends to your model. If your deployment is internet-facing and you would rather not expose that, put `/docs/` behind your reverse proxy's auth or drop the `/docs/*` handler from `apps/web/Caddyfile`.

> **Note:** For manual migrations outside Docker, run `npm install && npm run db:migrate`. Ensure the `compass` app role owns the tables—if you created the database as the `postgres` role, reset ownership or the app will hit "permission denied" errors.
