# Codex Worker Delegation

## Task
081 — Budget Cap, Goal-Impact & EMI Guard (task 11.3)

## Approved Plan
- P1: Add shared Zod schemas to packages/shared/src/schemas/shopping.ts
- P2: Implement financial-guards.ts service
- P3: Route: GET /guards/check
- P4: Tests
- P5: Register route in plugin.ts, update snapshots
- P6: Extract getGoalProjectionInputs() from goals.ts

## Files and Symbols

### New files
- `apps/api/src/modules/shopping/services/financial-guards.ts`
- `apps/api/src/modules/shopping/services/financial-guards.test.ts`
- `apps/api/src/modules/shopping/routes/financial-guards.ts`

### Modified files
- `packages/shared/src/schemas/shopping.ts` — append guard schemas after existing exports
- `apps/api/src/modules/shopping/plugin.ts` — add import + register
- `apps/api/src/modules/planning/services/goals.ts` — extract getGoalProjectionInputs
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`

## Required Changes

### P1: Shared Zod Schemas (packages/shared/src/schemas/shopping.ts)

Add after the existing Pantry/Habit Profile section:

```typescript
// ─── Financial Guards contracts (task 11.3) ─────────────────────────────────

/** One EMI offer to decompose. */
export const EmiOfferInputSchema = z.object({
  principalPaise: z.number().int().nonnegative().safe(),
  tenureMonths: z.number().int().min(1).max(360),
  annualRateBps: z.number().int().min(0).max(10000),
  processingFeeBps: z.number().int().min(0).max(10000),
});
export type EmiOfferInput = z.infer<typeof EmiOfferInputSchema>;

/** Domain request (after coercion from query params). */
export const FinancialGuardsRequestSchema = z.object({
  cartTotalPaise: z.number().int().nonnegative().safe(),
  categoryId: z.uuid().optional(),
  emiOffers: z.array(EmiOfferInputSchema).max(10).optional(),
});
export type FinancialGuardsRequest = z.infer<typeof FinancialGuardsRequestSchema>;

/** Wire schema for GET query params — coerces strings to domain types. */
export const FinancialGuardsQuerySchema = z.object({
  cartTotalPaise: z.coerce.number().int().nonnegative().safe(),
  categoryId: z.uuid().optional(),
  emiOffers: z.string().optional().transform((s) => {
    if (!s) return undefined;
    const parsed = JSON.parse(s);
    return z.array(EmiOfferInputSchema).max(10).parse(parsed);
  }),
});

export const BudgetGuardResultSchema = z.object({
  budgetedPaise: z.number().int().safe(),
  carryPaise: z.number().int().safe(),
  spentPaise: z.number().int().safe(),
  remainingPaise: z.number().int().safe(),
  cartTotalPaise: z.number().int().nonnegative().safe(),
  overBudgetPaise: z.number().int().nonnegative().safe(),
  categoryId: z.uuid().nullable(),
}).nullable();
export type BudgetGuardResult = z.infer<typeof BudgetGuardResultSchema>;

export const GoalImpactStatusSchema = z.enum([
  "no_impact", "delayed", "unreachable", "undated", "completed", "already_behind",
]);

export const GoalImpactItemSchema = z.object({
  goalId: z.uuid(),
  goalName: z.string(),
  baselineMonths: z.number().nullable(),
  impactedMonths: z.number().nullable(),
  delayMonths: z.number().nullable(),
  baselineMonthlyInflowPaise: z.number().int().nonnegative().safe(),
  impactedMonthlyInflowPaise: z.number().int().nonnegative().safe(),
  status: GoalImpactStatusSchema,
});
export type GoalImpactItem = z.infer<typeof GoalImpactItemSchema>;

export const GoalImpactResultSchema = z.object({
  impacts: z.array(GoalImpactItemSchema),
}).nullable();
export type GoalImpactResult = z.infer<typeof GoalImpactResultSchema>;

export const EmiGuardItemSchema = z.object({
  offerIndex: z.number().int().nonnegative(),
  emiPaise: z.number().int().nonnegative().safe(),
  totalRepaymentPaise: z.number().int().nonnegative().safe(),
  interestPaise: z.number().int().nonnegative().safe(),
  processingFeePaise: z.number().int().nonnegative().safe(),
  extraCostPaise: z.number().int().nonnegative().safe(),
});
export type EmiGuardItem = z.infer<typeof EmiGuardItemSchema>;

export const EmiGuardResultSchema = z.object({
  offers: z.array(EmiGuardItemSchema),
}).nullable();
export type EmiGuardResult = z.infer<typeof EmiGuardResultSchema>;

