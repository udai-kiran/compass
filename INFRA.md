# INFRA.md

Full reference for the production deployment of Compass (PennyPilot) on the
self-hosted infra host at **192.168.2.228**.

---

## Overview

A single Docker Compose stack runs on the host at `192.168.2.228`. The stack is
managed from `~/infra` using a `Makefile` that wraps `docker compose`. Compose's
`include:` directive pulls in the PennyPilot app stack from
`~/infra/pennypilot/docker-compose.yml`; the top-level
`~/infra/docker-compose.yml` adds the `cloudflared` ingress container.

Ingress is a **Cloudflare Tunnel** (`cloudflared` container). It dials outbound
to Cloudflare — no port is published on the LAN or on the router. Cloudflare
terminates HTTPS at the edge, so `compass.udaikiran.dev` is served over TLS
without any local certificate. There is no Caddy, no Nginx, and no internal CA
in this cluster.

All state (Postgres, Valkey, MinIO) lives on this host in Docker named volumes.
As of 2026-08-08, nothing depends on the old LAN box at 192.168.2.196 any more.

A parallel **development** cluster lives at `~/infra-dev` on the same machine
(project `infra-dev`, bridge `172.32.0.0/24`, database `compass-staging`, Redis
db 1, hostname `compass-dev.udaikiran.dev`). The two clusters must never share
state.

---

## Directory layout

```
~/infra/
├── .claude/
│   └── settings.local.json          # Claude Code local settings (gitignored)
├── pennypilot/
│   └── docker-compose.yml           # PennyPilot services (postgres, valkey, minio,
│                                    #   migrate, api, ingestor, extractor, web)
├── .env                             # Live secrets — gitignored, never commit
├── .env.example                     # Template with all variable names + comments
├── .gitignore                       # Ignores .env, .claude/, backups/
├── CLAUDE.md                        # Infra-host guidance for Claude Code
├── Makefile                         # Wraps docker compose commands
├── docker-compose.override.yml      # Local-only: publishes web on 127.0.0.1:8080
│                                    #   for smoke-testing; not present in prod once
│                                    #   cloudflared is permanently live
└── docker-compose.yml               # Top-level: project name, include, cloudflared
```

---

## Services & ports

All containers run on the `pennypilot_net` bridge (172.31.0.0/24). Nothing is
published to the host LAN. `cloudflared` is the sole inbound path from the
internet; everything else is reachable only within the bridge or via SSH tunnel.

| Service | Container name | Image | Internal port | Host port | Notes |
|---|---|---|---|---|---|
| `cloudflared` | `cloudflared` | `cloudflare/cloudflared:latest` | — | none | Outbound Cloudflare Tunnel; no inbound port. Routes `compass.udaikiran.dev` → `http://pennypilot-web:80`. |
| `postgres` | `pennypilot-postgres` | `pgvector/pgvector:pg18-trixie` | 5432 | none | Postgres 18.4 + pgvector 0.8.6. Static IP 172.31.0.8. |
| `valkey` | `pennypilot-valkey` | `valkey/valkey:9.1.1-alpine` | 6379 | none | Redis-compatible queue/cache (BullMQ). Static IP 172.31.0.9. AOF enabled. |
| `minio` | `pennypilot-minio` | `minio/minio:latest` | 9000 (S3 API), 9001 (console) | none | S3-compatible object storage. Static IP 172.31.0.7. Console intentionally not tunnelled — reach via SSH tunnel to 172.31.0.7:9001. |
| `pennypilot-migrate` | `pennypilot-migrate` | `ghcr.io/udai-kiran/pennypilot-api:${COMPASS_VERSION}` | — | none | One-shot on every `make up`. Applies Drizzle migrations and provisions the owner account. Exits 0 on success; `pennypilot-api` gates on `service_completed_successfully`. |
| `pennypilot-api` | `pennypilot-api` | `ghcr.io/udai-kiran/pennypilot-api:${COMPASS_VERSION}` | 3001 | none | Fastify API. Static IP 172.31.0.4, network alias `api` (required by the baked Caddyfile in the web image). |
| `pennypilot-ingestor` | `pennypilot-ingestor` | `ghcr.io/udai-kiran/pennypilot-ingestor:${COMPASS_VERSION}` | — | none | Mailbox polling worker. Static IP 172.31.0.5. |
| `pennypilot-extractor` | `pennypilot-extractor` | `ghcr.io/udai-kiran/pennypilot-extractor:${COMPASS_VERSION}` | — | none | AI extraction worker. Static IP 172.31.0.6. |
| `pennypilot-web` | `pennypilot-web` | `ghcr.io/udai-kiran/pennypilot-web:${COMPASS_VERSION}` | 80 | none (127.0.0.1:8080 via override) | Caddy serving the React SPA; reverse-proxies `/api/*` and `/health` to the API. Static IP 172.31.0.2. This is the container that cloudflared forwards to. |

