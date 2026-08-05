# SP3 Verification — flat-folder cleanup

Verifier: independent (read-only). Date: 2026-08-05.

---

## T1 — Filesystem (AC3): both flat folders GONE

```
$ test ! -e apps/api/src/services && echo ABSENT || echo PRESENT
ABSENT

$ test ! -e apps/api/src/repositories && echo ABSENT || echo PRESENT
ABSENT
```

**Result: PASS** — both directories are absent.

---

## T2 — No surviving old-path imports; all new destination files exist

Command:
```
grep -r "services/cache\.ts|services/balances\.ts|services/ownership\.ts|services/periods\.ts|..." \
  --include="*.ts" --include="*.tsx" apps/ packages/ (excluding tasks/ docs/ reviews/)
```

Output (all 7 hits):
```
apps/api/src/modules/planning/services/cashflow.ts:      import { bankCashTotal } from "../../ledger/services/balances.ts";
apps/api/src/modules/investments/services/sip-lifecycle.ts:   * count as a recorded installment (see services/balances.ts).
apps/api/src/modules/system/services/prefs.ts:             import { bankCashBalances } from "../../ledger/services/balances.ts";
apps/api/src/modules/planning/services/goals.ts:           * - `services/autopilot.ts` — weekly `autopilot.goals` cron
apps/api/src/jobs/index.ts:8:                              import { evaluateAnomalies } from "../modules/automation/services/anomaly.ts";
apps/api/src/jobs/index.ts:9:                              import { runAutopilotReview, runGoalReview } from "../modules/automation/services/autopilot.ts";
apps/api/src/modules/planning/services/dashboard.ts:5:     import { bankCashTotal } from "../../ledger/services/balances.ts";
```

Analysis:
- Lines 1, 3, 6 (cashflow.ts, prefs.ts, dashboard.ts): relative path `../../ledger/services/balances.ts`
  resolves to `modules/ledger/services/balances.ts` = **NEW** destination. Not an old path.
- Line 2 (`sip-lifecycle.ts:89`): JSDoc comment `(see services/balances.ts)` — **stale documentation comment,
  not an import**. Does not affect compilation or runtime.
- Line 4 (`goals.ts:16`): JSDoc comment `` `services/autopilot.ts` `` — **stale documentation comment,
  not an import**.
- Lines 5–6 (`jobs/index.ts`): imports from `../modules/automation/services/anomaly.ts` and
  `../modules/automation/services/autopilot.ts` = **NEW** destinations.

Bare `/repositories/` import grep: zero results (exit 1).

**Zero surviving old-path import statements.** Two stale JSDoc comments reference old paths
(`sip-lifecycle.ts:89`, `goals.ts:16`) — not imports, no functional impact.

New destination files:
```
EXISTS: apps/api/src/lib/cache.ts
EXISTS: apps/api/src/lib/ownership.ts
EXISTS: apps/api/src/lib/periods.ts
EXISTS: apps/api/src/lib/periods.test.ts
EXISTS: apps/api/src/modules/ledger/services/balances.ts
EXISTS: apps/api/src/modules/automation/services/autopilot.ts
EXISTS: apps/api/src/modules/automation/services/autopilot.test.ts
EXISTS: apps/api/src/modules/automation/services/anomaly.ts
EXISTS: apps/api/src/modules/automation/services/anomaly.test.ts
EXISTS: apps/api/src/modules/system/services/users.ts
```

**Result: PASS** — 0 surviving old-path imports; all 10 new files exist. (2 stale JSDoc comments noted.)

---

## T3 — AC6: typecheck, lint, tests pass; moved test files ran

```
$ npm run typecheck
[all workspaces ran tsc --noEmit]
Exit code: 0

$ npm run lint
[eslint .]
Exit code: 0

$ npm run test -w apps/api
ℹ tests 886
ℹ suites 2
ℹ pass 885
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 7411.996429
Exit code: 0
```

Moved test files run individually:

```
$ node --test apps/api/src/lib/periods.test.ts
✔ periodRange handles month lengths and years (1.951873ms)
✔ prevPeriodKey crosses year boundaries (0.271956ms)
✔ currentPeriodKey formats today (0.333046ms)
✔ advanceDate steps and clamps day-of-month (0.357279ms)
ℹ tests 4 | pass 4 | fail 0
Exit: 0

$ node --test apps/api/src/modules/automation/services/autopilot.test.ts
✔ no breach when every projected day stays above the floor (1.639509ms)
✔ breaches when the projection crosses below zero within the horizon (0.25928ms)
✔ today's balance is ignored — only look-ahead days count (0.216048ms)
✔ a breach beyond the horizon does not fire (0.312147ms)
✔ respects a non-zero floor (0.254087ms)
✔ empty / single-day forecast never breaches (0.189565ms)
✔ weekKey collapses a whole week to its Monday (0.232756ms)
ℹ tests 7 | pass 7 | fail 0
Exit: 0

$ node --test apps/api/src/modules/automation/services/anomaly.test.ts
✔ sensitivityThreshold: off disables, higher sensitivity = lower z-bar (1.361208ms)
✔ detectAnomaly: flags a clear 3x spike over steady history (0.360203ms)
✔ detectAnomaly: does not flag normal variation (0.199373ms)
✔ detectAnomaly: never flags under-spend, needs >=3 months history (0.224696ms)
✔ detectAnomaly: off sensitivity never flags (0.207233ms)
ℹ tests 5 | pass 5 | fail 0
Exit: 0
```

