# Task: 061 — Make migrations applicable from scratch (fix disaster recovery)

## Status
PLANNING — plan corrected after review-1 overturned three of my assumptions

## 🔴 URGENT, SEPARATE FROM THIS TASK: your next deploy will fail
Discovered by review-1 and **independent of task 061** — it is broken *today*:

Production's single ledger row has `created_at = 1786715434888`, which is **exactly**
journal entry `0000`'s timestamp (`meta/_journal.json:8`). Drizzle decides what to apply
**purely by timestamp** (`dialect.js:56,62`), so the next migrator run treats `0001`,
`0002` and `0003` as **pending** — even though production already has all four files'
schema.

The `pennypilot-migrate` one-shot calls programmatic `migrate()` (`bootstrap.ts:51`), which
will attempt `0001` and **fail immediately** at
`CREATE TYPE "public"."household_role" AS ENUM('owner','member')` because that type already
exists (`0001_lush_grim_reaper.sql:1`). The migrate container exits non-zero and **the API
stays gated behind it** (`docker-compose.yml:20`).

**Consequence: `make update` will fail and the API will not come up.**
**Mitigating:** all pending files run in one transaction, so the failure rolls back — it
should *not* partially apply DDL or mutate financial rows. This is a broken deploy, not
data corruption.

**Fix required before any deploy:** reconcile production's ledger to the verified schema
horizon. Because Drizzle only reads the greatest `created_at`, a correctly reviewed `0003`
ledger row makes all four journal entries non-pending. That is a **write to a live
financial database** and needs explicit user approval as its own operational task —
deliberately NOT done here.

## Objective
`npm run db:migrate` succeeds against a **completely empty** Postgres database, so the
schema can be rebuilt from migrations after a total loss. Prove it by running it against
an empty database end to end.

## Root Cause (confirmed twice, from opposite directions)
`drizzle-orm/pg-core/dialect.js:60` wraps **all pending migrations in a single
transaction**. Migration `apps/api/drizzle/0001_lush_grim_reaper.sql`:
- **line 2**: `ALTER TYPE ... ADD VALUE 'self'` (adds an enum value)
- **line ~56/58**: `INSERT` using `'self'`

PostgreSQL forbids using an enum value added by a still-uncommitted transaction (PG18
`ALTER TYPE` notes). So `db:migrate` fails at the INSERT and rolls back.

**Corroborating evidence, both directions:**
1. Production's `drizzle.__drizzle_migrations` holds **1 row for 4 migration files** — the
   schema was applied as a **snapshot**, precisely because migrating from zero fails.
2. Task 060 applied the identical SQL to an empty `compass-staging` via
   `psql` **autocommit** and all four files succeeded (58 tables, all owned by `compass`,
   inventory exactly matching `db/schema.ts`). The SQL is fine; **the transaction wrapping
   is the defect.**

## Impact
Disaster recovery is broken: a fresh Postgres cannot be brought up from migrations. For a
self-hosted personal-finance app this is the highest-value defect found in this session.
It also means the `pennypilot-migrate` one-shot in the deploy path has never actually
exercised a from-scratch path.

## Scope (to be confirmed by plan review — options below)
- `apps/api/drizzle/0001_lush_grim_reaper.sql` and/or new migration file(s)
- `apps/api/drizzle/meta/_journal.json` and `meta/*_snapshot.json`
- Possibly `apps/api/package.json` (if a migrate-strategy change is needed)

## Dependencies
- 057, 058, 059, 060 COMPLETE and **committed** — 061 starts from a clean tree so its diff
  is auditable (the three previous reviews were degraded by an uncommitted/untracked tree).

## My assumption about hashes was WRONG (review-1 §5)
I claimed editing a shipped migration would make Drizzle re-apply it. **It would not.**
Drizzle computes a SHA-256 per file (`migrator.js:23`) and stores it (`dialect.js:67`) but
**never compares** stored hash to file hash. It decides solely by comparing the *latest*
ledger row's `created_at` against each journal entry's `folderMillis`
(`dialect.js:56,62`). So:
- Editing `0001` does **not** cause a database past that timestamp to re-run it.
- Drizzle never detects or complains about a historical hash mismatch.
- Conversely, **inserting a migration with an older timestamp would be silently skipped**
  on databases already past it — a real trap for approach A.

## Approaches A, C and D are all REJECTED (review-1 §1-3)
- **C — per-migration transactions: IMPOSSIBLE.** Installed `drizzle-orm@0.45.2` /
  `drizzle-kit@0.31.10`. `MigrationConfig` exposes only `migrationsFolder`,
  `migrationsTable`, `migrationsSchema` (`migrator.d.ts:5`) — no transaction option, and
  drizzle-kit's config has no transaction-strategy field (`index.d.ts:112`).
  `--> statement-breakpoint` is **not** a commit boundary: it only splits statements
  (`migrator.js:12`), and the PG dialect ignores the journal's `bps` value, running every
  statement through the same `tx` (`dialect.js:63`). No newer stable release fixes this —
  current upstream still wraps the whole loop. Upgrading to a prerelease would be both
  ineffective and disproportionate.
