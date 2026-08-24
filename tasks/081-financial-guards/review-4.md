## High

- [`calculateBudgetCap()`](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.ts:35) still permits unsafe derived integers. `cartTotalPaise` accepts `Number.MAX_SAFE_INTEGER`, while `remainingPaise` may be negative. A remaining balance of `-1` produces `overBudgetPaise = 9_007_199_254_740_992`, which fails the response schema’s `.safe()` constraint and turns an advisory request into a 500. Aggregating multiple individually safe budget lines can similarly overflow at lines 35–38. This conflicts with AC4. Use checked arithmetic/BigInt or impose a practical cart cap and validate aggregate bounds.

## Medium

- The new goal projection path inherits an unchecked integer conversion in [`mappedContributionRate()`](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:247). The account aggregate is checked, but the holding aggregate is converted with `Number(...)` without `Number.isSafeInteger`, and the combined total is not checked before division. An oversized database aggregate can lose paise precision or ultimately fail the financial-guard response schema. Both branches and their sum should receive equivalent safe-integer checks.

## Low

- [`FinancialGuardsQuerySchema`](/work/personal/compass/packages/shared/src/schemas/shopping.ts:233) calls `.parse()` inside its transform. The syntax-error case is correctly caught and returns `z.NEVER` with a `ZodIssueCode.custom` issue, so `"{bad"` produces `safeParse(...).success === false` and Fastify returns 400. However, syntactically valid but structurally invalid JSON—such as `{}` or an offer above the principal cap—causes `safeParse()` itself to throw a `ZodError`. The application error handler still maps that exception to 400, so this is not a 500, but it violates normal `safeParse` semantics. Prefer `.pipe(z.array(...).max(10))` or forward inner `safeParse` issues through `ctx.addIssue`.
- The malformed-JSON test at [`financial-guards.test.ts:114`](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.test.ts:114) correctly asserts `success === false`, but does not verify the custom issue code/message or the HTTP 400 behavior. The 9-billion-paise test value is within the 10-billion cap. Since `9_000_000_000 × 10_000 = 90_000_000_000_000` is itself safe in JavaScript, that test executes the BigInt implementation but cannot detect regression to ordinary multiplication.

## Verified fixes

- F1’s cap is safe for EMI-derived outputs. Exhaustively checking all integer rates from 0–10000 bps and tenures from 1–360 at the 10-billion-paise cap found the maximum:
  - EMI: `833,333,333`
  - Interest: `299,999,999,880`
  - Total repayment: `309,999,999,880`
  - Maximum processing fee: `10,000,000,000`
  - Extra cost: `309,999,999,880`

  The largest derived value is only about `0.00344%` of `Number.MAX_SAFE_INTEGER`. Even the deliberately loose bound of maximum one-month EMI × 360 plus interest and fee remains below `4.3 × 10¹²`, safely below `9.007 × 10¹⁵`.

- F3 is behaviorally equivalent. [`getGoalProgress()`](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:409) uses the same mapped accounts/holdings, balance/current-value mapping, return-rate functions, effective target, target-date calculation, and `mappedContributionRate()` result as [`getGoalProjectionInputs()`](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:290). Asset sorting does not change the projection semantics. The duplicate database reads are removed.

- The focused financial-guards test file passes: 6/6 tests.
- Full `npm run typecheck` passes across all workspaces.
- No files were modified during this review.