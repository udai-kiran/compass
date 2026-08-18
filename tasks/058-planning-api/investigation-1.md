# Investigation 1 — v2.2.0 Planning/Credit Services: HTTP Wiring Plan

## 1. Existing planning module structure

Files under `apps/api/src/modules/planning/`:

```
plugin.ts                                   ← module entry point
plugin.test.ts
schema.ts
schema.smoke.test.ts
routes/
  bills.ts
  budgets.ts
  cashflow.ts
  dashboard.ts
  goals.ts                                  ← exemplar, 64 lines
  insights.ts
  projection-settings.ts
  reports.ts
  planning.route.test.ts
  projection-settings.route.test.ts
services/
  bills.ts  budgets.ts  cashflow.ts  dashboard.ts  goals.ts
  goal-allocation.ts  goal-plan.ts  goal-projection.ts
  goal-returns.ts  insights.ts  projection-settings.ts  reports.ts
  data-completeness.ts          ← unwired
  income-surplus.ts             ← unwired
  instrument-guidance.ts        ← unwired
  multi-goal-allocation.ts      ← unwired
  rebalancing-plan.ts           ← unwired
  + *.test.ts colocated files
```

### plugin.ts (verbatim — 39 lines)

```typescript
import type { FastifyInstance } from "fastify";
import { budgetRoutes } from "./routes/budgets.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { goalRoutes } from "./routes/goals.ts";
import { cashflowRoutes } from "./routes/cashflow.ts";
import { billRoutes } from "./routes/bills.ts";
import { insightRoutes } from "./routes/insights.ts";
import { reportRoutes } from "./routes/reports.ts";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";

export async function planningRoutes(app: FastifyInstance): Promise<void> {
  await app.register(budgetRoutes);
  await app.register(dashboardRoutes);
  await app.register(goalRoutes);
  await app.register(cashflowRoutes);
  await app.register(billRoutes);
  await app.register(insightRoutes);
  await app.register(reportRoutes);
  await app.register(projectionSettingsRoutes);
}
```

To add new route groups: create `routes/foo.ts` exporting `fooRoutes`, then `await app.register(fooRoutes)` at the end of `planningRoutes()`.  For the credit module, same pattern in `apps/api/src/modules/credit/plugin.ts`.

---

## 2. Exemplar route file — `routes/goals.ts` (lines 1–64, verbatim)

```typescript
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateGoalSchema,
  GoalProgressSchema,
  GoalSchema,
  ReorderGoalsSchema,
  UpdateGoalSchema,
} from "@compass/shared";
import {
  createGoal, deleteGoal, getGoalProgress, listGoals, reorderGoals, updateGoal,
} from "../services/goals.ts";

const IdParams = z.object({ id: z.uuid() });

export async function goalRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/goals",
    { schema: { response: { 200: z.array(GoalSchema) } } },
    async (req) => listGoals(app.db, req.session!.userId),
  );

  r.post(
    "/api/goals",
    { schema: { body: CreateGoalSchema, response: { 201: GoalSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createGoal(app.db, req.session!.userId, req.body)),
  );

  r.get(
    "/api/goals/:id/progress",
    { schema: { params: IdParams, response: { 200: GoalProgressSchema } } },
    async (req) => getGoalProgress(app.db, req.session!.userId, req.params.id),
  );
}
```

Pattern summary:
- `app.withTypeProvider<ZodTypeProvider>()` → `r`
- All Zod response schemas come from `@compass/shared`
- `req.session!.userId` always present
- DB services called as `service(app.db, userId, ...args)`
- Pure services (no DB) called as `service(...args)` directly

---

## 3. The 8 unwired services — exact exported signatures

### 3a. `apps/api/src/lib/instrument-rules.ts`
Pure, no DB. Exported functions:

```typescript
export function getInstrumentRule(
  category: InstrumentCategory,
  onDate: Date,
): InstrumentRule

export function listSuitableCategories(
  leg: AllocationLeg,
  horizonMonths: number,
  onDate?: Date,
): InstrumentCategory[]
```

Also exports types: `InstrumentCategory`, `AllocationLeg`, `LockInRule`, `TaxRule`, `LiquidityRule`, `HorizonFit`, `InstrumentRule`.

This file is a **data registry + lookup library**, not a route-facing service by itself. It is consumed by `instrument-guidance.ts`.

### 3b. `apps/api/src/modules/planning/services/goal-plan.ts` — `buildGlidePathSchedule`
Pure, no DB.

```typescript
export function buildGlidePathSchedule(input: GlidePathInput): GlideStep[]
```

`GlidePathInput`: `{ goalType, monthsToTarget, targetPaise, fundedPaise, monthlyInflowPaise, equityReturnBps, debtReturnBps, today? }` — all inputs must be pre-loaded by the route layer. Returns `[]` for emergency funds or undated goals.

