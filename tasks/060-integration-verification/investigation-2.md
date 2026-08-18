# Investigation 2 — compass-staging (192.168.2.183)

Date: 2026-08-18. Investigator: agent (worker). READ-ONLY — no writes performed.

---

## 1. Connectivity

**psql installed:** yes — `/usr/bin/psql`

**Connection form for hyphenated db name (psql flag style):**
```
psql -h 192.168.2.183 -p 5432 -U compass -d "compass-staging"
```
The `-d` value must be quoted because of the hyphen. For `DATABASE_URL`:
```
postgresql://compass:<redacted>@192.168.2.183:5432/compass-staging
```
(The hyphen is safe unquoted in a URL path segment.)

**`SELECT version();` output:**
```
PostgreSQL 18.6 (Debian 18.6-1.pgdg13+2) on x86_64-pc-linux-gnu,
compiled by gcc (Debian 14.2.0-19) 14.2.0, 64-bit
```

---

## 2. Contents — EMPTY DATABASE

```sql
SELECT schemaname, tablename FROM pg_tables
WHERE schemaname NOT IN ('pg_catalog','information_schema')
ORDER BY schemaname, tablename;
-- Result: (0 rows)
```

**No tables exist in any user schema.** The `drizzle.__drizzle_migrations` table does not exist either. This is a completely blank Postgres 18 database — no schema, no data, no migration tracking. It is NOT seeded and contains NO personal financial data.

Counts for all requested tables: **all 0** (no relations exist).

---

## 3. Migration State — CRITICAL: ZERO MIGRATIONS APPLIED

`drizzle.__drizzle_migrations` does not exist. Applied count: **0 of 4**.

All four repo migrations are pending:
- `0000_nosy_lizard.sql` — baseline schema (users, accounts, transactions, postings, card_details, statement_reconciliations with period/total_due_paise/min_due_paise, plus all other core tables)
- `0001_lush_grim_reaper.sql` — households, household_members, linked_user_id on family_members, holder_id on accounts, sharing_grants, splits, split_shares, settlements
- `0002_messy_stepford_cuckoos.sql` — additional columns/tables (exact list not reproduced, but household model is in 0001)
- `0003_lying_thanos.sql` — `card_details.apr_bps`, `cash_apr_bps`, `late_fee_paise`, `interest_free_days`

**Migration 0000** defines: `statement_reconciliations` (with `period TEXT`, `total_due_paise BIGINT`, `min_due_paise BIGINT`).
**Migration 0001** defines: `households`, `household_members`, `sharing_grants`, `splits`, `split_shares`, `settlements`, `family_members.linked_user_id`, `accounts.holder_id`.
**Migration 0003** defines: `card_details.apr_bps`, `cash_apr_bps`, `late_fee_paise`, `interest_free_days`.

**The tests cannot run until `npm run db:migrate` is executed against this database. This is a hard blocker.**

If migrations are run as the `compass` role (which has CREATE on the public schema), tables will be owned by `compass` — correct per CLAUDE.md warnings.

---

## 4. Privileges / Ownership

```sql
SELECT rolname, rolsuper, rolcreatedb FROM pg_roles WHERE rolname='compass';
-- rolname=compass  rolsuper=f  rolcreatedb=f
```

```sql
SELECT has_database_privilege('compass', 'compass-staging', 'CREATE') AS can_create,
       has_schema_privilege('compass', 'public', 'CREATE')            AS can_create_in_public,
       has_schema_privilege('compass', 'public', 'USAGE')             AS can_use_public;
-- t | t | t
```

`compass` is not superuser, not createdb, but has full CREATE + USAGE on the public schema of `compass-staging`. No tables exist yet so no `tableowner` rows to check, but running `db:migrate` as the `compass` role will create all tables owned by `compass` — the correct configuration.

No "permission denied" risk as long as migrations are applied by the `compass` role (not `postgres`).

---

## 5. Redis / Valkey — AVAILABLE, NO AUTH

Network reachability results (via `/bin/nc -zv`):
| Endpoint | Result |
|---|---|
| 192.168.2.183:5432 | Connection succeeded (Postgres confirmed above) |
| **192.168.2.183:6379** | **Connection succeeded** |
| 192.168.2.228:6379 | Connection refused |
| 127.0.0.1:6379 | Connection refused |

Raw protocol test at 192.168.2.183:6379:
```
Sent:    PING\r\n
Received: +PONG
```

**Redis at 192.168.2.183:6379 is reachable and requires no authentication.**

