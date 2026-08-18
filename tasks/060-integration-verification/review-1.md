# Safety review: task 060

## Verdict: NO-GO as currently written

The database-targeting gate and Redis URL parsing are sound. The blocker is migration execution: the installed Drizzle migrator wraps all pending migrations in one transaction, while migration 0001 adds an enum value and uses it later in that same transaction. PostgreSQL explicitly forbids that. The proposed direct-`psql` fallback can avoid the transaction problem, but it does not create/populate Drizzle’s migration ledger and therefore contradicts P2/T2.

Required before GO:

1. Replace P2 with a reviewed migration procedure that commits before migration 0001 uses the new enum value and correctly establishes Drizzle bookkeeping.
2. Add immediate target assertions to every PostgreSQL-writing phase.
3. Strengthen Redis and production non-damage evidence.
4. Stop putting the password literally in interactive command lines.

No database or Redis writes were performed during this review.

## 1. P1 database safety gate

### Env-file precedence is safe

Installed Node is v24.18.0. Its documented behavior is:

- `--env-file-if-exists` has the same semantics as `--env-file`.
- If a variable exists both in the process environment and the env file, the process-environment value wins.

This is explicitly documented by the [Node v24.18.0 CLI documentation](https://nodejs.org/download/release/v24.18.0/docs/api/cli.html#--env-filefile).

The read-only local probe produced:

```text
env_exists=no
.env not found. Continuing without it.
winner=sentinel.invalid/sentinel_staging
```

Thus no root `.env` currently exists, and an inline `DATABASE_URL` won under the exact installed Node version and flag. P1’s intended probe is sound. The migration script really does load `../../.env` relative to `apps/api` ([package.json:10](/home/udai/common/compass/apps/api/package.json:10)), matching the root `.env` inspected by P1 ([TASK.md:44](/home/udai/common/compass/tasks/060-integration-verification/TASK.md:44)).

### No dangerous fallback URL exists in executable code

The migration configuration:

- throws if `DATABASE_URL` is absent ([drizzle.config.ts:3](/home/udai/common/compass/apps/api/drizzle.config.ts:3));
- passes exactly `process.env.DATABASE_URL` to Drizzle ([drizzle.config.ts:7](/home/udai/common/compass/apps/api/drizzle.config.ts:7)).

The API configuration also requires a URL and has no database default ([config.ts:8](/home/udai/common/compass/apps/api/src/config.ts:8), [config.ts:10](/home/udai/common/compass/apps/api/src/config.ts:10)). Invalid or missing configuration stops startup ([config.ts:75](/home/udai/common/compass/apps/api/src/config.ts:75)). `createPool` uses exactly the supplied URL ([db.ts:3](/home/udai/common/compass/apps/api/src/infra/db.ts:3)).

The only repository example pointing at a database named `compass` is `.env.example`; nothing automatically loads it. A missing or misspelled variable fails closed rather than silently selecting production.

### Required P1 improvement

The precedence probe proves Node behavior, but it does not protect against a correctly passed yet accidentally mistyped URL. Before each write-capable phase, use the same effective connection and require literal output showing:

```sql
SELECT current_database(), current_user,
       inet_server_addr(), inet_server_port();
```

The operator must check:

```text
current_database = compass-staging
current_user     = compass
server address   = 192.168.2.183
```

Do this immediately before migration and again before tests. Prefer an automated fail-closed assertion, not merely visual inspection.

### Direct `psql` is less ambiguous, but the fallback is incomplete

Explicit `psql -h 192.168.2.183 -U compass -d compass-staging` is safer for target selection than embedding the database in a URL. Use `-X` to prevent a user `.psqlrc` from changing behavior and `-v ON_ERROR_STOP=1`.

However, applying only the four SQL files does not create or populate `drizzle.__drizzle_migrations`. Therefore the fallback at [TASK.md:55](/home/udai/common/compass/tasks/060-integration-verification/TASK.md:55) cannot satisfy [TASK.md:60](/home/udai/common/compass/tasks/060-integration-verification/TASK.md:60) or T2.

## 2. Migration safety

### Privileges and SQL contents

The migrations contain ordinary:

- enum creation;
- table and index creation;
- foreign keys;
- generated `tsvector`;
- table/column alterations;
- one data migration.

There is no `CREATE EXTENSION`, tablespace, role, ownership, grant/revoke, or superuser-only operation. Representative baseline operations begin at [0000:1](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:1); the generated search column and GIN index are at [0000:855](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:855).

`gen_random_uuid()` is built into modern PostgreSQL and does not require these migrations to create `pgcrypto`.

Given the reconnaissance result that `compass` has `USAGE` and `CREATE` on staging’s `public` schema, it can create the migration objects. Objects it creates will be owned by `compass`.

Drizzle also creates the `drizzle` schema and migration table itself:

- schema creation: [dialect.js:54](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:54)
- migration-table creation: [dialect.js:47](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:47)

The role’s reported database-level `CREATE` privilege is sufficient to create the `drizzle` schema.

### Blocking transaction defect

Migration 0001 does this:

- adds enum value `self` ([0001:2](/home/udai/common/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:2));
- later inserts rows using `'self'` ([0001:56](/home/udai/common/compass/apps/api/drizzle/0001_lush_grim_reaper.sql:56)).

The installed Drizzle PostgreSQL migrator opens one transaction around all pending migrations ([dialect.js:60](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:60)) and executes all statements inside it ([dialect.js:61](/home/udai/common/compass/node_modules/drizzle-orm/pg-core/dialect.js:61)).

PostgreSQL 18 states that an enum value added inside a transaction cannot be used until the transaction commits. See [PostgreSQL 18 `ALTER TYPE` notes](https://www.postgresql.org/docs/18/sql-altertype.html#SQL-ALTERTYPE-NOTES).

Therefore `npm run db:migrate` against the empty staging database is expected to fail at the 0001 insert and roll back the migration transaction. The separately created `drizzle` schema/table may remain, but the application schema and migration entries will roll back.

### Required migration-plan change

Use one of these reviewed approaches:

- Preferred: correct migration 0001 in a separate implementation task so the normal migrator is valid.
- For this disposable empty staging database only: apply SQL through explicit `psql` with autocommit, then establish the migration ledger using an exact, reviewed procedure derived from `_journal.json` and Drizzle’s hashes.

Do not improvise manual migration-ledger rows during execution. The exact hashes and `created_at` values must match Drizzle’s own migration reader. Run a subsequent `db:migrate` verification expecting “no migrations to apply”; if it tries to apply anything, stop.

## 3. Redis isolation

### `/15` is honored

The API passes the full Redis URL directly to ioredis ([redis.ts:3](/home/udai/common/compass/apps/api/src/infra/redis.ts:3), [redis.ts:4](/home/udai/common/compass/apps/api/src/infra/redis.ts:4)).

A no-connect, `lazyConnect` inspection using installed ioredis 5.11.1 parsed:

```text
parsed_host=192.168.2.183 parsed_port=6379 parsed_db=15
```

Therefore `redis://192.168.2.183:6379/15` does select database 15. It does not silently use database 0.

Before writes, still verify against the server:

```text
SELECT 15
DBSIZE
```

Require `SELECT` to return `OK` and `DBSIZE` to return zero. This also detects servers configured with fewer than 16 logical databases.

### Redis operations are narrowly scoped

Sessions create two UUID-scoped keys:

- `sess:<random session id>` via `SET` ([session.ts:23](/home/udai/common/compass/apps/api/src/modules/system/services/session.ts:23));
- `sess-user:<fresh user UUID>` via `SADD` ([session.ts:24](/home/udai/common/compass/apps/api/src/modules/system/services/session.ts:24)).

Teardown removes only that UUID’s set member and session key ([session.ts:35](/home/udai/common/compass/apps/api/src/modules/system/services/session.ts:35)). Redis removes an empty set automatically.

No `FLUSHDB`, `FLUSHALL`, global `SCAN` deletion, or wildcard deletion is used by these tests.

### BullMQ is not started

Production `buildApp()` would call `startJobs()` ([app.ts:204](/home/udai/common/compass/apps/api/src/app.ts:204)), and `startJobs()` would create queues and job schedulers ([jobs/index.ts:158](/home/udai/common/compass/apps/api/src/jobs/index.ts:158)).

Neither target test calls `buildApp()` or `startJobs()`. Both construct a reduced app and register only their module routes:

- planning harness: [planning-analysis.route.test.ts:41](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:41)
- credit harness: [revolving-debt.route.test.ts:41](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:41)

Consequently these tests will not create or mutate BullMQ queues.

### Is DB 15 sufficient?

Technically yes for these exact code paths, assuming:

- `SELECT 15` succeeds;
- DB 15 is empty before use;
- only the two reviewed files run;
- no Redis proxy aliases all logical databases.

It remains weaker than a dedicated Redis instance because it shares the production process, memory, persistence, and availability. A runaway client could still affect server capacity. Given the tiny bounded key volume and no jobs/global commands, this is acceptable only as an explicitly acknowledged exception. A separate Redis remains the safest option.

## 4. Test blast radius

### PostgreSQL writes are UUID-scoped

Planning inserts fresh UUID-namespaced users ([planning-analysis.route.test.ts:65](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:65)). Cleanup scopes every delete by that user UUID ([planning-analysis.route.test.ts:77](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:77)). Postings are tied to newly created transactions and accounts ([planning-analysis.route.test.ts:136](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:136)).

Credit does the same:

- fresh user: [revolving-debt.route.test.ts:65](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:65)
- scoped cleanup: [revolving-debt.route.test.ts:77](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:77)
- fixture account/card/statement: [revolving-debt.route.test.ts:101](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:101)

There is no unscoped `DELETE`, `UPDATE`, or `TRUNCATE`.

The remaining risk is process termination before `t.after()` runs. That would leave staging fixtures and DB-15 session keys. It would not damage production if targeting is correct.

### No automatic migrations, storage initialization, jobs, or outbound work

The reduced harness:

- creates DB and Redis clients;
- installs authentication/security;
- registers planning or credit routes;
- closes its connections afterward.

It does not:

- run migrations;
- call `buildApp()`;
- initialize local/S3 storage;
- start BullMQ;
- execute background catch-up work;
- call external AI or object-storage services.

The module-level app construction occurs before tests ([planning-analysis.route.test.ts:60](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:60), [revolving-debt.route.test.ts:60](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:60)), but lazy DB/Redis connections mean writes begin only within test setup.

## 5. Running only the two files

P5 is correct and safer than the full suite. Both files include their own setup, fixtures, sessions, and teardown. They require no seeded state and use fresh UUIDs.

Node’s default test isolation runs each file in its own child process. Their fixtures are independent and UUID-scoped, so parallel execution is acceptable. For maximum operational simplicity and easier cleanup diagnosis, I recommend `--test-concurrency=1`, though it is not required for correctness.

Do not invoke the workspace `test` script, which expands to every API test ([package.json:14](/home/udai/common/compass/apps/api/package.json:14)). Execute the two explicit paths.

## 6. Acceptance criteria and non-damage evidence

AC1–AC3 and AC5–AC9 cover the intended functional result reasonably well. AC4 and AC6 are too strong in wording for the evidence they prescribe.

### AC4 row counts are insufficient

Unchanged counts cannot prove “no write of any kind.” An `UPDATE`, delete-and-reinsert, or value corruption could leave counts unchanged.

Required strengthening:

- Capture deterministic client-side hashes of all rows in at least the four production tables named by AC4, before and after.
- Prefer hashes for all production tables the test services can read or that a mistaken migration could alter.
- Include schema fingerprints for production, since an accidental migration could change schema without changing row counts.
- Retain the counts as a simple secondary check.

The hashing queries must be read-only and deterministic, with stable ordering and unambiguous serialization.

Most importantly, prevention is stronger than after-the-fact evidence: add effective-target assertions before migration and tests.

### Redis evidence

DB 15 `DBSIZE=0` before and after is strong for cleanup because it begins empty. Add:

- `INFO keyspace` before/after;
- DB 0 and DB 1 `DBSIZE` before/after as coarse sentinels;
- optionally hashes of the sorted key names in DB 0 and DB 1.

DBSIZE alone cannot prove that values in existing keys were not modified, but code inspection establishes that the target harness never selects those DBs. Avoid `MONITOR`, which is global and operationally intrusive.

### Staging cleanup

AC5 should also include the `sess-user:<UUID>` keys indirectly through DB-15 emptiness. Capture generated fixture UUIDs in test output only if already available; do not weaken tests or edit source merely to expose them.

Migration-created objects are expected staging state, not test leftovers.

### Add explicit failure cleanup

If the process crashes and DB 15 or staging fixtures remain, do not use wildcard deletion. Identify only the exact test prefixes/fresh UUIDs and remove those explicitly after human review.

## 7. Secret hygiene

The plan’s “inline only” wording is not enough. A literal inline assignment such as:

```sh
DATABASE_URL='postgresql://compass:password@...'
```

can enter interactive shell history. It may also appear in terminal capture, process inspection, copied command output, or a diagnostic report.

Safer procedure:

- Read the password silently into a shell variable, or obtain it from an existing non-repository secret mechanism.
- Construct/export the URL in the current shell without printing it.
- Execute commands using variable names, so history contains no secret.
- For `psql`, prefer `PGPASSWORD` plus explicit `-h/-U/-d`, avoiding a credential-bearing URI.
- Disable shell tracing (`set +x`) and do not use `env`, `printenv`, or `ps e`.
- Do not enable Node diagnostic reports; reports can contain environment variables unless specifically excluded.
- Redact host/database output with URL parsing rather than regex-printing the full URL.
- Unset secret variables afterward.

The target Fastify apps use `logger: false`, so their normal output should not print connection configuration. `loadConfig()` reports only field names and validation errors, not values ([config.ts:75](/home/udai/common/compass/apps/api/src/config.ts:75)). Drizzle normally does not print the password, but failures from dependencies cannot be guaranteed never to include configuration. Capture output through a redaction filter if it will be retained.

The repository’s `redact.ts` helper is not automatically applied to shell output, Drizzle CLI output, or Node test-runner failures, so its existence does not solve this risk.

T7 should compare against a baseline `git status --short`, because the worktree may already contain user changes. It should not merely expect an empty status.

## Required revised safety gates

Before this becomes GO, amend the plan to require:

1. Baseline `git status --short`.
2. Secret acquisition without literal credentials in command history.
3. Effective PostgreSQL target assertion before every write-capable phase.
4. A migration procedure that handles the 0001 enum commit boundary and correctly creates Drizzle bookkeeping.
5. `psql -X -v ON_ERROR_STOP=1` for any manual SQL.
6. Post-migration normal-migrator verification that nothing remains pending.
7. Redis `SELECT 15`, successful response, and zero `DBSIZE` before tests.
8. Explicit two-file invocation, preferably `--test-concurrency=1`.
9. Production row-data and schema fingerprints before/after, not counts alone.
10. DB 0/1 coarse Redis sentinels and DB 15 zero before/after.
11. Baseline-relative final `git status`, including explicit confirmation that `.env` was neither created nor modified.

With those changes—and only after the migration transaction issue is resolved—the two tests themselves are sufficiently isolated for a controlled GO against `compass-staging` and Redis DB 15.