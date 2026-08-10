# Implementation Report — Task 023 PR-F(2), Iteration 1

## Files Changed

- `apps/api/src/modules/system/services/backup.ts` — `transactionsCsv` only
- `apps/api/src/modules/system/services/backup.test.ts` — new CSV tests + import

## Complete Diff

See `git diff apps/api/src/modules/system/services/backup.ts apps/api/src/modules/system/services/backup.test.ts`
(produced literally by running the git diff command; omitted from this file because the diff is embedded in the implementation report submitted to the coordinator).

### backup.ts changes (lines 126-194)

Replaced the one-line doc comment and the 18-line legacy function body with:
- A 22-line JSDoc comment covering: postings-derivation, the two lateral sub-queries, D9 deliberate divergences, and AC18 bigint-safety acceptance.
- The exact SQL from P1 of TASK.md (two independent LEFT JOIN LATERALs), byte-for-byte. Not simplified.
- Null-safe row mapping:
  - `r.amount_paise === null ? "" : Number(r.amount_paise)` (never `Number(null)`)
  - `r.account === null ? "" : String(r.account)` (blank when no real posting)
  - `String(r.category ?? "")` (coalesce in SQL already handles null)
  - `String(r.notes ?? "")` unchanged

Header array `["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"]` is byte-identical to the old code (AC2/P3).

### backup.test.ts changes

1. Added `transactionsCsv` to the named import from `"./backup.ts"`.
2. Appended after the last existing test (A6 AC5 post-commit throw):
   - `parseCsvRows(csv)` — RFC-4180 parser handling embedded commas, double-quotes and newlines in quoted fields; no external dependency.
   - `CsvFixture` interface and `createCsvUser()` helper — creates a fresh user with two real accounts (Test Bank, Wallet), four system accounts (expenses/clearing/opening/income-not-used), and two categories (Food, Transport). Reuses the existing `createUser()` and `db.insert` patterns.
   - 14 new `test()` blocks covering AC2–AC9 and AC11–AC17.

## Commands and Literal Output

### 1. `npm run typecheck`

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

EXIT:0
```

**Result: PASS (exit 0)**

### 2. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

**Result: PASS (exit 0)**

### 3. `node --test apps/api/src/modules/system/services/backup.test.ts`

DATABASE_URL is **NOT SET** in this environment. `requireDatabaseUrl()` throws at module load (line 337, called at line 346). Command output:

```
DATABASE_URL=NOT_SET
node:internal/test_runner/harness:122
      throw err;
      ^

Error: backup.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireDatabaseUrl (file:///home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:337:11)
    at file:///home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:346:25

Node.js v24.18.0
✖ apps/api/src/modules/system/services/backup.test.ts (990.736941ms)
ℹ tests 1
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1003.067769

✖ failing tests:

test at apps/api/src/modules/system/services/backup.test.ts:1:1
✖ apps/api/src/modules/system/services/backup.test.ts (990.736941ms)
  'test failed'
EXIT:1
```

**Result: BLOCKED — DATABASE_URL not set. Not reported as passing.**

### 4. `npm run test -w apps/api`

All 25 failures are DB-backed test files (app.test.ts, reconcile-postings.test.ts, backup.test.ts, etc.) that throw on missing DATABASE_URL. These are pre-existing failures unrelated to this change. The Postgres server at `192.168.2.196:5432` (from `.env.example`) is unreachable, and no local Postgres is running.

Summary from the run:
```
ℹ tests 669
ℹ pass 643
ℹ fail 25
EXIT:1
```

The 643 passing tests are all non-DB tests (route surface, schema decomposition, CSV math, crypto, etc.). The 25 failing tests are exclusively DB-backed; backup.test.ts is one of them. All 25 failures are pre-existing (DATABASE_URL absent); none are new failures caused by this change.

**Result: BLOCKED — DATABASE_URL not set (pre-existing condition). The 643 non-DB tests still pass.**

## AC18 Decision

**Chosen: explicitly accept the existing bigint→Number behaviour** (documented in the function's JSDoc, not a code-level guard).

Reasoning:
1. Personal-finance amounts in paise fit comfortably below Number.MAX_SAFE_INTEGER (≈ 90 trillion rupees). The largest credible single transaction for an Indian retail user is orders of magnitude smaller.
2. Adding a safe-integer check would need to emit either a non-numeric value (breaking downstream consumers who parse the Amount column as a number) or throw (aborting the export for an edge case that cannot realistically occur). Neither is better than the silent precision loss the guard would catch.
3. The existing codebase already calls `Number()` on bigint columns from raw SQL throughout (e.g. `backup.test.ts:789, 990`), so a guard here would be inconsistent without a broader project-wide policy.
4. The acceptance is documented in the JSDoc (AC18 line) so it is visible to reviewers and future readers.

## Plan Deviations

None. All changes are exactly as specified:
- SQL is byte-identical to P1 in TASK.md (both laterals, `a.user_id = t.user_id`, `ca.user_id = t.user_id`, `c.user_id = t.user_id`, `a.system_kind is null`, `ca.system_kind is not null`, `order by x.name collate "C"`, `order by p.id limit 1`).
- `Number()` is never called before the null check.
- Header unchanged.
- `dumpTable`, `dumpUserTable`, `dumpDatabase`, `buildUserBackupStream`, `restoreDump`, `restoreUserBackup`, `ALL_TABLES`, `USER_TABLES`, `LINKED_TABLES`, `FILE_COLUMNS`, the route file — all untouched.
- No schema change.

## Blockers

- **DATABASE_URL not available**: Postgres at `192.168.2.196:5432` is unreachable and no local Postgres is running. Commands 3 and 4 cannot execute the DB-backed tests. This is a pre-existing environment condition, not a defect in the implementation.
- The new tests ARE present and correctly typed (typecheck passes, lint passes). They will run when a DATABASE_URL is provided.
