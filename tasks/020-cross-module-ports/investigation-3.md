# SP3 Investigation — flat services/ and repositories/users.ts

Date: 2026-08-05  
Scope: `apps/api/src/services/{cache,balances,ownership,periods,autopilot,anomaly}.ts`
       + `apps/api/src/repositories/users.ts`

---

## Barrel / index check (question 6)

**No `services/index.ts` exists.** Every import across the repo names an individual file
(`services/cache.ts`, `services/balances.ts`, etc.). There is also no `repositories/index.ts`.
SP3 can therefore delete both folders without needing to update a barrel re-export.

---

## App.ts / jobs / plugins wiring (question 7)

### `apps/api/src/app.ts`
```
app.ts:27  import { invalidateUserCache } from "./services/cache.ts";
```
`invalidateUserCache` is called inside `registerLedgerCacheSubscriber` (the
`ledger.mutated` EventBus subscriber). This is the **only** app.ts reference to any
of the 7 files.

### `apps/api/src/jobs/index.ts`
```
jobs/index.ts:8   import { evaluateAnomalies }               from "../services/anomaly.ts";
jobs/index.ts:9   import { runAutopilotReview, runGoalReview } from "../services/autopilot.ts";
```
Both are called inside BullMQ worker handlers (`alertsWorker` and `systemWorker`
`autopilot.review`/`autopilot.goals` cases).

### `apps/api/src/plugins/` (auth.ts, security.ts)
No references to any of the 7 files.

---

## File-by-file analysis

---

### 1. `services/cache.ts`

**Purpose:** Version-stamped per-user Redis cache — write-through invalidation by
bumping a per-user version key; old cache keys age out by TTL. No domain logic.

**Exports:** `cached<T>`, `invalidateUserCache`

**Imports (file:line):**
```
cache.ts:1  import type { Redis } from "ioredis";
```
No module/, db/, or @compass/shared imports. Pure Redis utility.

**Importers (all files):**

| File | Line | Context |
|------|------|---------|
| `apps/api/src/app.ts` | 27 | infra wiring — `invalidateUserCache` inside `registerLedgerCacheSubscriber` |
| `modules/planning/routes/insights.ts` | 6 | planning module — `cached` |
| `modules/planning/routes/budgets.ts` | 23 | planning module — `invalidateUserCache` |
| `modules/planning/services/dashboard.ts` | 6 | planning module — `cached` |
| `modules/planning/services/cashflow.ts` | 8 | planning module — `cached` |
| `modules/credit/routes/emis.ts` | 7 | credit module — `invalidateUserCache` |
| `modules/investments/routes/sips.ts` | 27 | investments module — `invalidateUserCache` |

Importers span **4 locations**: app.ts (infra), planning (4), credit (1), investments (1).

**Best owner:** `lib/cache.ts` — it has zero domain knowledge (no schema, no
@compass/shared types), is a pure Redis utility, and is already used by 3 different
modules. Placing it in any one module would force the others to import across a
module boundary.

**Risks:**
- app.ts calls it directly. After the move, app.ts's import path changes to
  `"./lib/cache.ts"` — a trivial update, but SP3 must not miss it.
- 3 modules each update their `../../../` relative path to `lib/cache.ts`.

---

### 2. `services/balances.ts`

**Purpose:** Posted bank+cash balance per account (or totaled) as of a given date.
Queries the `accounts` and `transactions` tables via raw SQL. No module imports.

**Exports:** `AccountBalance` (interface), `bankCashBalances`, `bankCashTotal`

**Imports (file:line):**
```
balances.ts:1  import { sql } from "drizzle-orm";
balances.ts:2  import type { Db } from "../db/index.ts";
```
No module/, schema.ts, or @compass/shared imports. Raw SQL against `accounts`/`transactions`
(not via Drizzle query builder, so no schema.ts import needed).

**Importers (all files):**

| File | Line | Context |
|------|------|---------|
| `modules/system/services/prefs.ts` | 6 | system module — `bankCashBalances` (low-balance alert) |
| `modules/ledger/services/epf-contributions.test.ts` | 12 | ledger module (test) — `bankCashBalances` |
| `modules/planning/services/dashboard.ts` | 5 | planning module — `bankCashTotal` |
| `modules/planning/services/cashflow.ts` | 7 | planning module — `bankCashTotal` |
| `modules/investments/services/sip-lifecycle.ts` | 89 | **comment only** — not a real import |

