Review result: changes requested.

## High

- Unsafe budget arithmetic remains. The 10B `cartTotalPaise` cap does not constrain DB-derived utilization values. [financial-guards.ts](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.ts:35) sums values with ordinary numbers, then line 45 subtracts a potentially large negative `remainingPaise`. For example, a valid 10B cart and `remainingPaise = -Number.MAX_SAFE_INTEGER` produce `overBudgetPaise = 9007209254740992`, which is unsafe and rejected by [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:246), resulting in a 500 during response serialization. `UtilizationLineSchema` only requires `.int()`, not safe or bounded values, and the underlying columns are `bigint` in number mode. Aggregating multiple individually safe lines can also overflow. Therefore AC4 and the requested unsafe-integer confirmation are not satisfied. Budget inputs and all aggregate/subtraction results need checked arithmetic or enforceable upstream bounds.

## Medium

- Completed goals are still reported rather than excluded. [financial-guards.ts](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.ts:111) filters only archived goals, while lines 81–82 explicitly emit `"completed"`. This conflicts with the task’s prior F6 requirement to exclude already-completed goals and AC2’s wording of “active goal.” If every non-archived goal is already funded, the expected result should be `null`, not a list of completed impacts.

## Low

- The task’s full API verification gate is not green in this checkout. Typecheck and lint passed, and all six focused financial-guard tests passed. However, `npm run test -w apps/api` reported 979 passes and 34 failures, chiefly because database environment variables were unavailable, plus an unrelated missing `cart-draft-generator.ts`. Thus the focused AC7 interpretation passes, but TASK.md’s full T3 gate remains unverified.
- The six focused tests do not exercise the DB-backed `checkBudgetCap`/`computeGoalImpact` functions or the GET route, so current-period selection, side-effect freedom, demo access, and end-to-end 200/null behavior lack direct regression coverage.

The EMI path is safe under the 10B principal cap: the maximum-rate/maximum-tenure case remains within safe integers, uses `annualRateBps`, reconciles repayment through `amortize`, and calculates processing fees with `BigInt`. The remaining unsafe path is the budget side, not EMI.