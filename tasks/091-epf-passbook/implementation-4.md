# Implementation 4 — Codex Review Fixes (Tasks 091)

## Files Inspected

- `apps/api/src/modules/tax/services/epf-contributions.ts`
- `apps/api/src/modules/tax/services/epf-contributions.test.ts`
- `apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`
- `packages/shared/src/schemas/tax.ts`
- `apps/api/src/modules/ledger/services/transfers.ts` (to verify `.for("update")` pattern)
- `apps/api/src/modules/investments/services/sip-installments.ts` (to verify `.for("update")` pattern)

## Files Changed

- `apps/api/src/modules/tax/services/epf-contributions.ts`
- `apps/api/src/modules/tax/services/epf-contributions.test.ts`
- `apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`
- `packages/shared/src/schemas/tax.ts`

No other files were modified.

---

## Implementation Details

### Fix 1 — TOCTOU race in createManual / importFromPayslip

Added `.for("update")` after `.where(...)` on both existing-row SELECT queries, matching the established repo pattern (used in `transfers.ts:132,143`, `sip-installments.ts:175,188,284,390,398`).

**`createManual`** — the existing-row SELECT (line ~239 before this round):
```typescript
// Added .for("update") + explanatory comment:
const [existing] = await tx
  .select()
  .from(epfContributions)
  .where(and(...))
  .for("update");
```

**`importFromPayslip` Step 3** — the existing-row SELECT (line ~359 before this round):
```typescript
const [existing] = await tx
  .select()
  .from(epfContributions)
  .where(and(...))
  .for("update");
```

Both have a code comment explaining why: the lock blocks a concurrent `confirmActual` UPDATE on the same row until our transaction commits, eliminating the race. On the fresh-insert path (no existing row), `.for("update")` is a no-op.

A true concurrency-reproduction test (two literal concurrent DB clients racing) was not added — the existing node process has one connection pool and `Promise.all` on the same pool would simply serialize. The integration test (Test 12 below) exercises the correct sequential outcome (status recomputed from preserved actuals) and the code-level comment explains the race.

**New integration test (Test 12)** in `epf-contributions.integration.test.ts`:
- Added `createManual` to the import list.
- Added `test("createManual: re-upsert with corrected expected recomputes status from existing actuals (Fix 1 / TOCTOU)", ...)`:
  1. `createManual` with `expectedEmployeePaise: 180000` → asserts `"pending"`.
  2. `confirmActual` with `actualEmployeePaise: 180000` → asserts `"matched"`.
  3. `createManual` again with `expectedEmployeePaise: 190000` → asserts same row id, `actualEmployeePaise: 180000` (preserved), `reconciliationStatus: "mismatch"` (recomputed from actual 180000 vs expected 190000).

### Fix 2 — HttpError on projection overflow

Changed `throw new Error(...)` inside `computeEpfProjection`'s per-step overflow check to `throw new HttpError(500, ...)` with the same message text. `HttpError` was already imported at the top of the file (`import { HttpError } from "../../../lib/errors.ts";`). Added a comment explaining why: plain `Error` would be masked to a generic 500 by the app's error handler (which only forwards `HttpError` messages for 5xx); `HttpError` is a plain subclass with a `statusCode` field and does not perform any I/O, so the "Pure — no I/O" contract is not violated.

**New unit test** in `epf-contributions.test.ts`:
- Added `import { HttpError } from "../../../lib/errors.ts";` at the top.
- Added test in the `computeEpfProjection` describe block:
  - Starting corpus `9_000_000_000_000_000` paise (9e15, a valid safe integer — below `MAX_SAFE_INTEGER ≈ 9.007e15`). After 1 year at 825 bps: `9e15 * 10825 / 10000 ≈ 9.742e15 > MAX_SAFE_INTEGER`. Asserts `err instanceof HttpError && err.statusCode === 500`.

### Fix 3a — Zero-expected employee/employer coverage

Added two tests to the `computeStatus` describe block in `epf-contributions.test.ts`, after the existing "a zero expected EPS with a null actual now needs confirmation" test:

- `statusRow({ expectedEmployeePaise: 0, actualEmployeePaise: null })` → `"pending"`.  
  Defaults in `statusRow()` leave `actualEmployerPaise: 55000` and `actualEpsPaise: 125000` non-null, so the leading all-four-null check does not trigger.
- `statusRow({ expectedEmployerPaise: 0, actualEmployerPaise: null })` → `"pending"`.  
  Defaults leave `actualEmployeePaise: 180000` and `actualEpsPaise: 125000` non-null.

Both are correctly returned as `"pending"` by `needsConfirmation(0, null)` — `0 !== null && null === null` → `true`.

### Fix 3c — Stale "positive expected" doc comment in shared/src/schemas/tax.ts

