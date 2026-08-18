# Sonnet Worker Delegation — Task 061

## Task
Make `npm run db:migrate` work against a completely empty database, restoring
from-scratch disaster recovery.

## Approved fix (settled by review-1 — do not deviate)
In **`apps/api/drizzle/0001_lush_grim_reaper.sql` only**, replace the line-2 statement:
```sql
ALTER TYPE "public"."family_relationship" ADD VALUE 'self' BEFORE 'spouse';
```
with a **transactional enum replacement**:
```sql
ALTER TYPE "public"."family_relationship" RENAME TO "family_relationship_old";
CREATE TYPE "public"."family_relationship" AS ENUM ('self','spouse','child','parent','sibling','other');
ALTER TABLE "family_members" ALTER COLUMN "relationship"
  TYPE "public"."family_relationship"
  USING "relationship"::text::"public"."family_relationship";
DROP TYPE "public"."family_relationship_old";
```
Separate the statements with `--> statement-breakpoint` exactly as the file's existing
convention does. **Leave the backfill INSERT (~line 58) completely unchanged.**

**Why:** Drizzle wraps ALL pending migrations in ONE transaction (`dialect.js:60`, outside
the loop at 61-70). PostgreSQL forbids using a value added by `ALTER TYPE ... ADD VALUE`
before its transaction commits — so `db:migrate` fails on a fresh DB. But values of a
newly **CREATE**d enum *are* usable immediately in the same transaction. Splitting into a
separate migration does **not** work (both files stay pending in the same transaction), and
text casts do not work either.

**First verify the enum's exact current value set** from `0000_nosy_lizard.sql:10` and
`apps/api/src/db/shared/persons.ts:15`. The list above must match the original values with
`self` inserted **before `spouse`**. If it differs, STOP and report rather than guessing.

## Must NOT change
- `apps/api/drizzle/meta/_journal.json` — **do not alter timestamps and do not add a
  migration entry.** An older-timestamped entry is *silently skipped* on databases already
  past it.
- Any `meta/*_snapshot.json` — the schema `0001`'s snapshot represents is unchanged.
- `0000`, `0002`, `0003`, any `.ts` source, any schema content (no new table/column/enum
  value/constraint). This fixes **applicability**, not schema.
- **Never** connect to `compass` (production) or `compass-staging`.

## Test environment — disposable Docker Postgres only
Docker is available (v29.6.2, you are in the `docker` group); there is no local Postgres
server. Start a throwaway **Postgres 18** container: unique name, **no persistent volume**,
random port bound to **127.0.0.1**, its own db/user, readiness probe before use, and
**remove container + volume afterwards**. Do not use `compass-staging` (the `compass` role
may not own its `public` schema, and reusing it would destroy task 060's baseline).

## Required test scenarios

**Scenario 1 — fresh reconstruction (AC1-AC3).** Empty DB → `npm run db:migrate` with
`DATABASE_URL` pointing at the container. Must exit **0**. Then:
- `drizzle.__drizzle_migrations` has exactly **4** rows carrying the journal timestamps.
- A **second** `db:migrate` is a **no-op** (nothing applied), exit 0.
- Schema matches task 060's baseline: **58 tables**. Compare column/index/constraint
  inventories, and **also enum definitions and generated expressions** — not just names.
- Enum **order** is exactly `self, spouse, child, parent, sibling, other`.

**Scenario 2 — historical upgrade + backfill (AC4).** A fresh DB cannot be seeded before
`0000` (no `users` table), so:
1. Establish exactly the `0000` state **including its real ledger row** by running the
   installed migrator against a temporary folder fixture containing only the real `0000`
   (copy `0000_nosy_lizard.sql` + a `meta/_journal.json` holding only its real entry).
   **Do not hand-invent hashes or timestamps.**
2. Insert representative `users`, plus `family_members` rows covering **every** old enum
   label (`spouse, child, parent, sibling, other`), and one user who **already** has a
   `self`-equivalent row if expressible.
3. Run the normal migrator over the full folder. It must **skip `0000`** and apply
   `0001`-`0003`, exit 0.
4. Assert: exactly one `self` row per pre-existing user; `linked_user_id = users.id`;
   `family_members.user_id = users.id`; `name = users.display_name`; `sort_order = -1`;
   re-running creates **no duplicates**; a user already holding a `self` row gets no
   second one; and **all pre-existing non-`self` family members survive with identical
   values and row counts**.

## Commands (capture exit codes correctly)
⚠ Never pipe into `tail` before capturing `$?` — it reports `tail`'s status. Use:
`<cmd> > /tmp/061-x.txt 2>&1 ; echo "EXIT=$?" ; tail -60 /tmp/061-x.txt`

1. `git status --short` (baseline — expect only `?? screen-shots/` and `?? tasks/061-*`)
2. start the Docker Postgres 18 container; readiness probe
3. Scenario 1: `db:migrate`, ledger rows, second run, schema/enum comparison
4. Scenario 2: the staged upgrade above with all assertions
5. `npm run typecheck` ; `npm run lint`
6. `npm run test` (full suite — expect exit 1, ~26 env-gated failures, **0 regressions**)
7. `git diff -- apps/api/drizzle/` — must show **only** `0001_lush_grim_reaper.sql`
8. teardown: remove container and volume; confirm removed

## Required Evidence
- the literal `0001` diff
- Scenario 1: full `db:migrate` output + exit code, the 4 ledger rows, second-run no-op
  proof, table count, enum order, and the schema comparison
- Scenario 2: full output plus every assertion result, especially data preservation across
  the enum replacement
- typecheck/lint/test exit codes and totals; confirm no regression
- confirmation `_journal.json` and all snapshots are untouched
- confirmation the container and volume were removed
- any deviation or blocker stated, never worked around

No `as any`/`@ts-ignore`/`eslint-disable`. Do not weaken a test to get green. Do not stage,
commit, or push. Do not touch `screen-shots/`.

Write to `tasks/061-migration-from-scratch/implementation-1.md`; return ≤20 lines + path.
