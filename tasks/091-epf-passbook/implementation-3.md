# Implementation-3 — EPF Passbook Review-4 Blockers (5 Fixes)

## Files Changed

1. `apps/api/src/modules/tax/services/epf-contributions.ts` — all functional changes (P1, P2, P3, P4, P5.1)
2. `apps/api/src/modules/tax/schema.ts` — comment only (P5.2)
3. `packages/shared/src/schemas/tax.ts` — comment only (P5.3)
4. `apps/api/src/modules/tax/routes/epf-contributions.ts` — comment only (P5.4)
5. `apps/api/src/modules/tax/services/epf-contributions.test.ts` — test updates for P1 and P3
6. `apps/api/src/modules/tax/services/epf-contributions.integration.test.ts` — test updates for P2 and P4

## Implementation Details

### P1 — computeStatus: unconditional leading check + EPS/employee/employer zero-skip removal

**Change:** In `computeStatus`, replaced the old single `needsConfirmation` helper (which had `expected !== 0` for all four components) with:

1. An unconditional leading check: if ALL four actuals are null → return `"pending"` immediately. Handles the case of a freshly-created row where no passbook values have been entered at all, even when all expected values are null (e.g. a manual entry with nothing set yet would previously have returned `"matched"` since no positive expectation existed).

2. Split into two helpers:
   - `needsConfirmation(expected, actual)`: `expected !== null && actual === null` — used for employee, employer, EPS. Zero expected NOW triggers pending if actual is null.
   - `vpfNeedsConfirmation(expected, actual)`: `expected !== 0 && actual === null` — used only for VPF, which keeps the zero-skip exception (zero VPF expected = no VPF, so no actual required).

**Test changes:**
- Test `"treats a zero expected column as not a pending trigger..."` renamed to `"a zero expected EPS with a null actual now needs confirmation (blocker 1 — EPS/employer/employee lost their zero exception)"` and assertion changed from `"matched"` → `"pending"`. This test uses `statusRow()` which gives non-null actuals for employee and employer (180000 and 55000), so the leading all-null check does NOT fire; instead the second `if` block catches `needsConfirmation(0, null)` → true.
- Added new test `"returns pending when all four actuals are null, even with all expected null/zero (fresh unconfirmed row)"`.

**Test NOT changed:** `"treats a zero expected column as not comparable for mismatch"` — uses `expectedEpsPaise: 0, actualEpsPaise: 125000`. Actual is non-null so `needsConfirmation(0, 125000)` → false. No pending. Zero expected skipped by `isMismatch` guard. Still returns `"matched"`. ✓

### P2 — createManual / importFromPayslip: atomic reconciliationStatus recompute on every upsert

**Change:** Both functions changed from `db: DbOrTx` to `db: Db`. Bodies wrapped in `db.transaction(async (tx) => { ... })`. Before the upsert, each function now SELECTs the existing row (by the conflict key) to read current `actual_*` values. `computeStatus()` is called with existing actuals + new expected values. The resulting `status` is included in both `.values({...})` and `onConflictDoUpdate({...set: { reconciliationStatus: sql\`EXCLUDED.reconciliation_status\`, ... }})`.

**Caller check:** `grep -rn "createManual\|importFromPayslip" apps/api/src/` confirmed both are called only from:
- `apps/api/src/modules/tax/routes/epf-contributions.ts` with `req.server.db` (a `Db`)
- `apps/api/src/modules/tax/services/epf-contributions.integration.test.ts` with `db` (a `Db` from `createDb(pool)`)

No caller passes a raw transaction (`DbOrTx` narrowing to `Db` is safe). `DbOrTx` is still used by `confirmActual`, `listContributions`, `getGaps`, `getProjection` — the import was updated to `import type { Db, DbOrTx } from "../../../db/index.ts"`.

**Integration test change (test 5):** Captured return value of `confirmActual(...)`, asserted `confirmed.reconciliationStatus === "matched"` (employee expected=180000, actual=180000). After second `importFromPayslip` with expected=185000, asserted `second.reconciliationStatus === "mismatch"` (|5000|*100=500000 > 185000).

### P3 — computeEpfProjection: exact BigInt compounding

**Change:** Replaced `Math.round((corpus * (10000 + assumedAnnualRateBps)) / 10000)` with per-step BigInt arithmetic: `(corpus * rateNumerator + half) / rateDenominator` where `rateNumerator = 10000n + BigInt(rate)`, `rateDenominator = 10000n`, `half = 5000n` (= rateDenominator/2). Throws if result exceeds `Number.MAX_SAFE_INTEGER` at any step. Returns `Number(corpus)`.