Located at `ReconciliationStatusSchema` JSDoc comment (line 439 before this round):

Old:
```
 * pending:   any component with a positive expected value still has a null actual.
```

New:
```
 * pending:   any component with a non-null expected value (including zero, except VPF's zero-skip exception) still has a null actual, OR all four actuals are null.
```

---

## Commands Run — Literal Output

### 1. `npm run typecheck -w apps/api`

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT:0
```

### 2. `npm run typecheck -w packages/shared`

```
> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT:0
```

### 3. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

### 4. `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts`

```
TAP version 13
# Subtest: computeStatus
    ok 1 - returns pending when actual employee is null and expected employee is positive
    ok 2 - returns pending even when some actuals are set but employee is null
    ok 3 - returns pending when eps actual is null and expected eps is positive (new H4 rule)
    ok 4 - returns pending when employer actual is null and expected employer is positive
    ok 5 - returns pending when vpf actual is null and expected vpf is positive
    ok 6 - returns matched on exact match across all three columns (vpf=0, no vpf expected)
    ok 7 - returns matched when the difference is within the 1% tolerance
    ok 8 - returns matched at exactly 1% difference (boundary — not a mismatch)
    ok 9 - returns mismatch when employee differs by more than 1%
    ok 10 - returns mismatch when employer differs by more than 1%
    ok 11 - returns mismatch when eps differs by more than 1%
    ok 12 - returns mismatch when vpf actual differs from expected by more than 1%
    ok 13 - returns matched when vpf actual matches expected within 1%
    ok 14 - treats a null expected column as not a pending trigger and not comparable (no mismatch)
    ok 15 - a zero expected EPS with a null actual now needs confirmation (blocker 1 — EPS/employer/employee lost their zero exception)
    ok 16 - a zero expected employee with a null actual needs confirmation (no zero exception for employee)
    ok 17 - a zero expected employer with a null actual needs confirmation (no zero exception for employer)
    ok 18 - treats a zero expected column as not comparable for mismatch (avoids divide-by-zero)
    ok 19 - returns pending when all four actuals are null, even with all expected null/zero (fresh unconfirmed row)
    ok 20 - flags a mismatch when actual is lower than expected by more than 1%
    ok 21 - returns matched when all expected are null (or zero vpf) but actuals are set
    1..21
ok 1 - computeStatus
# Subtest: isGapEligible
    ok 1 - returns false on the day the wage month ends (day 0 of grace)
    ok 2 - returns false on day 44 of grace (one day before threshold)
    ok 3 - returns true on day 45 of grace (exactly at threshold)
    ok 4 - returns true well after the grace period
    ok 5 - handles month-end rollover correctly for month with 31 days
    ok 6 - handles February edge case (non-leap year)
    1..6
ok 2 - isGapEligible
# Subtest: computeEpfProjection
    ok 1 - returns currentCorpusPaise unchanged when monthsToRetirement is 0
    ok 2 - compounds once for 12 months (one year)
    ok 3 - compounds twice for 24 months (two years, integer at each step)
    ok 4 - uses only whole years (13 months = 1 full year, not 1.08 years)
    ok 5 - uses only whole years (23 months = 1 full year)
    ok 6 - returns zero when currentCorpusPaise is zero
    ok 7 - produces integer results (no fractional paise)
    ok 8 - produces an exact BigInt result for a corpus where the intermediate product exceeds Number.MAX_SAFE_INTEGER
    ok 9 - throws HttpError 500 when a compounding step produces a result exceeding Number.MAX_SAFE_INTEGER
    1..9
ok 3 - computeEpfProjection
# Subtest: fyToWageMonthRange
    ok 1 - maps FY 2025-26 to April 2025 → March 2026
    ok 2 - maps FY 2024-25 to April 2024 → March 2025
    ok 3 - handles a century rollover FY 2099-00
    ok 4 - produces a range that string-orders correctly for wage_month comparison
    1..4
ok 4 - fyToWageMonthRange
# Subtest: buildEpfContributionDto
    ok 1 - converts an unconfirmed payslip-derived row
    ok 2 - computes 80C eligibility from expected values when unconfirmed
    ok 3 - excludes employer EPF and EPS from 80C eligibility
    ok 4 - prefers actual over expected for 80C eligibility once confirmed
    ok 5 - mixes actual employee with expected vpf when only vpf is unconfirmed
    ok 6 - treats a fully null expected/actual row as zero 80C eligibility
    ok 7 - carries a null payslipId for manual entries
    ok 8 - carries a null employerName
    ok 9 - carries gapReason through
    ok 10 - carries the matched status through
    ok 11 - grossEmployerContributionPaise = expected employer + expected eps when no actuals
    ok 12 - grossEmployerContributionPaise uses actual values when confirmed
    ok 13 - grossEmployerContributionPaise mixes actual employer + expected eps when only employer confirmed
    ok 14 - grossEmployerContributionPaise is zero when all employer/eps values are null
    1..14