Real importers span **3 modules**: system (1), ledger (1 test), planning (2).

**Best owner:** `modules/ledger/services/balances.ts` — `accounts` and `transactions` are
ledger domain tables; a balance is a ledger concept. The system and planning imports
of a ledger service are directionally sound (higher-level modules depend on ledger,
not the reverse). Alternative: `lib/` — but this file is more domain-specific than
`cache.ts`.

**Risks:**
- Moving to `ledger` makes `modules/system/services/prefs.ts` depend on
  `modules/ledger/` — a new cross-module dependency. This is acceptable (system
  alert logic reading ledger balances is natural) but should be noted.
- `epf-contributions.test.ts` is already inside ledger, so its import path shortens
  to a sibling (`./balances.ts`).

---

### 3. `services/ownership.ts`

**Purpose:** Foreign-key ownership guards — `assertOwned*` functions that verify the
calling user owns the referenced account/category/goal/holding before allowing a
write. Cross-cutting security utility.

**Exports:** `assertOwnedAccount`, `assertOwnedCategory`, `assertOwnedGoal`, `assertOwnedHolding`

**Imports (file:line):**
```
ownership.ts:1  import { and, eq } from "drizzle-orm";
ownership.ts:2  import type { DbOrTx } from "../db/index.ts";
ownership.ts:3  import { accounts, categories, goals, holdings } from "../db/schema.ts";
ownership.ts:4  import { HttpError } from "../lib/errors.ts";
```
Imports from `db/schema.ts` (accounts, categories, goals, holdings) and `lib/errors.ts`.
`accounts`/`categories` are ledger tables; `goals` is planning; `holdings` is investments.
So it already references tables from 3 different domain modules.

**Importers (all files):**

| File | Line | Context |
|------|------|---------|
| `modules/system/services/prefs.ts` | 8 | system — `assertOwnedAccount` |
| `modules/credit/services/emis.ts` | 13 | credit — `assertOwnedCategory` |
| `modules/ledger/services/recurring.ts` | 13 | ledger — `assertOwnedAccount`, `assertOwnedCategory` |
| `modules/ledger/services/transactions.ts` | 16 | ledger — `assertOwnedAccount`, `assertOwnedCategory` |
| `modules/ledger/services/accounts.ts` | 13 | ledger — `assertOwnedGoal` |
| `modules/planning/services/budgets.ts` | 14 | planning — `assertOwnedCategory` |
| `modules/investments/services/holdings.ts` | 19 | investments — `assertOwnedGoal` |
| `modules/investments/services/sip-lifecycle.ts` | 18 | investments — `assertOwnedGoal` |

Importers span **5 modules**: system, credit, ledger (3), planning, investments (2).

**Best owner:** `lib/ownership.ts` — this is the quintessential cross-cutting utility.
It validates ownership for entity types owned by 3 different modules (ledger, planning,
investments) and is called by 5 different modules. Placing it in any one module forces
4 cross-module imports; `lib/` is the only neutral home.

**Risks:**
- The `holdings` guard references a table primarily owned by `investments`, so if
  task 1.9 moves `holdings` out of `db/schema.ts` into per-module schema files, the
  import inside `ownership.ts` must update. This is a 1.9 concern, not a SP3
  blocker, but worth noting.
- All 8 importers must update their `../../../services/ownership.ts` path to
  `../../../lib/ownership.ts` (or appropriate relative depth).

---

### 4. `services/periods.ts`

**Purpose:** Budget-period arithmetic and spending aggregation utilities.
Pure functions (periodRange, prevPeriodKey, currentPeriodKey, monthKeyOf) plus
DB-query functions (spentByCategory, spendByNecessity, incomeExpense) and a SQL
constant (LIABILITY_TYPES_SQL).

**Exports:** `LIABILITY_TYPES_SQL`, `periodRange`, `prevPeriodKey`, `currentPeriodKey`,
`monthKeyOf`, `spentByCategory`, `NecessitySpendRow` (interface), `spendByNecessity`,
`incomeExpense`

