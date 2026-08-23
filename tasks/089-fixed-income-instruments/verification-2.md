# Verification Report: Task 089 — Fixed-Income & Small-Savings Instruments (Fix Round)

**Date:** 2026-08-23  
**Status:** VERIFIED ✓

## Test Gate Results

### Command 1: npm run typecheck
**Exit code:** 0  
**Result:** PASS — all 7 workspaces typecheck clean

### Command 2: npm run lint
**Exit code:** 0  
**Result:** PASS — no linting errors

### Command 3: Deposit Accrual & Details Tests
```
node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
```
**Exit code:** 0  
**Result:** PASS  
✔ 17 accrual tests (FD compound, payout, RD per-installment, NSC 5-year, tax-saver, stub periods, half-up rounding, leap-year, balance coherence)  
✔ 12 deposit-details validation tests (RD quarterly enforcement, NSC exact 5-year, tax-saver exact 5-year, positive/negative boundaries)  
**Total:** 29 pass, 0 fail

### Command 4: Route Snapshot & Schema Decomposition Tests
```
node --test apps/api/src/app.route-snapshot.test.ts apps/api/src/db/schema.decomposition.test.ts
```
**Exit code:** 0  
**Result:** PASS  
✔ 5 route snapshot tests (surface + tree match + validation guards)  
✔ 3 schema decomposition tests (74 tables + 58 enums, identity, no duplicates)  
**Total:** 10 pass, 0 fail

### Command 5: Shared Workspace Tests
```
npm run test -w packages/shared
```
**Exit code:** 0  
**Result:** PASS  
✔ 351 tests (all existing schemas + new wealth.ts extensions)  
**Total:** 351 pass, 0 fail

### Command 6: Full API Test Suite
```
npm run test -w apps/api
```
**Exit code:** 1 (expected — missing DATABASE_URL)  
**Result:** 1132 pass, 33 fail (all ECONNREFUSED, DB-dependent)  
- ✔ All deposit-accrual and deposit-details tests passing (29 tests)
- ✔ 12 static backup tests pass (table coverage, FK ordering, etc.)
- ✖ 33 DB tests fail with ECONNREFUSED → CONNECTION-DEPENDENT (not genuine failures)

## Fix Round F1–F5 Landed Checklist

| Item | Requirement | Status | Evidence |
|------|-------------|--------|----------|
| **F1** | RD redesign: per-installment date-based accrual, anchored boundaries, opening balance Actual/365F for stubs, ONE half-up round per period | ✓ Landed | deposit-accrual.test.ts: "RD Q1 installment-date accrual: 3×₹10k @7% ≈34,904 paise" matches hand-calculated ~50% reduction from naive model; "RD: stub final period uses pro-rated opening balance (Actual/365 Fixed)" passes |
| **F2** | NSC exact 5-year calendar (startDate + 60 months); tax_saver_fd exact 5-year; delete day-count tolerance | ✓ Landed | deposit-details.test.ts: "NSC with non-5-year term is rejected (400)", "NSC with exact 5-year term is accepted", "tax_saver_fd one day short/beyond 5 years is rejected" all pass |
| **F3** | Service rejects RD unless compoundingFrequency === "quarterly" (400) + negative test | ✓ Landed | deposit-details.test.ts: "RD with non-quarterly compoundingFrequency is rejected (400)" passes |
| **F4** | Property tests: closing=opening+deposit+interest−payout, period continuity, totals reconcile, half-up rounding boundaries; regressions for all rejected shapes | ✓ Landed | deposit-accrual.test.ts: "property: balance coherence…", "half-up rounding: exact .0 / .5 / below .5", "schedule fields form coherent balance sheet" all pass |
| **F5** | Header comment updated (remove "simplified model" language) | ✓ Landed | deposit-accrual.ts header reflects per-installment design, not simplified model |

## Schema & Table Consistency

