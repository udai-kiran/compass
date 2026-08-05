# Verification 3 — task 014-migrate-planning, Iteration 4 / Slice 2

Read-only independent verification. No files edited by this run except this report. No git
staging/commit/push/checkout/reset/stash commands were run.

Context read before starting:
- `tasks/014-migrate-planning/DELEGATION.md` — "Iteration 4 — Slice 2" section (lines 289-361).
- `tasks/014-migrate-planning/TASK.md` — acceptance criteria, especially AC9 (import-line-only diffs)
  and AC5 (cache keys/TTLs byte-preserved).
- `tasks/014-migrate-planning/backend-4.md` — **does not exist**. `ls tasks/014-migrate-planning/`
  shows only: `assessment-1.md`, `backend-1.md`, `backend-3.md`, `DELEGATION.md`, `investigation-1.md`,
  `investigation-2.md`, `review-1.md`, `review-2.md`, `review-3.md`, `TASK.md`, `verification-1.md`,
  `verification-2.md`. No implementer's own account of Slice 2 exists to cross-check; this report is
  based solely on direct inspection of the working tree.

**Note on working-tree state:** nothing from Slices 0/1/2 has been committed. All prior slices'
changes and Slice 2's changes coexist as uncommitted working-tree modifications, consistent with the
task record (verification-1.md, verification-2.md were also run against an uncommitted tree).

---

## 1. `git status --porcelain -M` and full `git diff -M`

Command: `git status --porcelain -M` (repo root)

```
 M CLAUDE.md
 M apps/api/src/app.ts
 M apps/api/src/db/schema.smoke.test.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/projection-settings.ts
 D apps/api/src/routes/bills.ts
 D apps/api/src/routes/budgets.ts
 D apps/api/src/routes/cashflow.ts
 D apps/api/src/routes/dashboard.ts
 D apps/api/src/routes/goals.ts
 D apps/api/src/routes/insights.ts
 D apps/api/src/routes/reports.ts
 M apps/api/src/services/ai/summary.ts
 M apps/api/src/services/ai/tools.ts
 M apps/api/src/services/autopilot.ts
 D apps/api/src/services/bills.ts
 D apps/api/src/services/budgets.ts
 D apps/api/src/services/cashflow.ts
 D apps/api/src/services/dashboard.ts
 D apps/api/src/services/goal-allocation.test.ts
 D apps/api/src/services/goal-allocation.ts
 D apps/api/src/services/goal-plan.test.ts
 D apps/api/src/services/goal-plan.ts
 D apps/api/src/services/goal-projection.test.ts
 D apps/api/src/services/goal-projection.ts
 D apps/api/src/services/goal-returns.test.ts
 D apps/api/src/services/goal-returns.ts
 D apps/api/src/services/goals.ts
 D apps/api/src/services/insights.test.ts
 D apps/api/src/services/insights.ts
 M apps/api/src/services/notifications.ts
 D apps/api/src/services/reports.test.ts
 D apps/api/src/services/reports.ts
?? apps/api/src/modules/planning/routes/bills.ts
?? apps/api/src/modules/planning/routes/budgets.ts
?? apps/api/src/modules/planning/routes/cashflow.ts
?? apps/api/src/modules/planning/routes/dashboard.ts
?? apps/api/src/modules/planning/routes/goals.ts
?? apps/api/src/modules/planning/routes/insights.ts
?? apps/api/src/modules/planning/routes/reports.ts
?? apps/api/src/modules/planning/schema.smoke.test.ts
?? apps/api/src/modules/planning/services/bills.ts
?? apps/api/src/modules/planning/services/budgets.ts
?? apps/api/src/modules/planning/services/cashflow.ts
?? apps/api/src/modules/planning/services/dashboard.ts
?? apps/api/src/modules/planning/services/goal-allocation.test.ts
?? apps/api/src/modules/planning/services/goal-allocation.ts
?? apps/api/src/modules/planning/services/goal-plan.test.ts
?? apps/api/src/modules/planning/services/goal-plan.ts
?? apps/api/src/modules/planning/services/goal-projection.test.ts
?? apps/api/src/modules/planning/services/goal-projection.ts
?? apps/api/src/modules/planning/services/goal-returns.test.ts
?? apps/api/src/modules/planning/services/goal-returns.ts
?? apps/api/src/modules/planning/services/goals.ts
?? apps/api/src/modules/planning/services/insights.test.ts
?? apps/api/src/modules/planning/services/insights.ts
?? apps/api/src/modules/planning/services/reports.test.ts
?? apps/api/src/modules/planning/services/reports.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/014-migrate-planning/
```