- **A — split the enum add into an earlier migration: DOES NOT WORK.** This was my stated
  preference and it is **wrong**. The transaction opens at `dialect.js:60`, *outside* the
  migration loop (lines 61-70), so on a from-scratch run **both** the new enum migration
  and its consumer are pending inside the **same** transaction. The enum value is still
  uncommitted when used. Moving the INSERT to `0002`/`0003`/a new `0004` fails for exactly
  the same reason.
- **B — text casts / query tricks: DO NOT WORK.** PostgreSQL rejects *use* of the newly
  added enum value, not one particular literal syntax. `'self'::text::family_relationship`,
  a `CASE`, or a `pg_enum` lookup all still resolve to the new label.
- **D — document a snapshot bootstrap: rejected.** Leaves recovery dependent on an
  undocumented manual `psql` procedure.

## CHOSEN FIX: transactional enum replacement inside `0001` (review-1 §3)
Replace the `ALTER TYPE ... ADD VALUE` at `0001_lush_grim_reaper.sql:2` with:
```sql
ALTER TYPE "public"."family_relationship" RENAME TO "family_relationship_old";
CREATE TYPE "public"."family_relationship"
  AS ENUM ('self','spouse','child','parent','sibling','other');
ALTER TABLE "family_members" ALTER COLUMN "relationship"
  TYPE "public"."family_relationship"
  USING "relationship"::text::"public"."family_relationship";
DROP TYPE "public"."family_relationship_old";
```
Leave the existing backfill INSERT (line ~58) **unchanged**.

**Why this works:** `CREATE TYPE ... AS ENUM(...)` creates a *complete* type, and values of
a newly *created* enum are immediately usable in the same transaction. The restriction
applies only to values *added* to an existing enum via `ALTER TYPE ... ADD VALUE`.

**Why not just add `self` to `0000`'s enum and delete the ALTER:** that fixes a fresh
database but **breaks a genuine database sitting at the `0000` state** — its enum would
lack `self` while the modified `0001` tries the INSERT. The transactional replacement
handles *both* fresh application and the real `0000 → 0001` upgrade path.

**Safety checks confirmed:** only `family_members.relationship` uses this enum
(`0000:10`, `0000:211`, `persons.ts:15`); the column is `NOT NULL` with **no default**, so
no default expression needs dropping/recreating; and all existing labels are present in the
replacement, so data is preserved. Enum *order* (`self` before `spouse`) is preserved.

## No other latent from-scratch failures (review-1 §4)
Reviewed all four files: the only `ALTER TYPE ... ADD VALUE` is the one above; enums in
`0000`/`0002` are created complete (valid in-transaction); there is no
`CREATE INDEX CONCURRENTLY`; the generated `transactions.search` tsvector column is created
before its GIN index (`0000:855,857`) which is valid; and table/FK/index dependency order is
sound. So fixing `0001` should not merely expose the next failure.

## Acceptance Criteria (draft — to be firmed after review)
- **AC1**: `npm run db:migrate` completes successfully against a **fresh, empty** database
  with **zero** manual intervention, exit 0.
- **AC2**: The resulting schema is **equivalent** to what task 060's autocommit run
  produced — 58 tables, all owned by the migrating role, table inventory exactly matching
  `db/schema.ts`. Compare column/constraint/index inventories, not just table names.
- **AC3**: `drizzle.__drizzle_migrations` is correctly populated by the migrator itself, and
  a second `db:migrate` is a **no-op** ("no migrations to apply").
- **AC4 (corrected)**: My original wording — "seed users before migrating" — is **not
  executable**: on an empty database the `users` table does not exist yet. Two scenarios
  are required instead:
  1. **Fresh reconstruction** — migrate from nothing; proves AC1-AC3.
  2. **Historical upgrade** — establish exactly the `0000` state *including a matching
     `0000` ledger row* (using the installed migrator against a temporary folder fixture
     containing only the real `0000`, **not** hand-invented hashes/timestamps), seed
     representative users, then run the normal migrator over the full folder. It must skip
     `0000`, apply `0001`-`0003`, and create exactly one `self` row per user.
  Assert: one `self` row per pre-existing user; `linked_user_id = users.id`;
  `family_members.user_id = users.id`; `name = users.display_name`; `sort_order = -1`;
  re-running creates no duplicates; a user already holding a `self` row gets no second one;
  and **existing non-`self` family members survive the enum replacement unchanged**.
