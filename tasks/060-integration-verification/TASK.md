# Task: 060 — Close the real-Postgres serializer risk (run the AC4b tests)

## Status
COMPLETE — functional objective achieved; two evidence-quality caveats recorded below
rather than papered over. Codex confirmed **no rerun is needed** to close them.

## Outcome: the real-Postgres serializer risk is CLOSED for the happy path

**12/12 tests passed, exit 0.** Verified by review-2 as genuinely exercising real Postgres,
not passing trivially:
- Test count checked against source: **4** (revolving-debt) + **8** (planning) = 12, with
  **0 skipped**. Nothing silently omitted.
- Non-empty `cards` array is a real assertion (`cards.length > 0`,
  `revolving-debt.route.test.ts:176`), against a genuinely inserted account + card_details
  + statement row (`totalDuePaise: 5_000_000`, valid `YYYY-MM`).
- The exact 100_000-paise month is a real assertion
  (`planning-analysis.route.test.ts:241`) on a **freshly generated user**, so it could not
  be satisfied by pre-existing data.
- The tests **cannot** silently skip — both throw at module load without
  `DATABASE_URL`/`REDIS_URL`/`SESSION_SECRET`.

**Schema application worked, confirming the diagnosis.** All four files applied cleanly
under `psql -X -v ON_ERROR_STOP=1` autocommit (each exit 0), proving the 0001 failure is
specifically Drizzle's **transaction wrapping**, not bad SQL. Codex independently imported
`db/schema.ts` and found **exactly 58 table definitions whose sorted names exactly match**
the 58 public tables now in staging — no missing or extra tables. All 58 owned by
`compass`. `drizzle.__drizzle_migrations` genuinely **absent**, not fabricated (AC10 ✅).

**Production untouched.** Row counts still **1 / 21 / 21 / 42**, independently re-checked
in a read-only transaction. Codex found no evidence any operation wrote to production.

**Redis isolation proven, not assumed.** The `rl:read:127.0.0.1` key appearing in **db 15**
is *stronger* evidence than option-parsing: the security plugin writes rate-limit buckets
via `app.redis` (`security.ts:82`), so its landing in db 15 proves the app's own client
honoured `/15`. No code path constructs a db-0 client; `buildApp()`/`startJobs()` never
run, so BullMQ was untouched.

**Secret hygiene (AC7) ✅** — the password and its fragments appear **nowhere** in the repo.

## Evidence-quality caveats (honest, not dismissed)

1. **AC4 is NOT independently reproducible.** The implementer recorded fingerprint *values*
   but not the SQL or serialization method, so a reviewer cannot confirm they were
   deterministic or complete. Codex computed its own under an explicitly defined method —
   `md5(jsonb_agg(to_jsonb(row) ORDER BY id)::text)` → users `446b4640…`, accounts
   `ee24a354…`, transactions `477786ae…`, postings `d45ba0f1…`; column inventory
   `a46660ef…`; 109 indexes `f0ebc42b…`; 536 constraints `06539318…`. These **differ** from
   the reported values, but that proves nothing either way since the algorithms differ.
   **Use Codex's defined-method hashes as the auditable baseline from now on.** The
   non-damage conclusion rests on row counts plus the repeated fail-closed target gate,
   not on an auditable cryptographic proof.
2. **AC6 was written too strictly and is NOT literally satisfied.** I required db 0
   unchanged, but db 0 is a **live production keyspace** — it went 1485 → 1488 → 1491
   across observations, i.e. it keeps moving from external activity. Recorded as an
   **explained exception**. db 1 stayed 0; db 15 returned to 0.
3. **Historical negatives cannot be proven after the fact.** "`db:migrate` never run", "no
   `MONITOR`", "nothing committed" rest on the implementer's assertion — no shell audit log
   or baseline commit hash was captured. Also, `git status` cannot detect content changes
   *inside* an already-untracked file, so baseline-relative status alone does not prove
   those files' contents were unchanged. **Another instance of the uncommitted tree
   degrading verification.** Future execution-only tasks should capture a baseline commit
   hash plus checksums of untracked targets.

## STILL OPEN — this run proved the happy path only
Both documented hazards remain open in practice:
1. **Unsafe integers.** `income-surplus.ts:163` does `Number(row.income)` and
   `revolving-debt.ts:161` does the same for aggregate postings. The tested amounts
   (100_000 and 5_000_000 paise) sit **far below** `Number.MAX_SAFE_INTEGER`, so the
   boundary was never approached.
2. **`statement_reconciliations.period` is still unconstrained `text`** (`spines.ts:204`)
   against a strict `YYYY-MM` contract. The tests inserted **valid** periods only; no
   malformed legacy value was exercised.