**Imports (file:line):**
```
periods.ts:1   import { sql } from "drizzle-orm";
periods.ts:2   import { LIABILITY_ACCOUNT_TYPES, type BudgetPeriod,
               type CategoryKind, type ExpenseNecessity } from "@compass/shared";
periods.ts:8   import type { Db } from "../db/index.ts";
```
No `modules/` imports. Uses `@compass/shared` types and raw SQL.

**Importers (14 call sites across the repo):**

| File | Line | Import (verbatim) |
|------|------|-------------------|
| `modules/system/services/notifications.ts` | 7 | `import { currentPeriodKey } from "../../../services/periods.ts";` |
| `modules/planning/routes/insights.ts` | 7 | `import { currentPeriodKey } from "../../../services/periods.ts";` |
| `modules/planning/services/cashflow.ts` | 10 | `import { LIABILITY_TYPES_SQL } from "../../../services/periods.ts";` |
| `modules/planning/services/reports.test.ts` | 5 | `import type { NecessitySpendRow } from "../../../services/periods.ts";` |
| `modules/planning/services/dashboard.ts` | 14 | (multiple symbols) `from "../../../services/periods.ts";` |
| `modules/planning/services/goals.ts` | 44 | `import { incomeExpense, periodRange, prevPeriodKey, currentPeriodKey } from "../../../services/periods.ts";` |
| `modules/planning/services/budgets.ts` | 15 | `import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "../../../services/periods.ts";` |
| `modules/planning/services/insights.ts` | 4 | `import { incomeExpense, periodRange, prevPeriodKey } from "../../../services/periods.ts";` |
| `modules/planning/services/reports.ts` | 21 | (multiple symbols) `from "../../../services/periods.ts";` |
| `modules/ingest/services/inbox.test.ts` | 12 | `import { incomeExpense } from "../../../services/periods.ts";` |
| `modules/ledger/services/recurring.test.ts` | 12 | `import { incomeExpense, spentByCategory } from "../../../services/periods.ts";` |
| `modules/credit/services/alerts.ts` | 6 | `import { currentPeriodKey } from "../../../services/periods.ts";` |
| `modules/automation/services/tools.ts` | 11 | `import { currentPeriodKey } from "../../../services/periods.ts";` |
| `services/anomaly.ts` (flat, same SP3 batch) | 8 | `import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "./periods.ts";` |

Importers span **6 modules + 1 flat sibling**: planning (7), system (1), ingest (1),
ledger (1 test), credit (1), automation (1), plus `anomaly.ts` (also moving in SP3).

**Best owner:** `lib/periods.ts` — despite planning being the plurality consumer (7/14
call sites), 6 other locations in non-planning modules use it. Moving to `modules/planning`
would make system, ingest, ledger, credit, automation, and anomaly.ts all import from
planning — inverting the natural dependency direction (planning is a higher-level
module that orchestrates ledger data; lower modules depending on planning creates
a cycle risk). `lib/` is the neutral destination that preserves directionality.

**Risks:**
- 14 import paths change; this is the highest churn file in SP3.
- `anomaly.ts` currently imports via `./periods.ts` (sibling); after both move, the
  path inside anomaly must resolve to the new location.
- `spentByCategory` and `incomeExpense` are DB-query functions that touch
  `transactions`/`categories` — they have domain gravity toward `ledger`, but
  their heavy use by planning and other non-ledger modules makes `lib/` safer.

---

### 5. `services/autopilot.ts`

**Purpose:** Financial Autopilot — scheduled fan-out review that fires
forward-looking notifications: cash-flow shortfall check (`evaluateCashRunway`,
`runAutopilotReview`) and weekly goal-plan proposals (`evaluateGoalPlans`,
`runGoalReview`). Also contains pure helpers `detectCashShortfall`, `weekKey`,
`goalPlanMessage`.

**Exports:** `ReviewResult` (interface), `weekKey`, `CashShortfall` (interface),
`detectCashShortfall`, `evaluateCashRunway`, `goalPlanMessage`, `evaluateGoalPlans`,
`runAutopilotReview`, `runGoalReview`