**Correctness verification:** BigInt round-half-up `(x*n+half)/d` matches `Math.round((x*n)/d)` for positive integers. Confirmed for existing test cases:
- `(1000000n * 10825n + 5000n) / 10000n = 10825005000n / 10000n = 1082500n` → 1_082_500 ✓
- Year 2: `(1082500n * 10825n + 5000n) / 10000n = 11718067500n / 10000n = 1171806n` → 1_171_806 ✓ (matches `Math.round(1171806.25)`)

**New test:** Corpus `8_000_000_000_200` at 825 bps for 12 months. Intermediate product `8_000_000_000_200 * 10825 ≈ 8.66e16 > Number.MAX_SAFE_INTEGER ≈ 9.007e15` — the old `number` multiplication would have lost integer precision. Expected result computed inline in the test as `(8000000000200n * 10825n + 5000n) / 10000n = 8660000000217n` → `8_660_000_000_217` (a safe integer). Test asserts `computeEpfProjection` equals that value and result is a safe integer.

### P4 — getProjection: DOB-missing disclaimer

**Change:** Added `dobMissing: boolean` tracking in the `if (profile?.dateOfBirth) / else` block. Added two string constants inside `getProjection` (after `ASSUMED_ANNUAL_RATE_BPS`):
- `BASE_DISCLAIMER` — the existing disclaimer text
- `DOB_MISSING_DISCLAIMER` = `"Date of birth not on file — assumed 20 years to retirement. " + BASE_DISCLAIMER`

Replaced the inline `disclaimer: "..."` with `disclaimer: dobMissing ? DOB_MISSING_DISCLAIMER : BASE_DISCLAIMER`.

**Integration test changes:**
- Test 10 (`getProjection: currentCorpusPaise matches posted balance`): no `dateOfBirth` set → DOB-missing path. Added `assert.match(result.disclaimer, /date of birth/i)`.
- New test 11 (`getProjection: uses base disclaimer (no DOB mention) when dateOfBirth is on file`): inserts `userProfiles` row with `{ userId, dateOfBirth: "1985-06-15" }` (only two columns required — both notNull are userId PK and dateOfBirth; createdAt/updatedAt have defaults). Asserts `doesNotMatch(result.disclaimer, /date of birth/i)`.

### P5 — Stale doc-comment cleanup (4 locations, comment-only)

1. `epf-contributions.ts` file header: `employer_epf + eps = gross employer share (12% of basic).` → `...gross employer share (no fixed-rate check — the actual rate varies by employer/payslip; H2 removed the unconditional 12%-of-basic assumption).`
2. `schema.ts` line 317 (column doc on `expectedEmployerPaise`): same old text → same replacement.
3. `packages/shared/src/schemas/tax.ts` line 478: `pension fund) = gross employer share (statutory ~12% of wage).` → `...gross employer share (no fixed-rate check — the actual rate varies by employer/payslip).`
4. `routes/epf-contributions.ts` POST `/import-from-payslip` doc: `Idempotent by payslip_id: a second call returns the existing row. Re-import over an existing (month, member) row preserves actual_*.` → `Always upserts on (user, wage_month, epfo_member_id): a second call refreshes expected_* (and reconciliationStatus) from the current payslip components, preserving any already-confirmed actual_*.`

## Command Output

### 1. `npm run typecheck -w apps/api`

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```
EXIT: 0

### 2. `npm run typecheck -w packages/shared`

```
> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
EXIT: 0

### 3. `npm run lint` (root)

