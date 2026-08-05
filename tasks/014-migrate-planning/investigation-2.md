# Task 1.5 (migrate planning module) — behavioural seams & migration gates

Investigation only. No files changed outside this document. No git commands run.

Roadmap under test: `tasks/01.05-migrate-planning.md`:
```
Routes: budgets, goals, cashflow, bills, projection-settings, dashboard, insights, reports.
Tables: budgets, budget_lines, budget_alerts, goals, subscription_dismissals, projection_settings.

This module owns the budget-evaluation subscriber introduced in 0.2 and the
Redis-cached dashboard/trends aggregates. `budget_lines` has no `user_id` and
scopes via its parent budget. Goal projections are consumed later by the
shopping goal-impact receipt (6.4).
```

Note up front: the module scaffold already exists and is partially populated.
`apps/api/src/modules/planning/` currently contains only `projection_settings`
(schema.ts:5 `projectionSettings = pgTable("projection_settings", ...)`,
`routes/projection-settings.ts`, `services/projection-settings.ts`), migrated
in task 0.3 per `plugin.ts`'s own doc comment. Everything else named in the
roadmap (budgets, goals, cashflow, bills, dashboard, insights, reports) is
still flat under `apps/api/src/services/*.ts` / `apps/api/src/routes/*.ts`.
`db/schema.ts:22` already does `export * from "../modules/planning/schema.ts";`
and `db/schema.ts:32-35` documents the split.

---

## 1. Budget-alert evaluation — end-to-end trace

**Roadmap claim:** "This module owns the budget-evaluation subscriber
introduced in 0.2" and "Budget-alert evaluation still runs in the alerts
worker, still gated on notification prefs."

**Verdict: accurate that the debounce/worker/gate mechanics survive
untouched by a move — but the roadmap's implicit framing ("this module
owns...") is misleading, because the evaluation function itself
(`evaluateBudgetAlerts`) does NOT live in a planning-route file. It lives in
`services/notifications.ts`, which backs the *notifications* domain
(`routes/notifications.ts`) — a route not in the planning route list at all.**
Concretely:

1. **Subscriber registration** — `apps/api/src/app.ts:67-72`
   ```
   export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
     app.eventBus.on("ledger.mutated", async ({ userId }) => {
       await invalidateUserCache(app.redis, userId);
       await enqueueBudgetEvaluation(app, userId);
     });
   }
   ```
   Called from `buildApp()` at `app.ts:172`, before `startJobs(app)` at
   `app.ts:174` (comment at `app.ts:64-65` explains why: boot-catchup emits
   during `startJobs`, so the subscriber must be live first).

2. **Event source** — `app.eventBus.emit("ledger.mutated", { userId })` is
   called from many ledger-writing call sites (grep, non-test only):
   `modules/ledger/routes/recurring.ts:27,30,73`,
   `modules/ledger/routes/transactions.ts:49,70,80,90,100`,
   `modules/ledger/routes/transfers.ts:31,43,58`,
   `jobs/index.ts:249,375` (recurring materialization, boot + cron),
   `routes/inbox.ts:64,80,95`, `routes/imports.ts:112,122`.
   Event type declared in `lib/event-bus.ts:11`: `"ledger.mutated": { userId: string }`.

3. **Enqueue** — `enqueueBudgetEvaluation`, `apps/api/src/jobs/index.ts:54-64`:
   ```
   export async function enqueueBudgetEvaluation(app: FastifyInstance, userId: string): Promise<void> {
     try {
       await app.queues.alerts.add(
         "evaluate",
         { userId },
         { jobId: `eval-${userId}-${Math.floor(Date.now() / 5000)}`, delay: 5000, removeOnComplete: true, removeOnFail: true },
       );
     } catch (err) { ... }
   }
   ```
   Referenced from `app.ts:42` (import) and `app.ts:70` (call site) — matches
   the brief's pointer to "`enqueueBudgetEvaluation` around app.ts:42 and :70".