Images for `pennypilot-*` are **private on GHCR** (`ghcr.io/udai-kiran/`). Log
in before `make pull` or `make update`:

```bash
gh auth token | docker login ghcr.io -u <your-github-user> --password-stdin
# token needs read:packages scope:
gh auth refresh -h github.com -s read:packages
```

---

## Volumes & persistence

All named volumes are prefixed `infra_` by Compose (the project name is
`infra`). The dev cluster uses the prefix `infra-dev_` — never mount one
cluster's volume into the other.

| Volume | Mount path in container | Service | Holds |
|---|---|---|---|
| `infra_pgdata` | `/var/lib/postgresql` | `pennypilot-postgres` | Postgres 18 cluster — database `compass`, role `compass`. **Do not change this path** — Postgres 18 changed `PGDATA` to `/var/lib/postgresql/18/docker`; the pre-18 path `/var/lib/postgresql/data` would create an anonymous volume that disappears on recreate. |
| `infra_valkey_data` | `/data` | `pennypilot-valkey` | Valkey AOF persistence — queued/delayed BullMQ jobs survive restarts. |
| `infra_minio_data` | `/data` | `pennypilot-minio` | Uploaded files: attachments, insurance policy docs, health cards. |
| `infra_pennypilot_data` | `/data` | `pennypilot-api` | App-written backups (`/data/backups`) and fallback attachment dir (`/data/attachments`, used only if MinIO is unavailable). |

Verify the Postgres mount is correct after any recreate:

```bash
docker inspect pennypilot-postgres \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
# must print:  infra_pgdata -> /var/lib/postgresql
```

---

## Networking

### Docker network

One bridge network: **`pennypilot_net`**, `172.31.0.0/24`, defined in
`pennypilot/docker-compose.yml` and joined by `cloudflared` (in the top-level
compose). Static IP assignments:

| IP | Container |
|---|---|
| 172.31.0.2 | `pennypilot-web` |
| 172.31.0.3 | (free — was the old `tailscale` container) |
| 172.31.0.4 | `pennypilot-api` (alias: `api`) |
| 172.31.0.5 | `pennypilot-ingestor` |
| 172.31.0.6 | `pennypilot-extractor` |
| 172.31.0.7 | `pennypilot-minio` |
| 172.31.0.8 | `pennypilot-postgres` |
| 172.31.0.9 | `pennypilot-valkey` |

`cloudflared` joins `pennypilot_net` without a pinned IP (dynamic allocation
starts at `.2` but `pennypilot-web` owns that; cloudflared gets the next free
address).

### Ingress: Cloudflare Tunnel

```
internet → Cloudflare edge (TLS terminated) → cloudflared → pennypilot-web:80
```

- **Public hostname:** `compass.udaikiran.dev`
- The tunnel and its `public-hostname → service` routing are configured in the
  **Cloudflare Zero Trust dashboard** (Networks → Tunnels → Public Hostnames),
  not in any local file. The service is set to `http://pennypilot-web:80`.
- `cloudflared` dials outbound using `CF_TUNNEL_TOKEN`. No inbound port is
  opened on the router or LAN.
- There is **no local TLS certificate** and no internal CA. Cloudflare's edge
  terminates HTTPS, which satisfies the app's `Secure` session cookie.

To add a new service to the internet: create a Public Hostname entry in the
Cloudflare dashboard pointing at `http://<container-name>:<port>`. Nothing on
the host needs to change. Services that must not be internet-facing (e.g. MinIO
console) get no public hostname and are reachable only via SSH tunnel.

### Historical note

Before 2026-08-05, ingress used a `tailscale` container (kernel-networking
mode) with a `proxy/` Caddy stack and an internal CA. Both are now removed. The
old Tailscale/tailnet URLs are dead. The `proxy/` directory is left on disk for
reference only (it holds `caddy-root.crt`); untrust/remove that CA from any
device it was installed on.

---

## Environment variables

All variables live in `~/infra/.env` (gitignored). Copy `.env.example` to
`.env` and fill in values. **No secret values are listed here — names only.**

### Global

| Variable | Description |
|---|---|
| `TZ` | Timezone for all containers (e.g. `Etc/UTC`) |

### cloudflared

| Variable | Description |
|---|---|
| `CF_TUNNEL_TOKEN` | Cloudflare Tunnel token from the Zero Trust dashboard. Required — compose fails to start without it. Must be a different tunnel from the dev cluster. |

