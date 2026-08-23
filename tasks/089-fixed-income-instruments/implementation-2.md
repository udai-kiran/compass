# Implementation Report — Task 089 Fix Round (Iteration 4)

## Per-finding resolution

- **F1 (H1+M2+M3) RESOLVED**: Redesigned `computeRdSchedule`:
  - Installment dates pre-computed as `addMonths(startDate, k)` for k=0..totalInstallments-1
  - Per period: opening balance earns nominal periodic rate (raw); each installment in [periodStart, periodEnd) accrues `installment × bps × days / (10000 × 365)` (raw); ONE `Math.round` of sum
  - Loop continues until `maturityDate` regardless of installments exhausted (`depositPaise=0` after all installments consumed)
  - `computeFdNscSchedule` also fixed: period boundaries anchored as `addMonths(startDate, n × monthsPerPeriod)` — never chained from previously clamped dates

- **F2 (M1+L1) RESOLVED**: `validateDepositKindConstraints` now:
  - NSC: `addMonths(startDate, 60) !== maturityDate` → 400 (exact calendar, leap-safe)
  - tax_saver_fd: same exact calendar check replacing the 1825–1832 day-count tolerance
  - Function exported for direct unit testing

- **F3 (M4) RESOLVED**: RD branch in `validateDepositKindConstraints` now rejects `compoundingFrequency !== "quarterly"` with 400; `addMonths` imported from `deposit-accrual.ts`

- **F4 (M5) RESOLVED**: New tests added:
  - Property suite (9 generated cases) covering balance identity, period continuity, totals reconciliation, safe-integer/non-negativity
  - Half-up rounding boundary: exact .0 → 100, .5 → 101 (rounds UP), .4875 → 100 (rounds DOWN)
  - Regression: RD Q1 installment-date accrual (3×1,000,000 paise @700bps = 34,904 paise — vs old front-loaded 52,500)
  - Regression: maturity beyond final installment (Q2 earns 53,111 from opening balance alone)
  - Regression: non-quarterly RD rejected (monthly/half_yearly/annually all 400)
  - Regression: NSC non-5-year rejected, exact 5-year accepted
  - Regression: tax_saver_fd exact-boundary accept (Jan1→Jan1+5y), reject -1 day, reject +1 day
  - Updated RD 12-month test with corrected per-installment values: 34,904 / 88,015 / 142,247 / 197,428; maturity 12,462,594

- **F5 RESOLVED**: Header comment updated — removed "standard simplified model" language, documented per-date installment accrual, anchored boundary convention, stub period handling, loop-to-maturity behaviour

## Files changed

- `apps/api/src/modules/investments/services/deposit-accrual.ts` — F1 (redesign), F5 (header)
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` — F4 (new tests), updated RD 12-month values
- `apps/api/src/modules/investments/services/deposit-details.ts` — F2 (NSC+tax_saver_fd exact 5y), F3 (RD quarterly), export `validateDepositKindConstraints`
- `apps/api/src/modules/investments/services/deposit-details.test.ts` — F3+F4 pure rejection tests

## Commands run and output

### Gate 1: targeted tests
```
node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
```
```
ℹ tests 28
ℹ pass 28
ℹ fail 0
ℹ duration_ms 446.611756
exit 0
```

### Gate 2: typecheck
```
npm run typecheck
```
Output: tsc --noEmit for all 6 workspaces, no errors.
Exit: 0

### Gate 3: lint
```
npm run lint
```
Output: eslint . — no warnings or errors.
Exit: 0

## Diff stat

4 files changed. No new files; no deletions.

deposit-accrual.ts: ~+60 lines (redesigned RD function + anchored FD loop + addMonths export + header)
deposit-accrual.test.ts: ~+130 lines (new regression/property/rounding tests + corrected RD 12-month values)
deposit-details.ts: ~+15 lines (exact-calendar 5y checks + RD quarterly guard + export + import)
deposit-details.test.ts: ~+110 lines (8 new pure validation tests)

## Key numeric correction

RD 12-month test (1M paise/installment, 700bps quarterly, 2024-01-01 → 2025-01-01):
- Q3 expected 142,246 in test; actual formula gives 142,247 (opening raw 107,151.08 not 107,150.58 — arithmetic error in original hand computation). Fixed in test.
- Final maturity: 12,462,594 (not 12,462,593).

## Assumptions

- For RD stub final periods (maturityDate between compounding boundaries), the opening balance earns the full nominal periodic rate, not Actual/365F — as specified in F1.
- `totalDepositPaise` in RD schedule is computed as `sum(period.depositPaise)` rather than `total × installment` to ensure the property test `totalDeposit = sum(period deposits)` holds exactly.
- `addMonths` export from deposit-accrual.ts to deposit-details.ts is a minimal public API addition; no schema, route, plugin, snapshot, or migration files touched.

## Unresolved risks

None. All review-2 blocking findings resolved; typecheck, lint, and 28 targeted tests pass.