Precise nuance from review-2: the data-completeness fixture's statement period is **not**
serialized into its response — the service reads it only to order reconciliation rows
(`data-completeness.ts:207`). So the meaningful period happy-path proof comes from
**revolving-debt alone**.

**What a reader should believe:** these three endpoints return 200 with serializer-valid
bodies against *representative, well-formed* Postgres data. They are **not** proven safe
against adversarial, corrupt, legacy, or out-of-range database values.

## Cleanup: complete
Staging fixture tables all 0 rows; Redis db 15 and db 1 at 0 keys; the exact rate-limit key
absent (`DEL` returned 0 — already expired); no Drizzle ledger; nothing staged; `.env` never
created; no source file modified.

## Objective
Execute the two `DATABASE_URL`-gated integration tests written in task 059 against a
real Postgres + Redis, proving the three v2.2.0 endpoints return **HTTP 200** with
serializer-valid bodies against genuine database output. This is the one risk task 059
could not retire; it is currently OPEN by design.

Target files:
- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts`

## Root Cause
Not a defect. Fastify installs a **global** `serializerCompiler` (`app.ts:163`), so a
response schema that rejects real service output turns a working request into a **500**.
Task 058 proved the schemas only against typed fixtures; task 059's hermetic tests prove
route wiring with a stubbed service. Neither exercises real Postgres output. Two specific
hazards remain unverified:
- `Number(bigintString)` / Drizzle `mode:"number"` can exceed `Number.MAX_SAFE_INTEGER`,
  which the contract's `.safe()` would then correctly reject.
- `statement_reconciliations.period` is unconstrained `text` (`spines.ts:205`) while the
  contract demands strict `YYYY-MM`.

## Environment findings (investigation-1.md + investigation-2.md)

| Fact | Value |
|---|---|
| `compass` db on 192.168.2.183 | **PRODUCTION — real data** (1 user, 21 accounts, 21 transactions, 42 postings). **DO NOT TOUCH.** |
| `compass-staging` db | **Empty — 0 tables, 0 rows.** Safe to write. |
| `compass` role | `rolcreatedb=f`, `rolsuper=f`, but **has `CREATE` on `public`** in staging ✅ |
| Staging schema | **None applied** — `drizzle.__drizzle_migrations` does not exist. Migrations 0000-0003 must run first. |
| Redis/Valkey 192.168.2.183:6379 | Reachable, `+PONG`, **no auth**. This is the **production Valkey** (BullMQ store). |
| Redis 192.168.2.228:6379 / 127.0.0.1:6379 | Unreachable. |
| Test blast radius | Verified: every INSERT/DELETE is scoped to freshly generated user UUIDs; FK-safe per-test teardown; **no unscoped DELETE/TRUNCATE/UPDATE anywhere** in either file. |
| Required env | `DATABASE_URL`, `REDIS_URL`, `SESSION_SECRET` (+ whatever `loadConfig()` needs). |

## Dependencies
- 057, 058, 059 (all COMPLETE).

## Plan (revised after review-1's NO-GO)

- **P0 (secret hygiene, before anything).** Do **not** put the password literally on any
  command line — it enters shell history and may surface in captured output. Read it into
  a shell variable without echoing, build `PGPASSWORD` / the URL from variables, keep
  `set +x`, never run `env`/`printenv`/`ps e`, and unset afterwards. For `psql` prefer
  `PGPASSWORD` + explicit `-h/-U/-d` over a credential-bearing URI. Take a baseline
  `git status --short` first (the tree is already dirty — T7 is baseline-relative, not
  "expect empty").

- **P1 (target-assertion gate — repeat before EVERY write-capable phase).** Node
  precedence is already proven safe (process env beats `--env-file`; verified on
  v24.18.0; and no root `.env` exists), and `drizzle.config.ts:3` / `config.ts:8` throw
  when `DATABASE_URL` is missing, so the config fails closed. But that does not protect
  against a correctly-passed-yet-mistyped URL. So immediately before each write phase,
  assert the **effective** target and **fail closed** — do not merely eyeball it:
  ```sql
  SELECT current_database(), current_user, inet_server_addr(), inet_server_port();
  ```
  Require exactly `compass-staging` / `compass` / `192.168.2.183`. **If it reports
  `compass`, ABORT immediately.**

- **P2 (REVISED — the Drizzle migrator cannot be used).** `npm run db:migrate` **will
  fail** on a fresh database: the migrator wraps all pending migrations in one
  transaction (`drizzle-orm/pg-core/dialect.js:60`), while `0001_lush_grim_reaper.sql`
  adds enum value `self` (line 2) and then INSERTs using `'self'` (line 56) inside that
  same transaction — which PostgreSQL forbids. **Do not run `db:migrate`.**

  Instead apply the four SQL files with `psql` in **autocommit** (no `-1`, no wrapping
  `BEGIN`), so each statement commits individually and the enum value is committed before
  use. Use `psql -X -v ON_ERROR_STOP=1` (`-X` ignores any user `.psqlrc`).
  **Verify the premise first:** confirm none of the four files contains an explicit
  `BEGIN`/`COMMIT` (they use `--> statement-breakpoint` separators). If any does, STOP
  and report.

  **Deliberate consequence:** staging will have the schema but **no Drizzle ledger**.
  That is accepted — see Decisions. Do **not** improvise `drizzle.__drizzle_migrations`
  rows, and do **not** run `db:migrate` against staging afterwards.

- **P2b (schema proof)**: verify the columns the tests need exist —
  `statement_reconciliations.period/total_due_paise/min_due_paise`,
  `card_details.apr_bps/cash_apr_bps/late_fee_paise/interest_free_days`, and the
  household/person-model tables. Confirm `tableowner = compass` for public tables
  (CLAUDE.md: wrong-role migration causes "permission denied").

- **P3 (Redis isolation)**: use `redis://192.168.2.183:6379/15`. Verified that ioredis
  honours the `/15` path (`infra/redis.ts:3-4`; parsed `db=15`), so isolation is real.
  db 0 is the production BullMQ/session keyspace and INFRA.md puts the dev cluster on
  db 1; 15 avoids both. Before writing: `SELECT 15` must return OK **and** `DBSIZE` must
  be **0** (this also detects a server configured with <16 logical DBs). Capture
  `DBSIZE` for db 0 and db 1 as coarse sentinels before and after. **Never**
  `FLUSHDB`/`FLUSHALL`, no wildcard/SCAN deletion, and do not use `MONITOR`.

