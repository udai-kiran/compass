# Task: Migration Collapse

## Status
COMPLETE

## Objective
Collapse 69 Drizzle migrations into a single clean baseline. No deployed DB exists; dev DBs will be recreated. Produces a single `0000_*.sql` that creates the post-PR-G2 schema from scratch.

## Root Cause
69 migrations (9 MB) accumulated over 3 months of rapid development, including 5 hand-edited data backfills and 3 unrepresented DB objects. A clean baseline is required before tagging a clean release.

## Scope
- Delete `apps/api/drizzle/*.sql` and `apps/api/drizzle/meta/`
- Run `db:generate` to produce single baseline from current schema.ts
- Manually append the `search` tsvector generated column + GIN index (not representable in Drizzle schema)
- `check_split_sum()` function and its triggers are NOT appended (transaction_splits dropped in task 043)
- Verify baseline applies cleanly on a fresh DB

## Dependencies
- task 043 (legacy ledger drop) — schema.ts must be final before generating

## Plan
- P1: Delete all files in `apps/api/drizzle/*.sql` and `apps/api/drizzle/meta/`
- P2: Run `npm run db:generate -w apps/api` (needs DATABASE_URL; use dummy if needed)
- P3: Append to the generated `0000_*.sql`:
  - `ALTER TABLE "transactions" ADD COLUMN "search" tsvector GENERATED ALWAYS AS (to_tsvector('simple', coalesce("merchant", '') || ' ' || coalesce("notes", ''))) STORED;`
  - `CREATE INDEX "transactions_search_idx" ON "transactions" USING gin ("search");`
- P4: Drop and recreate dev DB: `dropdb compass && createdb -O compass compass`
- P5: Run `npm run db:migrate -w apps/api` on fresh DB
- P6: Run `npm run db:seed -w apps/api`
- P7: Run `npm run test -w apps/api` to verify

## Acceptance Criteria
- AC1: `apps/api/drizzle/` contains exactly 1 SQL file + 1 snapshot + journal
- AC2: The baseline SQL includes the `search` tsvector column and GIN index
- AC3: The baseline SQL does NOT include `transaction_splits`, `transfer_links`, `check_split_sum`, or the dropped legacy columns
- AC4: `db:migrate` applies cleanly on a fresh Postgres
- AC5: `db:seed` runs successfully after migration
- AC6: `npm run test` passes

## Verification
- T1: `ls apps/api/drizzle/*.sql | wc -l` = 1
- T2: `grep -c 'transaction_splits\|transfer_links\|check_split_sum' apps/api/drizzle/0000_*.sql` = 0
- T3: `grep -c 'tsvector\|transactions_search_idx' apps/api/drizzle/0000_*.sql` >= 2
- T4: `npm run db:migrate -w apps/api` exit 0
- T5: `npm run test`

## Non-Goals
- Preserving data from any existing dev DB
- Maintaining migration history for rollback