### PennyPilot — root `.env` variables (mapped via `COMPASS_` prefix)

These are read from `.env` and mapped into the containers (the `x-compass-env`
anchor in `pennypilot/docker-compose.yml` handles the renaming).

| Variable | Maps to | Description |
|---|---|---|
| `COMPASS_VERSION` | (image tag) | GHCR image tag to run. Bump to upgrade, then `make update`. |
| `COMPASS_OWNER_EMAIL` | `OWNER_EMAIL` | Owner account email; provisioned by `migrate` on first deploy. One-way. |
| `COMPASS_OWNER_PASSWORD` | `OWNER_PASSWORD` | Owner account password; min 8 chars. Idempotent: changing this does NOT reset an existing password — use the profile page. |
| `COMPASS_DB_USER` | `POSTGRES_USER`, `DATABASE_URL` | Postgres role and superuser for this cluster. |
| `COMPASS_DB_NAME` | `POSTGRES_DB`, `DATABASE_URL` | Postgres database name. |
| `COMPASS_DB_PASSWORD` | `POSTGRES_PASSWORD`, `DATABASE_URL` | Postgres role password. Read by `initdb` on first start only — changing it later requires `ALTER ROLE ... PASSWORD` in the container. |
| `COMPASS_SESSION_SECRET` | `SESSION_SECRET` | Signs session cookies; min 32 chars. Changing it logs everyone out. |
| `COMPASS_BACKUP_KEY` | `BACKUP_KEY` | Encrypts scheduled backups; falls back to `SESSION_SECRET` when empty. |
| `COMPASS_MAILBOX_SECRET` | `MAILBOX_SECRET` | Encrypts mailbox credentials and per-user AI secrets; falls back to `SESSION_SECRET`. |
| `COMPASS_AI_PROVIDER` | `AI_PROVIDER` | `none` \| `anthropic` \| `ollama`. App is fully functional with `none`. |
| `COMPASS_ANTHROPIC_API_KEY` | `ANTHROPIC_API_KEY` | Required if `AI_PROVIDER=anthropic`. |
| `COMPASS_OLLAMA_BASE_URL` | `OLLAMA_BASE_URL` | Required if `AI_PROVIDER=ollama`. |
| `COMPASS_AI_ALLOWED_BASE_URLS` | `AI_ALLOWED_BASE_URLS` | Server-side allowlist of Ollama/custom destinations users may configure. |
| `COMPASS_TRUSTED_ORIGINS` | `TRUSTED_ORIGINS` | Extra browser origins trusted for CSRF; only needed if SPA is on a different host than the API. |
| `COMPASS_S3_ACCESS_KEY` | `MINIO_ROOT_USER`, `S3_ACCESS_KEY` | MinIO root user / S3 access key. |
| `COMPASS_S3_SECRET_KEY` | `MINIO_ROOT_PASSWORD`, `S3_SECRET_KEY` | MinIO root password / S3 secret key. |
| `COMPASS_S3_BUCKET` | `S3_BUCKET` | S3 bucket name (auto-created by the API on boot). |

### pennypilot-api only (set directly in compose, not via `COMPASS_` prefix)

| Variable | Value | Description |
|---|---|---|
| `PORT` | `3001` | Fastify listen port. Fixed — the Caddyfile in the web image hardcodes it. |
| `STORAGE_DIR` | `/data/attachments` | Fallback attachment directory (used only if MinIO is unavailable). |
| `BACKUP_DIR` | `/data/backups` | Where `make backup` dumps land via the API's backup service. |
| `S3_ENDPOINT` | `http://minio:9000` | In-cluster MinIO endpoint. |
| `S3_REGION` | `us-east-1` | Region string (required by S3 SDK; value is arbitrary for MinIO). |
| `S3_FORCE_PATH_STYLE` | `true` | Required for MinIO path-style URL compatibility. |

### Legacy variables (kept in `.env.example`, unused by any compose file)

These are retained only for a one-off `pg_dump` off the old LAN box at
192.168.2.196 when it comes back up. Delete them from `.env` once that migration
is complete.

| Variable | Description |
|---|---|
| `INFRA_DB_HOST` | Old LAN Postgres host |
| `INFRA_DB_PORT` | Old LAN Postgres port |
| `INFRA_DB_USER` | Old LAN Postgres user |
| `INFRA_DB_PASSWORD` | Old LAN Postgres password |

---

## Update / rollback flow

### Upgrade to a new version

```bash
# 1. On the infra host
cd ~/infra

# 2. Edit .env — bump COMPASS_VERSION to the new tag
#    e.g.  COMPASS_VERSION=1.4.0

# 3. Log in to GHCR (needs read:packages scope)
gh auth token | docker login ghcr.io -u <your-github-user> --password-stdin

# 4. Pull new images and recreate any container whose image changed
make update
# Equivalent to: docker compose pull && docker compose up -d
```