### 3c. `apps/api/src/modules/planning/services/instrument-guidance.ts`
Pure, no DB.

```typescript
export function buildInstrumentGuidance(
  leg: AllocationLeg,
  horizonMonths: number,
  alreadyHeldCategories: InstrumentCategory[],
  onDate?: Date,
): InstrumentGuidance
```

`InstrumentGuidance`: `{ leg, horizonMonths, suggestions: InstrumentSuggestion[] }`.
Route layer must supply `alreadyHeldCategories` from DB (held asset categories for the user).

### 3d. `apps/api/src/modules/planning/services/income-surplus.ts`
DB-backed (main) + pure helper.

```typescript
// DB-backed:
export async function getIncomeSurplus(
  db: Db,
  userId: string,
  lookbackMonths?: number,      // default 12
): Promise<IncomeSurplusResult>

// Pure (exported for unit testing):
export function computeIncomeSurplus(
  data: IncomeSurplusComputation,
): Omit<IncomeSurplusResult, "months" | "committedOutflows">
```

`IncomeSurplusResult`: `{ historyMonths, months: MonthlyIncome[], committedOutflows: CommittedOutflow[], totalCommittedPaise, conservativeSurplusPaise|null, optimisticSurplusPaise|null, confidence }`.
Route: `GET /api/planning/income-surplus` → calls `getIncomeSurplus(app.db, userId)`.

### 3e. `apps/api/src/modules/planning/services/data-completeness.ts`
DB-backed (main) + pure helper.

```typescript
// DB-backed:
export async function getDataCompletenessReport(
  db: Db,
  userId: string,
  today?: Date,
): Promise<DataCompletenessReport>

// Pure helper:
export function computeConfidence(params: {
  accounts: Pick<AccountReadiness, "accountName"|"lastImportDaysAgo"|"lastValuationDaysAgo"|"dataFreshness">[];
  unresolvedDraftCount: number;
  lastSnapshotDaysAgo: number | null;
}): { confidence: DataCompletenessReport["confidence"]; confidenceReasons: string[] }
```

`DataCompletenessReport`: `{ asOf, accounts: AccountReadiness[], unresolvedDraftCount, lastSnapshotAt|null, lastSnapshotDaysAgo|null, confidence, confidenceReasons }`.
Route: `GET /api/planning/data-completeness` → calls `getDataCompletenessReport(app.db, userId)`.

### 3f. `apps/api/src/modules/planning/services/multi-goal-allocation.ts`
Pure, no DB.

```typescript
export function allocateAcrossGoals(
  entries: GoalAllocationEntry[],
  availableSurplusPaise: number,
): MultiGoalAllocationPlan
```

`MultiGoalAllocationPlan`: `{ perGoal: GoalAllocationResult[], totalAllocatedPaise, freeCashPaise }`.
Route layer must load goals from DB and call `getIncomeSurplus` first, then call this pure function.

### 3g. `apps/api/src/modules/planning/services/rebalancing-plan.ts`
Pure, no DB.

```typescript
export function buildRebalancingPlan(input: RebalancingPlanInput): RebalancingPlan
```

`RebalancingPlanInput`: `{ fundedPaise, currentEquityPct, currentDebtPct, targetEquityPct, targetDebtPct, currentEquitySipPaise, currentDebtSipPaise, goalType, glideSteps: GlideStep[] }`.
`RebalancingPlan`: `{ drift: DriftAnalysis, actions: RebalancingAction[], deRiskingSchedule: DeRiskingEvent[] }`.
Route: per-goal — `GET /api/goals/:id/rebalancing-plan`. Route layer loads goal data + mapped assets, calls `buildGlidePathSchedule` then `buildRebalancingPlan`.

### 3h. `apps/api/src/modules/credit/services/revolving-debt.ts`
DB-backed (main) + pure helpers.

```typescript
export async function getHouseholdRevolvingDebt(
  db: Db,
  userId: string,
): Promise<HouseholdRevolvingDebt>

// Pure helpers (exported):
export function derivePaymentState(
  totalDuePaise: number | null,
  minDuePaise: number | null,
  paidPaise: number,
): PaymentState

export function estimateMonthlyCharge(
  revolvingBalancePaise: number,
  aprBps: number | null,
): number | null
```

`HouseholdRevolvingDebt`: `{ cards: CardRevolvingStatus[], totalRevolvingPaise, hasRevolvingDebt, totalMonthlyChargePaise }`.
Route: `GET /api/credit/revolving-debt` → goes in credit module's plugin.ts.

---

## 4. Shared schema gap

Grep for `GlidePath|IncomeSurplus|DataCompleteness|MultiGoalAllocation|RebalancingPlan|RevolvingDebt|InstrumentGuidance` in `packages/shared/src/` returned **zero matches**.