export const FinancialGuardsResponseSchema = z.object({
  budget: BudgetGuardResultSchema,
  goals: GoalImpactResultSchema,
  emi: EmiGuardResultSchema,
});
export type FinancialGuardsResponse = z.infer<typeof FinancialGuardsResponseSchema>;
```

### P2: Service (apps/api/src/modules/shopping/services/financial-guards.ts)

Three functions:

1. `checkBudgetCap(db, userId, cartTotalPaise, categoryId?)`:
   - Import `getUtilization` from `../../planning/services/budgets.ts`
   - Import `currentPeriodKey` from `../../../lib/periods.ts`
   - Call `getUtilization(db, userId, "monthly", currentPeriodKey("monthly"))`
   - If categoryId: find matching utilization line; else aggregate all lines
   - `overBudgetPaise = Math.max(0, cartTotalPaise - remainingPaise)`
   - No budget lines → return null

2. `computeGoalImpact(db, userId, amountPaise)`:
   - Import `listGoals` from `../../planning/services/goals.ts`
   - Import new `getGoalProjectionInputs` from same file
   - Import `projectGoal` from `../../planning/services/goal-projection.ts`
   - Filter active non-archived goals
   - For each: get projection inputs, run baseline `projectGoal`
   - Calculate totalInflow = sum of all goals' monthlyInflowPaise
   - Proportional allocation: each goal's reduction = `Math.floor(amountPaise * (goalInflow / totalInflow))`, clamped ≥ 0. If totalInflow=0, divide evenly.
   - Re-project with reduced inflow
   - Compute delayMonths, assign status
   - No active goals → return null

3. `decomposeEmi(principalPaise, tenureMonths, annualRateBps, processingFeeBps)`:
   - Import `standardEmiPaise` from `@compass/shared`
   - Import `amortize` from `../../credit/services/emis.ts`
   - emiPaise = standardEmiPaise(principalPaise, annualRateBps, tenureMonths)
   - { totalInterest } = amortize(principalPaise, annualRateBps, tenureMonths)
   - totalRepaymentPaise = principalPaise + totalInterest
   - processingFeePaise = Number(BigInt(principalPaise) * BigInt(processingFeeBps) / 10000n)
   - extraCostPaise = totalInterest + processingFeePaise
   - Return { emiPaise, totalRepaymentPaise, interestPaise: totalInterest, processingFeePaise, extraCostPaise }

### P3: Route (apps/api/src/modules/shopping/routes/financial-guards.ts)

```typescript
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  FinancialGuardsQuerySchema,
  FinancialGuardsResponseSchema,
} from "@compass/shared";
import { checkBudgetCap, computeGoalImpact, decomposeEmi } from "../services/financial-guards.ts";

export async function financialGuardRoutes(app: FastifyInstance): Promise<void> {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/guards/check",
    {
      schema: {
        querystring: FinancialGuardsQuerySchema,
        response: { 200: FinancialGuardsResponseSchema },
      },
    },
    async (req) => {
      const { cartTotalPaise, categoryId, emiOffers } = req.query;
      const userId = req.session!.userId;
      const db = app.db;

      const [budget, goals] = await Promise.all([
        checkBudgetCap(db, userId, cartTotalPaise, categoryId),
        computeGoalImpact(db, userId, cartTotalPaise),
      ]);

      const emi = emiOffers?.length
        ? { offers: emiOffers.map((o, i) => ({ offerIndex: i, ...decomposeEmi(o.principalPaise, o.tenureMonths, o.annualRateBps, o.processingFeeBps) })) }
        : null;

      return { budget, goals, emi };
    },
  );
}
```

### P4: Extract getGoalProjectionInputs (apps/api/src/modules/planning/services/goals.ts)

Extract a new exported function `getGoalProjectionInputs` from the internals of `getGoalProgress`. It should:
- Load the same data (accounts, portfolio, target, projection settings, contribution rate)
- But NOT call `checkGoalMilestones`
- Return `{ targetPaise, monthsToTarget, monthlyInflowPaise, assets: ProjectionAsset[] }` — the exact inputs for `projectGoal`
- Keep `getGoalProgress` calling `getGoalProjectionInputs` internally + `checkGoalMilestones` separately

The private helpers `effectiveTarget` and `mappedContributionRate` stay private. `getGoalProjectionInputs` wraps their results into the ProjectionInput shape.

### P5: Tests (apps/api/src/modules/shopping/services/financial-guards.test.ts)

Use `node:test`. Tests should cover:
- EMI: zero rate, typical 12% rate, rounding, multiple offers, BigInt safety
- EMI invariant: totalRepayment = principal + interest
- Budget: mock getUtilization to test overage, no budget, already overspent, rollover carry
- Goals: mock projection inputs to test delay, no_impact, undated, completed, already_behind, unreachable, zero inflow, proportional allocation
- Schema: validate request/response shapes

### P6: Plugin registration (apps/api/src/modules/shopping/plugin.ts)

Add import and register:
```typescript
import { financialGuardRoutes } from "./routes/financial-guards.ts";
// ... in shoppingRoutes:
await app.register(financialGuardRoutes);
```

### P7: Snapshots

Run `npm run test -w apps/api` which should regenerate route snapshots. If snapshots need manual update, run the snapshot generation command.

## Must Not Change
- No changes to `apps/api/src/modules/planning/services/budgets.ts` internals (only import from it)
- No changes to `apps/api/src/modules/credit/services/emis.ts` internals (only import amortize)
- No changes to `packages/shared/src/money.ts` (only import standardEmiPaise)
- No schema changes, no migrations, no backup.ts changes
- Do not modify any existing test files

## Acceptance Criteria
- AC1: Cart total checked against live budget envelope; overage in integer paise
- AC2: Goal-impact as delay months per active goal, side-effect-free
- AC3: EMI uses annualRateBps via standardEmiPaise; totalRepayment from amortize
- AC4: Always returns 200, advisory only
- AC5: No goals/budgets/offers → null
- AC6: GET route, demo-safe
- AC7: typecheck + lint + test green

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api`

## Required Evidence
- files changed (list every file)
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers
