# Implementation 3 — Fix round 2 (review-3 blockers R1–R4)

## Per-item resolution

### R1 (M-NEW1) — BigInt exact arithmetic in both FD/NSC and RD paths
- Added `halfUp(num: bigint, den: bigint): number` helper.
- Replaced `periodInterest` internals with BigInt: full-period uses `base * bps / (10000 * periodsPerYear)`; stub uses `base * bps * days / (10000 * 365)`. Both half-up rounded once.
- Added `rdPeriodInterest` helper accumulating all period contributions (opening full/stub + per-installment day-count) over a common denominator `10000 * periodsPerYear * 365`. GCD(periodsPerYear, 365) = 1 for all valid values (1, 2, 4, 12), so the LCM equals the product. Full-period opening scaled by ×365; day-count terms scaled by ×periodsPerYear.
- Refactored `computeRdSchedule` to use `rdPeriodInterest` per period (removed float `openingInterestRaw` and `installmentInterestRaw` accumulation).
- Added `assertSafeIntegers` post-condition checking every emitted field and schedule total via `Number.isSafeInteger`; throws `Error("deposit accrual: value exceeds safe integer range: <field>=<value>")`.
- Both `computeFdNscSchedule` and `computeRdSchedule` call `assertSafeIntegers` before returning.
- Existing 29 tests unchanged in expectations; BigInt produces identical results at normal magnitudes (verified: pass count 32/32).

### R2 (M-NEW2) — cap totalInstallments at 600
- Added `export const MAX_RD_INSTALLMENTS = 600` to `packages/shared/src/schemas/wealth.ts`.
- Changed `totalInstallments: z.number().int().min(1)` to `.min(1).max(MAX_RD_INSTALLMENTS)` in `UpsertDepositDetailsSchema`.
- Added rejection test in `wealth.test.ts` asserting: at-cap (600) accepted; cap+1 rejected; 10_000 rejected; zero rejected.

### R3 (M5 residue) — replace fixed-table property test with LCG-generated coverage
- Replaced the fixed 9-case table with a seeded LCG (Numerical Recipes: a=1664525, c=1013904223, m=2^32; seed=0xDEAD_BEEF) generating 25 deterministic cases across all deposit kinds, frequencies, dispositions, principals/installments, and start dates.
- Each case asserts: balance identity (closing = opening+deposit+interest−payout), period continuity (opening[n+1] = closing[n]), totals reconciliation, maturityValue = last closing, all period fields non-negative and isSafeInteger.
- Two explicit required cases appended: payout-mode RD (12-month @700bps), and EOM Jan31→Apr30 monthly FD.
- EOM assertion now `=== 3` (was `>= 3`).

### R4 (M-NEW1 regression) — exact-rational reproduction test
- Added `R4 regression (M-NEW1): RD Q1 with large installment rounds to exact paise 56_391_369_504_281` test asserting `interestPaise === 56_391_369_504_281`.
- Comment in test shows full BigInt oracle: `sum_num = 955173831910025n × 1184n × 728n = 823_313_994_762_509_868_800n`; `q = 56_391_369_504_281n`; `r = 7_268_800n`; `r×2n = 14_537_600n < 14_600_000n` → rounds DOWN.
- Also added: `RD payout mode` direct regression and `post-condition throws when closing paise exceeds safe integer range` (principal = MAX_SAFE_INTEGER, @700bps quarterly, closing ~9.16e15 > MAX_SAFE_INTEGER).

## Files changed