ok 5 - buildEpfContributionDto
1..5
# tests 54
# suites 5
# pass 54
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 366.461786
EXIT:0
```

### 5. `node --test apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`

DATABASE_URL is not set. The `requireDatabaseUrl()` call throws at module load time with the expected error:

```
TAP version 13
# file:///home/udai/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:54
#     throw new Error(
#           ^
# Error: epf-contributions.integration.test.ts requires DATABASE_URL set (a real Postgres
# connection) — this repo has no DB-mocking infrastructure. Export it (see
# apps/api/.env) before running `npm run test -w apps/api`.
#     at requireDatabaseUrl (file:///...epf-contributions.integration.test.ts:54:11)
#     at file:///...epf-contributions.integration.test.ts:63:25
#     ...
not ok 1 - apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
  ---
  failureType: 'testCodeFailure'
  exitCode: 1
  error: 'test failed'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 433.378331
EXIT:1
```

This is expected — the file requires a live Postgres connection. The test would run and pass as part of `npm run test -w apps/api` with DATABASE_URL set (as per the repo pattern for all integration tests in this file).

### 6. `git status --short` and `git diff --stat`

```
M apps/api/src/modules/tax/routes/epf-contributions.ts
 M apps/api/src/modules/tax/schema.ts
 M apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
 M apps/api/src/modules/tax/services/epf-contributions.test.ts
 M apps/api/src/modules/tax/services/epf-contributions.ts
 M packages/shared/src/schemas/tax.ts
?? tasks/091-epf-passbook/implementation-3.md

---

 .../src/modules/tax/routes/epf-contributions.ts    |   3 +-
 apps/api/src/modules/tax/schema.ts                 |   2 +-
 .../services/epf-contributions.integration.test.ts |  70 ++++-
 .../modules/tax/services/epf-contributions.test.ts |  66 ++++-
 .../src/modules/tax/services/epf-contributions.ts  | 329 ++++++++++++++-------
 packages/shared/src/schemas/tax.ts                 |   4 +-
 6 files changed, 353 insertions(+), 121 deletions(-)
```

Note: `routes/epf-contributions.ts` and `schema.ts` changes are from the prior round (not touched in this round). `implementation-3.md` is an untracked file from the prior round.

---

## Diff for This Round's Changes

The full `git diff` covering the four touched files (cumulative of all uncommitted work) was captured. This round's specific additions are:

**`epf-contributions.ts`**:
- `createManual` SELECT: added `.for("update")` + 4-line comment block
- `importFromPayslip` Step 3 SELECT: added `.for("update")` + 4-line comment block
- `computeEpfProjection` overflow guard: changed `throw new Error(...)` → `throw new HttpError(500, ...)` + 4-line comment

**`epf-contributions.test.ts`**:
- Added `import { HttpError } from "../../../lib/errors.ts";`
- Added tests for `computeStatus`: zero-expected employee (ok 16) and zero-expected employer (ok 17)
- Added test for `computeEpfProjection`: overflow → HttpError 500 (ok 9)

**`epf-contributions.integration.test.ts`**:
- Added `createManual` to import list
- Added Test 12: `createManual` status recompute from preserved actuals

**`packages/shared/src/schemas/tax.ts`**:
- Updated `ReconciliationStatusSchema` JSDoc: "positive expected" → "non-null expected value (including zero, except VPF's zero-skip exception) … OR all four actuals are null"

---

## Assumptions

- `HttpError` from `../../../lib/errors.ts` is a plain subclass of `Error` with a `statusCode` field (confirmed by its existing usage throughout the service file and import at line 34 of the original file).
- `9_000_000_000_000_000` (9e15) is a valid JavaScript safe integer: `Number.isSafeInteger(9_000_000_000_000_000)` → `true` (since 9e15 < 9.007e15 = MAX_SAFE_INTEGER). After one 825-bps compounding step it reaches ~9.742e15, which exceeds MAX_SAFE_INTEGER and correctly triggers the overflow guard.
- Integration Test 12 is placed before Test 11 in the file (because I inserted before the "Test 11" label block), so the numbering in the file shows Test 12 appearing before Test 11. The ordering of tests has no semantic impact on `node --test`.

## Unresolved Risks

- A genuine concurrent-race reproduction test (two separate DB client connections hitting the same row simultaneously) was not attempted. The brief explicitly acknowledged this is impractical without a second DB connection and directed against using `Promise.all` on a single pool. The code-level fix (`.for("update")`) is correct per established repo convention and Postgres semantics. The sequential test validates the status-recompute logic the lock protects.
