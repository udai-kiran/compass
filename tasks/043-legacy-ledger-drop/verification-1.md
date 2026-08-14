# Verification — Task 043 Legacy Ledger Drop

Date: 2026-08-14  
Branch: main  
Working tree: clean (no uncommitted changes at session start; git diff shows staged/committed diff against prior HEAD)

---

## 1. `npm run typecheck` — exit 0

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

EXIT: 0 — all 6 workspaces pass.

---

## 2. `npm run lint` — exit 1 (9 errors, 0 warnings)

```
> compass@0.1.0 lint
> eslint .

/work/personal/compass/apps/api/src/modules/ledger/routes/user-tasks.route.test.ts
  110:42  error  'accountId' is defined but never used. Allowed unused args must match /^_/u  @typescript-eslint/no-unused-vars

/work/personal/compass/apps/api/src/modules/ledger/services/categories.ts
  159:11  error  'affected' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/work/personal/compass/apps/api/src/modules/ledger/services/reconcile-postings.test.ts
   68:9  error  'acct' is assigned a value but never used. Allowed unused vars must match /^_/u   @typescript-eslint/no-unused-vars
  109:9  error  'acctA' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  110:9  error  'acctB' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars

/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts
   399:10  error  'account' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
   576:10  error  'account' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1099:10  error  'account' is assigned a value but never used. Allowed unused vars must match /^_/u  @typescript-eslint/no-unused-vars
  1508:10  error  'myBank' is assigned a value but never used. Allowed unused vars must match /^_/u   @typescript-eslint/no-unused-vars

✖ 9 problems (9 errors, 0 warnings)
```

EXIT: 1 — lint fails. All 9 errors are `@typescript-eslint/no-unused-vars` in test files and one service file. None are related to deleted legacy symbols; they are residual unused variable assignments from the drop cleanup.

Affected files:
- `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts` (1 error)
- `apps/api/src/modules/ledger/services/categories.ts` (1 error)
- `apps/api/src/modules/ledger/services/reconcile-postings.test.ts` (3 errors)
- `apps/api/src/modules/system/services/backup.test.ts` (4 errors)

---

## 3. `grep -rn 'transactionSplits\|transferLinks' apps/api/src/ packages/ --include='*.ts' | grep -v node_modules | grep -v '/tasks/' | grep -v '\.d\.ts'`

(no output)

EXIT: 1 (grep exit code for no matches)

Result: Zero matches. The camelCase symbols `transactionSplits` and `transferLinks` are entirely absent from production and package source.

---

## 4. `grep -rn 'transaction_splits\|transfer_links' apps/api/src/ packages/ --include='*.ts' | grep -v node_modules | grep -v '/tasks/' | grep -v '\.d\.ts' | grep -v '// '`

```
apps/api/src/modules/ledger/services/reconcile-postings.ts:74: * `necessity`, `is_opening`) and `transaction_splits` table have been dropped.
apps/api/src/modules/ledger/services/reconcile-postings.ts:91: * dual-write representation — Clearing postings, `transfer_links` rows, or a
apps/api/src/modules/ledger/services/postings.ts:230: * the two legs are stitched together only via `transfer_links`, not via a
apps/api/src/modules/ledger/services/postings.ts:267: * legacy columns any more, so this function, not `transfer_links` /
apps/api/src/modules/ledger/services/postings.ts:268: * `transaction_splits` / `is_opening`, is what decides what a transaction is.
apps/api/src/modules/ledger/services/postings.ts:281: * is no legacy `transaction_splits` row left to say otherwise.
apps/api/src/modules/ledger/services/postings.ts:361: * legacy columns, `transfer_links` and `transaction_splits`.
apps/api/src/modules/ingest/services/inbox.test.ts:1119:test("acceptRepayment AC1: no existing candidate creates one merged transfer transaction with two real postings, zero transfer_links", async (t) => {
apps/api/src/modules/ledger/services/post-entry.ts:90: * the `transaction_splits` table were dropped in PR-G2.
apps/api/src/modules/ledger/services/transfers.ts:55: * three separate exclusions (`is_opening`, `transfer_links` membership, and the
apps/api/src/modules/ledger/services/transfers.ts:232: * id — there is no `transfer_links` row to name any more.
apps/api/src/modules/ledger/services/transactions.ts:154: * real postings on one header rather than a `transfer_links` row joining two.
apps/api/src/modules/ledger/services/transactions.ts:250: * whole shape from `is_opening` / `transfer_links` / `transaction_splits` and
packages/shared/src/schemas/ledger.ts:400:   * postings. Derived from the postings, not from a link row — `transfer_links`
```

EXIT: 0

NOTE: The `grep -v '// '` filter was intended to exclude comment lines, but many JSDoc lines (`*`) were not filtered. All 14 matches are documentation/JSDoc comments explaining what was dropped — no live SQL or production code. One match is a test description string in `inbox.test.ts:1119` (`test("... zero transfer_links", ...)`), which is a test title string, not executable schema reference. The brief's expected condition (only archive fixture data in backup.test.ts) is NOT quite met — matches are spread across JSDoc comments in service files and one test name string. There is no live SQL or schema reference to these tables.