Per INFRA.md, the development cluster uses Redis db 1 (`compass-staging` database, Redis db 1). The coordinator should decide whether `REDIS_URL` for the tests should use db 1 (`redis://192.168.2.183:6379/1`) to match the dev cluster, or db 0 (`redis://192.168.2.183:6379`). At the raw protocol level both are on the same Redis instance; key collision with the live cluster is impossible since 192.168.2.228:6379 is not the same host.

---

## 6. Blast Radius

### planning-analysis.route.test.ts

**Tables written:**
1. `users` — INSERT one row per test case (UUID email suffix)
2. `accounts` — INSERT bank / system accounts (userId-scoped)
3. `transactions` — INSERT (userId-scoped)
4. `postings` — INSERT (transactionId-scoped, cascade-deleted with transactions)
5. `statement_reconciliations` — INSERT (userId-scoped)

**Teardown (`cleanupUser`):**
```ts
await app.db.delete(transactions).where(eq(transactions.userId, userId));
await app.db.delete(statementReconciliations).where(eq(statementReconciliations.userId, userId));
await app.db.delete(accounts).where(eq(accounts.userId, userId));
await app.db.delete(users).where(eq(users.id, userId));
```
Every DELETE is scoped to a freshly generated `userId` (UUID). No unscoped DELETE, TRUNCATE, or UPDATE. Postings are cascade-deleted when transactions are deleted (FK `ON DELETE CASCADE` confirmed in migration 0000). Session keys in Redis are destroyed via `destroySession` with the specific session ID.

### revolving-debt.route.test.ts

**Tables written:**
1. `users` — INSERT one row per test case (UUID email suffix)
2. `accounts` — INSERT credit_card accounts (userId-scoped)
3. `card_details` — INSERT (userId-scoped)
4. `statement_reconciliations` — INSERT (userId-scoped)

**Teardown (`cleanupUser`):**
```ts
await app.db.delete(statementReconciliations).where(eq(statementReconciliations.userId, userId));
await app.db.delete(cardDetails).where(eq(cardDetails.userId, userId));
await app.db.delete(accounts).where(eq(accounts.userId, userId));
await app.db.delete(users).where(eq(users.id, userId));
```
Again, every DELETE is scoped to the freshly created `userId`. No unscoped operations. FK-safe deletion order observed.

**Neither test file contains any unscoped DELETE, UPDATE, or TRUNCATE.** Pre-existing rows (if any existed after migration) cannot be touched by any test operation.

### Required env vars (both files):
- `DATABASE_URL`
- `REDIS_URL`
- `SESSION_SECRET`
Plus everything `loadConfig()` pulls from `config.ts` (e.g. `SESSION_SECRET`, `PORT`, etc.).

---

## 7. INFRA.md Summary — Postgres / Redis Topology

**Production cluster** (`~/infra` on host 192.168.2.228):
- Postgres 18 container `pennypilot-postgres`, internal IP 172.31.0.8, no host port published. Database `compass`, role `compass`.
- Valkey 9.1.1 container `pennypilot-valkey`, internal IP 172.31.0.9, port 6379 internal only.

**Development cluster** (`~/infra-dev` on the SAME machine 192.168.2.228):
- Bridge: 172.32.0.0/24
- Database: `compass-staging`
- Redis: db 1
- Hostname: `compass-dev.udaikiran.dev`

Note: The target host 192.168.2.183 is a separate physical/VM machine distinct from the documented infra host (192.168.2.228). Both Postgres and Redis ports are accessible on 192.168.2.183 without the Docker network isolation that applies on 192.168.2.228. No staging setup documentation exists in INFRA.md for 192.168.2.183 specifically.

---

## Summary Verdicts

**(a) SAFE to write to `compass-staging`?**
YES — the database is completely empty (no tables, no data, no personal financial information). Both test files scope all INSERTs and DELETEs to freshly generated UUIDs; no pre-existing row can be affected. There is zero blast-radius risk from pre-existing data because there is none.

**(b) Schema current enough to run the tests?**
NO — the schema is completely absent. **All 4 migrations (0000–0003) must be applied first.** After `npm run db:migrate` with `DATABASE_URL=postgresql://compass:<redacted>@192.168.2.183:5432/compass-staging`, the schema will be at the current repo head and all required columns (`apr_bps`, `statement_reconciliations.period`, etc.) will exist. Migrations should be run as the `compass` role (which it will be, given the DATABASE_URL). This is the only blocker for the tests.

**(c) Redis available, or a blocker?**
AVAILABLE — `192.168.2.183:6379` responds to PING without authentication. `REDIS_URL=redis://192.168.2.183:6379` (or `/1` for db isolation) will work. Not a blocker.