4. **Queue/worker** — the `alerts` BullMQ queue is created in
   `jobs/index.ts:230-231` and consumed by `alertsWorker`,
   `jobs/index.ts:345-363`:
   ```
   const alertsWorker = new Worker(
     "alerts",
     async (job) => {
       const { userId } = job.data as { userId: string };
       const budget = (await prefEnabled(app.db, userId, "budget"))
         ? await evaluateBudgetAlerts(app.db, userId)
         : 0;
       const large = await evaluateLargeTransactions(app.db, userId);
       const low = await evaluateLowBalance(app.db, userId);
       const cardUtil = await evaluateCardUtilization(app.db, userId);
       const anomaly = await evaluateAnomalies(app.db, userId);
       ...
     },
     { connection, concurrency: 2 },
   );
   ```
   Note this worker is a *shared* alert dispatcher — one job triggers budget,
   large-transaction, low-balance, card-utilization and anomaly evaluation
   together, each from a different service file/domain (notifications,
   prefs, `modules/credit/services/alerts.ts`, `services/anomaly.ts`). Moving
   `evaluateBudgetAlerts` will require this worker body in `jobs/index.ts` to
   import from the new planning-module path, but the worker itself
   (job dispatch, gating, `alerts` queue) has no reason to move — it isn't a
   planning file and stays in `jobs/index.ts`.

5. **Notification-preference gate** — `apps/api/src/services/prefs.ts:69-78`:
   ```
   /** Kind-level kill switch: a user-wide pref row with enabled=false mutes the type. */
   export async function prefEnabled(db: Db, userId: string, type: NotificationType): Promise<boolean> {
     const row = await db.query.notificationPrefs.findFirst({
       where: and(
         eq(notificationPrefs.userId, userId),
         eq(notificationPrefs.type, type),
         isNull(notificationPrefs.accountId),
       ),
     });
     return row?.enabled ?? true;
   }
   ```
   Called from `jobs/index.ts:349` with `type: "budget"`. `notificationPrefs`
   is a table in `db/schema.ts` used by the notifications domain, not listed
   among the planning tables in the roadmap.

6. **Evaluation function** — `apps/api/src/services/notifications.ts:87-122`
   (`evaluateBudgetAlerts`), which:
   - calls `getUtilization(db, userId, "monthly", key)` — imported from
     `./budgets.ts` (`notifications.ts:7`), i.e. `services/budgets.ts` — a
     planning file per the roadmap's route list.
   - calls `currentPeriodKey("monthly")` — imported from `./periods.ts`
     (`notifications.ts:6`), i.e. `services/periods.ts`, which is **not**
     named in the roadmap's route/table list at all but is a period-key
     utility shared across budgets, dashboard, insights, cashflow, and
     `modules/credit/services/alerts.ts`.
   - inserts into `budgetAlerts` (dedup ledger) and calls
     `createNotification(db, userId, {...})`, also defined in
     `services/notifications.ts` itself.

### Files outside planning route/service files that import evaluation-path symbols and would need an import update if the evaluation service moves

- `apps/api/src/jobs/index.ts:4` — `import { evaluateBudgetAlerts } from "../services/notifications.ts";` (also line 17, `prefEnabled` from `../services/prefs.ts`).
- `apps/api/src/modules/credit/services/alerts.ts:5-6` —
  `import { createNotification } from "../../../services/notifications.ts";`
  and `import { currentPeriodKey } from "../../../services/periods.ts";`
  — a **credit-module** file reaching into `services/notifications.ts` (for
  `createNotification`, not budget-eval) and `services/periods.ts`
  (for period keys). Neither symbol is budget-specific, but both live in
  files that also house budget-alert code, so any file-level move of
  `notifications.ts`/`periods.ts` breaks this import regardless of whether
  the *budget* logic moves.
- `apps/api/src/routes/notifications.ts:15` —
  `import { listPrefs, upsertPref } from "../services/prefs.ts";` (own domain,
  not planning, but shares `prefs.ts` with `evaluateLargeTransactions`/`evaluateLowBalance`, also invoked by the same `alertsWorker`).
- `apps/api/src/routes/insights.ts:7` —
  `import { currentPeriodKey } from "../services/periods.ts";` (insights IS
  in the roadmap's planning route list, so this becomes an intra-module
  import once insights moves — but only if `periods.ts` also moves; today
  `periods.ts` is not named as a planning file).
- `apps/api/src/services/goals.ts:19,21` —
  `import { createNotification } from "./notifications.ts";` and
  `import { prefEnabled } from "./prefs.ts";` — goals (planning route/table)
  already depends on notifications/prefs.
- `apps/api/src/services/autopilot.ts` (see §3) also transitively touches
  `services/goals.ts`, not evaluation, but is worth flagging alongside.

**Hazard for the migration:** `services/notifications.ts` and
`services/prefs.ts` are NOT in the roadmap's planning route/table list (the
roadmap lists `budgets, goals, cashflow, bills, projection-settings,
dashboard, insights, reports` / `budgets, budget_lines, budget_alerts, goals,
subscription_dismissals, projection_settings`), yet `evaluateBudgetAlerts` —
the exact function the acceptance criterion is about — physically lives in
`notifications.ts`, and its notification-pref gate lives in `prefs.ts`. If
the migration moves `services/budgets.ts` into
`modules/planning/services/budgets.ts` but leaves `notifications.ts`/
`prefs.ts` flat (as their own future "notifications" module, out of this
task's scope), then `notifications.ts`'s `import { getUtilization } from
"./budgets.ts"` (`notifications.ts:7`) needs to become
`"../modules/planning/services/budgets.ts"`, and `jobs/index.ts:4`'s import
of `evaluateBudgetAlerts` is unaffected (still `services/notifications.ts`)
but its downstream `getUtilization` call is now cross-module. This is exactly
the "silently break during a move" risk the brief asks about.

---

## 2. Redis-cached dashboard/trends aggregates — cache reads/writes/invalidation

Generic cache helper: `apps/api/src/services/cache.ts` (whole file, not
planning-specific, used by ledger/credit/investments too):
```
export async function cached<T>(
  redis: Redis, userId: string, name: string, ttlSeconds: number, compute: () => Promise<T>,
): Promise<T> {
  const ver = (await redis.get(`cachever:${userId}`)) ?? "0";
  const key = `cache:${userId}:${ver}:${name}`;
  const hit = await redis.get(key);
  if (hit !== null) return JSON.parse(hit) as T;
  const value = await compute();
  await redis.set(key, JSON.stringify(value), "EX", ttlSeconds);
  return value;
}

export async function invalidateUserCache(redis: Redis, userId: string): Promise<void> {
  await redis.incr(`cachever:${userId}`);
}
```
Key pattern: `cache:${userId}:${ver}:${name}` where `ver` comes from
`cachever:${userId}` (a version counter, not a TTL'd key itself —
invalidation bumps the version so old `cache:...:<oldVer>:...` keys are
simply orphaned and age out via their own `EX`).

### Reads/writes (every `cached(...)` call site, non-test)

| Site | Key `name` | TTL |
|---|---|---|
| `services/dashboard.ts:20` `getDashboard` | `"dashboard"` | `300` (`dashboard.ts:17` `const TTL = 300;`) |
| `services/dashboard.ts:50` `getTrends` | `` `trends:${months}` `` | `300` (same `TTL`) |
| `services/cashflow.ts:56` `getForecast` | `"forecast:90"` | `300` (`cashflow.ts:14` `const TTL = 300;`) |
| `routes/insights.ts:22` | `` `insights:${period}` `` | `300` (inline literal) |

`services/cashflow.ts:9,22` — `getCashflow` does NOT call `cached()` itself;
it calls `getTrends(db, redis, userId, months)` (from `dashboard.ts`), so its
caching is inherited from the dashboard trends cache, not a separate key.

### Invalidation call sites (every `invalidateUserCache` call, non-test)

- `apps/api/src/app.ts:69` — inside `registerLedgerCacheSubscriber`
  (§1), fired for every `ledger.mutated` event, i.e. from the generic ledger
  write path. This is domain-agnostic infrastructure, not planning code.
- `apps/api/src/routes/budgets.ts:32` — planning-owned (budgets route),
  fine.
- `apps/api/src/modules/credit/routes/emis.ts:29,32` — **outside
  planning**, a credit-module route invalidating the user's whole cache
  (including dashboard/trends) after EMI writes.
- `apps/api/src/modules/investments/routes/sips.ts:52,62,72,82,92,108` —
  **outside planning**, six call sites in the investments module
  invalidating the same shared per-user cache after SIP mutations.

**Exhaustive answer to "is invalidation scattered across other domains":
yes.** Dashboard/trends invalidation is NOT contained inside planning
services/routes. It happens via three paths: (a) the generic
`ledger.mutated` subscriber in `app.ts` (domain-agnostic), (b) planning's own
`routes/budgets.ts`, and (c) two non-planning modules — credit
(`modules/credit/routes/emis.ts`) and investments
(`modules/investments/routes/sips.ts`) — reaching directly into
`services/cache.ts` to bump the same per-user cache version that gates
`getDashboard`/`getTrends`/`getForecast`/insights. None of these non-planning
call sites import anything module-specific from planning (they only import
the generic `invalidateUserCache` from `services/cache.ts`, which is not a
planning file), so a planning-module move does not by itself break these
imports — but it means "dashboard/trends caching and its invalidation still
work" (the roadmap's acceptance criterion) cannot be verified by looking at
planning files alone; EMI and SIP writes are just as load-bearing for
dashboard-cache correctness as anything inside planning.

---

## 3. Goal progress/projection interface

**Primary function:** `apps/api/src/services/goals.ts:245`
```
export async function getGoalProgress(db: Db, userId: string, id: string): Promise<GoalProgress>
```
Also exported from the same file (`services/goals.ts`):
`listGoals(db: Db, userId: string): Promise<Goal[]>` (52),
`createGoal(db: Db, userId: string, input: CreateGoal): Promise<Goal>` (60),
`updateGoal(...)` (75), `deleteGoal(...)` (93), `reorderGoals(...)` (101),
`checkGoalMilestones(db, userId, goalId, percent, goalName): Promise<void>` (215).

`getGoalProgress` composes several other exported, currently-flat helper
files (none imported from a planning path today):
- `services/goal-projection.ts:78` — `export function projectGoal(input: ProjectionInput): ProjectionResult`
- `services/goal-plan.ts:91` — `export function buildGoalPlan(input: GoalPlanInput): GoalPlan` (also `equityShareOfInvestable` at :70, `OTHER_BAND_PCT` at :26)
- `services/goal-returns.ts:109,142` — `accountReturnBps(...)`, `holdingReturnBps(...)` (also `DEFAULT_EQUITY_RETURN_BPS = 1200` at :18)
- `services/goal-allocation.ts:5,14,49,88` — `accountAllocationClass`, `holdingAllocationClass`, `allocationPercentages`, `sortAssetsByAllocation`
- `modules/planning/services/projection-settings.ts` — `getProjectionSettings` (already-migrated planning file)
- `modules/investments/services/holdings.ts` — `getPortfolio` (investments)
- `modules/investments/services/sip-commitments.ts` — `committedForGoal` (investments)
- `modules/ledger/services/accounts.ts` — `listAccounts` (ledger)

### Route consumer

`apps/api/src/routes/goals.ts:11-18,59-63` imports
`getGoalProgress` and calls it directly:
```
r.get(
  "/api/goals/:id/progress",
  { schema: { params: IdParams, response: { 200: GoalProgressSchema } } },
  async (req) => getGoalProgress(app.db, req.session!.userId, req.params.id),
);
```

### Consumer outside the planning domain

`apps/api/src/services/autopilot.ts:7-8,201`:
```
import { equityShareOfInvestable, OTHER_BAND_PCT } from "./goal-plan.ts";
import { getGoalProgress, listGoals } from "./goals.ts";
...
const progress = await getGoalProgress(db, userId, g.id);
```
`services/autopilot.ts` is not in the planning route list and drives the
`autopilot.goals` cron job (see §5) — it is a real, already-existing external
consumer of `getGoalProgress`/`listGoals`/`equityShareOfInvestable`, which is
exactly the kind of "documented interface for later reuse" the roadmap wants
for task 6.4. **No such documented interface exists yet** — today it's a
plain function import from a flat file, not a boundary with any doc comment
calling it out as a public module interface.

### Cross-dependencies already reaching into the not-yet-migrated goal files from already-migrated/other-module code

- `apps/api/src/modules/planning/services/projection-settings.ts:6` —
  `import { DEFAULT_EQUITY_RETURN_BPS } from "../../../services/goal-returns.ts";`
  — the already-migrated planning module reaches back into a flat
  (not-yet-migrated) file.
- `apps/api/src/modules/investments/services/sip-commitments.ts:6` —
  `import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../../services/goal-allocation.ts";`
  — investments module depends on a flat goal-allocation helper file that
  is itself goal/planning-adjacent but not listed as a planning table/route.

### `apps/api/src/modules/investments/services/goal-networth.ts` specifically

Full file read. It does **not** import anything from `services/goals.ts` or
any `getGoalProgress`/projection function. Its only planning-adjacent
dependency is the `goals` table object, queried directly:
```
import { goals } from "../../../db/schema.ts";
...
db.query.goals.findMany({ where: eq(goals.userId, userId), orderBy: (g, { asc }) => [asc(g.createdAt)] })
```
(`goal-networth.ts:5,94`). It also imports `listAccounts` from
`../../ledger/services/accounts.ts` (`goal-networth.ts:6`) and `getPortfolio`
from its own sibling `./holdings.ts` (`goal-networth.ts:7`). It exports:
```
export interface GoalMeta { id: string; name: string; type: string | null; targetPaise: number | null }
export function groupByGoal(assets: GoalAsset[], goalList: GoalMeta[]): GoalGroup[]
export function liabilitiesGroup(items: GoalAsset[]): GoalGroup | null
export async function netWorthByGoal(db: Db, userId: string): Promise<NetWorthByGoal>
```
This backs `GET /api/net-worth/by-goal` (present in the route-surface
snapshot, §4a) — a route that is **not** in the roadmap's planning route
list (it's registered by the investments module) even though it reads the
`goals` table directly. So there are now two independent "goal" surfaces:
`services/goals.ts`'s progress/projection engine (to become planning) and
`modules/investments/services/goal-networth.ts`'s net-worth grouping
(already investments, reads `goals` table only, no shared function). They
don't call each other, so migrating `services/goals.ts` doesn't break
`goal-networth.ts`'s import graph — only the `goals` Drizzle table export
(re-exported via `db/schema.ts`) needs to keep resolving.

---

## 4. Snapshot / backup / demo gates

### 4a. `route-surface.snapshot.txt` — planning route lines (verbatim)

```
4:DELETE /api/budgets/:period/:key/lines/:categoryId
9:DELETE /api/goals/:id
39:GET /api/bills/upcoming
40:GET /api/budgets/:period/:key
41:GET /api/budgets/monthly/:key/comparison
42:GET /api/budgets/suggestions
50:GET /api/cashflow
51:GET /api/cashflow/export.csv
54:GET /api/dashboard
61:GET /api/goals
62:GET /api/goals/:id/progress
63:GET /api/goals/:id/sips
74:GET /api/insights
83:GET /api/net-worth/by-goal
88:GET /api/projection-settings
90:GET /api/reports
91:GET /api/reports.csv
121:HEAD /api/bills/upcoming
122:HEAD /api/budgets/:period/:key
123:HEAD /api/budgets/monthly/:key/comparison
124:HEAD /api/budgets/suggestions
132:HEAD /api/cashflow
133:HEAD /api/cashflow/export.csv
136:HEAD /api/dashboard
143:HEAD /api/goals
144:HEAD /api/goals/:id/progress
145:HEAD /api/goals/:id/sips
156:HEAD /api/insights
165:HEAD /api/net-worth/by-goal
170:HEAD /api/projection-settings
172:HEAD /api/reports
173:HEAD /api/reports.csv
194:PATCH /api/goals/:id
214:POST /api/budgets/:period/:key/copy-previous
224:POST /api/goals
268:PUT /api/budgets/:period/:key
269:PUT /api/budgets/:period/:key/lines
273:PUT /api/goals/order
281:PUT /api/projection-settings
```

Note: `GET/HEAD /api/goals/:id/sips` and `GET/HEAD /api/net-worth/by-goal`
appear here but are **not** served by `routes/goals.ts` (confirmed by
reading that file in full — it has no `/sips` or `/net-worth` routes) or by
any planning-listed file; they belong to the investments module (SIPs route
+ `goal-networth.ts`). They surface in this grep only because they share the
`goal`/`goals` substring, not because they're planning routes. Treat them as
noise for the planning migration's route-diff, but real entries in the
snapshot that must not move/change.

sha256 checksums:
```
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8  apps/api/src/route-table.snapshot.txt
```

### 4b. `apps/api/src/services/backup.ts` — planning table entries

`ALL_TABLES`, lines 28-41 (planning entries quoted, with their line number in
the array literal):
```
31:  "budgets", "budget_lines", "budget_alerts", "notifications", "recurring_templates",
32:  "goals", "alert_ledger", "subscription_dismissals", "notification_prefs", "projection_settings",
```
(Note `budgets`/`budget_lines`/`budget_alerts`/`goals`/`subscription_dismissals`/`projection_settings`
are all planning tables per the roadmap; `notifications`, `recurring_templates`,
`alert_ledger`, `notification_prefs` on the same lines are NOT planning
tables — they belong to the notifications/ledger domains and are
interleaved in the same array entries.)

`USER_TABLES`, lines 44-59 (planning entries quoted):
```
47:  budgets: "user_id", budget_alerts: "user_id", notifications: "user_id", recurring_templates: "user_id",
48:  goals: "user_id", sips: "user_id", alert_ledger: "user_id", subscription_dismissals: "user_id", notification_prefs: "user_id",
49:  projection_settings: "user_id", user_profiles: "user_id", family_members: "user_id", ai_settings: "user_id",
```
(Again interleaved with non-planning tables — `notifications`, `sips`,
`alert_ledger`, `notification_prefs`, `user_profiles`, `family_members`,
`ai_settings` on the same lines.)

`LINKED_TABLES` (child tables with no `user_id`, scoped via parent), line 66-74:
```
71:  budget_lines: { fk: "budget_id", parent: "budgets" },
```
This confirms the roadmap's claim "`budget_lines` has no `user_id` and
scopes via its parent budget" exactly — cross-checked against the table
definition itself, `db/schema.ts:579-595`, which has no `userId` column,
only `budgetId: uuid("budget_id").notNull().references(() => budgets.id, { onDelete: "cascade" })` (schema.ts:583-585).

`budget_alerts` is listed only in `ALL_TABLES`/`USER_TABLES` (has its own
`user_id`, `backup.ts:47`) — it is not in `LINKED_TABLES`, i.e. it is
scoped directly, not through its parent budget, despite conceptually
belonging to a budget period/category. Not a hazard by itself, just worth
noting for anyone assuming all budget-family tables share one scoping style.

### 4c. `apps/api/src/services/demo.ts` and `apps/api/src/services/restore-user.ts` — planning references

`services/demo.ts` imports table objects directly from `db/schema.ts`
(`demo.ts:6-26`), not from any planning service file:
```
9:  budgetLines,
10:  budgets,
15:  goals,
```
Usage sites (non-comment):
- `demo.ts:163-170` — `.insert(goals)...returning({ id: goals.id })`, then
  `tx.update(accounts).set({ goalId: emergency!.id })...` /
  `tx.update(accounts).set({ goalId: car!.id })...`
- `demo.ts:212-215` — `.insert(budgets)...returning({ id: budgets.id })`
- `demo.ts:216-221` — `tx.insert(budgetLines).values([...])` (5 category rows)

No import of `services/goals.ts`, `services/budgets.ts`,
`services/bills.ts`, `services/cashflow.ts`, `services/insights.ts`,
`services/reports.ts`, or `modules/planning/services/projection-settings.ts`
anywhere in `demo.ts`. Demo seeding is entirely table-object writes.

`apps/api/src/services/restore-user.ts:14` —
```
const MUST_BE_EMPTY = ["accounts", "transactions", "insurance_policies", "goals", "holdings"] as const;
```
`"goals"` is the only planning table referenced in `restore-user.ts`, as a
literal string in this pre-restore guard array — no import of any planning
service or the `goals` table object itself (this is a `string[]`, checked
against table names, not a Drizzle reference). No other planning table
(`budgets`, `budget_lines`, `budget_alerts`, `subscription_dismissals`,
`projection_settings`) appears anywhere else in `restore-user.ts` (grepped,
no other matches).

### 4d. Does `services/goals.ts` exist at the flat path, and is it referenced by `services/demo.ts`?

`apps/api/src/services/goals.ts` exists at the flat path (569+ lines,
confirmed by reading it — exports `listGoals`, `createGoal`, `updateGoal`,
`deleteGoal`, `reorderGoals`, `checkGoalMilestones`, `getGoalProgress`).

**It is NOT imported by `services/demo.ts`.** `demo.ts` imports only the
`goals`/`budgets`/`budgetLines` Drizzle table objects from `db/schema.ts`
(§4c) and writes rows directly with `tx.insert(...)`; it never calls
`listGoals`/`createGoal`/`getGoalProgress` etc. Checked task 1.4's own notes
(`tasks/011-migrate-protection/TASK.md:273-274`,
`tasks/011-migrate-protection/investigation-1.md:277-286`) to see what claim
was actually made there: task 1.4's claim was that `services/demo.ts` and
`services/goals.ts` are two **independent external consumers** of
protection-domain tables (`retirementDetails`, `insurancePolicies`), each
importing those tables directly from `db/schema.ts` rather than from
`services/retirement.ts`/`services/insurance.ts` — not that `demo.ts`
imports `services/goals.ts`. That claim (as actually written in task 1.4's
own files) is accurate and is **not** contradicted by this investigation;
if the current brief's phrasing implied a direct `demo.ts` → `goals.ts`
import, that specific reading is inaccurate — no such import exists.

---

## 5. Scheduled (cron) BullMQ jobs touching planning tables

All schedulers are `upsertJobScheduler` calls inside `startJobs`,
`apps/api/src/jobs/index.ts`. Only one cron directly touches a planning
table/service:

- **`bills.remind`** — scheduler registered `jobs/index.ts:177-181`
  (`{ pattern: "20 0 * * *", tz: LEDGER_DAY_TZ }`, i.e. daily 00:20 UTC),
  handled `jobs/index.ts:254-258`:
  ```
  case "bills.remind": {
    const sent = await evaluateBillReminders(app.db);
    if (sent > 0) app.log.info({ sent }, "bill reminders sent");
    return;
  }
  ```
  `evaluateBillReminders` is `services/bills.ts:53` (planning route "bills").
  Also re-run at boot: `jobs/index.ts:379-381`
  (`await evaluateBillReminders(app.db).catch(...)`).

No dedicated "budget rollover" cron exists — budget evaluation is purely
reactive (debounced off `ledger.mutated`, §1), not scheduled. No dedicated
"subscription detection" cron exists either —
`suggestSubscriptions(db, userId)` (`services/bills.ts:91`) is on-demand
(called from a route, not from `jobs/index.ts`); grepped `jobs/index.ts` for
`suggestSubscriptions`/`subscription` — no match.

**Adjacent, not-directly-planning cron worth flagging:**
- **`autopilot.goals`** — scheduler `jobs/index.ts:224-228`
  (`{ pattern: "0 6 * * 1", tz: LEDGER_DAY_TZ }`, Mondays 06:00), handled
  `jobs/index.ts:325-335`, calls `runGoalReview(app.db)` from
  `services/autopilot.ts` (not a planning file). `runGoalReview` internally
  calls `getGoalProgress`/`listGoals` (§3), so this cron is a live, scheduled
  external consumer of the goal-progress interface, distinct from the
  `/api/goals/:id/progress` route consumer.
- **`cards.remind`** — `jobs/index.ts:183-187`, `jobs/index.ts:259-277` —
  calls `evaluateCardDueReminders`/`materializeCardDueTasks` from
  `modules/credit/services/`, which themselves import `createNotification`
  from `services/notifications.ts` and `currentPeriodKey` from
  `services/periods.ts` (§1) — not planning tables, but the same two files
  the budget-eval hazard depends on.

---

## 6. Web consumers — any planning API path built outside the route-surface snapshot?

**No.** Checked every `apps/web/src` call site referencing
`/api/budgets`, `/api/goals`, `/api/cashflow`, `/api/bills`,
`/api/projection-settings`, `/api/dashboard`, `/api/insights`,
`/api/reports`, `/api/net-worth/by-goal`:

- `apps/web/src/lib/budget-queries.ts:36,43,51,64,69,74,78,89`
- `apps/web/src/lib/wealth-queries.ts:167`
- `apps/web/src/lib/insights-queries.ts:8`
- `apps/web/src/routes/cashflow/CashFlowPage.tsx:32`
- `apps/web/src/lib/settings-queries.ts:65,73`
- `apps/web/src/lib/goal-queries.ts:39,45,57,62,66,71,103,221,234`
- `apps/web/src/routes/reports/ReportsPage.tsx:16,112`

Every dynamic segment (e.g. `` `/api/budgets/${period}/${key}` ``,
`` `/api/budgets/monthly/${key}/comparison` ``,
`` `/api/goals/${id}/progress` ``, `` `/api/goals/${goalId}/sips` ``,
`` `/api/cashflow?months=${months}` ``,
`` `/api/bills/upcoming?days=${days}` ``,
`` `/api/reports?${queryString}` ``) matches a path template already present
in the route-surface snapshot (§4a) — no dynamically-built path falls
outside the snapshotted surface.

---

## Summary of roadmap-accuracy findings

- **§1** — the *mechanics* (debounce, worker, notification-pref gate) are
  described accurately, but the roadmap's "this module owns the
  budget-evaluation subscriber" framing is misleading: the evaluation
  function and its notification-pref gate physically live in
  `services/notifications.ts`/`services/prefs.ts`, files that are not on the
  roadmap's own planning route list. This is a real migration decision point
  the roadmap doesn't surface, not merely a citation gap.
- **§2** — accurate, and additionally confirmed exhaustive: dashboard/trends
  cache invalidation is scattered into `modules/credit/routes/emis.ts` and
  `modules/investments/routes/sips.ts`, exactly the hazard the brief
  anticipated.
- **§3** — "consumed later by 6.4" is forward-looking and unverifiable now
  (6.4 doesn't exist yet), but there is already a real *current* external
  consumer (`services/autopilot.ts`) that the roadmap doesn't mention, and no
  documented interface boundary exists yet — it's a plain function export.
  `goal-networth.ts` does not consume `getGoalProgress`/`services/goals.ts`
  at all (only the `goals` table), contrary to what a reader might assume
  from the brief's phrasing "specifically" flagging that file.
- **§4d** — no inaccuracy found once cross-checked against what task 1.4's
  files actually claimed (independent external consumers of protection
  tables, not a `demo.ts` → `goals.ts` import).
- **§5** — no "budget rollover" or "subscription detection" cron exists;
  only `bills.remind` is a planning-table-touching scheduled job. The
  roadmap brief's example list ("budget rollover, bill reminders,
  subscription detection") over-lists relative to what's actually
  implemented — worth flagging so the migration doesn't go looking for
  nonexistent jobs.
- **§6** — no discrepancy; all web call sites match the snapshot.