- **P4**: generate a throwaway random `SESSION_SECRET`. Never persist it.

- **P5**: run **exactly the two target files** — `node --test --test-concurrency=1 <fileA> <fileB>`.
  Do **not** invoke the workspace `test` script (it globs every API test).

- **P6**: report results. **A failing test is a finding, not a setback** — it would be the
  first real evidence about serializer behaviour against genuine data, which is the whole
  point. Diagnose it; never weaken, skip, or delete the test.

## Acceptance Criteria
- **AC1**: Both test files execute (no `requireEnv` module-load throw) and their literal
  output is captured with an accurate exit code.
- **AC2**: Every test asserting HTTP **200** either passes, or a failure is diagnosed with
  its literal error and root cause identified. **A failing test must NOT be weakened,
  skipped, or deleted.**
- **AC3**: Real-DB serializer behaviour is now **evidenced** — specifically that
  `revolving-debt` returns a **non-empty** `cards` array parsed by
  `HouseholdRevolvingDebtSchema`, and that `income-surplus` returns the exact inserted
  100_000-paise month.
- **AC4 (strengthened — counts alone are insufficient)**: Production `compass` is
  provably untouched. Row counts unchanged (1/21/21/42) is retained only as a **secondary**
  check, because an UPDATE or delete-and-reinsert would leave counts identical. Primary
  evidence: deterministic **row-data fingerprints** (stable ordering, unambiguous
  serialization) plus a **schema fingerprint** for the production tables, captured
  **before and after** and compared. Prevention outranks evidence, so the P1 target
  assertion must gate every write phase.
- **AC5**: Teardown worked — after the run, `compass-staging` has **no leftover** test
  users/accounts/transactions/postings/card_details/statement_reconciliations. Report
  literal counts. (This also validates the FK-ordered cleanup fixed in 059.)
- **AC6**: Redis db 15 `DBSIZE` is 0 before and returns to **0** after (sessions
  destroyed). db 0 and db 1 `DBSIZE` captured before/after as coarse sentinels and
  unchanged. `INFO keyspace` captured before/after. Code inspection already establishes
  the harness never selects db 0/1.
- **AC10**: `drizzle.__drizzle_migrations` is **not** fabricated in staging, and
  `db:migrate` is never executed against any database in this task.
- **AC7**: **No credential is written into any file in the repo** — not `.env`, not
  `tasks/`, not a report. All secrets passed inline only.
- **AC8**: No source file is modified. This task only runs things. If a defect is found,
  it is reported for a separate fix task.
- **AC9**: `.env` is not created or modified.