```
> compass@0.1.0 lint
> eslint .
```
EXIT: 0

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
    ok 16 - treats a zero expected column as not comparable for mismatch (avoids divide-by-zero)
    ok 17 - returns pending when all four actuals are null, even with all expected null/zero (fresh unconfirmed row)
    ok 18 - flags a mismatch when actual is lower than expected by more than 1%
    ok 19 - returns matched when all expected are null (or zero vpf) but actuals are set
    1..19
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
    1..8
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
# tests 51
# suites 5
# pass 51
# fail 0
# cancelled 0
# skipped 0
# todo 0
# duration_ms 383.715495
```
EXIT: 0

### 5. `node --test apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`

DATABASE_URL was NOT set in this sandbox. The test throws at module load time with the expected `requireDatabaseUrl()` error:

```
Error: epf-contributions.integration.test.ts requires DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireDatabaseUrl (file:///home/udai/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:53:11)
    ...
not ok 1 - apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
# tests 1
# fail 1
# duration_ms 377.211816
```
EXIT: 1

This is the expected and pre-existing behavior with no DATABASE_URL. The test changes are syntactically valid (typecheck and lint pass at exit 0).

### 6. `git status` and `git diff --stat`

```
On branch feat/082-083-receipt-cart-review
Your branch is up to date with 'origin/feat/082-083-receipt-cart-review'.

Changes not staged for commit:
    modified:   apps/api/src/modules/tax/routes/epf-contributions.ts
    modified:   apps/api/src/modules/tax/schema.ts
    modified:   apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
    modified:   apps/api/src/modules/tax/services/epf-contributions.test.ts
    modified:   apps/api/src/modules/tax/services/epf-contributions.ts
    modified:   packages/shared/src/schemas/tax.ts
```

```
 .../src/modules/tax/routes/epf-contributions.ts    |   3 +-
 apps/api/src/modules/tax/schema.ts                 |   2 +-
 .../services/epf-contributions.integration.test.ts |  33 ++-
 .../modules/tax/services/epf-contributions.test.ts |  39 ++-
 .../src/modules/tax/services/epf-contributions.ts  | 314 +++++++++++++--------
 packages/shared/src/schemas/tax.ts                 |   2 +-
 6 files changed, 273 insertions(+), 120 deletions(-)
```

Nothing staged. Nothing committed.

## Pre-existing test analysis — computeStatus and computeEpfProjection

### computeStatus tests (19 total, 17 pre-existing + 2 new)

| Test | Changed? | Pre-existing expected | New expected | Reasoning |
|------|----------|----------------------|--------------|-----------|
| 1. pending when actual employee null, expected positive | No | "pending" | "pending" | needsConfirmation(180000, null) → true ✓ |
| 2. pending even when some actuals set but employee null | No | "pending" | "pending" | Same ✓ |
| 3. pending when eps actual null, expected eps positive | No | "pending" | "pending" | needsConfirmation(125000, null) → true ✓ |
| 4. pending when employer actual null, expected employer positive | No | "pending" | "pending" | needsConfirmation(55000, null) → true ✓ |
| 5. pending when vpf actual null, expected vpf positive | No | "pending" | "pending" | vpfNeedsConfirmation(50000, null) → true ✓ |
| 6. matched on exact match (vpf=0) | No | "matched" | "matched" | No null actuals for employee/employer/EPS; vpfNeedsConfirmation(0, null) → false ✓ |
| 7. matched within 1% tolerance | No | "matched" | "matched" | Same ✓ |
| 8. matched at exactly 1% (boundary) | No | "matched" | "matched" | Same ✓ |
| 9. mismatch when employee differs by >1% | No | "mismatch" | "mismatch" | Same ✓ |
| 10. mismatch when employer differs by >1% | No | "mismatch" | "mismatch" | Same ✓ |
| 11. mismatch when eps differs by >1% | No | "mismatch" | "mismatch" | Same ✓ |
| 12. mismatch when vpf actual differs from expected by >1% | No | "mismatch" | "mismatch" | Same ✓ |
| 13. matched when vpf actual matches expected within 1% | No | "matched" | "matched" | Same ✓ |
| 14. null expected column not a pending trigger | No | "matched" | "matched" | needsConfirmation(null, 999999) → false; mismatch skips null expected ✓ |
| 15. **RENAMED**: zero expected EPS with null actual | YES | "matched" | "pending" | needsConfirmation(0, null) → true (zero exception removed for EPS) |
| 16. zero expected not comparable for mismatch | No | "matched" | "matched" | actualEpsPaise=125000 (non-null), needsConfirmation(0, 125000) → false; isMismatch(0, 125000) → false (zero guard) ✓ |
| 17. **NEW**: all four actuals null, all expected null/zero | NEW | — | "pending" | Leading unconditional check fires ✓ |
| 18. mismatch when actual lower than expected by >1% | No | "mismatch" | "mismatch" | Same ✓ |
| 19. matched when all expected null (or zero vpf) but actuals set | No | "matched" | "matched" | actualEmployeePaise=180000 so leading check doesn't fire; needsConfirmation(null, ...)→false; isMismatch(null, ...)→false ✓ |

### computeEpfProjection tests (8 total, 7 pre-existing + 1 new)

All 7 pre-existing tests unchanged (same expected values). The BigInt round-half-up formula produces identical results to `Math.round` for all existing cases — verified by hand before running. The new test (test 8) exercises a large corpus where the old intermediate product would exceed MAX_SAFE_INTEGER.

## Deviations from Brief

None. All 5 fixes implemented exactly as specified. The brief's note about `userProfiles` requiring only `userId` and `dateOfBirth` for the insert in test 11 was confirmed by reading `apps/api/src/modules/system/schema.ts`: `userProfiles` has `userId` (PK), `dateOfBirth` (nullable date), `createdAt` (defaultNow), `updatedAt` (defaultNow). Direct insert works with `{ userId, dateOfBirth: "1985-06-15" }`.

The brief noted `DbOrTx` may no longer be needed in the file after removing it from `createManual`/`importFromPayslip`. It is still used by `confirmActual`, `listContributions`, `getGaps`, and `getProjection`, so both `Db` and `DbOrTx` remain imported.
