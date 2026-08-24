# Task: 081 — Budget Cap, Goal-Impact & EMI Guard (task 11.3)

## Status
COMPLETE

## Resolution
- review-3: F1 (EMI cap 10B), F2 (JSON parse try/catch), F3 (goal dedup), F4 (test updates) — all applied
- review-4: cartTotalPaise capped at 10B — applied
- review-5: defensive safe-integer guard on budget aggregates — applied
- All focused tests pass (6/6), typecheck + lint green

## Review-4 Findings (post fix-1)
### Verified
- F1 cap proven safe: max derived EMI value 0.003% of MAX_SAFE_INTEGER
- F3 behaviorally equivalent: no regression from removing getGoalProjectionInputs call
- 6/6 tests pass, typecheck passes

### HIGH (fix-2 dispatched)
- cartTotalPaise accepts MAX_SAFE_INTEGER; with negative remainingPaise → overBudgetPaise exceeds safe integer → 500
- Fix: cap cartTotalPaise at 10B paise (₹100 crore) in both schemas

### MEDIUM (out of scope — pre-existing)
- mappedContributionRate unchecked Number() conversion in planning module

### LOW (accepted)
- .parse() inside transform throws ZodError (Fastify maps to 400 regardless)
- Test depth could be better (acceptable for scope)

## Objective
Three financial guard integrations for the shopping cart: (1) budget cap — check draft cart against live grocery budget envelope, (2) goal-impact receipt — compute days of delay on goals from cart spend, (3) EMI temptation guard — decompose "no-cost EMI" into true cost. Guards inform, never block.

## Root Cause
Shopping intelligence has no integration with planning/credit modules.

## Codex Review Findings (review-1)
### High — must fix before approval
- F1: EMI rate units wrong — plan uses `annualRatePct` but `standardEmiPaise` uses `annualRateBps` (basis points). Must use bps throughout. Processing fees should also be integer bps or paise, not float pct.
- F2: EMI model incomplete — missing `totalRepaymentPaise`, rounding error on last installment (should reuse `amortize` from credit module), no opportunity cost, no offer identifier for multiple offers.
- F3: Goal-impact has no defined counterfactual — does purchase reduce corpus, monthly inflow, or allocate across goals? Must define explicitly.
- F4: `getGoalProgress` has side effects (writes milestone notifications via `checkGoalMilestones`) — not safe for read-only guard. Need side-effect-free projection path.
- F5: `getGoalProgress` returns `projectedMonths` at one-decimal precision — too coarse for day-level delta. `delayDays` must be nullable with unreachable/undated discriminator.
- F6: Must exclude archived and already-completed goals.

### Medium — should fix
- F7: Budget cap doesn't match `getUtilization(db, userId, period, key)` API — plan supplies neither period nor key. Must use current monthly period explicitly.
- F8: Optional `categoryId` ambiguous — should aggregate across all budget lines or require category selection. Rollover carry not exposed.
- F9: Demo-mode: POST is blocked for demo sessions (`MUTATING_METHODS`), but guard is read-only. Need GET or demo exemption.
- F10: Dependency on 079 is fake — endpoint takes `cartTotalPaise`, not draftId. Can build independently. Remove 079 dependency.
- F11: Schemas underspecified — need shared request schema, safe-integer constraints, goalId (not just name), nullable/unreachable handling.
- F12: Tests say "pure" but budget/goal are DB-backed — need integration tests too.
- F13: Trusting caller-provided cart total — decide if this is a generic calculator or should verify against draft.

### Low
- F14: Plugin registration and both snapshot files must be named explicitly.
- F15: backup.ts doesn't need changes (no new tables) — correct.

## Codex Review-2 Findings (addressed in revised plan below)
- R2-F1: GET query params need coercion schema (z.coerce.number for paise, JSON.parse for emiOffers) → add wire/query schema
- R2-F2: EMI totalRepaymentPaise must use amortize() for accurate last-installment, not emiPaise * tenureMonths → use principalPaise + amortize().totalInterest
- R2-F3: Goal counterfactual applies full cart to every goal independently → allocate once: reduce monthly investable surplus, distribute proportionally by current contribution
- R2-F4: getGoalProgress private helpers (effectiveTarget, mappedContributionRate) need extraction → add getGoalProjectionInputs() to goals.ts modified files
- R2-F5: Per-goal monthlyInflowPaise, not result-level → move to GoalImpactItem
- R2-F6: Add "no_impact" status for zero delay → add to discriminator
- R2-F7: BigInt for intermediate EMI products → use checked BigInt arithmetic
- R2-F8: offerIndex derived from array position server-side → ignore client offerIndex, use array index

## Scope

### Cross-module service imports (runtime, allowed per CLAUDE.md)
- `apps/api/src/modules/planning/services/budgets.ts` — live budget data
- `apps/api/src/modules/planning/services/goal-plan.ts` — goal projections
- `apps/api/src/modules/planning/services/goal-projection.ts` — projection math
- `apps/api/src/modules/credit/services/` — EMI/amortization if available
- `packages/shared/src/money.ts` — standardEmiPaise

### New files
- `apps/api/src/modules/shopping/services/financial-guards.ts` — guard computations
- `apps/api/src/modules/shopping/services/financial-guards.test.ts` — pure function tests
- `apps/api/src/modules/shopping/routes/financial-guards.ts` — route