✓ Journal: migrations 0012 & 0013 present (idx 12 & 13)  
✓ deposit_details table in apps/api/src/modules/investments/schema.ts (all constraints present)  
✓ db/schema.ts re-exports: depositDetails, depositKindEnum, compoundingFrequencyEnum  
✓ backup.ts: deposit_details in ALL_TABLES (line 43) AND USER_TABLES (line 68)  
✓ backup.ts: deposit_details listed BEFORE holdings FK-parent order (line 43)  
✓ route-surface.snapshot.txt: +3 deposit routes (GET/HEAD/PUT /api/holdings/:id/deposit; GET/HEAD /api/holdings/:id/deposit/schedule)  
✓ route-table.snapshot.txt: deposit routes registered under /api/holdings/:id hierarchy  
✓ schema.decomposition: 74 tables + 58 enums (no new enums for 089, reuses existing depositKind/compoundingFrequency)  

## Scope Adherence

**089 Declared Scope** — all files present:
- ✓ apps/api/src/modules/investments/services/deposit-accrual.ts (new)
- ✓ apps/api/src/modules/investments/services/deposit-accrual.test.ts (new)
- ✓ apps/api/src/modules/investments/services/deposit-details.ts (new)
- ✓ apps/api/src/modules/investments/services/deposit-details.test.ts (new)
- ✓ apps/api/src/modules/investments/routes/deposit-details.ts (new)

**Modified Scope** — schema, plugin, wiring:
- ✓ apps/api/src/modules/investments/schema.ts (deposit_details table + enums)
- ✓ apps/api/src/modules/investments/plugin.ts (deposit routes registered)
- ✓ apps/api/src/db/schema.ts (re-exports)
- ✓ apps/api/src/modules/system/services/backup.ts (USER_TABLES)
- ✓ packages/shared/src/schemas/wealth.ts (deposit Zod schemas)

**Out-of-scope files NOT modified:**
- ✓ db/shared/spines.ts (holdings table untouched)
- ✓ lib/instrument-rules.ts (untouched)
- ✓ modules/tax/** (co-resident 087 owns this)
- ✓ lib/financial-year.ts, lib/tax-rules.ts (co-resident 087 owns these)

## Acceptance Criteria (AC1–AC11)

| AC | Requirement | Status |
|----|-------------|--------|
| AC1 | FD/RD/NSC/tax_saver_fd distinguished by depositKind enum | ✓ Schema uses pgEnum('depositKind', ['fd', 'rd', 'nsc', 'tax_saver_fd']) |
| AC2 | RD: installmentPaise + totalInstallments; FD/NSC: principalPaise | ✓ Schema with CHECK constraints enforcing RD pattern |
| AC3 | Premature-closure penalty as advisory prematureClosurePenaltyBps | ✓ Column present in deposit_details table |
| AC4 | TDS applicability flagged (tdsSectionApplicable advisory only) | ✓ Boolean column, no TDS computation |
| AC5 | Interest accrual schedule computed on demand, never stored | ✓ getDepositSchedule() returns AccrualPeriod[], no persistence |
| AC6 | Payout FD: interest not reinvested; Reinvest: interest compounds | ✓ deposit-accrual.test.ts: "FD monthly payout: interest paid out each month, principal unchanged" passes |
| AC7 | Tax-saver 5-year FD + NSC 5-year annual-compound reinvest enforced | ✓ deposit-details.test.ts validates exact calendar 5-year; NSC enforced as annual+reinvest in accrual logic |
| AC8 | Integer paise; Actual/365 Fixed day-count; half-up rounding per period | ✓ All tests verify paise arithmetic, stub Actual/365F, half-up rounding |
| AC9 | Table in ALL_TABLES + USER_TABLES (not LINKED_TABLES) | ✓ backup.ts line 43 (ALL), line 68 (USER), has user_id |
| AC10 | Ownership validation matches holding-details pattern | ✓ deposit-details.ts loads by holdingId + userId, verifies assetClass |
| AC11 | typecheck + lint + test green | ✓ typecheck 0 errors, lint 0 errors, 29 targeted tests pass |

## Verdict

**VERIFIED** — Task 089 fix round (F1-F5) is complete and all verification gates pass.

- T1: typecheck ✓
- T2: lint ✓
- T3: test (29 targeted deposit tests) ✓
- T4–T10: all acceptance criteria met (AC1-AC11)
- No genuine test failures (33 API-suite fails are CONNECTION-DEPENDENT)
- RD per-installment model cuts naive overstating in half (~50% correction)
- NSC/tax-saver exact 5-year enforcement prevents term mismatches
- All financial invariants verified (balance coherence, period continuity, half-up rounding)

