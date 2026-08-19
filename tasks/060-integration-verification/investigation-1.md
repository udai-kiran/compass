# Task 060 — Integration Test Infrastructure Investigation

**Date:** 2026-08-18  
**Scope:** READ-ONLY recon for running planning-analysis and revolving-debt route tests.  
**Password handled inline only; never written here — referred to as $PGPASSWORD.**

---

## 1. Connectivity

**psql:** Installed at `/usr/bin/psql` — PostgreSQL 18.4 (Ubuntu).

**Postgres 192.168.2.183:5432:** REACHABLE. `select version()` returns:
```
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu
```
Exit 0.

**Redis 192.168.2.183:6379:** REACHABLE. `PING` → `+PONG` via `/bin/nc`.  
No auth challenge was returned; appears unauthenticated from this host (or IP-trusted).

**Redis 127.0.0.1:6379:** NOT reachable. No local Redis instance.

---

## 2. Database Inventory

Databases on 192.168.2.183 (queried as `compass`):

```
compass           ← PRODUCTION database
compass-staging   ← exists but is completely EMPTY (see §3)
postgres
template0
template1
```

No `compass_test` database exists.

---

## 3. Is `compass` holding real data?

**YES. This is a live production database.**

```
users        | 1
accounts     | 21
transactions | 21
postings     | 42
```

The single user row is the provisioned owner account. The 21 accounts and 21
transactions represent real personal financial data.

**`compass-staging`:** `select table_name from information_schema.tables` returns
0 rows — it is a bare, schema-less database. Unusable as-is for the tests.

---

## 4. Can `compass` role create a database?

```
rolcreatedb | rolsuper
    f       |    f
```

**No.** The `compass` role cannot create databases and is not a superuser.
A dedicated `compass_test` DB cannot be created with these credentials; a
superuser (`postgres`) would be needed.

---

## 5. Schema state

All 6 tables the tests need are present in `compass`:

```
accounts
card_details
postings
statement_reconciliations
transactions
users
```

Drizzle migration tracking (`drizzle.__drizzle_migrations`):

```
id | hash                                                             | created_at
 1 | 5c0ba49a151b63fc35425f99beca8386176e6ac641f339ea6dfe57637aac82fd | 1786715434888
```

Only **1 row** recorded. The repo has **4 migration files** (0000–0003). This
means Drizzle's migration journal and the live DB state are diverged — the
schema was almost certainly applied via a snapshot/restore or a prior `migrate`
that ran all files as a single hash. The tables exist and appear functional, but
the migration counter should not be used as a proxy for schema completeness.

---

## 6. Redis / Valkey

Per INFRA.md: Valkey (Redis-compatible) runs at static IP 172.31.0.9 inside the
`pennypilot_net` Docker bridge. **It publishes no host port.** However, port
6379 on 192.168.2.183 responds to PING from this dev machine — either a Docker
host-port mapping is in effect or the Valkey container is accessible via the host
IP from the LAN.

No Redis is running locally at 127.0.0.1:6379.

**For tests:** `REDIS_URL=redis://192.168.2.183:6379` would point at the
PRODUCTION Valkey instance (same queue/cache store used by the live API).

---

## 7. What the tests require — teardown safety

Both test files share the same pattern:

**Env vars required (throw at module load if absent):**
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`

**Bootstrap:** Both call `buildTestApp()` at module top-level (not inside a
`test()` block), which boots a real Fastify instance connected to Postgres and
Redis. This happens before any test runs.

**Per-test lifecycle:**
- `createUser()` INSERTs a row into `users` with a `randomUUID()`-namespaced
  email (`planning-analysis-route-test-<uuid>@example.invalid` /
  `revolving-debt-route-test-<uuid>@example.invalid`).
- `createSession()` writes a session key into Redis.
- `t.after()` teardown calls `destroySession()` (Redis key removed) then
  `cleanupUser()`.

**`cleanupUser()` deletion order (planning-analysis):**
```
DELETE transactions WHERE user_id = $userId    -- postings cascade
DELETE statement_reconciliations WHERE user_id = $userId
DELETE accounts WHERE user_id = $userId
DELETE users WHERE user_id = $userId
```

**`cleanupUser()` deletion order (revolving-debt):**
```
DELETE statement_reconciliations WHERE user_id = $userId
DELETE card_details WHERE user_id = $userId
DELETE accounts WHERE user_id = $userId
DELETE users WHERE user_id = $userId
```

**No pre-existing rows are touched.** All inserts are keyed to a fresh UUID
user, scoped by `userId`. The teardown is in `t.after()` which runs even on
assertion failure but NOT if the process is killed or the test runner crashes.

**Risk of mutating pre-existing data:** LOW in theory (UUID isolation), but
**not zero** — if `cleanupUser()` fails mid-flight (e.g. unexpected FK), orphan
rows remain in the production database. There is no transaction wrapping the
setup+teardown.

**Second risk:** Both tests write a Redis session into the **production Valkey**,
which is the live queue/cache store. BullMQ queues share this instance; polluting
it with dangling keys is low-risk but not zero.

---

## 8. INFRA.md — Postgres/Redis topology and test/staging databases

Per INFRA.md:

- **Production Postgres:** `pennypilot-postgres` container, static IP 172.31.0.8,
  database `compass`, role `compass`. No host-port published per the services
  table. (Yet port 5432 is reachable from LAN — likely a Docker bridge quirk or
  an undocumented port mapping.)

- **Production Valkey:** `pennypilot-valkey`, static IP 172.31.0.9, no host-port
  published. (Yet 6379 is reachable from LAN — same note.)

- **Dev cluster:** `~/infra-dev`, database `compass-staging`, Redis db 1,
  hostname `compass-dev.udaikiran.dev`. INFRA.md says "the two clusters must
  never share state." The `compass-staging` database exists on 192.168.2.183
  but has no schema (0 tables) — the dev cluster may not have been started or
  migrated recently.

- **No documented test/staging database** exists for CI or integration testing.
  INFRA.md makes no mention of a `compass_test` or throwaway schema.

---

## Safety verdict

**IT IS NOT SAFE to run these tests against `compass`.** Reasons:

1. **Live production data** — 1 real user, 21 real accounts, 21 real
   transactions. Any crash mid-teardown leaves orphan rows.
2. **Production Valkey is shared** — sessions written there pollute the live
   key space used by BullMQ.
3. **`compass` role cannot create databases** — no way to provision a
   `compass_test` DB with these credentials alone; needs a superuser.

**A separate test database is required.** Options:

- **Use `compass-staging`** — it exists but has zero tables. Needs a superuser
  (or a `CREATEDB` grant to `compass`) to run `db:migrate` against it.
  `REDIS_URL` would still need to point somewhere safe (Redis db index 1 per
  INFRA.md for the dev cluster, or a local Redis).

- **Create `compass_test`** — requires a Postgres superuser to `CREATE DATABASE
  compass_test OWNER compass` and then run `npm run db:migrate` with
  `DATABASE_URL` pointing at it.

- **Local Redis** — not running on 127.0.0.1:6379. Would need to be started
  separately (e.g. `docker run -d -p 6379:6379 redis:alpine`) before tests.