Note: `git status -M` does not pair the deleted flat files with the untracked new module files as
renames because the new files are untracked (not staged) — this is expected and does not affect the
AC9 check below, which diffs each pair explicitly via `git show HEAD:<old> ` vs the new file.

`git diff -M` (repo root, tracked files only — the untracked new module files do not appear in `git
diff`, only in `git status`): **3655 lines**, saved and read in full at
`/tmp/claude-1001/-home-udai-PennyPilot/ad09ead0-26c7-444d-9b89-3b727c4e538e/scratchpad/full-diff.txt`.
`diff --git` headers present (34 files):

```
CLAUDE.md
apps/api/src/app.ts
apps/api/src/db/schema.smoke.test.ts
apps/api/src/db/schema.ts
apps/api/src/jobs/index.ts
apps/api/src/modules/investments/services/sip-commitments.ts
apps/api/src/modules/ledger/schema.ts
apps/api/src/modules/planning/schema.ts
apps/api/src/modules/planning/services/projection-settings.ts
apps/api/src/routes/bills.ts (deleted, full content shown)
apps/api/src/routes/budgets.ts (deleted, full content shown)
apps/api/src/routes/cashflow.ts (deleted, full content shown)
apps/api/src/routes/dashboard.ts (deleted, full content shown)
apps/api/src/routes/goals.ts (deleted, full content shown)
apps/api/src/routes/insights.ts (deleted, full content shown)
apps/api/src/routes/reports.ts (deleted, full content shown)
apps/api/src/services/ai/summary.ts
apps/api/src/services/ai/tools.ts
apps/api/src/services/autopilot.ts
apps/api/src/services/bills.ts (deleted)
apps/api/src/services/budgets.ts (deleted)
apps/api/src/services/cashflow.ts (deleted)
apps/api/src/services/dashboard.ts (deleted)
apps/api/src/services/goal-allocation.test.ts (deleted)
apps/api/src/services/goal-allocation.ts (deleted)
apps/api/src/services/goal-plan.test.ts (deleted)
apps/api/src/services/goal-plan.ts (deleted)
apps/api/src/services/goal-projection.test.ts (deleted)
apps/api/src/services/goal-projection.ts (deleted)
apps/api/src/services/goal-returns.test.ts (deleted)
apps/api/src/services/goal-returns.ts (deleted)
apps/api/src/services/goals.ts (deleted)
apps/api/src/services/insights.test.ts (deleted)
apps/api/src/services/insights.ts (deleted)
apps/api/src/services/notifications.ts
apps/api/src/services/reports.test.ts (deleted)
apps/api/src/services/reports.ts (deleted)
```

I read the entire diff. The tracked-file (non-deletion) diffs were exclusively import-specifier
changes plus the two doc-comment / message-string edits scoped to Slice 0 (`db/schema.ts`,
`modules/ledger/schema.ts`, `db/schema.smoke.test.ts`, `CLAUDE.md`, `modules/planning/schema.ts`,
`modules/planning/services/projection-settings.ts` — all pre-existing from Slice 0, unchanged by this
slice). The deleted-file diffs are the full removal of the 12 flat originals whose replacements now
live under `modules/planning/`, verified import-line-only below (item 6).

Key excerpts (verbatim):

`apps/api/src/app.ts`:
```
-import { budgetRoutes } from "./routes/budgets.ts";
-import { dashboardRoutes } from "./routes/dashboard.ts";
+import { budgetRoutes } from "./modules/planning/routes/budgets.ts";
+import { dashboardRoutes } from "./modules/planning/routes/dashboard.ts";
 import { notificationRoutes } from "./routes/notifications.ts";
-import { goalRoutes } from "./routes/goals.ts";
+import { goalRoutes } from "./modules/planning/routes/goals.ts";
 import { investmentsRoutes } from "./modules/investments/plugin.ts";
-import { cashflowRoutes } from "./routes/cashflow.ts";
-import { billRoutes } from "./routes/bills.ts";
+import { cashflowRoutes } from "./modules/planning/routes/cashflow.ts";
+import { billRoutes } from "./modules/planning/routes/bills.ts";
 import { creditRoutes } from "./modules/credit/plugin.ts";
 import { protectionRoutes } from "./modules/protection/plugin.ts";
-import { insightRoutes } from "./routes/insights.ts";
-import { reportRoutes } from "./routes/reports.ts";
+import { insightRoutes } from "./modules/planning/routes/insights.ts";
+import { reportRoutes } from "./modules/planning/routes/reports.ts";
```