## Verification
- **T1**: The literal P1 precedence-probe output, proving which DB the inline var targets.
- **T2**: Post-migration schema proof: migration rows, the specific required columns, and
  `tableowner` values.
- **T3**: `DBSIZE` on Redis db 15 before and after.
- **T4**: Full literal test output for both files, with exit code.
- **T5**: Production `compass` **row-data fingerprints + schema fingerprint** before and
  after, compared and shown identical; row counts (1/21/21/42) as a secondary check. All
  queries strictly read-only.
- **T6**: Post-run staging row counts for all six fixture tables, proving clean teardown.
  Migration-created objects are expected staging state, not leftovers.
- **T7**: `git status --short` compared against the **P0 baseline** (the tree is already
  dirty with ~22 files from tasks 057-059) — confirm no source file changed and that
  `.env` was neither created nor modified.
- **T8**: Confirm the four migration SQL files contain no explicit `BEGIN`/`COMMIT`,
  validating the autocommit premise P2 depends on.
- **T9**: If the process dies mid-run leaving fixtures or db-15 keys, clean up **only**
  the exact captured UUIDs/keys after review. **No wildcard or pattern deletion, ever.**

## Non-Goals
- Running the whole test suite against the DB. Only the two target files.
- Fixing the production migration-counter divergence (only 1 row for 4 files) — recorded
  as a **finding for the user**, not touched here.
- Fixing the two documented DB-value hazards (unsafe bigint, unconstrained `period`).
  This task establishes whether the **happy path** works; hardening is separate.
- Seeding staging for general use, or altering production in any way.
- Committing anything.

## Decisions / Notes
- **Staging, never production.** The credentials first supplied pointed at `compass`,
  which reconnaissance proved is live. Redirected to `compass-staging` (empty) before any
  write was issued.
- **Redis db 15, not db 0 or 1.** Only one Valkey instance is reachable and it is
  production. Numbered DBs give keyspace isolation without standing up new infrastructure;
  15 dodges both production (0) and the documented dev cluster (1).
- **A test failure here is a success for the process** — it would be the first real
  evidence about serializer behaviour against genuine data, which is exactly what this
  task exists to obtain.

- **Drizzle ledger deliberately not established in staging.** Codex correctly noted that
  raw-SQL application leaves `drizzle.__drizzle_migrations` absent, contradicting my
  original P2/T2. Rather than improvise ledger rows (whose hashes and timestamps must
  match Drizzle's own reader exactly, and getting them wrong is worse than absence), I
  dropped the ledger requirement. Staging is a **disposable, schema-only** database whose
  sole purpose is running two tests; the ledger has no bearing on that. Recorded so nobody
  later runs `db:migrate` against it and is surprised.
- **Redis db 15 accepted as an explicit exception, not a clean solution.** It shares the
  production Valkey process, memory and persistence; only keyspace is isolated. Accepted
  because the key volume is tiny and bounded, no jobs or global commands run, and standing
  up separate infrastructure is disproportionate. A dedicated Redis would be strictly safer.
- **Migration 0001 will NOT be edited here.** Fixing it properly is task 061 (below).
  Editing a shipped migration changes its hash, which has consequences for any database
  that already applied it — that needs its own plan and review, not a side-effect of a
  test run.

## Findings for the user (not fixed here)

- **🔴 The migrations cannot be applied from scratch — disaster recovery is broken.**
  Drizzle's migrator runs all pending migrations in **one transaction**
  (`drizzle-orm/pg-core/dialect.js:60`), but `0001_lush_grim_reaper.sql` adds enum value
  `self` (line 2) and then INSERTs rows using `'self'` (line 56) within it. PostgreSQL
  forbids using an enum value before its transaction commits
  (PG18 `ALTER TYPE` notes). So `npm run db:migrate` fails on any fresh database.
  **This explains the migration-counter anomaly below**: production's schema was applied
  as a snapshot precisely because migrating from zero does not work. Consequence: the DB
  could not be rebuilt from migrations after a total loss.
  → **Proposed task 061**: split the enum addition into its own migration so it commits
  before use, then prove a from-scratch `db:migrate` succeeds on an empty database.
  Needs its own plan review because rewriting a shipped migration changes its hash.
- **Production Drizzle migration state is inconsistent**: `drizzle.__drizzle_migrations`
  holds **1 row** while the repo ships **4** migration files (0000-0003). The schema was
  evidently applied as a snapshot. This means migration bookkeeping on production is not
  trustworthy, which matters for what the `pennypilot-migrate` one-shot does on the next
  `make update`.
- **Production Postgres and Valkey are reachable from the LAN with no auth on Valkey**,
  despite INFRA.md describing them as Docker-internal with no published host ports.