**Imports (file:line):**
```
autopilot.ts:1   import type { Redis } from "ioredis";
autopilot.ts:2   import type { GoalProgress } from "@compass/shared";
autopilot.ts:3   import { formatINR } from "@compass/shared";
autopilot.ts:4   import type { Db } from "../db/index.ts";
autopilot.ts:5   import { alertLedger, users } from "../db/schema.ts";
autopilot.ts:6   import { getForecast } from "../modules/planning/services/cashflow.ts";
autopilot.ts:7   import { equityShareOfInvestable, OTHER_BAND_PCT } from "../modules/planning/services/goal-plan.ts";
autopilot.ts:8   import { getGoalProgress, listGoals } from "../modules/planning/services/goals.ts";
autopilot.ts:9   import { createNotification } from "../modules/system/services/notifications.ts";
autopilot.ts:10  import { prefEnabled } from "../modules/system/services/prefs.ts";
```
Already imports from 2 existing modules (planning × 3, system × 2). It is an
orchestrator that calls into other modules — it has no lower-level domain data of
its own.

**Importers:**

| File | Line | Context |
|------|------|---------|
| `jobs/index.ts` | 9 | `import { runAutopilotReview, runGoalReview } from "../services/autopilot.ts";` |
| `modules/planning/services/goals.ts` | 16 | **comment only** — not a real import |

Only **one real importer**: `jobs/index.ts` (job wiring).

**Best owner:** `modules/automation/services/autopilot.ts` — the roadmap brief
explicitly names this, `jobs/index.ts` is already the sole caller, and the file's
role (orchestrating planning+system signals into notifications) matches the
automation module's existing pattern. Task 1.6 already moved the AI routes into
`modules/automation`; autopilot belongs in the same module.

**Risks:**
- `jobs/index.ts` is the sole importer and must update its import path.
  After move: `import { ... } from "../modules/automation/services/autopilot.ts";`
- `autopilot.ts` already imports from `modules/planning/` and `modules/system/` —
  after the move those relative paths (currently `../modules/planning/...`) change
  to sibling paths like `../../planning/services/cashflow.ts`. These are
  internal-to-autopilot.ts changes only.
- `autopilot.test.ts` (colocated) moves with the source file.

---

### 6. `services/anomaly.ts`

**Purpose:** Per-category spending anomaly detector — compares current month's
spend per category against 6-month trailing average using z-score. Fires a
notification when the z-score exceeds the user's configured threshold. Contains
`sensitivityThreshold`, `detectAnomaly`, `evaluateAnomalies`.

**Exports:** `sensitivityThreshold`, `detectAnomaly`, `evaluateAnomalies`

**Imports (file:line):**
```
anomaly.ts:1   import { eq } from "drizzle-orm";
anomaly.ts:2   import type { AnomalySensitivity } from "@compass/shared";
anomaly.ts:3   import { formatINR } from "@compass/shared";
anomaly.ts:4   import type { Db } from "../db/index.ts";
anomaly.ts:5   import { alertLedger, categories } from "../db/schema.ts";
anomaly.ts:6   import { createNotification } from "../modules/system/services/notifications.ts";
anomaly.ts:7   import { listPrefs } from "../modules/system/services/prefs.ts";
anomaly.ts:8   import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "./periods.ts";
```
Imports from `modules/system` (2) and the sibling `periods.ts` (which is also
moving in SP3). After `periods.ts` moves to `lib/`, line 8's import path changes.

**Importers:**

| File | Line | Context |
|------|------|---------|
| `jobs/index.ts` | 8 | `import { evaluateAnomalies } from "../services/anomaly.ts";` |

Only **one real importer**: `jobs/index.ts` (job wiring, `alertsWorker`).

**Best owner:** `modules/automation/services/anomaly.ts` — same rationale as
`autopilot.ts`. It is a scheduled analytical review that produces notifications,
orchestrated by a job worker. The `anomaly.test.ts` pure-function tests (no DB)
move with it.

**Risks:**
- `jobs/index.ts` import path changes to `"../modules/automation/services/anomaly.ts"`.
- The `periods.ts` sibling import on line 8 becomes
  `"../../../lib/periods.ts"` (assuming SP3 moves periods to `lib/`), or the
  equivalent relative path from the new location.
