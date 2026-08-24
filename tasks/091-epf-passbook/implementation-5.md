# EPF Passbook — Implementation Round 5

## Files Inspected
- `apps/api/src/modules/tax/services/epf-contributions.ts` (service)
- `apps/api/src/modules/tax/routes/epf-contributions.ts` (route callers)
- `apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`
- `apps/api/src/modules/tax/services/epf-contributions.test.ts`
- `apps/api/src/db/index.ts` (to confirm `Db` has `transaction()`)

## Files Changed
- `apps/api/src/modules/tax/services/epf-contributions.ts`
- `apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`

## Pre-change verification (type safety of `db: DbOrTx` → `db: Db`)

Confirmed before changing:
1. Route caller at `apps/api/src/modules/tax/routes/epf-contributions.ts:187`:
   `return confirmActual(req.server.db, userId, req.params.id, req.body);`
   `req.server.db` is typed as `Db`.
2. Integration test: `const db = createDb(pool)` returns `Db` (from `apps/api/src/db/index.ts`).
3. `DbOrTx` is still referenced by `listContributions`, `getGaps`, and `getProjection` so it
   remains imported.

## Implementation Details

### Change 1 — `confirmActual` in `epf-contributions.ts`

- Changed parameter type from `DbOrTx` to `Db`.
- Wrapped body in `db.transaction(async (tx) => { ... })`.
- Changed both the SELECT and the UPDATE to use `tx` instead of `db`.
- Added `.for("update")` to the SELECT.
- Added a 4-line comment above `.for("update")` matching the style established in
  `createManual` and `importFromPayslip` (prior round):

```
// Load the row first so we can run computeStatus.
// .for("update") acquires a row-level lock for the remainder of this transaction,
// so a concurrent createManual/importFromPayslip upsert on the same row blocks until
// we commit — eliminating the TOCTOU race where expected_* might change between our
// SELECT and UPDATE, causing us to write a stale reconciliationStatus.
```

The WHERE clause (`id` + `userId`) is sufficient re-verification after lock acquisition.
No re-check of `existing.id` needed: if the row still exists with matching id+userId after
the lock is granted, no other operation could have changed its identity.

### Change 2 — Test 13 in `epf-contributions.integration.test.ts`

Added integration test `"confirmActual: re-confirm reads fresh expected_* after createManual updates them (sequential TOCTOU proof)"` between the existing "Test 12" and "Test 11" section headers (test 12 was added in the prior round; the file numbering is logical, not positional).

The test:
1. Creates manual entry expected=180000 → asserts "pending".
2. Confirms actual=180000 → asserts "matched".
3. Re-calls `createManual` with expected=190000 → asserts "mismatch" (expected=190000, actual=180000, |10000|*100=1000000 > 190000).
4. Re-confirms actual=190000 → asserts `reconciliationStatus === "matched"` and `expectedEmployeePaise === 190000`.

One-line comment (not a test) near the `.for("update")` simulation (step 3) reads:
```
// True concurrent-interleaving reproduction requires two separate pool connections and was out of scope here.
```
This is consistent with (and does not duplicate) the comment in test 12 which explains the `.for("update")` lock semantics but does not mention the pool-connection limitation.

## Complete Diff (This Round Only — `confirmActual` + Test 13)

The cumulative `git diff` output (vs HEAD) is in the tool output captured above. The
round-5-specific hunks are:

**`epf-contributions.ts` (lines ~439–494 in the patched file):**
```diff
-export async function confirmActual(
-  db: DbOrTx,
+export async function confirmActual(
+  db: Db,
   userId: string,
   id: string,
   body: ConfirmActualBody,
 ): Promise<EpfContribution> {
-  // Load the row first so we can run computeStatus.
-  const [existing] = await db
-    .select()
-    .from(epfContributions)
-    .where(and(eq(epfContributions.id, id), eq(epfContributions.userId, userId)));
-
-  if (!existing) throw new HttpError(404, "EPF contribution not found");
-
-  const newActuals = { ... };
-  const status = computeStatus({ ..., expectedEmployeePaise: existing... });
-
-  const [updated] = await db
-    .update(epfContributions)
-    .set({ ...newActuals, reconciliationStatus: status, updatedAt: new Date() })
-    .where(and(eq(epfContributions.id, id), eq(epfContributions.userId, userId)))
-    .returning();
-
-  if (!updated) throw new HttpError(404, "EPF contribution not found");
-  return buildEpfContributionDto(updated);
+  return db.transaction(async (tx) => {
+    // Load the row first so we can run computeStatus.
+    // .for("update") acquires a row-level lock for the remainder of this transaction,
+    // so a concurrent createManual/importFromPayslip upsert on the same row blocks until
+    // we commit — eliminating the TOCTOU race where expected_* might change between our
+    // SELECT and UPDATE, causing us to write a stale reconciliationStatus.
+    const [existing] = await tx
+      .select()
+      .from(epfContributions)
+      .where(and(eq(epfContributions.id, id), eq(epfContributions.userId, userId)))
+      .for("update");
+
+    if (!existing) throw new HttpError(404, "EPF contribution not found");
+
+    const newActuals = { ... };
+    const status = computeStatus({ ..., expectedEmployeePaise: existing... });
+
+    const [updated] = await tx
+      .update(epfContributions)
+      .set({ ...newActuals, reconciliationStatus: status, updatedAt: new Date() })
+      .where(and(eq(epfContributions.id, id), eq(epfContributions.userId, userId)))
+      .returning();
+
+    if (!updated) throw new HttpError(404, "EPF contribution not found");
+    return buildEpfContributionDto(updated);
+  });
 }
```

**`epf-contributions.integration.test.ts` (Test 13, ~38 lines added):**
Full test added between existing test-12 and test-11 section headers; see file.

## Commands Run and Literal Output

### 1. `npm run typecheck -w apps/api`

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit

EXIT:0
```

### 2. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT:0
```

### 3. `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts`

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
# duration_ms 388.085944
EXIT:0
```

### 4. `node --test apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`

```
TAP version 13
# file:///home/udai/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:54
#     throw new Error(
#           ^
# Error: epf-contributions.integration.test.ts requires DATABASE_URL set (a real Postgres
# connection) — this repo has no DB-mocking infrastructure. Export it (see
# apps/api/.env) before running `npm run test -w apps/api`.
#     at requireDatabaseUrl (...)
#     at file:///...epf-contributions.integration.test.ts:63:25
# Node.js v22.19.0
not ok 1 - apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
  ---
  duration_ms: 393.33221
  failureType: 'testCodeFailure'
  exitCode: 1
  error: 'test failed'
  code: 'ERR_TEST_FAILURE'
  ...
1..1
# tests 1
# suites 0
# pass 0
# fail 1
# cancelled 0
# skipped 0
# todo 0
# duration_ms 399.251024
EXIT:1
```

DATABASE_URL is not set in this environment. The file fails at module load with the
`requireDatabaseUrl()` guard — the documented expected behavior for this repo. All
11 existing tests + the new test 13 will run against a real DB when DATABASE_URL is set.

### 5. `git status --short` and `git diff --stat`

```
M apps/api/src/modules/tax/routes/epf-contributions.ts
 M apps/api/src/modules/tax/schema.ts
 M apps/api/src/modules/tax/services/epf-contributions.integration.test.ts
 M apps/api/src/modules/tax/services/epf-contributions.test.ts
 M apps/api/src/modules/tax/services/epf-contributions.ts
 M packages/shared/src/schemas/tax.ts
?? tasks/091-epf-passbook/implementation-3.md
?? tasks/091-epf-passbook/implementation-4.md
 .../src/modules/tax/routes/epf-contributions.ts    |   3 +-
 apps/api/src/modules/tax/schema.ts                 |   2 +-
 .../services/epf-contributions.integration.test.ts | 109 +++++-
 .../modules/tax/services/epf-contributions.test.ts |  66 +++-
 .../src/modules/tax/services/epf-contributions.ts  | 412 +++++++++++++--------
 packages/shared/src/schemas/tax.ts                 |   4 +-
 6 files changed, 437 insertions(+), 159 deletions(-)
EXIT:0
```

No staging or committing was performed. The other 4 modified files (`routes/epf-contributions.ts`,
`schema.ts`, `epf-contributions.test.ts`, `packages/shared/src/schemas/tax.ts`) are from
prior rounds and were not touched in this round.

## Assumptions and Unresolved Risks

- None. The WHERE clause on `id` + `userId` is sufficient after lock acquisition —
  confirmed as noted in the brief. The 404 path for a missing/foreign row is unaffected.
- The integration test cannot be run to completion without a real Postgres connection.
  The sequential proof (test 13) is structurally equivalent to test 12 (prior round),
  which was reviewed and accepted. True concurrent-interleaving testing would require
  two separate pool connections; that is explicitly noted in the test comment.