---

## 5. `grep -rn 'legacy-projection' apps/api/src/ --include='*.ts' | grep -v node_modules`

(no output)

EXIT: 1 (grep exit code for no matches)

Result: No references to `legacy-projection` remain in any `.ts` file under `apps/api/src/`.

---

## 6. `ls apps/api/src/modules/ledger/services/legacy-projection.ts 2>&1`

```
lsd: apps/api/src/modules/ledger/services/legacy-projection.ts: No such file or directory (os error 2).
```

EXIT: 2

Note: Exit code is 2 rather than 1 because the shell's `ls` alias resolves to `lsd` (a `ls` replacement). Regardless, the file does not exist — confirmed.

---

## 7. `grep -rn 'isOpening\b' apps/api/src/db/shared/ledger.ts apps/api/src/modules/ledger/schema.ts`

(no output)

EXIT: 1 (grep exit code for no matches)

Result: `isOpening` column is absent from both `db/shared/ledger.ts` and `modules/ledger/schema.ts`.

---

## 8. `git diff --stat` (staged diff, i.e., index vs working tree)

```
 apps/api/drizzle/0000_mysterious_mockingbird.sql   |    9 -
 apps/api/drizzle/0001_natural_klaw.sql             |   96 -
 ... [68 migration SQL files deleted] ...
 apps/api/drizzle/0068_mean_sentinel.sql            |    2 -
 apps/api/drizzle/meta/0000_snapshot.json           | 6813 ++++++++++++++++++-
 apps/api/drizzle/meta/0001_snapshot.json           |  863 ---
 ... [68 meta snapshot JSON files deleted] ...
 apps/api/drizzle/meta/0068_snapshot.json           | 7160 --------------------
 apps/api/drizzle/meta/_journal.json                |  480 +-
 apps/api/src/db/restore.ts                         |    6 +-
 apps/api/src/db/schema.decomposition.test.ts       |   10 +-
 apps/api/src/db/schema.ts                          |    6 +-
 apps/api/src/db/shared/ledger.ts                   |   31 +-
 apps/api/src/lib/postings-periods-parity.test.ts   |  836 ---
 apps/api/src/modules/credit/services/cards.ts      |    2 +-
 apps/api/src/modules/credit/services/reconciliation-writes.test.ts |   47 +-
 apps/api/src/modules/credit/services/reconciliation-writes.ts      |    9 +-
 apps/api/src/modules/ingest/services/imports.ts    |    3 +-
 apps/api/src/modules/ingest/services/inbox.test.ts |   45 +-
 apps/api/src/modules/ledger/routes/user-tasks.route.test.ts |    2 -
 apps/api/src/modules/ledger/schema.smoke.test.ts   |    4 +-
 apps/api/src/modules/ledger/schema.ts              |   41 -
 apps/api/src/modules/ledger/services/accounts.test.ts   |   21 +-
 apps/api/src/modules/ledger/services/accounts.ts   |    8 +-
 apps/api/src/modules/ledger/services/categories.ts |    5 -
 apps/api/src/modules/ledger/services/epf-contributions.test.ts |   43 +-
 apps/api/src/modules/ledger/services/legacy-projection.test.ts |  164 -
 apps/api/src/modules/ledger/services/legacy-projection.ts      |  108 -
 apps/api/src/modules/ledger/services/post-entry.ts |   38 +-
 apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts |    4 +-
 apps/api/src/modules/ledger/services/reconcile-postings.test.ts |    8 +-
 apps/api/src/modules/ledger/services/reconcile-postings.ts  |   44 +-
 apps/api/src/modules/ledger/services/recurring.test.ts  |   45 +-
 apps/api/src/modules/ledger/services/transactions.ts    |   36 +-
 apps/api/src/modules/ledger/services/transfers.ts  |    4 -
 apps/api/src/modules/planning/services/postings-planning-parity.test.ts |  573 +-
 apps/api/src/modules/system/services/backup.test.ts |   65 +-
 apps/api/src/modules/system/services/backup.ts     |    5 +-
 apps/api/src/modules/system/services/demo.ts       |   30 +-
 169 files changed, 7021 insertions(+), 346004 deletions(-)
```

EXIT: 0

---

## 9. `git diff --stat HEAD`

Identical output to command 8 (same 169 files, same +7021/-346004 totals).

EXIT: 0

---

## Summary

| Check | Expected | Actual | Status |
|-------|----------|--------|--------|
| typecheck | all 6 pass | all 6 pass | PASS |
| lint | pass | 9 unused-var errors | FAIL |
| transactionSplits / transferLinks (camelCase) | comments only | zero matches | PASS |
| transaction_splits / transfer_links (snake_case) | only backup.test.ts fixtures | 14 matches in JSDoc comments + 1 test name string across service files | PARTIAL — no live SQL, all are documentation/comments |
| legacy-projection refs | no matches | no matches | PASS |
| legacy-projection.ts file | does not exist | does not exist | PASS |
| isOpening in schema files | no matches | no matches | PASS |
| git diff | 169 files changed | 169 files changed | INFO |