**None** of the 8 services' return-type Zod schemas exist in `packages/shared/src/schemas/`. All must be authored from scratch.

Existing shared schema files for reference: `goals.ts`, `insights.ts`, `reports.ts`, `wealth.ts`, `resources.ts`, `budgets.ts` — none contain planning v2.2.0 types.

Schemas to author (minimum):
| Route | Zod schema needed |
|-------|-------------------|
| `GET /api/planning/income-surplus` | `IncomeSurplusResultSchema` |
| `GET /api/planning/data-completeness` | `DataCompletenessReportSchema` |
| `GET /api/planning/allocation` | `MultiGoalAllocationPlanSchema` |
| `GET /api/goals/:id/glide-path` | `GlideStepSchema`, `GlidePathScheduleSchema` |
| `GET /api/goals/:id/rebalancing-plan` | `RebalancingPlanSchema` |
| `GET /api/planning/instrument-guidance` | `InstrumentGuidanceSchema` |
| `GET /api/credit/revolving-debt` | `HouseholdRevolvingDebtSchema` |
| `GET /api/instrument-rules/:category` | `InstrumentRuleSchema` (optional, if exposed) |

Likely new file: `packages/shared/src/schemas/planning.ts` (and possibly `packages/shared/src/schemas/credit.ts` for revolving-debt).

---

## 5. Route snapshot test

**File:** `apps/api/src/app.route-snapshot.test.ts`

Two companion snapshot files:
- `apps/api/src/route-surface.snapshot.txt` — canonical `(method, path)` pair list; **sorted, one per line, newline-terminated**. This is the real "unchanged API surface" gate. **Must be regenerated when any new route is added.**
- `apps/api/src/route-table.snapshot.txt` — raw `printRoutes()` tree; sensitive to registration/nesting structure. **Must also be regenerated.**

Update procedure (per test file comment):
1. Add route(s) to plugin(s).
2. Run the snapshot test — it will fail with a diff.
3. Regenerate `route-surface.snapshot.txt` using the `onRoute` hook pattern (pairs sorted, joined `\n`, one trailing `\n`).
4. Regenerate `route-table.snapshot.txt` from `app.printRoutes({ commonPrefix: false })`.
5. Commit both regenerated files with justification.

The test at line 80 (`assertRouteTableMatches`) is a **byte-for-exact-byte** comparison — no trimming. Adding a route without regenerating both snapshots fails CI.

---

## 6. Task spec summaries

### `tasks/07.01-goal-roadmap-ui.md` (task 7.1, depends 5.1 + 5.4)
UI-only task. **No new API endpoints specified.** Renders the forward glide path from 5.1 (`buildGlidePathSchedule`) in a new `RoadmapPanel.tsx`. Consumes data already available from goals + projection-settings endpoints. The derivation logic goes in `roadmap-view.ts` (frontend). The spec does not mandate a dedicated API route — it reads from existing goals/projection-settings data client-side. **If `buildGlidePathSchedule` results are to be consumed here, the glide-path API endpoint feeds this panel.**

### `tasks/06.04-multi-goal-allocation.md` (task 6.4, depends 6.1–6.3 + 5.1)
Specifies the multi-goal allocation engine (already written as `allocateAcrossGoals`). Mentions surplus from task 5.1, priority order from `/api/goals/order`. **No explicit API endpoint path is stated**, but the integration pattern is: route loads goals + calls `getIncomeSurplus` + calls `allocateAcrossGoals`, returns `MultiGoalAllocationPlan`. The natural endpoint is `GET /api/planning/allocation`.

---

## Summary of wiring work required

| # | Service | Nature | New route | New shared schema |
|---|---------|---------|-----------|-------------------|
| 1 | `getIncomeSurplus` | DB, planning | `GET /api/planning/income-surplus` | Yes |
| 2 | `getDataCompletenessReport` | DB, planning | `GET /api/planning/data-completeness` | Yes |
| 3 | `allocateAcrossGoals` | Pure (DB in route) | `GET /api/planning/allocation` | Yes |
| 4 | `buildGlidePathSchedule` | Pure (DB in route) | `GET /api/goals/:id/glide-path` | Yes |
| 5 | `buildRebalancingPlan` | Pure (DB + glide in route) | `GET /api/goals/:id/rebalancing-plan` | Yes |
| 6 | `buildInstrumentGuidance` | Pure (DB for held cats) | `GET /api/planning/instrument-guidance` | Yes |
| 7 | `getHouseholdRevolvingDebt` | DB, credit | `GET /api/credit/revolving-debt` | Yes |
| 8 | `getInstrumentRule` / `listSuitableCategories` | Pure library | Optional lookup endpoints | Optional |

All 7 Zod response schemas must be added to `packages/shared` before routes can be wired.
Both snapshot files (`route-surface.snapshot.txt`, `route-table.snapshot.txt`) must be regenerated after adding routes.
