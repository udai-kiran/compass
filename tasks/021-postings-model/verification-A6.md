# Verification A6 — Literal Command Transcript

## Command 1: git --no-pager status --porcelain

```
$ git --no-pager status --porcelain
 M apps/api/drizzle/meta/_journal.json
 M apps/api/src/app.ts
 M apps/api/src/db/schema.decomposition.test.ts
 M apps/api/src/db/shared/hubs.ts
 M apps/api/src/db/shared/ledger.ts
 M apps/api/src/lib/ownership.ts
 M apps/api/src/modules/credit/services/bank-details.ts
 M apps/api/src/modules/credit/services/emis.ts
 M apps/api/src/modules/credit/services/overdraft-details.ts
 M apps/api/src/modules/ingest/services/imports.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/investments/services/sip-lifecycle.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/ledger/services/accounts.ts
 M apps/api/src/modules/ledger/services/categories.ts
 M apps/api/src/modules/ledger/services/epf-contributions.ts
 M apps/api/src/modules/ledger/services/postings.test.ts
 M apps/api/src/modules/ledger/services/postings.ts
 M apps/api/src/modules/ledger/services/recurring.ts
 M apps/api/src/modules/ledger/services/search.ts
 M apps/api/src/modules/ledger/services/transactions.ts
 M apps/api/src/modules/ledger/services/transfers.ts
 M apps/api/src/modules/protection/services/retirement.ts
 M apps/api/src/modules/system/routes/backup.ts
 M apps/api/src/modules/system/services/auth.ts
 M apps/api/src/modules/system/services/backup.test.ts
 M apps/api/src/modules/system/services/backup.ts
 M apps/api/src/modules/system/services/demo.ts
 M apps/api/src/modules/system/services/restore-user.ts
 M tasks/021-postings-model/DELEGATION.md
 M tasks/021-postings-model/TASK.md
?? apps/api/drizzle/0067_illegal_shocker.sql
?? apps/api/drizzle/meta/0067_snapshot.json
?? apps/api/src/lib/account-type.ts
?? apps/api/src/modules/ledger/services/post-entry.ts
?? apps/api/src/modules/ledger/services/reconcile-postings.ts
... (truncated at 75+ lines)
EXIT: 0
```

## Command 2: git --no-pager diff --stat -- restore-user.ts backup.ts routes/backup.ts backup.test.ts restore.ts

```
$ git --no-pager diff --stat -- apps/api/src/modules/system/services/restore-user.ts \
  apps/api/src/modules/system/services/backup.ts \
  apps/api/src/modules/system/routes/backup.ts \
  apps/api/src/modules/system/services/backup.test.ts \
  apps/api/src/db/restore.ts

 apps/api/src/modules/system/routes/backup.ts       |   9 +-
 .../api/src/modules/system/services/backup.test.ts | 511 ++++++++++++++++++++-
 apps/api/src/modules/system/services/backup.ts     |   7 +-
 .../src/modules/system/services/restore-user.ts    |  75 ++-
 4 files changed, 583 insertions(+), 19 deletions(-)
EXIT: 0
```

NOTE: apps/api/src/db/restore.ts does NOT appear in the diff. It has no changes.

## Command 3: npm run typecheck -w apps/api (tail)

```
$ npm run typecheck -w apps/api 2>&1 | tail -30

> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT: 0
```

## Command 4: npm run lint (tail)

```
$ npm run lint 2>&1 | tail -30

> compass@0.1.0 lint
> eslint .

EXIT: 0
```

## Command 5: node --test apps/api/src/modules/system/services/backup.test.ts

Run with DATABASE_URL="postgresql://postgres:postgres@192.168.2.196:5432/compass" (no .env file present; this is the known dev Postgres per project memory).

```
$ DATABASE_URL="postgresql://postgres:postgres@192.168.2.196:5432/compass" \
  node --test apps/api/src/modules/system/services/backup.test.ts 2>&1

✔ the full backup covers every table in the schema (2.346233ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.319901ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.259913ms)
✔ no table is scoped both directly and through a parent (0.211127ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.757801ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.501212ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.425917ms)
✔ restore defers cyclic and self-referencing foreign keys (0.482761ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.397232ms)
✔ the mocked restoreDump records postings every column, positioned after FK parents (1.076256ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (0.644776ms)
✖ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (140.613228ms)
✖ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (115.492738ms)
✖ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (84.525919ms)
✖ A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 (107.795451ms)
✖ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (81.433163ms)
✖ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (74.488007ms)
✖ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs (78.023359ms)
ℹ tests 18
ℹ suites 0
ℹ pass 11
ℹ fail 7
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1951.353002

✖ failing tests:

test at apps/api/src/modules/system/services/backup.test.ts:377:1
✖ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (140.613228ms)
  Error: Failed query: insert into "accounts" (..., "system_kind", ...) ...
  cause: error: column "system_kind" of relation "accounts" does not exist

test at apps/api/src/modules/system/services/backup.test.ts:458:1
✖ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (115.492738ms)
  Error: Failed query: select c.* from "postings" c join "transactions" p ...
  cause: error: relation "postings" does not exist

test at apps/api/src/modules/system/services/backup.test.ts:502:1
✖ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (84.525919ms)
  error: column "system_kind" does not exist

test at apps/api/src/modules/system/services/backup.test.ts:548:1
✖ A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 (107.795451ms)
  Error: Failed query: select "system_kind" from "accounts" where ...
  cause: error: column "system_kind" does not exist

test at apps/api/src/modules/system/services/backup.test.ts:601:1
✖ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (81.433163ms)
  Error: Failed query: select "system_kind" from "accounts" where ...
  cause: error: column "system_kind" does not exist

test at apps/api/src/modules/system/services/backup.test.ts:805:1
✖ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (74.488007ms)
  Error: Failed query: select "system_kind" from "accounts" where ...
  cause: error: column "system_kind" does not exist

test at apps/api/src/modules/system/services/backup.test.ts:896:1
✖ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs (78.023359ms)
  Error: Failed query: insert into "accounts" (..., "system_kind", ...) ...
  cause: error: column "system_kind" of relation "accounts" does not exist

EXIT: 1
```

Root cause of all failures: the migration for `accounts.system_kind` column (and the `postings` table) has NOT been applied to the dev database. The schema code references these columns but the DB doesn't have them yet.

## Command 6: node --test apps/api/src/modules/ledger/services/postings.test.ts

```
$ DATABASE_URL="postgresql://postgres:postgres@192.168.2.196:5432/compass" \
  node --test apps/api/src/modules/ledger/services/postings.test.ts 2>&1

✔ assertSafePaise rejects non-safe integers (3.326824ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.441801ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (8.879021ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.439645ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.620857ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.283983ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.432394ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.280801ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.312056ms)
✔ buildTransferPostings: rejects non-positive amounts (0.443153ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.313147ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.317775ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.202871ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.281036ms)
✔ classifyShape + projections round-trip: ordinary (0.517656ms)
✔ classifyShape + projections round-trip: split (0.311969ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.229623ms)
✔ classifyShape + projections round-trip: opening (0.312739ms)
✔ classifyShape: transfer classifies as 'transfer' (0.352109ms)
✔ classifyShape: degenerate shapes throw (0.293179ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 206.047708
EXIT: 0
```

## Command 7: node --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts

File does NOT exist. Confirmed via `ls` (exit code 2) and direct node run:

```
$ node --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts
Could not find 'apps/api/src/modules/ledger/services/reconcile-postings.test.ts'
EXIT: 1
```

Note: `apps/api/src/modules/ledger/services/reconcile-postings.ts` (the source file, not a test) IS present as an untracked file.

---

## A6 Test Titles and Line Ranges

From `grep -n "^test(" backup.test.ts` and `wc -l` (976 total lines):

| Title | Start line | End line (exclusive = next test - 1) |
|---|---|---|
| A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 | 548 | 600 |
| A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) | 601 | 804 |
| A6 AC5: a posting with a foreign account_id is skipped (never inserted) | 805 | 895 |
| A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs | 896 | 976 |

---

## restore.ts Status

`apps/api/src/db/restore.ts` does NOT appear in the diff. Both `git diff --stat` (which listed only 4 files, none being restore.ts) and `git --no-pager diff -- apps/api/src/db/restore.ts` (empty output, exit 0) confirm it has zero code changes.