- **AC4b**: Seed **every** old enum label before applying `0001`, then confirm all values
  and row counts are unchanged by the enum replacement.
- **AC4c**: Enum **order** is preserved — exactly `self, spouse, child, parent, sibling,
  other`. Membership alone is insufficient.
- **AC5**: `npm run typecheck`, `npm run lint`, and the full test suite are unchanged in
  health (26 env-gated failures, 0 regressions).
- **AC6 (now a RELEASE GATE, not documentation)**: **Production deployment is BLOCKED until
  the live migration ledger has been reconciled to the independently verified schema
  horizon.** Before any release, prove the production migrator sees **no** existing
  migration as pending. The dry determination can be made read-only from the ledger and
  journal; the reconciling *write* needs explicit user approval as its own operational task.
  Note this gate is required **whether or not 061 ships** — the deploy is already broken.
- **AC8 (ledger identity)**: A fresh application creates **four** ledger rows carrying the
  journal timestamps and file hashes; a second run leaves them unchanged and is a no-op.
- **AC7**: No schema *content* change — this task fixes **applicability**, not the schema.
  No new table, column, enum value, or constraint beyond re-ordering what already exists.

## Verification
- **T1 (resolved — use a disposable Docker Postgres)**: Docker is available (daemon
  reachable, v29.6.2, user in the `docker` group) and there is **no** local Postgres server
  (`psql` client only; no `postgres`/`initdb`/`pg_ctl`). So run a throwaway Postgres **18**
  container: unique name, **no persistent volume**, a random port bound to **127.0.0.1**,
  its own database/user, a readiness probe before migrating, and container+volume removal
  afterwards. This needs no external privileges.
  **Do NOT use `compass-staging`**: reconnaissance proved only `USAGE`+`CREATE` on
  `public`, *not* ownership of the schema, so `DROP SCHEMA public CASCADE` may be
  unavailable — and reusing it would destroy task 060's useful baseline.
  **Never** touch `compass` (production).
- **T2**: Compare the resulting schema against 060's known-good baseline: 58 tables, owner
  `compass`, plus column/index/constraint fingerprints using the **explicitly defined**
  method recorded in `tasks/060-integration-verification/TASK.md`.
- **T3**: Second `db:migrate` → no-op.
- **T4**: AC4 backfill proof: seed users, migrate, assert each has a `self` person.
- **T5**: `npm run typecheck`, `npm run lint`, `npm run test` (correct exit-code capture —
  redirect then tail; never pipe before `$?`).
- **T6 (corrected)**: `git diff` — the chosen fix needs **only `0001_lush_grim_reaper.sql`**.
  Do **not** change `_journal.json` timestamps and do **not** add a migration file (an
  older-timestamped entry would be silently skipped on databases already past it). Snapshot
  metadata should not need editing either, since the schema the `0001` snapshot represents
  is unchanged. The tree is now **clean** (057-060 committed), so this diff is fully
  auditable — the first task in this session for which that is true.
- **T7**: Compare the resulting schema against task 060's baseline using its **explicitly
  defined** serialization, and additionally compare **enum definitions and generated
  expressions**, not just tables/columns.
- **T8 (optional)**: Inject a disposable late failure in a test fixture to demonstrate the
  batch rolls back, documenting the migrator's all-or-nothing semantics.

## Non-Goals
- Any schema change. Any new feature.
- Repairing production's existing ledger inconsistency — that is an **operational** action
  on a live financial database and needs the user's explicit decision, separately.
- Touching production or re-running task 060's endpoint tests.

## Second finding: bootstrap owners never get a `self` person (review-1 §7)
`bootstrap.ts` migrates (line 53) and *then* creates the owner (line 55) via `createUser()`,
which inserts only into `users` (`users.ts:26`) — it does **not** create a `self` family
member. Normal registration does create one, but bootstrap bypasses that path. So a
freshly bootstrapped owner has no `self` person, and the historical `0001` backfill cannot
help because the user did not exist when it ran.

If the intended invariant is "every user has a self person", AC4 alone does not establish
it. **Recorded as a separate pre-existing functional gap** — needs an explicit decision on
whether bootstrap should create it, then its own task. Not fixed here.

## Open questions for plan review
1. Does the installed drizzle-orm/drizzle-kit support per-migration transactions or a
   transaction opt-out (approach C)? Read the installed source, do not assume.
2. If `0001` is edited or split, what exactly happens to a database whose ledger already
   records it? And to production's 1-row ledger?
3. Is there a disposable database available? `compass` lacks `CREATEDB`, and
   `compass-staging` is now populated by 060.
4. Are there other latent from-scratch failures beyond `0001` that only surface once this
   one is fixed — e.g. another enum-then-use, or a generated column ordering issue? A
   from-scratch run may fail again further along.
