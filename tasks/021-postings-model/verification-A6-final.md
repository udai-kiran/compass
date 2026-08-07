# Verification A6 Final — Independent Evidence

Date: 2026-08-06
Verifier: sonnet-worker (independent, no implementation knowledge)

---

## Command 1 — git status --porcelain

```
$ git status --porcelain
EXIT: 0

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
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/release-log.md
?? tasks/021-postings-model/COMMIT_MSG.txt
?? tasks/021-postings-model/DELEGATION-A6.md
?? tasks/021-postings-model/DELEGATION-dualwrite-pr-a.md
?? tasks/021-postings-model/PLAN-A5.md
?? tasks/021-postings-model/PLAN-A6.md
?? tasks/021-postings-model/PLAN-dualwrite.md
?? tasks/021-postings-model/PR_BODY.md
... (additional tasks/ untracked files)
```

---

## Command 2 — git diff --stat

```
$ git diff --stat
EXIT: 0

 apps/api/drizzle/meta/_journal.json                |   7 +
 apps/api/src/app.ts                                |  14 +
 apps/api/src/db/schema.decomposition.test.ts       |  14 +-
 apps/api/src/db/shared/hubs.ts                     |  30 +-
 apps/api/src/db/shared/ledger.ts                   |  28 +
 apps/api/src/lib/ownership.ts                      |  21 +-
 .../src/modules/credit/services/bank-details.ts    |   3 +-
 apps/api/src/modules/credit/services/emis.ts       |   5 +-
 .../modules/credit/services/overdraft-details.ts   |   5 +-
 apps/api/src/modules/ingest/services/imports.ts    |  72 ++
 .../investments/services/sip-commitments.ts        |   3 +-
 .../modules/investments/services/sip-lifecycle.ts  |   4 +-
 apps/api/src/modules/ledger/schema.ts              |   2 +-
 apps/api/src/modules/ledger/services/accounts.ts   |  55 +-
 apps/api/src/modules/ledger/services/categories.ts |  24 +
 .../modules/ledger/services/epf-contributions.ts   |   3 +-
 .../src/modules/ledger/services/postings.test.ts   |  56 ++
 apps/api/src/modules/ledger/services/postings.ts   |  58 +-
 apps/api/src/modules/ledger/services/recurring.ts  |  28 +-
 apps/api/src/modules/ledger/services/search.ts     |   2 +-
 .../src/modules/ledger/services/transactions.ts    | 258 ++++++-
 apps/api/src/modules/ledger/services/transfers.ts  | 108 ++-
 .../src/modules/protection/services/retirement.ts  |   5 +-
 apps/api/src/modules/system/routes/backup.ts       |   9 +-
 apps/api/src/modules/system/services/auth.ts       |   2 +
 .../api/src/modules/system/services/backup.test.ts | 795 ++++++++++++++++++++-
 apps/api/src/modules/system/services/backup.ts     |   7 +-
 apps/api/src/modules/system/services/demo.ts       |  19 +-
 .../src/modules/system/services/restore-user.ts    |  75 +-
 tasks/021-postings-model/DELEGATION.md             | 242 ++++---
 tasks/021-postings-model/TASK.md                   |  41 +-
 31 files changed, 1781 insertions(+), 214 deletions(-)
```

---

## Command 3 — git diff --name-only