### Modified files
- `packages/shared/src/schemas/shopping.ts` — add guard request + response schemas
- `apps/api/src/modules/shopping/plugin.ts` — register route
- `apps/api/src/modules/planning/services/goals.ts` — extract `getGoalProjectionInputs()` (side-effect-free loader for projectGoal inputs, without checkGoalMilestones)
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`

## Dependencies
- none (guard endpoint accepts cartTotalPaise, no draft dependency)

## Plan
- P1: Add shared Zod schemas to `packages/shared/src/schemas/shopping.ts`:
  - `FinancialGuardsRequestSchema` — { cartTotalPaise: safe nonneg int, categoryId?: uuid, emiOffers?: array of { principalPaise: safe nonneg int, tenureMonths: int 1-360, annualRateBps: int 0-10000, processingFeeBps: int 0-10000 } max 10 }
  - `FinancialGuardsQuerySchema` — wire schema for GET query params: cartTotalPaise as z.coerce.number(), categoryId as optional uuid string, emiOffers as optional JSON string parsed to array
  - `BudgetGuardResultSchema` — { budgetedPaise, carryPaise, spentPaise, remainingPaise, cartTotalPaise, overBudgetPaise (cart - remaining, clamped ≥0), categoryId: uuid | null } | null (null = no budget configured)
  - `GoalImpactItemSchema` — { goalId: uuid, goalName: string, baselineMonths: number | null, impactedMonths: number | null, delayMonths: number | null, baselineMonthlyInflowPaise: int, impactedMonthlyInflowPaise: int, status: "no_impact" | "delayed" | "unreachable" | "undated" | "completed" | "already_behind" }
  - `GoalImpactResultSchema` — { impacts: GoalImpactItem[] } | null (null = no active goals)
  - `EmiGuardItemSchema` — { offerIndex: int, emiPaise, totalRepaymentPaise, interestPaise, processingFeePaise, extraCostPaise (interest + fees) }
  - `EmiGuardResultSchema` — { offers: EmiGuardItem[] } | null (null = no offers provided)
  - `FinancialGuardsResponseSchema` — { budget: BudgetGuardResult, goals: GoalImpactResult, emi: EmiGuardResult }
- P2: Implement `financial-guards.ts`:
  - `checkBudgetCap(db, userId, cartTotalPaise, categoryId?)`:
    - Use `currentPeriodKey("monthly")` and call `getUtilization(db, userId, "monthly", key)`
    - If categoryId: find matching line; if not: aggregate all lines
    - Return { budgetedPaise, carryPaise, spentPaise, remainingPaise, cartTotalPaise, overBudgetPaise }
    - No budget → return null
  - `computeGoalImpact(db, userId, amountPaise)`:
    - Load active non-archived goals via `listGoals`, filter out archived
    - For each goal: use new `getGoalProjectionInputs(db, userId, goalId)` (extracted from getGoalProgress, side-effect-free — no checkGoalMilestones)
    - Use `projectGoal` (pure) for baseline projection
    - Counterfactual: treat cart as reducing one month's investable surplus. Reduce each goal's `monthlyInflowPaise` by `Math.floor(amountPaise * (goalInflow / totalInflow))` (proportional allocation, integer, clamped ≥ 0). If totalInflow is 0, divide evenly.
    - Re-project with reduced inflow. Compare `projectedMonths` — delta is delayMonths (1 decimal).
    - Status: "no_impact" (delta ≤ 0), "delayed" (delta > 0), "undated" (null target), "completed" (already funded), "already_behind" (baseline unreachable), "unreachable" (counterfactual unreachable)
    - No active goals → return null
  - `decomposeEmi(principalPaise, tenureMonths, annualRateBps, processingFeeBps)`:
    - Pure function. emiPaise = standardEmiPaise(principalPaise, annualRateBps, tenureMonths)
    - Use `amortize(principalPaise, annualRateBps, tenureMonths)` to get accurate totalInterest (handles last-installment rounding)
    - interestPaise = amortize result's totalInterest
    - totalRepaymentPaise = principalPaise + interestPaise
    - processingFeePaise: use BigInt arithmetic — `Number(BigInt(principalPaise) * BigInt(processingFeeBps) / 10000n)` to avoid unsafe intermediate products
    - extraCostPaise = interestPaise + processingFeePaise
    - offerIndex: derived from array position server-side, not client-supplied
- P3: Route: `GET /guards/check` (GET, not POST — read-only, demo-safe)
  - Query params: cartTotalPaise, categoryId?, emiOffers as JSON string
  - Parse with FinancialGuardsRequestSchema
  - Call all three guards, return FinancialGuardsResponseSchema
  - GET avoids demo-mode POST rejection
- P4: Tests:
  - Pure: EMI decomposition (zero rate = no interest, typical rate, rounding, multiple offers, bps not pct)
  - Pure: EMI invariant — totalRepayment = principal + interest (within 1 paisa rounding)
  - Integration (if DB available) or pure mock: budget overage, no budget, rollover carry, already overspent
  - Pure: goal delay calculation — baseline vs impacted months, undated goal, completed goal, unreachable goal, zero inflow, no goals
  - Schema validation tests for request/response
- P5: Register route in plugin.ts, update both route snapshots:
  - `apps/api/src/route-surface.snapshot.txt`
  - `apps/api/src/route-table.snapshot.txt`

## Acceptance Criteria
- [ ] AC1: Cart total checked against live budget envelope (current monthly period + rollover carry); overage in integer paise
- [ ] AC2: Goal-impact as delay months per active goal, using pure projections without side effects
- [ ] AC3: EMI decomposed using `annualRateBps` (not percent) via `standardEmiPaise`; total repayment reconciles with `amortize`
- [ ] AC4: Guards inform and never block — always returns 200, advisory only
- [ ] AC5: No goals/budgets/offers → null in response (graceful degradation)
- [ ] AC6: GET route, demo-safe (not blocked by MUTATING_METHODS)
- [ ] AC7: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0

## Non-Goals
- Auto-blocking purchases
- UI for guards (task 12.2)
- Draft verification (accepts raw cartTotalPaise; integrity check deferred to UI layer)