`make update` calls `make pull` then `docker compose up -d`. Compose recreates
only the containers whose image digest changed. The `pennypilot-migrate` one-shot
runs again (it is idempotent) and applies any new migrations before the API
starts.

### Rollback

Edit `.env` to the previous tag and run `make update` again.

### Restart a single service

```bash
make restart S=pennypilot-api
# Equivalent to: docker compose up -d --force-recreate pennypilot-api
```

### Full available `make` targets

| Target | Effect |
|---|---|
| `make up` | Start the whole stack in the background |
| `make down` | Stop and remove all containers (keeps volumes) |
| `make restart [S=<service>]` | Force-recreate one or all containers |
| `make pull` | Pull the latest images |
| `make update` | `pull` + `up -d` (recreates changed containers) |
| `make logs [S=<service>]` | Follow logs (all services or one) |
| `make ps` | Show container and healthcheck status |
| `make config` | Render and validate the merged compose config |
| `make backup` | `pg_dump` the compass database into `backups/` |

---

## Backup & restore

### Take a backup

```bash
cd ~/infra
make backup
# Writes backups/compass-YYYYMMDD-HHMMSS.dump (custom format, compressed)
# Reads the role/database from the container's own POSTGRES_* env vars,
# so it can't drift from the compose config.
```

### Restore from a backup

```bash
# Quiesce writers first
docker compose stop pennypilot-api pennypilot-ingestor pennypilot-extractor

# Drop and recreate the database
docker compose exec -T postgres psql -U compass -d postgres \
  -c "DROP DATABASE compass;" \
  -c "CREATE DATABASE compass OWNER compass;"

# Restore
docker compose exec -T postgres pg_restore -U compass -d compass \
  --no-owner --no-privileges \
  < backups/<file>.dump

# Bring writers back up
docker compose up -d
make ps
```

### Notes

- This host holds the **only** copy of production data. Set up a cron for
  `make backup` and copy dumps off-box (e.g. to a NAS or cloud bucket).
- `backups/compass-pre-v1.0.0-reset-20260715-103515.sql` predates ~60 migrations
  and is **not** restorable against the current schema — archive only.

### Migrating data from the old LAN box (192.168.2.196)

When the old box comes back online, follow the procedure in
`~/infra/CLAUDE.md` ("Migrating the old LAN data in") to dump from it and
restore into the current cluster. After that, delete the `INFRA_DB_*` vars
from `.env`.

---

## Debugging

### Check container status and healthchecks

```bash
make ps
# or: docker compose ps
```

### Follow logs

```bash
make logs                          # all services
make logs S=pennypilot-api         # one service
make logs S=cloudflared            # tunnel status
make logs S=postgres
make logs S=pennypilot-migrate     # see migration output
```

A healthy cloudflared start logs `Registered tunnel connection` (typically four,
one per Cloudflare colo) followed by `Updated to new configuration`.

### Open a shell / run a command inside a container

```bash
# Postgres psql
docker compose exec postgres psql -U compass -d compass

# Check applied migrations
docker compose exec postgres psql -U compass -d compass \
  -c "SELECT count(*) FROM drizzle.__drizzle_migrations;"

# Valkey CLI
docker compose exec valkey valkey-cli

# MinIO console (not tunnelled — use an SSH tunnel)
ssh -L 9001:172.31.0.7:9001 udai@192.168.2.183
# then open http://localhost:9001 in a browser
```

### Validate the compose config

```bash
make config
# Renders the fully-merged compose YAML; useful to confirm env substitution.
```

### Check app version and health

```bash
curl https://compass.udaikiran.dev/health
# Returns: {"status":"ok","version":"1.3.0","sha":"...","buildTime":"..."}
```

### Verify the Postgres volume mount

```bash
docker inspect pennypilot-postgres \
  --format '{{range .Mounts}}{{.Name}} -> {{.Destination}}{{"\n"}}{{end}}'
# Expected:  infra_pgdata -> /var/lib/postgresql
```

### Verify Postgres OOM score

```bash
cat /proc/$(docker inspect pennypilot-postgres --format '{{.State.Pid}}')/oom_score_adj
# Expected: -500  (kernel prefers killing Node containers over the database)
```

### Resource usage

```bash
docker stats --no-stream
# Steady-state idle (approximate): postgres ~26 MB, api ~110 MB, web ~11 MB,
# minio ~80 MB, ingestor ~75 MB, extractor ~90 MB, valkey ~4 MB, cloudflared ~18 MB
```
