## Files changed

- Modified: `packages/shared/src/schemas/shopping.ts`
- Created/deleted: none
- No other files were changed by me. The file already had unrelated uncommitted changes before this work.

## Change made

Capped both `cartTotalPaise` inputs at ₹100 crore (10,000,000,000 paise), replacing `.safe()` and adding the requested safety comment.

```diff
 export const FinancialGuardsRequestSchema = z.object({
-  cartTotalPaise: z.number().int().nonnegative().safe(),
+  /** Max ₹100 crore — keeps derived budget values within safe-integer range. */
+  cartTotalPaise: z.number().int().nonnegative().max(10_000_000_000),
```

```diff
 export const FinancialGuardsQuerySchema = z.object({
-  cartTotalPaise: z.coerce.number().int().nonnegative().safe(),
+  /** Max ₹100 crore — keeps derived budget values within safe-integer range. */
+  cartTotalPaise: z.coerce.number().int().nonnegative().max(10_000_000_000),
```

## Commands run and outputs

### `npm run typecheck`

Exit code: `0`

```text
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

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

### `npm run test -w packages/shared`

Exit code: `0`

```text
> @compass/shared@0.1.0 test
> node --test "src/**/*.test.ts"

ℹ tests 351
ℹ suites 0
ℹ pass 351
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 316.604754
```

### `npm run test -w apps/api`

Exit code: `1`

```text
> @compass/api@0.1.0 test
> node --env-file-if-exists=../../.env --experimental-test-module-mocks --test "src/**/*.test.ts"

../../.env not found. Continuing without it.

✔ decomposeEmi uses annual basis points and reconciles repayment
✔ decomposeEmi has no interest at zero bps and uses BigInt for a large processing fee
✔ calculateBudgetCap handles rollover, overage, overspend, category selection, and no budgets
✔ calculateGoalImpacts allocates a cart reduction proportionally and classifies projections
✔ FinancialGuardsQuerySchema coerces GET query values and parses EMI offers
✔ FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error

ℹ tests 1013
ℹ suites 18
ℹ pass 979
ℹ fail 33
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 9980.540432
```

The command failed only because the repository’s DB-backed tests require `DATABASE_URL` and no root `.env` is present. The harness truncated the middle of this command’s very large output, but its failures were all missing-`DATABASE_URL` failures, including `app.test.ts`, automation, credit, ingest, investments, ledger, planning, protection, shopping route, system, and backup DB-backed suites.

### Targeted financial-guards test

```text
node --env-file-if-exists=../../.env --experimental-test-module-mocks --test src/modules/shopping/services/financial-guards.test.ts
```

Exit code: `0`

```text
../../.env not found. Continuing without it.
../../.env not found. Continuing without it.
✔ decomposeEmi uses annual basis points and reconciles repayment (0.478161ms)
✔ decomposeEmi has no interest at zero bps and uses BigInt for a large processing fee (0.375947ms)
✔ calculateBudgetCap handles rollover, overage, overspend, category selection, and no budgets (0.130479ms)
✔ calculateGoalImpacts allocates a cart reduction proportionally and classifies projections (0.313107ms)
✔ FinancialGuardsQuerySchema coerces GET query values and parses EMI offers (1.46366ms)
✔ FinancialGuardsQuerySchema rejects malformed emiOffers JSON with a validation error (0.193469ms)
ℹ tests 6
ℹ suites 0
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 494.054013
```

## Issues, risks, deviations

- No implementation deviations.
- The full API workspace test suite cannot pass in the current environment without `DATABASE_URL`/the expected DB and Redis services. The specific financial-guards tests pass.