**Result: PASS** — typecheck 0, lint 0, tests 885/886 pass (1 skip, 0 fail). All 3 moved test files ran and passed.

---

## T4 — Cycle safety: importers confined; lib/ files have no module/ imports

Importers of `modules/automation/services/autopilot.ts` (excluding test files):
```
apps/api/src/jobs/index.ts:9: import { runAutopilotReview, runGoalReview } from "../modules/automation/services/autopilot.ts";
```
Only `jobs/index.ts`. **PASS.**

Importers of `modules/automation/services/anomaly.ts` (excluding test files):
```
apps/api/src/jobs/index.ts:8: import { evaluateAnomalies } from "../modules/automation/services/anomaly.ts";
```
Only `jobs/index.ts`. **PASS.**

lib/ files (`cache.ts`, `ownership.ts`, `periods.ts`) — grep for `from.*modules/`:
```
(no output, exit 1)
```
None of the lib/ files import from `../modules/` or `../../modules/`. **PASS.**

---

## T5 — AC4: no schema/migration change

```
$ git diff --exit-code -- apps/api/drizzle
(no output)
Exit code: 0

$ npm run db:generate
No schema changes, nothing to migrate 😴
Exit code: 0
```

**Result: PASS** — no migration generated; drizzle directory unchanged.

---

## T6 — Mechanical-move proof: git status + diff analysis

```
$ git status --porcelain
 M apps/api/src/app.ts
 M apps/api/src/db/bootstrap.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/jobs/index.ts
R  apps/api/src/services/cache.ts -> apps/api/src/lib/cache.ts
RM apps/api/src/services/ownership.ts -> apps/api/src/lib/ownership.ts
R  apps/api/src/services/periods.test.ts -> apps/api/src/lib/periods.test.ts
R  apps/api/src/services/periods.ts -> apps/api/src/lib/periods.ts
 M apps/api/src/modules/automation/schema.ts
R  apps/api/src/services/anomaly.test.ts -> apps/api/src/modules/automation/services/anomaly.test.ts
RM apps/api/src/services/anomaly.ts -> apps/api/src/modules/automation/services/anomaly.ts
R  apps/api/src/services/autopilot.test.ts -> apps/api/src/modules/automation/services/autopilot.test.ts
RM apps/api/src/services/autopilot.ts -> apps/api/src/modules/automation/services/autopilot.ts
 M apps/api/src/modules/automation/services/tools.ts
 M apps/api/src/modules/credit/routes/emis.ts
 M apps/api/src/modules/credit/schema.ts
 M apps/api/src/modules/credit/services/alerts.ts
 M apps/api/src/modules/credit/services/emis.ts
 M apps/api/src/modules/ingest/schema.ts
 M apps/api/src/modules/ingest/services/inbox.test.ts
 M apps/api/src/modules/investments/routes/sips.ts
 M apps/api/src/modules/investments/schema.ts
 M apps/api/src/modules/investments/services/holdings.ts
 M apps/api/src/modules/investments/services/networth.ts
 M apps/api/src/modules/investments/services/sip-lifecycle.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/ledger/services/accounts.ts
RM apps/api/src/services/balances.ts -> apps/api/src/modules/ledger/services/balances.ts
 M apps/api/src/modules/ledger/services/epf-contributions.test.ts
 M apps/api/src/modules/ledger/services/recurring.test.ts
 M apps/api/src/modules/ledger/services/recurring.ts
 M apps/api/src/modules/ledger/services/transactions.ts
 M apps/api/src/modules/planning/routes/budgets.ts
 M apps/api/src/modules/planning/routes/insights.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/budgets.ts
 M apps/api/src/modules/planning/services/cashflow.ts
 M apps/api/src/modules/planning/services/dashboard.ts
 M apps/api/src/modules/planning/services/goals.ts
 M apps/api/src/modules/planning/services/insights.ts
 M apps/api/src/modules/planning/services/reports.test.ts
 M apps/api/src/modules/planning/services/reports.ts
 M apps/api/src/modules/protection/schema.ts
 M apps/api/src/modules/system/routes/auth.ts
 M apps/api/src/modules/system/schema.ts
 M apps/api/src/modules/system/services/auth.ts
 M apps/api/src/modules/system/services/demo.ts
 M apps/api/src/modules/system/services/notifications.ts
 M apps/api/src/modules/system/services/prefs.ts
RM apps/api/src/repositories/users.ts -> apps/api/src/modules/system/services/users.ts
 M tasks/014-migrate-planning/TASK.md
?? apps/api/src/db/schema.decomposition.test.ts
?? apps/api/src/db/shared/
?? apps/api/src/modules/ledger/services/account-balances.test.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/015-statusline/
?? tasks/018-migrate-system/commit-log.md
?? tasks/020-cross-module-ports/
?? tasks/BATCH-phase1-close.md
```