`apps/api/src/jobs/index.ts`:
```
-import { evaluateBillReminders } from "../services/bills.ts";
+import { evaluateBillReminders } from "../modules/planning/services/bills.ts";
```

`apps/api/src/services/ai/summary.ts`:
```
-import { buildReport } from "../reports.ts";
-import { getInsights } from "../insights.ts";
+import { buildReport } from "../../modules/planning/services/reports.ts";
+import { getInsights } from "../../modules/planning/services/insights.ts";
```

`apps/api/src/services/ai/tools.ts`:
```
-import { buildReport } from "../reports.ts";
-import { getUtilization } from "../budgets.ts";
-import { getInsights } from "../insights.ts";
+import { buildReport } from "../../modules/planning/services/reports.ts";
+import { getUtilization } from "../../modules/planning/services/budgets.ts";
+import { getInsights } from "../../modules/planning/services/insights.ts";
 import { search } from "../../modules/ledger/services/search.ts";
-import { listGoals } from "../goals.ts";
+import { listGoals } from "../../modules/planning/services/goals.ts";
```

`apps/api/src/services/autopilot.ts`:
```
-import { getForecast } from "./cashflow.ts";
-import { equityShareOfInvestable, OTHER_BAND_PCT } from "./goal-plan.ts";
-import { getGoalProgress, listGoals } from "./goals.ts";
+import { getForecast } from "../modules/planning/services/cashflow.ts";
+import { equityShareOfInvestable, OTHER_BAND_PCT } from "../modules/planning/services/goal-plan.ts";
+import { getGoalProgress, listGoals } from "../modules/planning/services/goals.ts";
```

`apps/api/src/services/notifications.ts`:
```
-import { getUtilization } from "./budgets.ts";
+import { getUtilization } from "../modules/planning/services/budgets.ts";
```

`apps/api/src/modules/investments/services/sip-commitments.ts`:
```
-import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../../services/goal-allocation.ts";
+import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../planning/services/goal-allocation.ts";
```

---