```
$ git diff --name-only
EXIT: 0

apps/api/drizzle/meta/_journal.json
apps/api/src/app.ts
apps/api/src/db/schema.decomposition.test.ts
apps/api/src/db/shared/hubs.ts
apps/api/src/db/shared/ledger.ts
apps/api/src/lib/ownership.ts
apps/api/src/modules/credit/services/bank-details.ts
apps/api/src/modules/credit/services/emis.ts
apps/api/src/modules/credit/services/overdraft-details.ts
apps/api/src/modules/ingest/services/imports.ts
apps/api/src/modules/investments/services/sip-commitments.ts
apps/api/src/modules/investments/services/sip-lifecycle.ts
apps/api/src/modules/ledger/schema.ts
apps/api/src/modules/ledger/services/accounts.ts
apps/api/src/modules/ledger/services/categories.ts
apps/api/src/modules/ledger/services/epf-contributions.ts
apps/api/src/modules/ledger/services/postings.test.ts
apps/api/src/modules/ledger/services/postings.ts
apps/api/src/modules/ledger/services/recurring.ts
apps/api/src/modules/ledger/services/search.ts
apps/api/src/modules/ledger/services/transactions.ts
apps/api/src/modules/ledger/services/transfers.ts
apps/api/src/modules/protection/services/retirement.ts
apps/api/src/modules/system/routes/backup.ts
apps/api/src/modules/system/services/auth.ts
apps/api/src/modules/system/services/backup.test.ts
apps/api/src/modules/system/services/backup.ts
apps/api/src/modules/system/services/demo.ts
apps/api/src/modules/system/services/restore-user.ts
tasks/021-postings-model/DELEGATION.md
tasks/021-postings-model/TASK.md
```

---

## Command 4 — npm run typecheck -w apps/api

```
$ npm run typecheck -w apps/api

> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT: 0
```

---

## Command 5 — npm run lint

```
$ npm run lint

> compass@0.1.0 lint
> eslint .

EXIT: 0
```

---

## Command 6 — node --test apps/api/src/modules/system/services/backup.test.ts

Run with DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass

```
✔ the full backup covers every table in the schema (2.468576ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.277371ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.291038ms)
✔ no table is scoped both directly and through a parent (0.224285ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.746773ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.567379ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.425061ms)
✔ restore defers cyclic and self-referencing foreign keys (0.499844ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.565598ms)
✔ the mocked restoreDump records postings every column, positioned after FK parents (1.38075ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (0.748174ms)
✖ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (147.036615ms)
✖ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (122.808372ms)
✖ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (66.376571ms)
✖ A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 (100.052128ms)
✖ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (83.870535ms)
✖ A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings and no system accounts (74.00239ms)
✖ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (75.870108ms)
✖ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs (78.446359ms)
ℹ tests 19
ℹ suites 0
ℹ pass 11
ℹ fail 8
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2092.926221

EXIT: 1
```

### Failing tests (with literal first error line):

1. **AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore**
   `cause: error: column "system_kind" of relation "accounts" does not exist (code 42703)`

2. **misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task**
   `cause: error: relation "postings" does not exist (code 42P01)`

3. **misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs**
   `error: column "system_kind" does not exist (code 42703)`

4. **A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409**
   `cause: error: column "system_kind" does not exist (code 42703)`
   — from `seedSystemAccounts` in `post-entry.ts:138`

5. **A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows)**
   `cause: error: column "system_kind" does not exist (code 42703)`
   — from `seedSystemAccounts` in `post-entry.ts:138`

6. **A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings and no system accounts**
   `cause: error: column "system_kind" does not exist (code 42703)`
   — from `seedSystemAccounts` in `post-entry.ts:138`

7. **A6 AC5: a posting with a foreign account_id is skipped (never inserted)**
   `cause: error: column "system_kind" does not exist (code 42703)`
   — from `seedSystemAccounts` in `post-entry.ts:138`

8. **A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs**
   `cause: error: column "system_kind" of relation "accounts" does not exist (code 42703)`

**Root cause:** The database at 192.168.2.196 does NOT have migration 0067 applied. Specifically:
- The `accounts.system_kind` column does not exist (Postgres error 42703)
- The `postings` table does not exist (Postgres error 42P01)

Despite the brief stating "Migration 0067 is already applied on the DB host", the actual DB errors prove otherwise.

---

## Command 7 — node --test apps/api/src/modules/ledger/services/postings.test.ts

Run with DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass

```
✔ assertSafePaise rejects non-safe integers (3.585455ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.439561ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (10.265601ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.572093ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.915481ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.422372ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (1.094525ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.901047ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (1.142268ms)
✔ buildTransferPostings: rejects non-positive amounts (1.01228ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.649075ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.468108ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.539341ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.685244ms)
✔ classifyShape + projections round-trip: ordinary (0.890229ms)
✔ classifyShape + projections round-trip: split (0.63488ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.396549ms)
✔ classifyShape + projections round-trip: opening (0.597603ms)
✔ classifyShape: transfer classifies as 'transfer' (0.697924ms)
✔ classifyShape: degenerate shapes throw (0.82661ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 231.284087

EXIT: 0
```