- If `anomaly.ts` and `autopilot.ts` land in the same `modules/automation/services/`
  directory, `anomaly.ts`'s `./periods.ts` relative import just needs to point to
  wherever periods ends up — no further structural issue.

---

### 7. `repositories/users.ts`

**Purpose:** CRUD for the `users` table — the only file in `repositories/`. Wraps
basic Drizzle queries: `countUsers`, `findUserByEmail`, `findUserById`, `createUser`.

**Exports:** `UserRow` (type alias for `typeof users.$inferSelect`), `countUsers`,
`findUserByEmail`, `findUserById`, `createUser`

**Imports (file:line):**
```
users.ts:1   import { eq, sql } from "drizzle-orm";
users.ts:2   import type { Db } from "../db/index.ts";
users.ts:3   import { users } from "../db/schema.ts";
```
No `modules/` imports. Pure Drizzle against the `users` table.

**Importers (all files):**

| File | Line | Import (verbatim) |
|------|------|-------------------|
| `apps/api/src/db/bootstrap.ts` | 15 | `import { createUser, findUserByEmail } from "../repositories/users.ts";` |
| `modules/system/services/demo.ts` | 28 | `import { findUserByEmail } from "../../../repositories/users.ts";` |
| `modules/system/services/auth.ts` | 7 | `import { findUserByEmail, findUserById, type UserRow } from "../../../repositories/users.ts";` |
| `modules/system/routes/auth.ts` | 18 | `import { countUsers, findUserById } from "../../../repositories/users.ts";` |

All 3 module importers are in **`modules/system`** (demo.ts, services/auth.ts, routes/auth.ts).
`db/bootstrap.ts` is a deploy-time infra script, not a module.

**Best owner:** Fold into `modules/system/services/users.ts`. All module consumers
are in system; the content (user CRUD) is system domain. The `db/bootstrap.ts`
importer can import from `modules/system/services/users.ts` without any cycle risk
(bootstrap is a standalone deploy script, not imported by any module).

After the move, `repositories/` is empty and can be deleted along with `services/`.

**Risks:**
- `db/bootstrap.ts` path changes from `"../repositories/users.ts"` to
  `"../modules/system/services/users.ts"`.
- `modules/system/services/auth.ts` currently imports `users` (the Drizzle table) from
  `"../schema.ts"` AND `UserRow` from `"../../../repositories/users.ts"`. After the
  merge, `UserRow` lives alongside the functions in `modules/system/services/users.ts` —
  auth.ts will drop the `repositories/users.ts` import and get `UserRow` from the
  new location.

---

## Summary table

| File | Purpose (one line) | Best destination | Owner module | Key risk |
|------|--------------------|-----------------|--------------|----------|
| `services/cache.ts` | Version-stamped per-user Redis cache (read-through + bump-invalidate) | `lib/cache.ts` | shared/lib | app.ts + 3 modules update paths |
| `services/balances.ts` | Posted bank+cash balance per account as of date | `modules/ledger/services/balances.ts` | ledger | system + planning gain cross-module dep on ledger |
| `services/ownership.ts` | FK ownership guards (assert user owns account/category/goal/holding) | `lib/ownership.ts` | shared/lib | references tables from 3 domain modules; 8 importers update paths |
| `services/periods.ts` | Budget-period arithmetic + spending aggregation SQL helpers | `lib/periods.ts` | shared/lib | highest churn (14 importers); anomaly.ts sibling import breaks |
| `services/autopilot.ts` | Scheduled reviews: cash-runway & goal-plan notification fan-outs | `modules/automation/services/autopilot.ts` | automation | jobs/index.ts path; relative paths inside file change |
| `services/anomaly.ts` | Per-category z-score anomaly detector + alert | `modules/automation/services/anomaly.ts` | automation | jobs/index.ts path; `./periods.ts` sibling import changes |
| `repositories/users.ts` | User table CRUD (findByEmail, findById, create, count) | `modules/system/services/users.ts` | system | db/bootstrap.ts + 3 system files update paths |

**After SP3:** `apps/api/src/services/` has 0 files → deleted.
`apps/api/src/repositories/` has 0 files → deleted.
