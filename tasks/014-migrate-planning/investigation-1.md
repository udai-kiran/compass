# Task 1.5 "Migrate planning module" — Inventory investigation

Scope: inventory only (routes, services, tables, cross-import graph, existing
partial module, precedent, test baseline, size). Jobs/caching/consumers are
covered by a separate worker and are only noted here where they touch the
inventory (e.g. `jobs/index.ts` importing a planning service).

No files were changed. No writing git commands were run.

---

## 1. ROUTE FILES

All 8 claimed route groups exist as files under `apps/api/src/routes/`,
**except** `projection-settings`, which is **already migrated** (lives at
`apps/api/src/modules/planning/routes/projection-settings.ts`, registered via
`apps/api/src/modules/planning/plugin.ts:16`). So the roadmap's "8 route
groups" claim is really **7 still-flat route files + 1 already-done**.

| # | claimed name | file | plugin symbol | lines | status |
|---|---|---|---|---|---|
| 1 | budgets | `apps/api/src/routes/budgets.ts` | `budgetRoutes` (`budgets.ts:28`) | 130 | flat |
| 2 | goals | `apps/api/src/routes/goals.ts` | `goalRoutes` (`goals.ts:22`) | 64 | flat |
| 3 | cashflow | `apps/api/src/routes/cashflow.ts` | `cashflowRoutes` (`cashflow.ts:9`) | 35 | flat |
| 4 | bills | `apps/api/src/routes/bills.ts` | `billRoutes` (`bills.ts:7`) | 40 | flat |
| 5 | projection-settings | `apps/api/src/modules/planning/routes/projection-settings.ts` | `projectionSettingsRoutes` | 28 | **already migrated** |
| 6 | dashboard | `apps/api/src/routes/dashboard.ts` | `dashboardRoutes` (`dashboard.ts:7`) | 26 | flat |
| 7 | insights | `apps/api/src/routes/insights.ts` | `insightRoutes` (`insights.ts:9`) | 27 | flat |
| 8 | reports | `apps/api/src/routes/reports.ts` | `reportRoutes` (`reports.ts:6`) | 31 | flat |

None of these 7 flat files mix in a route for a different apparent domain —
each is single-purpose. Exact route declarations:

**`apps/api/src/routes/budgets.ts`** (`budgetRoutes`, 130 lines)
- `GET /api/budgets/suggestions` — `budgets.ts:36-40`
- `GET /api/budgets/:period/:key` — `budgets.ts:42-46`
- `PUT /api/budgets/:period/:key` — `budgets.ts:48-66`
- `PUT /api/budgets/:period/:key/lines` — `budgets.ts:68-82`
- `DELETE /api/budgets/:period/:key/lines/:categoryId` — `budgets.ts:84-103`
- `POST /api/budgets/:period/:key/copy-previous` — `budgets.ts:105-118`
- `GET /api/budgets/monthly/:key/comparison` — `budgets.ts:120-129`

**`apps/api/src/routes/goals.ts`** (`goalRoutes`, 64 lines)
- `GET /api/goals` — `goals.ts:25-29`
- `POST /api/goals` — `goals.ts:31-36`
- `PUT /api/goals/order` — `goals.ts:38-42`
- `PATCH /api/goals/:id` — `goals.ts:44-48`
- `DELETE /api/goals/:id` — `goals.ts:50-57`
- `GET /api/goals/:id/progress` — `goals.ts:59-63`

**`apps/api/src/routes/cashflow.ts`** (`cashflowRoutes`, 35 lines)
- `GET /api/cashflow` — `cashflow.ts:12-16`
- `GET /api/cashflow/export.csv` — `cashflow.ts:18-28`
- `GET /api/forecast` — `cashflow.ts:30-34`

**`apps/api/src/routes/bills.ts`** (`billRoutes`, 40 lines)
- `GET /api/bills/upcoming` — `bills.ts:10-19`
- `GET /api/subscriptions/suggestions` — `bills.ts:21-25`
- `POST /api/subscriptions/dismiss` — `bills.ts:27-39`