---

## Answers to explicit questions

### Is backup.test.ts the ONLY changed source file under apps/ or packages/?

**NO.** Many source and production files changed. Complete list of changed tracked files under apps/ (from git diff --name-only):

- apps/api/drizzle/meta/_journal.json
- apps/api/src/app.ts
- apps/api/src/db/schema.decomposition.test.ts
- apps/api/src/db/shared/hubs.ts
- apps/api/src/db/shared/ledger.ts
- apps/api/src/lib/ownership.ts
- apps/api/src/modules/credit/services/bank-details.ts
- apps/api/src/modules/credit/services/emis.ts
- apps/api/src/modules/credit/services/overdraft-details.ts
- apps/api/src/modules/ingest/services/imports.ts
- apps/api/src/modules/investments/services/sip-commitments.ts
- apps/api/src/modules/investments/services/sip-lifecycle.ts
- apps/api/src/modules/ledger/schema.ts
- apps/api/src/modules/ledger/services/accounts.ts
- apps/api/src/modules/ledger/services/categories.ts
- apps/api/src/modules/ledger/services/epf-contributions.ts
- apps/api/src/modules/ledger/services/postings.test.ts
- apps/api/src/modules/ledger/services/postings.ts
- apps/api/src/modules/ledger/services/recurring.ts
- apps/api/src/modules/ledger/services/search.ts
- apps/api/src/modules/ledger/services/transactions.ts
- apps/api/src/modules/ledger/services/transfers.ts
- apps/api/src/modules/protection/services/retirement.ts
- apps/api/src/modules/system/routes/backup.ts
- apps/api/src/modules/system/services/auth.ts
- apps/api/src/modules/system/services/backup.test.ts
- apps/api/src/modules/system/services/backup.ts
- apps/api/src/modules/system/services/demo.ts
- apps/api/src/modules/system/services/restore-user.ts

Plus new untracked files (not in git diff but exist):
- apps/api/src/lib/account-type.ts (NEW)
- apps/api/src/modules/ledger/services/post-entry.ts (NEW)
- apps/api/src/modules/ledger/services/reconcile-postings.ts (NEW)
- apps/api/drizzle/0067_illegal_shocker.sql (NEW)
- apps/api/drizzle/meta/0067_snapshot.json (NEW)

### Are the six named production files all unmodified?

**NO.** Verified against git diff --name-only:

| File | Status |
|------|--------|
| apps/api/src/modules/system/services/backup.ts | MODIFIED (7 lines changed) |
| apps/api/src/modules/system/services/restore-user.ts | MODIFIED (75 lines changed) |
| apps/api/src/modules/system/routes/backup.ts | MODIFIED (9 lines changed) |
| apps/api/src/modules/ledger/services/reconcile-postings.ts | NEW/UNTRACKED (not in tracked diff) |
| apps/api/src/modules/ledger/services/transactions.ts | MODIFIED (258 lines changed) |
| apps/api/src/db/restore.ts | NOT in diff — appears unmodified |

Five of the six named files were modified or created. Only apps/api/src/db/restore.ts is absent from the diff (unmodified).

### backup.test.ts counts and exit code

- pass: 11
- fail: 8
- skip: 0
- exit code: 1 (FAILING)

### postings.test.ts counts and exit code

- pass: 20
- fail: 0
- skip: 0
- exit code: 0 (PASSING)

---

## Critical Finding

**The database does NOT have migration 0067 applied**, despite the brief's assertion.

Every backup.test.ts failure traces to one of two Postgres errors:
- `column "system_kind" of relation "accounts" does not exist` (error code 42703) — the `accounts.system_kind` column added by migration 0067 is absent
- `relation "postings" does not exist` (error code 42P01) — the `postings` table added by migration 0067 is absent

The migration SQL file `apps/api/drizzle/0067_illegal_shocker.sql` is present in the working tree (untracked) but has not been applied to the database. The DB-backed tests for A6 ACs all fail as a result.
