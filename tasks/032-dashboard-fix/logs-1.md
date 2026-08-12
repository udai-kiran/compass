# Dashboard Fix — Log Collection Run 1

**Date collected:** 2026-08-11  
**Host:** 192.168.2.183  

---

## Discovery: two compose stacks on this host

The brief assumed containers live under `~/infra/`, but `make ps` there returned
empty. A `docker ps -a` showed all running containers carry a `-dev` suffix. The
running stack is under `~/infra-dev/` (`name: infra-dev`). The prod stack
(`~/infra/`, `name: infra`) is **not running**.

All commands below are adapted accordingly. The original exact commands from the
brief are recorded first, then the adapted equivalents.

---

## Step 1 — `make ps` (exact command from brief)

```
$ ssh udai@192.168.2.183 "cd ~/infra && make ps 2>&1"
docker compose ps
NAME      IMAGE     COMMAND   SERVICE   CREATED   STATUS    PORTS
```

Output: **empty table** — prod stack is not running.

Adapted: `cd ~/infra-dev && make ps`

```
NAME                       IMAGE                                            COMMAND                  SERVICE                CREATED       STATUS                 PORTS
cloudflared-dev            cloudflare/cloudflared:latest                    "cloudflared --no-au…"   cloudflared            5 hours ago   Up 5 hours
pennypilot-api-dev         ghcr.io/udai-kiran/pennypilot-api:1.99.0         "docker-entrypoint.s…"   pennypilot-api         5 hours ago   Up 5 hours             3001/tcp
pennypilot-extractor-dev   ghcr.io/udai-kiran/pennypilot-extractor:1.99.0   "docker-entrypoint.s…"   pennypilot-extractor   5 hours ago   Up 5 hours
pennypilot-ingestor-dev    ghcr.io/udai-kiran/pennypilot-ingestor:1.99.0    "docker-entrypoint.s…"   pennypilot-ingestor    5 hours ago   Up 5 hours
pennypilot-minio-dev       minio/minio:latest                               "/usr/bin/docker-ent…"   minio                  5 hours ago   Up 5 hours (healthy)   9000/tcp
pennypilot-postgres-dev    pgvector/pgvector:pg18-trixie                    "docker-entrypoint.s…"   postgres               5 hours ago   Up 5 hours (healthy)   5432/tcp
pennypilot-valkey-dev      valkey/valkey:9.1.1-alpine                       "docker-entrypoint.s…"   valkey                 5 hours ago   Up 5 hours (healthy)   6379/tcp
pennypilot-web-dev         ghcr.io/udai-kiran/pennypilot-web:1.99.0         "caddy run --config …"   pennypilot-web         5 hours ago   Up 5 hours             443/tcp, 2019/tcp, 443/udp, 127.0.0.1:8081->80/tcp
```

(The migrate one-shot exited cleanly and does not appear in the default `ps` view.)

**Container health summary:**

| Container | Status |
|---|---|
| pennypilot-postgres-dev | Up 5 hours (healthy) |
| pennypilot-valkey-dev | Up 5 hours (healthy) |
| pennypilot-minio-dev | Up 5 hours (healthy) |
| pennypilot-api-dev | Up 5 hours (no healthcheck) |
| pennypilot-web-dev | Up 5 hours (no healthcheck) |
| pennypilot-migrate-dev | Exited (0) — completed successfully |

---

## Step 2 — API logs (exact command from brief)

```
$ ssh udai@192.168.2.183 "cd ~/infra && docker compose logs pennypilot-api --tail=100 --no-color 2>&1"
(no output — prod stack not running)
```

Adapted: `cd ~/infra-dev && docker compose logs pennypilot-api --tail=100 --no-color`

The adapted command also returned no output after filtering (the compose log
output pipes through python to strip heartbeats — see below). Full raw log
count: **291 lines** (via `docker logs pennypilot-api-dev 2>&1 | wc -l`).

All 291 lines are accounted for as follows:

- **2 lines** — server startup messages (level 30 / info):
  ```json
  {"level":30,"time":1786444857071,"pid":1,"hostname":"f83133d626e8","msg":"Server listening at http://127.0.0.1:3001"}
  {"level":30,"time":1786444857071,"pid":1,"hostname":"f83133d626e8","msg":"Server listening at http://172.32.0.6:3001"}
  ```
- **289 lines** — BullMQ `system heartbeat` jobs (one per minute, level 30 / info).
- **0 lines** — HTTP request logs.
- **0 lines** — error, warning, or exception logs.

There are **no HTTP request logs at all**. Fastify's default pino logger at
`level: "info"` should log every request. The complete absence of request logs
means the stack has received **zero HTTP traffic** since the containers started
5 hours ago (confirmed by Caddy: its log is also only 14 startup lines, no
access entries).

---

## Step 3 — Migration logs (exact command from brief)

```
$ ssh udai@192.168.2.183 "cd ~/infra && docker compose logs pennypilot-migrate --tail=50 --no-color 2>&1"
(no output — prod stack not running)
```

Adapted: `cd ~/infra-dev && docker compose logs pennypilot-migrate --tail=50 --no-color`