**`apps/api/src/routes/dashboard.ts`** (`dashboardRoutes`, 26 lines)
- `GET /api/dashboard` — `dashboard.ts:10-14`
- `GET /api/trends` — `dashboard.ts:16-25`

**`apps/api/src/routes/insights.ts`** (`insightRoutes`, 27 lines)
- `GET /api/insights` — `insights.ts:12-26`

**`apps/api/src/routes/reports.ts`** (`reportRoutes`, 31 lines)
- `GET /api/reports` — `reports.ts:9-13`
- `GET /api/reports.csv` — `reports.ts:16-30`

Registration in `apps/api/src/app.ts`: imports at lines 23,24,26,28,29,32,33,37
(planning already-migrated import at line 37: `import { planningRoutes } from
"./modules/planning/plugin.ts";`); registrations at `app.ts:123` (budgets),
`124` (dashboard), `126` (goals), `128` (cashflow), `129` (bills), `132`
(insights), `133` (reports), `137` (planning/projection-settings). Note the
registration order is **not contiguous** — `notificationRoutes` (125),
`investmentsRoutes` (127), `creditRoutes`/`protectionRoutes` (130-131),
`backupRoutes`/`aiRoutes`/`aiEventRoutes` (134-136) are interleaved between
the planning route groups, same pattern the ledger/credit/investments/
protection precedent comments (`app.ts:82-117`) describe for their own
migrations.

## 2. SERVICE FILES

Planning-domain services under `apps/api/src/services/` (imported by the 7
flat route files above, or operating on the 6 claimed tables):