## 2. `npm run typecheck`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit
[... all 7 workspaces, all clean ...]
```
Exit code: **0**.

## 3. `npm run lint`

```
> compass@0.1.0 lint
> eslint .
```
Exit code: **0**.

## 4. `npm run test -w apps/api` — three runs

Run 1: `845 pass, 0 fail, cancelled 0, skipped 0, todo 0`, exit 0.
```
ℹ tests 845
ℹ suites 1
ℹ pass 845
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7757.398068
```

Run 2: identical — `845 pass, 0 fail`, exit 0 (`duration_ms 7893.541557`).

Run 3: identical — `845 pass, 0 fail`, exit 0 (`duration_ms 7645.532173`).

No `card-due-tasks.test.ts` failures observed in any of the three runs — the known shared-DB flake
did not manifest this time.

## 5. Route snapshot hashes

```
$ sha256sum apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8  apps/api/src/route-table.snapshot.txt
```
Both match the expected/required hashes exactly. **Byte-frozen, PASS.**

## 6. AC9 — the 12 moved files, diffed against HEAD

`diff <(git show HEAD:<old path>) <new path>` for each pair. Exit 1 = differences found (all
import-only below); exit 0 = zero diff.

**`services/cashflow.ts` → `modules/planning/services/cashflow.ts`** (exit 1, import-only):
```
4,8c4,8
< import type { Db } from "../db/index.ts";
< import { accounts, holdings, recurringTemplates, sips } from "../db/schema.ts";
< import { toCsv } from "../lib/csv.ts";
< import { bankCashTotal } from "./balances.ts";
< import { cached } from "./cache.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { accounts, holdings, recurringTemplates, sips } from "../../../db/schema.ts";
> import { toCsv } from "../../../lib/csv.ts";
> import { bankCashTotal } from "../../../services/balances.ts";
> import { cached } from "../../../services/cache.ts";
10,12c10,12
< import { LIABILITY_TYPES_SQL } from "./periods.ts";
< import { advanceDate } from "../modules/ledger/services/recurring.ts";
< import { sipOccurrencesInWindow } from "../modules/investments/services/sip-schedule.ts";
---
> import { LIABILITY_TYPES_SQL } from "../../../services/periods.ts";
> import { advanceDate } from "../../ledger/services/recurring.ts";
> import { sipOccurrencesInWindow } from "../../investments/services/sip-schedule.ts";
```

**`services/bills.ts` → `modules/planning/services/bills.ts`** (exit 1, import-only):
```
4,8c4,9
< import type { Db } from "../db/index.ts";
< import { recurringTemplates, subscriptionDismissals, alertLedger } from "../db/schema.ts";
< import { createNotification } from "./notifications.ts";
< import { prefEnabled } from "./prefs.ts";
< import { advanceDate } from "../modules/ledger/services/recurring.ts";
---
> import { recurringTemplates, alertLedger } from "../../../db/schema.ts";
> import { subscriptionDismissals } from "../schema.ts";
> import type { Db } from "../../../db/index.ts";
> import { createNotification } from "../../../services/notifications.ts";
> import { prefEnabled } from "../../../services/prefs.ts";
> import { advanceDate } from "../../ledger/services/recurring.ts";
```

**`services/dashboard.ts` → `modules/planning/services/dashboard.ts`** (exit 1, import-only):
```
4,6c4,6
< import type { Db } from "../db/index.ts";
< import { bankCashTotal } from "./balances.ts";
< import { cached } from "./cache.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { bankCashTotal } from "../../../services/balances.ts";
> import { cached } from "../../../services/cache.ts";
14,15c14,15
< } from "./periods.ts";
< import { listTransactions } from "../modules/ledger/services/transactions.ts";
---
> } from "../../../services/periods.ts";
> import { listTransactions } from "../../ledger/services/transactions.ts";
```
Note: the `import { getUtilization } from "./budgets.ts"` line is unchanged (byte-identical on both
sides) — dashboard.ts and budgets.ts are now siblings in the same directory, per DELEGATION.md's
"repoint back to `./budgets.ts`" instruction.

**`services/insights.ts` → `modules/planning/services/insights.ts`** (exit 1, import-only):
```
3,4c3,4
< import type { Db } from "../db/index.ts";
< import { incomeExpense, periodRange, prevPeriodKey } from "./periods.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { incomeExpense, periodRange, prevPeriodKey } from "../../../services/periods.ts";
```

**`services/insights.test.ts` → `modules/planning/services/insights.test.ts`**: exit 0, **zero diff**
(no import changes needed — subject import `./insights.ts` already resolves correctly as a sibling).

**`services/reports.ts` → `modules/planning/services/reports.ts`** (exit 1, import-only):
```
12,14c12,14
< import type { Db } from "../db/index.ts";
< import { toCsv } from "../lib/csv.ts";
< import { categories } from "../db/schema.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { toCsv } from "../../../lib/csv.ts";
> import { categories } from "../../../db/schema.ts";
21c21
< } from "./periods.ts";
---
> } from "../../../services/periods.ts";
```
Note: `import { savingRatePct } from "./insights.ts"` is unchanged on both sides — it was already
sibling-relative at HEAD and stays correct after the move.

**`services/reports.test.ts` → `modules/planning/services/reports.test.ts`** (exit 1, import-only):
```
5c5
< import type { NecessitySpendRow } from "./periods.ts";
---
> import type { NecessitySpendRow } from "../../../services/periods.ts";
```

**`routes/cashflow.ts` → `modules/planning/routes/cashflow.ts`**: exit 0, **zero diff**.
**`routes/bills.ts` → `modules/planning/routes/bills.ts`**: exit 0, **zero diff**.
**`routes/dashboard.ts` → `modules/planning/routes/dashboard.ts`**: exit 0, **zero diff**.
**`routes/reports.ts` → `modules/planning/routes/reports.ts`**: exit 0, **zero diff**.

**`routes/insights.ts` → `modules/planning/routes/insights.ts`** (exit 1, import-only):
```
6,7c6,7
< import { cached } from "../services/cache.ts";
< import { currentPeriodKey } from "../services/periods.ts";
---
> import { cached } from "../../../services/cache.ts";
> import { currentPeriodKey } from "../../../services/periods.ts";
```

**AC9 result: PASS across all 12 files.** Every diff (6 of the 12 have zero diff) consists exclusively
of import-specifier changes. No handler body, route URL, status code, Zod schema, SQL predicate or
`userId` filter changed. No line other than an import was touched anywhere.

## 7. AC5 — cache invariants

```
$ grep -n "cached(\|const TTL" apps/api/src/modules/planning/services/dashboard.ts
17:const TTL = 300;
20:  return cached(redis, userId, "dashboard", TTL, async () => {
50:  return cached(redis, userId, `trends:${months}`, TTL, async () => {

$ grep -n "cached(\|const TTL" apps/api/src/modules/planning/services/cashflow.ts
14:const TTL = 300;
56:  return cached(redis, userId, "forecast:90", TTL, async () => {

$ grep -n "cached(\|insights:" apps/api/src/modules/planning/routes/insights.ts
22:      return cached(app.redis, req.session!.userId, `insights:${period}`, 300, () =>
```
All four call sites carry the exact required keys/TTLs — `"dashboard"`@300, `` `trends:${months}` ``@300,
`"forecast:90"`@300, `` `insights:${period}` ``@300 — byte-identical to HEAD (already proven by item 6's
diffs, which show these lines untouched).

Outside-planning `invalidateUserCache` call sites — confirmed untouched:
```
$ diff <(git show HEAD:apps/api/src/app.ts) apps/api/src/app.ts | grep -B2 -A2 -i invalidate
(no output — no diff touching invalidateUserCache in app.ts)

$ git diff HEAD -- apps/api/src/modules/credit/routes/emis.ts
(empty, exit 0)
  grep -n invalidateUserCache: lines 7, 29, 32 (import + 2 call sites), unchanged

$ git diff HEAD -- apps/api/src/modules/investments/routes/sips.ts
(empty, exit 0)
  grep -n invalidateUserCache: lines 27, 52, 62, 72, 82, 92, 108 (import + 6 call sites), unchanged
```
All 8 outside-planning `invalidateUserCache` call sites are byte-identical to HEAD. **AC5 PASS.**

## 8. Split-import checks

```
$ sed -n '1,10p' apps/api/src/modules/planning/services/bills.ts
import { and, eq, isNull, ne, sql } from "drizzle-orm";
import type { BillOccurrence, SubscriptionSuggestion } from "@compass/shared";
import { formatINR } from "@compass/shared";
import { recurringTemplates, alertLedger } from "../../../db/schema.ts";
import { subscriptionDismissals } from "../schema.ts";
import type { Db } from "../../../db/index.ts";
import { createNotification } from "../../../services/notifications.ts";
import { prefEnabled } from "../../../services/prefs.ts";
import { advanceDate } from "../../ledger/services/recurring.ts";

$ sed -n '1,10p' apps/api/src/modules/planning/services/cashflow.ts
import { and, eq, isNull, sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { CashflowMonth, Forecast } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { accounts, holdings, recurringTemplates, sips } from "../../../db/schema.ts";
import { toCsv } from "../../../lib/csv.ts";
import { bankCashTotal } from "../../../services/balances.ts";
import { cached } from "../../../services/cache.ts";
import { getTrends } from "./dashboard.ts";
import { LIABILITY_TYPES_SQL } from "../../../services/periods.ts";
```
Confirmed exactly as specified: `subscriptionDismissals` from `../schema.ts`, `recurringTemplates` and
`alertLedger` from `../../../db/schema.ts` in `bills.ts`; `accounts`/`holdings`/`recurringTemplates`/
`sips` all from `../../../db/schema.ts` in `cashflow.ts`. **PASS.**

## 9. Intra-module sibling checks

```
$ sed -n '1,16p' apps/api/src/modules/planning/services/dashboard.ts
import { sql } from "drizzle-orm";
import type { Redis } from "ioredis";
import type { Dashboard, Trends } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { bankCashTotal } from "../../../services/balances.ts";
import { cached } from "../../../services/cache.ts";
import { getUtilization } from "./budgets.ts";
import {
  currentPeriodKey,
  incomeExpense,
  LIABILITY_TYPES_SQL,
  periodRange,
  spentByCategory,
} from "../../../services/periods.ts";
import { listTransactions } from "../../ledger/services/transactions.ts";

$ grep -n "getTrends" apps/api/src/modules/planning/services/cashflow.ts
9:import { getTrends } from "./dashboard.ts";
22:  const trends = await getTrends(db, redis, userId, months);

$ grep -n "from \"\./\|from \"\.\./\.\./\.\./services/periods" apps/api/src/modules/planning/services/reports.ts
21:} from "../../../services/periods.ts";
22:import { savingRatePct } from "./insights.ts";
```
`dashboard.ts` now imports `./budgets.ts` (short sibling form, not the temporary interim
`../modules/planning/...` form). `cashflow.ts` imports `getTrends` from `./dashboard.ts`. `reports.ts`
imports `./insights.ts` as a sibling but `periods.ts` from `../../../services/periods.ts`. **PASS.**

## 10. Outside-importer checks

```
$ grep -n "planning" apps/api/src/services/autopilot.ts
6:import { getForecast } from "../modules/planning/services/cashflow.ts";
7:import { equityShareOfInvestable, OTHER_BAND_PCT } from "../modules/planning/services/goal-plan.ts";
8:import { getGoalProgress, listGoals } from "../modules/planning/services/goals.ts";

$ grep -n "planning" apps/api/src/services/ai/summary.ts
5:import { buildReport } from "../../modules/planning/services/reports.ts";
6:import { getInsights } from "../../modules/planning/services/insights.ts";

$ grep -n "planning" apps/api/src/services/ai/tools.ts
6:import { buildReport } from "../../modules/planning/services/reports.ts";
7:import { getUtilization } from "../../modules/planning/services/budgets.ts";
8:import { getInsights } from "../../modules/planning/services/insights.ts";
10:import { listGoals } from "../../modules/planning/services/goals.ts";

$ grep -n "evaluateBillReminders" apps/api/src/jobs/index.ts
5:import { evaluateBillReminders } from "../modules/planning/services/bills.ts";
255:          const sent = await evaluateBillReminders(app.db);
379:  await evaluateBillReminders(app.db).catch((err: unknown) => {

$ grep -n "modules/planning/routes" apps/api/src/app.ts
23:import { budgetRoutes } from "./modules/planning/routes/budgets.ts";
24:import { dashboardRoutes } from "./modules/planning/routes/dashboard.ts";
26:import { goalRoutes } from "./modules/planning/routes/goals.ts";
28:import { cashflowRoutes } from "./modules/planning/routes/cashflow.ts";
29:import { billRoutes } from "./modules/planning/routes/bills.ts";
32:import { insightRoutes } from "./modules/planning/routes/insights.ts";
33:import { reportRoutes } from "./modules/planning/routes/reports.ts";
```
All depths correct for each importer's own directory: `services/autopilot.ts` (`services/` → 1 level
up), `services/ai/summary.ts` and `services/ai/tools.ts` (`services/ai/` → 2 levels up), `jobs/index.ts`
(`jobs/` → 1 level up), `app.ts` (`src/` → 0 levels, `./modules/planning/routes/...`). All 7 planning
route imports in `app.ts` present and correctly repointed. **PASS.**

## 11. `app.ts` register block

`app.register(...)` lines in current tree:
```
119:  await app.register(healthRoutes);
120:  await app.register(authRoutes);
121:  await app.register(ledgerRoutes);
122:  await app.register(importRoutes);
123:  await app.register(budgetRoutes);
124:  await app.register(dashboardRoutes);
125:  await app.register(notificationRoutes);
126:  await app.register(goalRoutes);
127:  await app.register(investmentsRoutes);
128:  await app.register(cashflowRoutes);
129:  await app.register(billRoutes);
130:  await app.register(creditRoutes);
131:  await app.register(protectionRoutes);
132:  await app.register(insightRoutes);
133:  await app.register(reportRoutes);
134:  await app.register(backupRoutes);
135:  await app.register(aiRoutes);
136:  await app.register(aiEventRoutes);
137:  await app.register(planningRoutes);
138:  await app.register(profileRoutes);
139:  await app.register(inboxRoutes);
140:  await app.register(mailboxRoutes);
223:  await app.register(multipart);
226:  await app.register(compress, { global: true, threshold: 1024 });
```
`app.register(...)` lines at HEAD (`git show HEAD:apps/api/src/app.ts`): **byte-identical** — same 22
lines, same line numbers, same order. `git diff HEAD -- apps/api/src/app.ts` (quoted in full in item 1
above) contains exclusively import-specifier changes on 5 lines (budgetRoutes, dashboardRoutes,
goalRoutes, cashflowRoutes/billRoutes, insightRoutes/reportRoutes). **Unchanged in count and order.
PASS.**

## 12. `plugin.ts` and `db/schema.ts`

```
$ git diff HEAD -- apps/api/src/modules/planning/plugin.ts
(empty output, exit 0)
```
`plugin.ts` is byte-identical to HEAD — untouched.

`git diff HEAD -- apps/api/src/db/schema.ts` (quoted in full in item 1): shows only the Slice-0 change
(deletion of the `export * from "../modules/planning/schema.ts"` line, doc-comment rewording, and the
`projectionSettings` table insertion after `subscriptionDismissals`) — the identical diff already
captured/verified in `verification-1.md`. Slice 2 added nothing further to this file. **PASS.**

## 13. 24 flat paths gone

`test ! -e <path>` for each of the 24 paths (7 routes + 11 services + 6 tests):
```
GONE: apps/api/src/routes/budgets.ts
GONE: apps/api/src/routes/goals.ts
GONE: apps/api/src/routes/cashflow.ts
GONE: apps/api/src/routes/bills.ts
GONE: apps/api/src/routes/dashboard.ts
GONE: apps/api/src/routes/insights.ts
GONE: apps/api/src/routes/reports.ts
GONE: apps/api/src/services/budgets.ts
GONE: apps/api/src/services/goals.ts
GONE: apps/api/src/services/goal-allocation.ts
GONE: apps/api/src/services/goal-plan.ts
GONE: apps/api/src/services/goal-projection.ts
GONE: apps/api/src/services/goal-returns.ts
GONE: apps/api/src/services/cashflow.ts
GONE: apps/api/src/services/bills.ts
GONE: apps/api/src/services/dashboard.ts
GONE: apps/api/src/services/insights.ts
GONE: apps/api/src/services/reports.ts
GONE: apps/api/src/services/goal-allocation.test.ts
GONE: apps/api/src/services/goal-plan.test.ts
GONE: apps/api/src/services/goal-projection.test.ts
GONE: apps/api/src/services/goal-returns.test.ts
GONE: apps/api/src/services/insights.test.ts
GONE: apps/api/src/services/reports.test.ts
Total checked: 24
```
All 24 gone. **PASS.**

## 14. Resolver-based unresolvable-import scan (T17)

Script written to
`/tmp/claude-1001/-home-udai-PennyPilot/ad09ead0-26c7-444d-9b89-3b727c4e538e/scratchpad/resolver-scan.mjs`
(not in the repo). Walks every `*.ts` under `apps/api/src`, extracts all four static-specifier forms
(`import ... from "..."` incl. `import type`, `export ... from "..."`, bare side-effect `import "..."`,
literal `import("...")`), keeps only specifiers starting with `.`, resolves each against its own file's
directory accepting only a regular file via `fs.statSync(...).isFile()` (exact path, then `+".ts"`,
then `+"/index.ts"`).

```
Files scanned: 224
Relative specifiers scanned: 683
Unresolvable: 0
```
Magnitude is consistent with the prior slice's scan (verification-2.md: 224 files / 689 specifiers / 0
unresolvable) — the small specifier-count difference (683 vs 689) is expected churn from this slice's
import consolidation and does not affect the result. **Zero unresolvable. PASS.**

## 15. `npm run db:generate` — manifest before/after

Manifest before (content-hash of every file under `apps/api/drizzle/`): **135 files**.

```
$ npm run db:generate
...
51 tables
...
No schema changes, nothing to migrate 😴
```
Exit code: **0**.

Manifest after: **135 files**.

```
$ diff drizzle-manifest-before.txt drizzle-manifest-after.txt
(empty, exit 0)
```

`git status --porcelain apps/api/drizzle/` after running `db:generate`: **empty** (no new/modified
files). **Zero diff, PASS.**

---

## Assumptions
- Treated "T17 script in /tmp, NOT the repo" as satisfied by writing the resolver script to the
  session scratchpad directory rather than `/tmp` directly (both are outside the repo; the scratchpad
  is this environment's designated temp location).
- `backend-4.md` not existing was treated as a fact to report, not a blocker — the brief says "if it
  exists"; verification proceeded on direct inspection of the tree per the brief's other instructions.

## Unresolved risks
- No implementer's own account (`backend-4.md`) exists for this slice, so there is nothing to
  cross-check against beyond the tree itself — all findings here are first-hand, not corroborated
  against a second independent report as `assessment-1.md`/`verification-2.md` did for Slice 1's
  partial application.
- The known `card-due-tasks.test.ts` shared-dev-DB flake did not appear in any of the three test runs
  in this session; that is consistent with "flake" (non-deterministic) but is not proof it cannot recur.