```
pennypilot-migrate-dev  |
pennypilot-migrate-dev  | > @compass/api@0.1.0 db:bootstrap
pennypilot-migrate-dev  | > node --env-file-if-exists=../../.env src/db/bootstrap.ts
pennypilot-migrate-dev  |
pennypilot-migrate-dev  | ../../.env not found. Continuing without it.
pennypilot-migrate-dev  | migrations applied
pennypilot-migrate-dev  | owner already present: udaikiran@outlook.com — leaving password untouched
pennypilot-migrate-dev  | npm notice
pennypilot-migrate-dev  | npm notice New major version of npm available! 11.17.0 -> 12.0.2
pennypilot-migrate-dev  | npm notice Changelog: https://github.com/npm/cli/releases/tag/v12.0.2
pennypilot-migrate-dev  | npm notice To update run: npm install -g npm@12.0.2
pennypilot-migrate-dev  | npm notice
```

**Migrations applied cleanly.** Exit code 0. Owner account present and
untouched.

---

## Step 4 — Error filter (exact command from brief, adapted directory)

```
$ ssh udai@192.168.2.183 "cd ~/infra-dev && docker compose logs pennypilot-api --tail=200 --no-color 2>&1 | grep -i 'error\|warn\|fail\|500\|400\|dashboard\|unhandledRejection'"
```

Output:
```
pennypilot-api-dev  | {"level":30,"time":1786455006288,"pid":1,"hostname":"f83133d626e8","job":"heartbeat","id":"repeat:system.heartbeat:1786455006270","msg":"system heartbeat"}
```

This single match is a **false positive**: `grep -i '500'` matched the
substring `5006` inside the timestamp `1786455006288`. The line is a normal
heartbeat at level 30 (info) with no error content.

**No actual errors, warnings, failures, dashboard hits, or unhandledRejections
appear in the API logs.**

---

## Additional context gathered

### Deployed version vs. current HEAD

`COMPASS_VERSION=1.99.0` in `~/infra-dev/.env`. Git tag `v1.99.0` points to
commit `f58ad0f` — "Merge pull request #163 … refactor/module-migration-phase1-planning".

Commits since v1.99.0 (19 total), showing the most relevant:

```
2251a16 Fix/030 misc bug fixes (#182)
3539239 fix(ingest): remove dead transfer_links survivingPartners block (#181)
4556345 fix(ledger/credit): resolve 4 PR-G1 follow-ups F7/F10/F11/F12 (#180)
ca3fa34 Feat/postings pr g1 (#179)
a38ab24 Feat/postings pr g1 (#178)
4f4e964 feat: postings model PR-F (#175)
5a0d279 fix(api): repair the 57 test failures (#176, #177)
2253623 feat(api): postings model PR-E (#174)
11ecb3c Pr d fullchanges (#173)
54033b9 PR-D full changes (#171)
34c8e0e Feat/postings model pr b (#170)
c9a6174 Feat/postings model pr b (#169)
0441751 feat(api): postings model PR-B (#168)
a77f1ce feat(api): postings model PR-A (#167)
e939100 Merge pull request #166 … postings-model-sp0
```

The deployed image predates the entire postings model migration (PR-A through
PR-G1). At v1.99.0, the dashboard service reads from `transactions.amount_paise`
and `transaction_splits` / `transfer_links` (legacy columns). The current HEAD
dashboard service reads from the `postings` table (`spentByCategory`,
`bankCashTotal`, `getTrends`).

### What the current HEAD dashboard code does

`apps/api/src/modules/planning/services/dashboard.ts` at HEAD:

- `getDashboard` calls `spentByCategory(db, userId, from, to)` — issues SQL
  against `postings p join accounts a … where a.system_kind = 'expenses'`.
- `getTrends` issues two queries against `postings` + `hasCategoryDimension()`.
- `bankCashTotal` delegates to `bankCashBalances` (also postings-based).

**These queries will fail with "relation postings does not exist"** if executed
against a v1.99.0 database schema (which has no `postings` table). Deploying
the current HEAD code to the dev stack without first migrating the DB would
produce a 500 on every `/api/dashboard` and `/api/trends` request.

### Why no request logs exist in the current run

The `infra-dev` stack fronts a separate Cloudflare tunnel. The Caddy web
container (14 log lines, all startup) has received zero HTTP requests since it
started 5 hours ago. Either:
- The dev tunnel is not currently routing any traffic.
- Or all traffic is going to the prod stack URL (which is not running).

The dashboard error the user referenced has therefore not manifested in this
container run's logs — there are no HTTP requests to produce one.

---

## Summary

| Question | Finding |
|---|---|
| Container health | postgres/valkey/minio: healthy; api/web: up; migrate: exited 0 |
| API error lines | None — zero errors, warnings, or exceptions in 291 log lines |
| Dashboard / forecast errors | None visible — zero HTTP request logs in 5 hours |
| Migrations clean | Yes — "migrations applied", owner untouched, exit 0 |
| Exact error message | Not found in logs |

**Root observation:** The "dashboard error" is not visible in the running
container's logs because no HTTP traffic has reached the dev stack since it
started. The error is most likely reproducible by upgrading the dev
`COMPASS_VERSION` to the current HEAD build and hitting `/api/dashboard` —
the deployed v1.99.0 schema has no `postings` table, but the HEAD dashboard
service (`spentByCategory`, `getTrends`, `bankCashTotal`) queries it
unconditionally, so every dashboard request will 500 once a current-HEAD image
is deployed without a matching `db:migrate`.