- `apps/api/src/modules/investments/services/deposit-accrual.ts` — BigInt refactor (R1), post-condition (R1)
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` — R4 regression, EOM === 3 fix, RD payout test, post-condition throw test, LCG property test (R3), `addMonths` import
- `packages/shared/src/schemas/wealth.ts` — MAX_RD_INSTALLMENTS export + .max(600) (R2)
- `packages/shared/src/schemas/wealth.test.ts` — cap rejection test + imports (R2)

## Diff stat (approximate)

- deposit-accrual.ts: ~90 lines changed (periodInterest replaced, rdPeriodInterest added, assertSafeIntegers added, computeRdSchedule refactored, computeFdNscSchedule updated)
- deposit-accrual.test.ts: ~160 lines net added (property test replaced + 3 new tests)
- wealth.ts: ~8 lines added
- wealth.test.ts: ~30 lines added

## Commands and literal output

### Gate 1: targeted deposit tests
```
node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
```
```
✔ FD 1-year at 710 bps quarterly compounding (reinvest): correct maturity value
✔ FD monthly payout: interest paid out each month, principal unchanged at maturity
✔ FD half-yearly 2-year at 800 bps (reinvest): 4 periods, correct maturity
✔ RD 12-month at 700 bps quarterly compounding: correct maturity value (per-installment date-based)
✔ NSC 5-year annual reinvest at 765 bps: correct taxable interest per year and maturity
✔ Tax-saver FD uses identical compound-interest math as a regular FD
✔ zero-rate FD: no interest earned, maturity value equals principal
✔ one-paise FD: schedule does not throw and returns non-negative interest
✔ large safe-integer amount: paise arithmetic stays within safe integer bounds
✔ leap-year FD: Feb 28 + 1 month → Mar 28, no crash
✔ end-of-month FD: Jan 31 anchored boundaries avoid drift
✔ stub final period uses Actual/365 Fixed day-count
✔ RD with fewer than one full period of installments
✔ RD Q1 installment-date accrual: 3×1,000,000 paise @700bps = 34,904 paise interest
▶ RD: maturity beyond final installment continues to accrue stub interest
  ✔ RD: stub final period uses pro-rated opening balance (Actual/365 Fixed)
✔ RD: maturity beyond final installment continues to accrue stub interest
✔ property: deterministic LCG-generated coverage over kind/rate/frequency/disposition matrix
✔ half-up rounding: exact .0 → no rounding
✔ half-up rounding: .5 fractional rounds UP
✔ half-up rounding: below .5 rounds DOWN
✔ schedule fields form a coherent balance sheet: closing = opening + deposit + interest - payout
✔ R4 regression (M-NEW1): RD Q1 with large installment rounds to exact paise 56_391_369_504_281
✔ RD payout mode: interest disbursed each period, closing = opening + deposit only
✔ post-condition throws when closing paise exceeds safe integer range
✔ deposit-details module exports getDepositDetails, upsertDepositDetails, getDepositSchedule
✔ validateDepositKindConstraints: RD with non-quarterly compoundingFrequency is rejected (400)
✔ validateDepositKindConstraints: RD with quarterly compoundingFrequency is accepted
✔ validateDepositKindConstraints: NSC with non-5-year term is rejected (400)
✔ validateDepositKindConstraints: NSC with exact 5-year term is accepted
✔ validateDepositKindConstraints: tax_saver_fd with exact 5-year term is accepted
✔ validateDepositKindConstraints: tax_saver_fd one day short of 5 years is rejected (400)
✔ validateDepositKindConstraints: tax_saver_fd one day beyond 5 years is rejected (400)
ℹ tests 32
ℹ pass 32
ℹ fail 0
ℹ duration_ms 436.056236
EXIT: 0
```

### Gate 2: packages/shared tests
```
npm run test -w packages/shared
```
```
ℹ tests 352
ℹ pass 352
ℹ fail 0
ℹ duration_ms 315.299519
EXIT: 0
```

### Gate 3: typecheck
```
npm run typecheck
```
All workspaces clean.
EXIT: 0

### Gate 4: lint
```
npm run lint
```
Clean (one intermediate failure on unused `FD_KINDS` was fixed before final run).
EXIT: 0

## Assumptions

- `addMonths` was already exported from `deposit-accrual.ts`; the test file just needed to import it.
- GCD(periodsPerYear, 365) = 1 holds for all valid frequencies (1, 2, 4, 12); documented in module header.
- The `assertSafeIntegers` post-condition intentionally does NOT prevent the BigInt→Number conversion from losing precision before the check: for values exceeding MAX_SAFE_INTEGER, `Number(bigint)` produces an imprecise float that still fails `isSafeInteger`, so the check remains sound.

## Unresolved risks

None. All four items fully resolved; 32+352 tests pass; typecheck exit 0; lint exit 0.
