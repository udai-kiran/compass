Files modified:

- `apps/api/src/modules/shopping/services/financial-guards.ts`

Change made:

- Added the requested safe-integer validation after the budget reduce aggregations.
- Computes `overBudgetPaise` once and reuses it in the return value.
- Returns `null` if any derived aggregate is unsafe, preventing response-schema validation errors.

Diff:

```diff
@@
   const carryPaise = lines.reduce((sum, line) => sum + line.carryPaise, 0);
   const spentPaise = lines.reduce((sum, line) => sum + line.spentPaise, 0);
   const remainingPaise = lines.reduce((sum, line) => sum + line.remainingPaise, 0);
+  const overBudgetPaise = Math.max(0, cartTotalPaise - remainingPaise);
+  // Defensive: if DB-derived aggregates or subtraction produce unsafe integers,
+  // return null rather than risk a 500 from response schema validation.
+  if (
+    !Number.isSafeInteger(budgetedPaise) ||
+    !Number.isSafeInteger(carryPaise) ||
+    !Number.isSafeInteger(spentPaise) ||
+    !Number.isSafeInteger(remainingPaise) ||
+    !Number.isSafeInteger(overBudgetPaise)
+  ) {
+    return null;
+  }
   return {
@@
-    overBudgetPaise: Math.max(0, cartTotalPaise - remainingPaise),
+    overBudgetPaise,
```

Commands run and output:

```text
$ npm run typecheck
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit
...
> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

Exit code: `0`

```text
$ npm run test -w apps/api -- financial-guards
...
✔ calculateBudgetCap handles rollover, overage, overspend, category selection, and no budgets
...
ℹ tests 1023
ℹ pass 989
ℹ fail 33
```

Exit code: `1`. The command runs the entire API test suite; 33 unrelated DB-backed tests failed because `DATABASE_URL`/`.env` is not configured. The financial-guards test passed.

```text
$ node --env-file-if-exists=.env --experimental-test-module-mocks --test src/modules/shopping/services/financial-guards.test.ts
.env not found. Continuing without it.
✔ decomposeEmi uses annual basis points and reconciles repayment
✔ decomposeEmi has no interest at zero bps and uses BigInt for a large processing fee
✔ calculateBudgetCap handles rollover, overage, overspend, category selection, and no budgets
✔ calculateGoalImpacts allocates a cart reduction proportionally and classifies projections
✔ FinancialGuardsQuerySchema coerces GET query values and parses EMI offers
✔ FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error
ℹ tests 6
ℹ pass 6
ℹ fail 0
```

Exit code: `0`

Issues/deviations:

- No files other than the requested file were changed.
- The requested package test command cannot exit successfully in this environment because it invokes all API tests and the required database environment is absent. The focused financial-guards tests pass.