### Staging state analysis

Git status legend: `R ` = rename staged, working tree clean; `RM` = rename staged, working tree has
additional unstaged modifications.

**5 files show RM** (staged rename carries old content; import fixes are unstaged):
- `services/ownership.ts → lib/ownership.ts`
- `services/anomaly.ts → modules/automation/services/anomaly.ts`
- `services/autopilot.ts → modules/automation/services/autopilot.ts`
- `services/balances.ts → modules/ledger/services/balances.ts`
- `repositories/users.ts → modules/system/services/users.ts`

**5 files show R** (clean renames, no unstaged changes):
- `services/cache.ts → lib/cache.ts`
- `services/periods.ts → lib/periods.ts`
- `services/periods.test.ts → lib/periods.test.ts`
- `services/autopilot.test.ts → modules/automation/services/autopilot.test.ts`
- `services/anomaly.test.ts → modules/automation/services/anomaly.test.ts`

**Staged rename diffs for all 10 files:** `similarity index 100%` — the git index holds pure renames;
no content change is staged for any of the 10 moved files.

**Unstaged diffs for the 5 RM files** (working tree vs index) — every hunk is an import specifier:

`lib/ownership.ts`:
```diff
-import { HttpError } from "../lib/errors.ts";
+import { HttpError } from "./errors.ts";
```

`modules/automation/services/anomaly.ts`:
```diff
-import type { Db } from "../db/index.ts";
-import { alertLedger, categories } from "../db/schema.ts";
-import { createNotification } from "../modules/system/services/notifications.ts";
-import { listPrefs } from "../modules/system/services/prefs.ts";
-import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "./periods.ts";
+import type { Db } from "../../../db/index.ts";
+import { alertLedger, categories } from "../../../db/schema.ts";
+import { createNotification } from "../../system/services/notifications.ts";
+import { listPrefs } from "../../system/services/prefs.ts";
+import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "../../../lib/periods.ts";
```

`modules/automation/services/autopilot.ts`:
```diff
-import type { Db } from "../db/index.ts";
-import { alertLedger, users } from "../db/schema.ts";
-import { getForecast } from "../modules/planning/services/cashflow.ts";
-import { equityShareOfInvestable, OTHER_BAND_PCT } from "../modules/planning/services/goal-plan.ts";
-import { getGoalProgress, listGoals } from "../modules/planning/services/goals.ts";
-import { createNotification } from "../modules/system/services/notifications.ts";
-import { prefEnabled } from "../modules/system/services/prefs.ts";
+import type { Db } from "../../../db/index.ts";
+import { alertLedger, users } from "../../../db/schema.ts";
+import { getForecast } from "../../planning/services/cashflow.ts";
+import { equityShareOfInvestable, OTHER_BAND_PCT } from "../../planning/services/goal-plan.ts";
+import { getGoalProgress, listGoals } from "../../planning/services/goals.ts";
+import { createNotification } from "../../system/services/notifications.ts";
+import { prefEnabled } from "../../system/services/prefs.ts";
```

`modules/ledger/services/balances.ts`:
```diff
-import type { Db } from "../db/index.ts";
+import type { Db } from "../../../db/index.ts";
```

`modules/system/services/users.ts`:
```diff
-import type { Db } from "../db/index.ts";
-import { users } from "../db/schema.ts";
+import type { Db } from "../../../db/index.ts";
+import { users } from "../../../db/schema.ts";
```

No logic change, no SQL change, no function signature change in any unstaged diff.

**Private artifact check:** No `Pasted image.png`, no root `*.pdf`, no `data/` entries appear in staged
or modified files in git status. Only tasks/** untracked entries.

**STAGING ISSUE:** The 5 RM files have correct import paths on disk (working tree) but the git index
holds those files with their pre-move import paths. If committed in the current staging state, these 5
files would be committed without their import path fixes, producing a broken commit. The import path
fixes exist only in the working tree and are not yet staged.

**Result: PARTIAL PASS** — working tree is mechanically correct (import specifiers only, no logic/SQL
changes); typecheck and tests confirm it. However, git staging is incomplete — 5 files' import-path
fixes are unstaged and must be staged before committing.

---

## Summary

| Check | Result | Notes |
|-------|--------|-------|
| T1 — both flat folders ABSENT | PASS | |
| T2 — zero old-path imports; all 10 new files exist | PASS | 2 stale JSDoc comments (not imports) |
| T3 — typecheck 0, lint 0, tests 885/886 pass | PASS | periods: 4/4, autopilot: 7/7, anomaly: 5/5 |
| T4 — autopilot+anomaly importers only jobs/index.ts; lib/ no module imports | PASS | |
| T5 — no schema change, no migration generated | PASS | |
| T6 — pure import-specifier changes, no logic change; no private artifacts | PASS (working tree) | STAGING INCOMPLETE: 5 RM files have import fixes unstaged |

**Overall: working tree is functionally correct; staging must be completed before the commit is made.**
