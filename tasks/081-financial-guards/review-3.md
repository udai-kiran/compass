## High

1. Valid EMI inputs can produce unsafe paise values and a 500 response.

   [financial-guards.ts](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.ts:134) uses checked `BigInt` only for the processing fee. `amortize` and the subsequent repayment/extra-cost additions remain `number` arithmetic with no safe-integer guard.

   The request schema accepts `principalPaise = Number.MAX_SAFE_INTEGER`, 360 months, and 10,000 bps. That produces:

   - `totalRepaymentPaise = 270228354244492030`
   - `interestPaise = 261221154989751040`

   These fail the `.safe()` response fields in [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:270). A Fastify serialization check returned `500 FST_ERR_RESPONSE_SERIALIZATION`. Thus AC3’s integer-paise guarantee and AC4’s advisory 200 response do not hold for valid schema-approved input. Either constrain inputs to a provably safe domain or check every calculated output before returning it.

## Medium

1. P6 is duplication rather than a behavior-preserving extraction, creating a `getGoalProgress` regression risk.

   `getGoalProgress` still performs its original goal, account, portfolio, target, rate, and contribution queries at [goals.ts](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:346), then calls `getGoalProjectionInputs`, which repeats those reads at [goals.ts](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:290). The projection therefore comes from a second snapshot while the returned `assets`, `monthlyInflowPaise`, target, allocation, and plan use the first snapshot. Concurrent ledger changes can make one response internally inconsistent, and the normal progress endpoint now performs substantially more work.

   The new loader itself is read-only and does not invoke `checkGoalMilestones`, so the financial guard satisfies the side-effect-free portion of AC2. The refactor should reuse one shared loader/result rather than retain both implementations.

2. Malformed `emiOffers` query JSON produces a server error rather than a validation response.

   [FinancialGuardsQuerySchema](/work/personal/compass/packages/shared/src/schemas/shopping.ts:217) calls `JSON.parse` directly inside a Zod transform. A request containing `emiOffers={` throws a raw `SyntaxError`; with the repository’s Fastify Zod compiler this returned `500 FST_ERR_VALIDATION`, while an ordinary invalid value such as negative `cartTotalPaise` correctly returned 400. The transform should convert JSON parsing failures into a Zod validation issue.

3. P4 test coverage is materially below the delegation brief.

   [financial-guards.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.test.ts:1) contains five pure/schema tests, but it never exercises the actual DB-backed `checkBudgetCap` or `computeGoalImpact`, and there is no route test. Missing delegated coverage includes:

   - GET route status/body and demo-session behavior
   - AC4 successful advisory 200 behavior
   - user-scoped service integration/no-IDOR behavior
   - `delayed` and `no_impact` status assertions
   - zero-inflow equal allocation assertions
   - multiple-offer indexing through the route
   - EMI rounding/last-installment behavior
   - maximum-safe output behavior
   - full request and non-null response schema validation
   - `getGoalProjectionInputs` side-effect characterization
   - `getGoalProgress` behavior after extraction

   Consequently several ACs happen to be implemented but are not protected against regression.

## Low

1. Proportional allocation can leave paise unallocated.

   [calculateGoalImpacts](/work/personal/compass/apps/api/src/modules/shopping/services/financial-guards.ts:62) floors every goal’s share independently. For example, allocating 100 paise in a 1:2 ratio assigns 33 and 66 paise, so only 99 paise affects projections. The zero-inflow equal split has the same remainder loss. This follows the plan’s literal formula, but slightly understates goal impact and lacks a reconciliation invariant. Deterministically distributing the remainder would preserve the full cart amount.

2. `FinancialGuardsRequestSchema` is defined but never used.

   P3 in `TASK.md` says to parse the coerced query through the domain request schema. The route consumes `FinancialGuardsQuerySchema` output directly at [financial-guards.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/financial-guards.ts:8). The schemas currently describe equivalent constraints, so this is not an immediate behavior bug, but future divergence would bypass domain validation.

3. AC7 is not fully demonstrated in the current environment.

   Repository-wide typecheck and lint both exited 0, and the focused financial-guard tests passed 5/5. `npm run test -w apps/api` exited 1: 978 passed and 33 failed because `DATABASE_URL`/required integration infrastructure was absent. The financial-guard tests and both route snapshot tests passed, but the required full green API gate cannot be claimed from this run.

## Item-by-item result

- P1: Pass. All requested contracts and helper schemas exist with the approved fields, bounds, nullable results, and complete six-value status discriminator.
- P2: Partial. All three functions exist; budget period/rollover and EMI primitives are correct. Unsafe EMI outputs and proportional remainder loss remain.
- P3: Pass with validation caveat. It is `GET /guards/check`, uses the query schema, and derives `offerIndex` server-side.
- P4: Fail against the delegated coverage list.
- P5: Pass. Route is imported and registered in [plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:15).
- P6: Partial. The loader is side-effect-free, but the extraction introduced duplicated reads in `getGoalProgress`.
- P7: Pass. Both snapshots contain GET/HEAD entries, and both snapshot tests passed.

- AC1: Pass. Current monthly utilization, rollover carry, spent/remaining amounts, and paise overage are used.
- AC2: Partial. Projection path is side-effect-free and reports delay months, but progress regression coverage is absent and allocation can lose remainder paise.
- AC3: Partial. `annualRateBps`, `standardEmiPaise`, `amortize`, and BigInt fee calculation are used correctly; valid large inputs violate safe-integer output.
- AC4: Fail for valid large EMI offers, which serialize as 500.
- AC5: Pass. Missing budget lines, active goals, or offers return `null`.
- AC6: Pass. GET is outside demo-mode `MUTATING_METHODS`.
- AC7: Typecheck and lint pass; focused tests pass; full API suite is not green in the available environment.

Security review found no IDOR: budget and goal reads originate from `userId`-scoped data, arbitrary category IDs are only matched against the caller’s utilization lines, and goal ownership is rechecked by `ownedGoal`. ESM `.ts` imports and paise conventions are followed; no floating-point rupee arithmetic was introduced.