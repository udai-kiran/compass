## High

None.

## Medium

- **M-NEW3 — payout-mode closing balances can still lose one paise at large safe-integer inputs.** Interest calculation is exact, but closing balances use floating-point addition followed by subtraction:

  - FD/NSC: [`deposit-accrual.ts:278`](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:278)
  - RD: [`deposit-accrual.ts:375`](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:375)

  In payout mode, `interestPaise === payoutPaise`, so the mathematical result should be `opening + deposit`. However, evaluating `opening + deposit + interest - payout` can exceed `2^53` temporarily and lose precision before the cancellation.

  Reproduction against the reviewed code:

  ```text
  RD installmentPaise = 3_000_000_000_000_001
  totalInstallments = 3
  annualRateBps = 1184
  payout mode, 2024-01-01 → 2024-04-01

  expected closing = 9_000_000_000_000_003
  actual closing   = 9_000_000_000_000_002
  delta            = -1 paise
  ```

  Every emitted value remains a safe integer, so [`assertSafeIntegers()`](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:221) does not detect the corruption. The direct payout regression uses only ₹10,000 installments and therefore misses this high-value/payout interaction ([test lines 855–895](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:855)).

  This can be fixed by computing payout-mode closing directly as `opening + depositPaise`/`base`, or by performing the complete balance equation in BigInt before conversion.

## Low

None.

## Prior-item resolutions

- **M-NEW1: raw interest precision — resolved.**
  - `halfUp()` uses exact BigInt quotient and remainder and rounds once ([lines 122–130](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:122)).
  - FD/NSC full and stub periods each invoke it exactly once ([lines 138–154](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:138)).
  - RD accumulates the opening and every installment contribution into one BigInt numerator and invokes `halfUp()` only after accumulation ([lines 169–212](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:169)).
  - The R4 regression asserts the exact result `56_391_369_504_281`, not the former float result one paise higher ([lines 803–847](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:803)).

- **M-NEW2: unbounded request precomputation — resolved for the validated request contract.**
  - `MAX_RD_INSTALLMENTS` is 600 ([wealth.ts:881](/work/personal/compass/packages/shared/src/schemas/wealth.ts:881)).
  - `totalInstallments` applies `.max(MAX_RD_INSTALLMENTS)` ([wealth.ts:889](/work/personal/compass/packages/shared/src/schemas/wealth.ts:889)).
  - Tests accept 600 and reject 601, 10,000, and zero ([wealth.test.ts:212](/work/personal/compass/packages/shared/src/schemas/wealth.test.ts:212)).

- **M5 test residue — resolved for the requested cases.**
  - Seeded-LCG generated cases and invariant checks: [lines 559–714](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:559).
  - Explicit payout-mode RD coverage: [lines 645–655](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:645) and direct regression at [lines 855–895](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:855).
  - Jan 31 → Apr 30 exactly three periods: [lines 657–722](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:657).
  - High-value R4 exact-result regression: [lines 803–847](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:803).

## BigInt correctness audit

- For non-negative `num` and positive `den`, `q = num / den`, `r = num % den`, followed by `r * 2 >= den ? q + 1 : q`, is correct half-up rounding, including exact ties.
- With `den = 10000 × periodsPerYear × 365`:
  - Full opening: multiplying by 365 cancels the denominator’s 365 factor.
  - Stub opening: multiplying by `days × periodsPerYear` cancels the `periodsPerYear` factor.
  - Installments use the same `days × periodsPerYear` transformation.
- All raw interest multiplication, accumulation, division, and rounding is now BigInt. The remaining `Math.round` calls concern calendar arithmetic, not interest.
- There is no narrow `Number()` conversion window where a rounded BigInt just above `Number.MAX_SAFE_INTEGER` becomes safe: values at or above `2^53` convert to `2^53` or higher (or infinity), all rejected by `Number.isSafeInteger`. The remaining defect instead occurs later through floating-point balance cancellation, as described above.

## Expected-value stability

Existing exact assertions remain unchanged and pass, including:

- FD quarterly maturity `107_291_284` ([lines 20–63](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:20)).
- FD monthly payout totals `360_000` ([lines 68–97](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:68)).
- RD maturity `12_462_594` ([lines 158–196](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:158)).
- NSC maturity `1_445_673` ([lines 201–254](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:201)).
- RD stub and post-installment values ([lines 422–555](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:422)).

A read-only run of the two reviewed test files passed **41/41** tests.

## FINAL VERDICT

**BLOCKING — not COMPLETE-ready.** The three previously reported items are addressed, but the large-value payout balance calculation still silently produces an incorrect safe integer.