| file | lines | exported symbols | test file | test( count |
|---|---|---|---|---|
| `services/budgets.ts` | 286 | `isClosed`, `getBudget`, `upsertBudget`, `upsertBudgetLine`, `deleteBudgetLine`, `getUtilization`, `suggestBudget`, `copyFromPreviousPeriod`, `comparePeriods` | **none** | — |
| `services/goals.ts` | 360 | `listGoals`, `createGoal`, `updateGoal`, `deleteGoal`, `reorderGoals`, `checkGoalMilestones`, `getGoalProgress` | **none** | — |
| `services/goal-allocation.ts` | 99 | `GoalAllocationClass` (type), `accountAllocationClass`, `holdingAllocationClass`, `allocationPercentages`, `sortAssetsByAllocation` | `services/goal-allocation.test.ts` | 9 |
| `services/goal-plan.ts` | 130 | `AllocationTarget`, `DRIFT_BAND_PCT`, `OTHER_BAND_PCT`, `targetAllocation`, `GoalPlanInput`, `equityShareOfInvestable`, `buildGoalPlan` | `services/goal-plan.test.ts` | 14 |
| `services/goal-projection.ts` | 133 | `ProjectionAsset`, `ProjectionInput`, `ProjectionResult`, `projectGoal` | `services/goal-projection.test.ts` | 7 |
| `services/goal-returns.ts` | 162 | `STORED`, `DEFAULT_EQUITY_RETURN_BPS`, `DEFAULT_DEBT_RETURN_BPS`, `ACCOUNT_RETURN_BPS`, `accountReturnBps`, `holdingReturnBps` | `services/goal-returns.test.ts` | 16 |
| `services/cashflow.ts` | 157 | `getCashflow`, `cashflowCsv`, `getForecast` | **none** | — |
| `services/bills.ts` | 166 | `upcomingBills`, `evaluateBillReminders`, `suggestSubscriptions`, `dismissSubscription` | **none** | — |
| `services/dashboard.ts` | 127 | `getDashboard`, `getTrends` | **none** | — |
| `services/insights.ts` | 284 | `savingRatePct`, `coefficientOfVariation`, `lifestyleInflationPct`, `computeHealthScore`, `getInsights` | `services/insights.test.ts` | 4 |
| `services/reports.ts` | 160 | `resolveReportRange`, `splitByNecessity`, `buildReport`, `reportToCsv` | `services/reports.test.ts` | 20 |

**Finding: 5 of 11 planning services have no colocated `*.test.ts`**
(`budgets.ts`, `goals.ts`, `cashflow.ts`, `bills.ts`, `dashboard.ts`) —
confirmed by `ls apps/api/src/services/*.test.ts` not containing any of
`budgets.test.ts`, `goals.test.ts`, `cashflow.test.ts`, `bills.test.ts`,
`dashboard.test.ts`.

**Finding: a 12th planning-flavoured service, `services/autopilot.ts` (241
lines), is not named in the roadmap's route/table lists at all.** It imports
`equityShareOfInvestable`/`OTHER_BAND_PCT` from `./goal-plan.ts`
(`autopilot.ts:7`), `getGoalProgress`/`listGoals` from `./goals.ts`
(`autopilot.ts:9`), and `getForecast` from `./cashflow.ts` (`autopilot.ts:6`).
It is not routed — its only importer is `apps/api/src/jobs/index.ts:9`
(`import { runAutopilotReview, runGoalReview } from "../services/autopilot.ts";`),
used at `jobs/index.ts:313`. It has no colocated test. This sits at the
planning/jobs boundary the other worker is covering; flagging it here because
it depends on 3 planning services that this task would move.

## 3. TABLES

All 6 claimed tables exist, physically defined in `apps/api/src/db/schema.ts`
— **none of them is defined in `apps/api/src/modules/planning/schema.ts`**,
which currently holds only the 7th (uncounted-by-the-roadmap) table,
`projection_settings`.

| table | `file:line` | physical home |
|---|---|---|
| `budgets` | `db/schema.ts:563-577` | `db/schema.ts` |
| `budget_lines` | `db/schema.ts:579-595` | `db/schema.ts` |
| `budget_alerts` | `db/schema.ts:598-615` | `db/schema.ts` |
| `goals` | `db/schema.ts:693-712` | `db/schema.ts` |
| `subscription_dismissals` | `db/schema.ts:736-747` | `db/schema.ts` |
| `projection_settings` | `modules/planning/schema.ts:5-13` | **`modules/planning/schema.ts`** (already migrated) |

`db/schema.ts:22` — `export * from "../modules/planning/schema.ts";` — is the
mechanism that re-exposes `projectionSettings` through the barrel; see
section 5 for the full 5-line context.

**Planning table the roadmap missed:** none beyond `projection_settings`
itself (already covered above) — no other table in `db/schema.ts` is
user-scoped exclusively for budgets/goals/bills forecasting. Two adjacent,
similarly-shaped tables are explicitly **not** planning-owned:
- `alert_ledger` (`db/schema.ts:722-734`) is a generic dedup ledger shared by
  credit (`card-due-tasks.ts`, per its own doc comment at `db/schema.ts:717-720`)
  and planning (`autopilot.ts`, `bills.ts:5`) — cross-domain, not planning-only.
- `notifications` / `notification_prefs` (`db/schema.ts:617-633`, `749-`) are a
  generic notification store consumed by many domains, not planning-owned.

**pgEnums used by the 6 tables:**
- `budgetPeriod = pgEnum("budget_period", ["monthly","annual"])` —
  `db/schema.ts:561`, used by `budgets.period` (`db/schema.ts:570`).
- `goalType = pgEnum("goal_type", [...])` — `db/schema.ts:682`, used by
  `goals.type` (`db/schema.ts:701`).
- `budget_lines`, `budget_alerts`, `subscription_dismissals`,
  `projection_settings` declare no enum columns of their own.

**Foreign keys OUT of the 6 tables (to other domains' tables):**
- `budgets.userId → users.id` — `db/schema.ts:567-569` (core-schema, shared).
- `budget_lines.budgetId → budgets.id` (`db/schema.ts:583-585`) — intra-planning.
- `budget_lines.categoryId → categories.id` — `db/schema.ts:586-588`
  (`categories` is a **ledger**-owned table).
- `budget_alerts.userId → users.id` — `db/schema.ts:602-604`.
- `budget_alerts.categoryId → categories.id` — `db/schema.ts:606-608` (ledger).
- `goals.userId → users.id` — `db/schema.ts:697-699`.
- `subscription_dismissals.userId → users.id` — `db/schema.ts:740-742`.
- `projection_settings.userId → users.id` — `modules/planning/schema.ts:6-8`.

**Foreign keys INTO `goals` from tables owned by other domains** (this is the
part most likely to bite a physical move — see section 6 precedent):
- `accounts.goalId → goals.id` (nullable, `onDelete: "set null"`, lazily typed
  `AnyPgColumn`) — `db/schema.ts:198`. `accounts` is a **ledger**-owned table
  (still physically in `db/schema.ts`, re-exported thinly from
  `modules/ledger/schema.ts`).
- `holdings.goalId → goals.id` (nullable, `onDelete: "set null"`) —
  `db/schema.ts:1284`. `holdings` is an **investments**-owned table (still
  physically in `db/schema.ts`, re-exported thinly from
  `modules/investments/schema.ts`).
- `sips.goalId → goals.id` (NOT NULL, `onDelete: "cascade"`) —
  `db/schema.ts:1444-1446`. `sips` is also **investments**-owned.

No other table's `.references(` targets `budgets`, `budget_lines`,
`budget_alerts`, `subscription_dismissals`, or `projection_settings` — grep
for `references(() => budgets` / `budgetLines` / `budgetAlerts` /
`subscriptionDismissals` / `projectionSettings` across `db/schema.ts` and
every `modules/*/schema.ts` returns only the intra-table hit already listed
(`budget_lines.budgetId`).

`services/backup.ts` (out of scope to edit, but relevant for sizing the blast
radius) already lists all 6 tables by string name in its FK-topological
`ALL_TABLES`/`USER_TABLES`/parent maps: `backup.ts:31-32` (`"budgets",
"budget_lines", "budget_alerts", ... "goals", ... "subscription_dismissals",
... "projection_settings"`), `backup.ts:47-48` (owner-column map), `backup.ts:71`
(`budget_lines: { fk: "budget_id", parent: "budgets" }`), and a doc comment at
`backup.ts:14,20` calling out `accounts.goal_id → goals` and `sips` needing to
restore after both `goals` and `holdings` — independent confirmation of the
cross-domain FK shape above.

## 4. CROSS-IMPORT GRAPH

### 4a. Imports of a planning SERVICE from outside the planning route/service files

- `apps/api/src/modules/investments/services/sip-commitments.ts:6` —
  `import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../../services/goal-allocation.ts";`
- `apps/api/src/services/autopilot.ts:6-9` —
  `import { getForecast } from "./cashflow.ts";` (line 6),
  `import { equityShareOfInvestable, OTHER_BAND_PCT } from "./goal-plan.ts";` (line 7),
  `import { getGoalProgress, listGoals } from "./goals.ts";` (line 9).
  (`autopilot.ts` is itself outside the claimed planning file set — see §2.)
- `apps/api/src/services/notifications.ts:7` —
  `import { getUtilization } from "./budgets.ts";`
- `apps/api/src/services/ai/summary.ts:5-6` —
  `import { buildReport } from "../reports.ts";` (line 5),
  `import { getInsights } from "../insights.ts";` (line 6).
- `apps/api/src/services/ai/tools.ts:6-10` —
  `import { buildReport } from "../reports.ts";` (line 6),
  `import { getInsights } from "../insights.ts";` (line 8),
  `import { getUtilization } from "../budgets.ts";` (line 7 — confirmed via
  grep `apps/api/src/services/ai/tools.ts:7`),
  `import { listGoals } from "../goals.ts";` (line 10).
- `apps/api/src/jobs/index.ts:5` —
  `import { evaluateBillReminders } from "../services/bills.ts";` (jobs
  domain — flagged for the parallel jobs/caching worker, not acted on here).

Not a real import, but worth flagging so it isn't mistaken for one: a
**comment** in `apps/api/src/modules/ledger/services/user-tasks.ts:50`
references "`services/goals.ts`" in prose (`sql\`${goals.sortOrder} desc\``
style note) — no actual `import` statement there.

### 4b. Imports of a planning TABLE from outside

All from `apps/api/src/db/schema.ts` (none of the 6 tables is imported from
anywhere else, since none but `projection_settings` has a module-local
`schema.ts` copy yet):

- `apps/api/src/modules/investments/services/goal-networth.ts:5` —
  `import { goals } from "../../../db/schema.ts";` (used `goal-networth.ts:94`).
- `apps/api/src/services/ownership.ts:3` —
  `import { accounts, categories, goals, holdings } from "../db/schema.ts";`
  (used `ownership.ts:49-50`, a cross-domain ownership-check helper spanning
  ledger/planning/investments tables in one file).
- `apps/api/src/services/notifications.ts:4` —
  `import { budgetAlerts, categories, notifications } from "../db/schema.ts";`
  (used `notifications.ts:98,101`).
- `apps/api/src/services/demo.ts:9-15` (block import) —
  `budgetLines`, `budgets`, `goals` among the imported symbols (used
  `demo.ts:163-169` for goals insert, `demo.ts:213-216` for budgets/budget_lines
  insert) — demo-seed writes directly to planning tables from outside.
- `apps/api/src/modules/ledger/schema.ts:6` (doc comment, not an import) states
  ledger has "4 outbound FKs to still-flat tables (goals, insurance_policies,
  sips, statement_reconciliations)" — this is the `accounts.goalId` FK from
  §3, documented in the ledger module's own precedent comment.
- `apps/api/src/services/backup.test.ts:119-120,134` references the string
  `"goals"` for FK-ordering assertions (no table-object import — string-keyed
  test, listed for completeness).

### 4c. Imports the planning route/service files make FROM other domains

- `apps/api/src/services/goals.ts:14` —
  `import { listAccounts } from "../modules/ledger/services/accounts.ts";`
- `apps/api/src/services/goals.ts:15` —
  `import { getPortfolio } from "../modules/investments/services/holdings.ts";`
- `apps/api/src/services/goals.ts:22` —
  `import { getProjectionSettings } from "../modules/planning/services/projection-settings.ts";`
  (the not-yet-migrated `goals.ts` already reaches INTO the partially-migrated
  planning module — a same-domain forward reference across the flat/module
  boundary).
- `apps/api/src/services/goals.ts:23` —
  `import { committedForGoal } from "../modules/investments/services/sip-commitments.ts";`
- `apps/api/src/services/goals.ts:12` —
  `import { alertLedger, goals, holdingEvents, retirementDetails, transactions } from "../db/schema.ts";`
  (`holdingEvents` = investments, `retirementDetails` = protection,
  `transactions` = ledger — 3 other domains' tables in one import).
- `apps/api/src/services/cashflow.ts:5` —
  `import { accounts, holdings, recurringTemplates, sips } from "../db/schema.ts";`
  (ledger `accounts`/`recurringTemplates`, investments `holdings`/`sips`).
- `apps/api/src/services/cashflow.ts:11` —
  `import { advanceDate } from "../modules/ledger/services/recurring.ts";`
- `apps/api/src/services/cashflow.ts:12` —
  `import { sipOccurrencesInWindow } from "../modules/investments/services/sip-schedule.ts";`
- `apps/api/src/services/bills.ts:5` —
  `import { recurringTemplates, subscriptionDismissals, alertLedger } from "../db/schema.ts";`
  (`recurringTemplates` = ledger).
- `apps/api/src/services/bills.ts:8` —
  `import { advanceDate } from "../modules/ledger/services/recurring.ts";`
- `apps/api/src/services/dashboard.ts:15` —
  `import { listTransactions } from "../modules/ledger/services/transactions.ts";`
- `apps/api/src/services/reports.ts:14` —
  `import { categories } from "../db/schema.ts";` (ledger).
- Reverse-of-the-partial-module dependency: `apps/api/src/modules/planning/services/projection-settings.ts:6` —
  `import { DEFAULT_EQUITY_RETURN_BPS } from "../../../services/goal-returns.ts";`
  — the **already-migrated** `modules/planning/` slice currently reaches back
  OUT to the still-flat `services/goal-returns.ts`. This import will need to
  flip direction (or be internalised) once `goal-returns.ts` moves in.

Within-domain-only imports not repeated above: `services/budgets.ts` →
`services/ownership.ts`, `services/periods.ts`; `services/goals.ts` →
`services/goal-returns.ts`, `goal-projection.ts`, `goal-plan.ts`,
`notifications.ts`, `periods.ts`, `prefs.ts`, `goal-allocation.ts`;
`services/dashboard.ts` → `services/balances.ts`, `cache.ts`, `budgets.ts`,
`periods.ts`; `services/reports.ts` → `services/periods.ts`, `insights.ts`;
`services/insights.ts` → `services/periods.ts` only.

## 5. EXISTING PARTIAL MODULE

`apps/api/src/modules/planning/` contents:

| file | lines |
|---|---|
| `plugin.ts` | 17 |
| `schema.ts` | 13 |
| `routes/projection-settings.ts` | 28 |
| `routes/projection-settings.route.test.ts` | 143 |
| `services/projection-settings.ts` | 30 |
| `services/projection-settings.test.ts` | 114 |

**`schema.smoke.test.ts` does NOT exist** for planning (confirmed —
`find apps/api/src/modules/planning -name "*.test.ts"` returns only the two
route/service test files above). **`plugin.test.ts` does NOT exist** for
planning either. Both exist for all 4 already-migrated modules:
`modules/{credit,ledger,investments,protection}/schema.smoke.test.ts` and
`.../plugin.test.ts` (line counts: credit 43/42, ledger 54/49, investments
54/45, protection 37/39).

`apps/api/src/db/schema.ts` line 22 and its 5-line surrounding context
(lines 18-23), verbatim:

```
} from "drizzle-orm/pg-core";
import { users } from "./core-schema.ts";
export { users } from "./core-schema.ts";
export * from "../modules/planning/schema.ts";

/**
```

(Line 20 imports `users` for local use in `pgTable(...).references(() =>
users.id)` calls throughout the file; line 21 re-exports `users` itself; line
22 is the `export *` that surfaces `projectionSettings` through the barrel —
this is the one case among the 4+1 modules where `db/schema.ts` re-exports
*from* the module, called out explicitly as the exception in
`modules/ledger/schema.ts:21-25` and `modules/credit/schema.ts:22-24`'s "does
NOT export * back" comments.)

## 6. PRECEDENT — `modules/credit/`

**`apps/api/src/modules/credit/schema.ts`, in full (37 lines):**

```ts
/**
 * Thin, named re-export of the credit domain's 8 tables + 2 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md and tasks/008-migrate-credit/TASK.md): these
 * 8 tables carry 7 outbound FKs into ledger-owned `accounts`/`recurring_templates`
 * and 8 outbound FKs into core `users`, plus 2 outbound FKs into the still-flat
 * ingest module's `email_ingestions` — physically relocating the table
 * definitions here would create a genuine cross-file ES-module cycle with
 * `db/schema.ts`. Table definitions stay in `db/schema.ts`, unmoved, until task
 * 1.9's cross-module FK-graph/SCC work decides a final, acyclic home for each
 * one.
 *
 * Services/routes inside `modules/credit/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * credit-owned tables) — this is the module-boundary discipline that matters:
 * it costs nothing today and means a future physical decomposition only has
 * to change this one file, not every service/route that already imports from
 * `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the credit tables'
 * only home is still `db/schema.ts` itself, so the reverse direction would
 * just recreate a pointless cycle (same reasoning as the ledger module).
 */
export {
  cardDetails,
  cardIssuerSettings,
  cardStatements,
  bankDetails,
  overdraftDetails,
  rewardEntries,
  statementReconciliations,
  emiDetails,
  cardNetwork,
  bankAccountSubtype,
} from "../../db/schema.ts";
```

**`apps/api/src/modules/credit/plugin.ts`, in full (28 lines):**

```ts
import type { FastifyInstance } from "fastify";
import { cardRoutes } from "./routes/cards.ts";
import { emiRoutes } from "./routes/emis.ts";
import { bankDetailsRoutes } from "./routes/bank-details.ts";
import { overdraftDetailsRoutes } from "./routes/overdraft-details.ts";

/**
 * `modules/credit/` — second of 8 Phase-1 module migrations (task 1.2),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 4 credit route groups internally, replacing the 4 separate
 * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
 * handler bodies — pure relocation, no behavioral change. This collapses 4
 * registrations (2 of which were previously interleaved with
 * `retirementRoutes`/`accountNpsRoutes`, see `tasks/008-migrate-credit/TASK.md`
 * Root Cause) into one contiguous plugin call, which legitimately restructures
 * Fastify's raw `printRoutes()` tree (see `route-table.snapshot.txt`'s
 * regenerated diff) but does not change the canonical (method, path) surface
 * (`route-surface.snapshot.txt`).
 */
export async function creditRoutes(app: FastifyInstance): Promise<void> {
  await app.register(cardRoutes);
  await app.register(emiRoutes);
  await app.register(bankDetailsRoutes);
  await app.register(overdraftDetailsRoutes);
}
```

For contrast, the current (partial) `apps/api/src/modules/planning/schema.ts`
(13 lines) is the *opposite* shape — it physically defines `projectionSettings`
(single-owner, no cross-domain FKs) rather than re-exporting it — and
`apps/api/src/modules/planning/plugin.ts` (17 lines) registers only
`projectionSettingsRoutes` today, with a doc comment at `plugin.ts:11-13`
already anticipating: "Task 1.5 registers the rest of the planning module
here (budgets, goals, cashflow, bills, dashboard, insights, reports)."

Given the FK shape found in §3 (`accounts.goalId`, `holdings.goalId`,
`sips.goalId` all reference `goals.id` from other, still-flat-table domains),
`budgets`/`budget_lines`/`budget_alerts`/`goals`/`subscription_dismissals`
look structurally like the credit/ledger/investments precedent (thin
re-export, tables staying in `db/schema.ts`, deferred to task 1.9) rather than
like the existing `projection_settings` precedent (physical move, `export *`
back) — but that is a design call for the coordinator, not concluded here.

## 7. TEST BASELINE

Command: `npm run test -w apps/api 2>&1 | tail -30` (run from
`/home/udai/PennyPilot`).

Literal tail-30 output:

```
✔ UpdateUserProfileSchema accepts null to clear dateOfBirth (0.190754ms)
✔ User profile DOB save/reload flow: round-trip through service layer (0.987569ms)
✔ resolveReportRange resolves monthly bounds (2.618048ms)
✔ resolveReportRange resolves leap-February bounds (0.292556ms)
✔ resolveReportRange resolves annual bounds (0.216947ms)
✔ resolveReportRange passes a custom range through and joins the periodKey (0.601837ms)
✔ resolveReportRange throws when a custom range lacks from/to (0.433975ms)
✔ resolveReportRange throws when monthly/annual lacks a key (0.23593ms)
✔ resolveReportRange throws for a custom range with an impossible calendar date (0.272905ms)
✔ resolveReportRange throws for a custom range exceeding MAX_REPORT_RANGE_DAYS (0.26484ms)
✔ resolveReportRange does not throw at exactly MAX_REPORT_RANGE_DAYS (0.360092ms)
✔ resolveReportRange throws for a malformed monthly key (0.336553ms)
✔ splitByNecessity sorts rows into essential, non-essential and unclassified by resolved necessity (0.413429ms)
✔ a transaction override routes spend away from its category's default bucket (0.278214ms)
✔ uncategorized spend is unclassified, never assumed (0.164809ms)
✔ a category with no necessity default set is unclassified (0.14583ms)
✔ spend booked against an income category's default is unclassified (0.288479ms)
✔ a transaction override classifies spend that has no category at all (0.263538ms)
✔ a transaction override applies across all of its split category rows (0.149051ms)
✔ two rows resolving to the same necessity sum rather than overwrite (0.174568ms)
✔ the three buckets always sum to the total spend across all input rows (0.174744ms)
✔ reportToCsv emits the necessity rows with distinct labels and values (1.414061ms)
ℹ tests 842
ℹ suites 1
ℹ pass 842
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7793.85325
```

Exit code: **0** (captured separately as the pipeline's `tail` exit code is
not the same as `npm run test`'s; re-ran without the pipe and captured `$?`
immediately after `npm run test -w apps/api` — see the command list below).

Commands actually run:
```
npm run test -w apps/api > <scratchpad>/test-output.txt 2>&1
echo "EXIT: $?"       # → EXIT: 0
tail -30 <scratchpad>/test-output.txt
```

## 8. SIZE

| bucket | lines |
|---|---|
| 7 flat route files (§1) | 353 |
| 11 flat services (§2, incl. 4 `goal-*` helpers) | 2064 |
| 6 existing colocated test files for those services (`goal-allocation.test.ts`, `goal-plan.test.ts`, `goal-projection.test.ts`, `goal-returns.test.ts`, `insights.test.ts`, `reports.test.ts`) | 804 |
| **Subtotal: files that would physically move** | **3221** |
| Existing partial `modules/planning/` (already done, task 0.3) | 345 |
| `services/autopilot.ts` (planning-adjacent, not in roadmap list, only used by jobs — not counted in the move total, flagged in §2) | 241 |

For comparison, precedent module sizes (all files under each `modules/<x>/`,
per `find | xargs wc -l` totals, not reproduced in full here): credit and
investments each ran to roughly a dozen route/service/test files. Planning's
3221-line, 11-service, 7-route flat surface plus a 6-table FK entanglement
into 3 other domains (ledger's `accounts`, investments' `holdings`/`sips`, and
notifications/backup/demo/AI touching in from outside) is comparably large or
larger than the credit/investments migrations and has a materially bigger
cross-import surface (§4) — worth the coordinator weighing whether 1.5 should
split into sub-tasks (e.g. budgets+goals+goal-* helpers as one slice,
cashflow+bills+dashboard+insights+reports as another), though that decision is
explicitly out of scope for this investigation.

## Roadmap-claim accuracy summary

- **Routes list (8 groups) is stale in one respect**: `projection-settings` is
  already migrated (task 0.3), so only 7 route files remain flat, not 8.
- **Tables list (6 tables) is accurate** as a list of names, but stale in
  implying they're comparable/independent: 3 of the 6 (`budgets`,
  `budget_lines`, `budget_alerts`) plus `goals` are entangled via FK with
  ledger's `accounts` and investments' `holdings`/`sips` in exactly the shape
  the ledger/credit/investments precedent comments describe as "cannot
  physically move without creating a cross-file cycle" — the roadmap text
  doesn't surface this, and a naive "move tables into
  `modules/planning/schema.ts`" would very likely hit the same wall task 1.9
  is explicitly deferred to resolve.
- **The roadmap's route/table lists omit `services/autopilot.ts`**, which is
  itself planning-flavoured (depends on 3 of the 11 planning services) but is
  routed nowhere — it's reached only from `jobs/index.ts`.
- **Roadmap doesn't mention `services/ai/summary.ts` and `services/ai/tools.ts`**
  depend directly on `buildReport`/`getInsights`/`getUtilization`/`listGoals`
  — an AI-domain dependency on planning services that will need updated import
  paths regardless of which precedent shape (re-export vs. physical move) is
  chosen.
