Implemented BigInt balance arithmetic and both regressions.

Files modified:

- `apps/api/src/modules/investments/services/deposit-accrual.ts`
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts`

Changes:

- Kept FD/NSC and RD running balances, per-period deposits/bases, payout/closing arithmetic, and schedule total reductions as `bigint`.
- Converted values to `Number` only when assigning emitted schedule fields.
- Updated exact-interest helpers to accept BigInt balances without changing their formulas or half-up rounding.
- Retained `assertSafeIntegers` as the final post-condition gate.
- Added the requested payout regression and a high-value reinvest regression, each with BigInt numerator/denominator derivation comments.

Complete logical diff:

```diff
--- a/deposit-accrual.ts
+++ b/deposit-accrual.ts
@@
-function periodInterest(basePaise: number, ...)
+function periodInterest(basePaise: bigint, ...)
 {
-  if (basePaise === 0) return 0;
-  const base = BigInt(basePaise);
+  if (basePaise === 0n) return 0;
   ...
-  return halfUp(base * bps, ...)
+  return halfUp(basePaise * bps, ...)
@@
-function rdPeriodInterest(opening: number, ..., installment: number, ...)
+function rdPeriodInterest(opening: bigint, ..., installment: bigint, ...)
 {
-  if (opening !== 0) {
-    const openB = BigInt(opening);
+  if (opening !== 0n) {
@@
-  if (installment !== 0) {
-    const instB = BigInt(installment);
+  if (installment !== 0n) {
@@
-  const principal = terms.principalPaise ?? 0;
-  let runningBalance = 0;
+  const principal = BigInt(terms.principalPaise ?? 0);
+  let runningBalance = 0n;
@@
-  const deposit = n === 0 ? principal : 0;
+  const deposit = n === 0 ? principal : 0n;
   const base = opening + deposit;
@@
-  const payoutPaise = disposition === "payout" ? interestPaise : 0;
-  const closingPaise = base + interestPaise - payoutPaise;
+  const payoutPaise = disposition === "payout" ? BigInt(interestPaise) : 0n;
+  const closingPaise = base + BigInt(interestPaise) - payoutPaise;
@@
-  openingPaise: opening,
-  depositPaise: deposit,
+  openingPaise: Number(opening),
+  depositPaise: Number(deposit),
   interestPaise,
-  payoutPaise,
-  closingPaise,
+  payoutPaise: Number(payoutPaise),
+  closingPaise: Number(closingPaise),
@@
-  const totalInterestPaise = periods.reduce((s, p) => s + p.interestPaise, 0);
+  const totalInterestPaise = periods.reduce(
+    (sum, period) => sum + BigInt(period.interestPaise),
+    0n,
+  );
+  const totalDepositPaise = periods.reduce(
+    (sum, period) => sum + BigInt(period.depositPaise),
+    0n,
+  );
@@
-  totalInterestPaise,
-  totalDepositPaise: principal,
-  maturityValuePaise: periods.at(-1)?.closingPaise ?? 0,
+  totalInterestPaise: Number(totalInterestPaise),
+  totalDepositPaise: Number(totalDepositPaise),
+  maturityValuePaise: Number(runningBalance),
@@
-  const installment = terms.installmentPaise ?? 0;
-  let runningBalance = 0;
+  const installment = BigInt(terms.installmentPaise ?? 0);
+  let runningBalance = 0n;
@@
-  let depositPaise = 0;
+  let depositPaise = 0n;
@@
-  const closingPaise = opening + depositPaise + interestPaise - payoutPaise;
+  const closingPaise =
+    opening + depositPaise + BigInt(interestPaise) - payoutPaise;
@@
-  totalInterestPaise: periods.reduce((s, p) => s + p.interestPaise, 0),
-  totalDepositPaise: periods.reduce((s, p) => s + p.depositPaise, 0),
-  maturityValuePaise: periods.at(-1)?.closingPaise ?? 0,
+  totalInterestPaise: Number(totalInterestPaiseBigInt),
+  totalDepositPaise: Number(totalDepositPaiseBigInt),
+  maturityValuePaise: Number(runningBalance),
```

```diff
--- a/deposit-accrual.test.ts
+++ b/deposit-accrual.test.ts
@@
+test("R5 regression (M-NEW3): RD payout Q1 preserves the exact large closing balance", ...)
+  installmentPaise: 3_000_000_000_000_001
+  totalInstallments: 3
+  annualRateBps: 1184
+  quarterly, payout, 2024-01-01 → 2024-04-01
+  // Uses a BigInt numerator/denominator half-up oracle.
+  assert.equal(q1.payoutPaise, q1.interestPaise)
+  assert.equal(q1.closingPaise, 9_000_000_000_000_003)
+
+test("R5 regression: high-value RD reinvest Q1 preserves its exact BigInt closing balance", ...)
+  installmentPaise: 2_900_000_000_000_001
+  totalInstallments: 3
+  annualRateBps: 1184
+  quarterly, reinvest, 2024-01-01 → 2024-04-01
+  // Uses a BigInt base + BigInt exact-interest oracle.
+  assert.equal(q1.payoutPaise, 0)
+  assert.equal(q1.closingPaise, 8_871_209_643_835_619)
```

Derivations:

- Requested payout case:
  - `numerator = 3_000_000_000_000_001 × 1184 × (91 + 60 + 31) × 4`
  - `= 2_585_856_000_000_000_861_952`
  - `denominator = 10_000 × 4 × 365 = 14_600_000`
  - quotient `= 177_113_424_657_534`, remainder `= 4_461_952`
  - `2 × remainder < denominator`, so interest is `177_113_424_657_534`.
  - Payout equals interest; closing is exactly `3 × installment = 9_000_000_000_000_003`.

- High-value reinvest case:
  - Base: `3 × 2_900_000_000_000_001 = 8_700_000_000_000_003`
  - numerator `= 2_499_660_800_000_000_861_952`
  - denominator `= 14_600_000`
  - quotient `= 171_209_643_835_616`, remainder `= 7_261_952`
  - `2 × remainder < denominator`, so interest is `171_209_643_835_616`.
  - Reinvest closing: `8_700_000_000_000_003 + 171_209_643_835_616 = 8_871_209_643_835_619`.

Commands run:

```text
node --experimental-test-module-mocks --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
```

Output tail:

```text
✔ R5 regression (M-NEW3): RD payout Q1 preserves the exact large closing balance
✔ R5 regression: high-value RD reinvest Q1 preserves its exact BigInt closing balance
✔ post-condition throws when closing paise exceeds safe integer range
✔ deposit-details module exports getDepositDetails, upsertDepositDetails, getDepositSchedule
✔ validateDepositKindConstraints: RD with non-quarterly compoundingFrequency is rejected (400)
✔ validateDepositKindConstraints: RD with quarterly compoundingFrequency is accepted
✔ validateDepositKindConstraints: NSC with non-5-year term is rejected (400)
✔ validateDepositKindConstraints: NSC with exact 5-year term is accepted
✔ validateDepositKindConstraints: tax_saver_fd with exact 5-year term is accepted
✔ validateDepositKindConstraints: tax_saver_fd one day short of 5 years is rejected (400)
✔ validateDepositKindConstraints: tax_saver_fd one day beyond 5 years is rejected (400)
ℹ tests 34
ℹ pass 34
ℹ fail 0
ℹ duration_ms 438.046081
```

Exit code: `0`

```text
npm run typecheck
```

Output tail:

```text
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

Exit code: `0`

Also run during development:

```text
node --experimental-test-module-mocks --test apps/api/src/modules/investments/services/deposit-accrual.test.ts
```

Before implementation: 25 pass, 1 fail; the new payout regression reproduced the defect with actual closing `9_000_000_000_000_002`.

After implementation: 26 pass, 0 fail.

```text
npx prettier --write apps/api/src/modules/investments/services/deposit-accrual.ts apps/api/src/modules/investments/services/deposit-accrual.test.ts
```

Exit code: `0`.

Issues, risks, deviations:

- None.
- The workspace already had unrelated modified/untracked files; they were not changed.