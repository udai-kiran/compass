# Verification-2 — 014-migrate-planning, Slice 1 (moves + repoints combined)

Read-only independent verification. No files edited, no git state-changing commands run.

Files read: `tasks/014-migrate-planning/DELEGATION.md` ("Iteration 2 — Slice 1" and "Iteration 3 —
Slice 1 completion" sections), `tasks/014-migrate-planning/TASK.md` (full, esp. AC9), the complete
`git diff -M` (2225 lines), all 12 moved-file old/new pairs, `apps/api/src/app.ts`,
`apps/api/src/db/schema.smoke.test.ts`, `apps/api/src/modules/planning/plugin.ts`, the 5
still-flat planning services/routes due to move in Slice 2, and the root/`apps/api` test logs.

---

## 1. `git status --porcelain -M`

```
$ git status --porcelain -M
 M CLAUDE.md
 M apps/api/src/app.ts
 M apps/api/src/db/schema.smoke.test.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/projection-settings.ts
 D apps/api/src/routes/budgets.ts
 D apps/api/src/routes/goals.ts
 M apps/api/src/services/ai/tools.ts
 M apps/api/src/services/autopilot.ts
 D apps/api/src/services/budgets.ts
 M apps/api/src/services/dashboard.ts
 D apps/api/src/services/goal-allocation.test.ts
 D apps/api/src/services/goal-allocation.ts
 D apps/api/src/services/goal-plan.test.ts
 D apps/api/src/services/goal-plan.ts
 D apps/api/src/services/goal-projection.test.ts
 D apps/api/src/services/goal-projection.ts
 D apps/api/src/services/goal-returns.test.ts
 D apps/api/src/services/goal-returns.ts
 D apps/api/src/services/goals.ts
 M apps/api/src/services/notifications.ts
?? apps/api/src/modules/planning/routes/budgets.ts
?? apps/api/src/modules/planning/routes/goals.ts
?? apps/api/src/modules/planning/schema.smoke.test.ts
?? apps/api/src/modules/planning/services/budgets.ts
?? apps/api/src/modules/planning/services/goal-allocation.test.ts
?? apps/api/src/modules/planning/services/goal-allocation.ts
?? apps/api/src/modules/planning/services/goal-plan.test.ts
?? apps/api/src/modules/planning/services/goal-plan.ts
?? apps/api/src/modules/planning/services/goal-projection.test.ts
?? apps/api/src/modules/planning/services/goal-projection.ts
?? apps/api/src/modules/planning/services/goal-returns.test.ts
?? apps/api/src/modules/planning/services/goal-returns.ts
?? apps/api/src/modules/planning/services/goals.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/014-migrate-planning/
```
Exit code: 0.

`git status -M` does **not** pair these as renames because the new-side files are untracked
(`??`), and git's rename detection with `-M`/`--find-renames` only pairs changes that are already
tracked (index-vs-HEAD or worktree-vs-index) — untracked files are never matched. This is expected
git behaviour, not a defect. 12 `D` entries (6 services + 4 tests + 2 routes) pair 1:1 with 12 of
the 13 `?? modules/planning/**` entries; the 13th (`schema.smoke.test.ts`) is Slice-0's new file,
already accounted for. 12 `M` entries under `apps/api/src` plus `CLAUDE.md` match the
import-repoint/doc-comment scope of Iterations 2+3. `tasks/013-release-v1.97.0/` and
`tasks/014-migrate-planning/` are untracked task-doc directories, out of scope for this brief.

## 2. Complete `git diff -M`

Full diff captured (2225 lines) and read in full. Untracked new files are not shown by `git diff`
(expected git behaviour); their content was independently diffed against the old HEAD copy in
section 8 (AC9) below.

Every hunk in the tracked diff is one of:
- `CLAUDE.md:49` — the AC13 sentence rewrite (Slice 0, pre-existing, unchanged by this slice).
- `apps/api/src/app.ts` — two import-specifier lines (`budgetRoutes`, `goalRoutes`).
- `apps/api/src/db/schema.smoke.test.ts` — one assertion-message string literal.
- `apps/api/src/db/schema.ts` — the Slice-0 diff (delete `export *` line, add the
  `projectionSettings` `pgTable()` block, doc-comment update) — no new edits this slice.
- `apps/api/src/modules/investments/services/sip-commitments.ts` — one import-specifier line.
- `apps/api/src/modules/ledger/schema.ts` — doc-comment prose only (Slice 0, F15).
- `apps/api/src/modules/planning/schema.ts` — Slice-0 rewrite to thin re-export (pre-existing).
- `apps/api/src/modules/planning/services/projection-settings.ts` — one import-specifier line.
- `apps/api/src/routes/budgets.ts`, `apps/api/src/routes/goals.ts` — full deletions (moved).
- `apps/api/src/services/ai/tools.ts` — two import-specifier lines.
- `apps/api/src/services/autopilot.ts` — two import-specifier lines (`./cashflow.ts` untouched).
- `apps/api/src/services/budgets.ts`, `goals.ts`, `goal-allocation.ts(.test.ts)`,
  `goal-plan.ts(.test.ts)`, `goal-projection.ts(.test.ts)`, `goal-returns.ts(.test.ts)` — full
  deletions (moved).
- `apps/api/src/services/dashboard.ts` — one import-specifier line.
- `apps/api/src/services/notifications.ts` — one import-specifier line.

No handler body, route URL, status code, Zod schema, SQL predicate, `userId` filter, cache key or
TTL text appears anywhere in the diff outside the deleted/moved bodies (which reappear verbatim at
the new paths — proven file-by-file in section 8).

## 3. `npm run typecheck`

```
$ npm run typecheck
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
... (all 7 workspaces: @compass/api, @compass/docs, @compass/extractor, @compass/ingestor,
     @compass/web, @compass/ai, @compass/shared — each "tsc --noEmit" with no error output)
```
Exit code: 0.

## 4. `npm run lint`

```
$ npm run lint
> compass@0.1.0 lint
> eslint .
```
Exit code: 0.

## 5. `npm run test -w apps/api`

```
$ npm run test -w apps/api
...
ℹ tests 845
ℹ suites 1
ℹ pass 845
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8104.035859
```
Exit code: 0. **845 pass, 0 fail** — matches the required count exactly, no tests gained or lost.

Re-ran the identical underlying command directly from `apps/api` a second time later
(`node --env-file-if-exists=../../.env --test "src/**/*.test.ts"`) — also 845/845, exit 0 (see
finding in section 6 below explaining why this reproducibility matters).

## 6. `npm run test` (repo root)

```
$ npm run test
> compass@0.1.0 test
> npm run test --workspaces --if-present
```
Exit code: **1**.

Per-workspace results, in run order:

- **`@compass/api`**: `ℹ tests 845 / ℹ pass 818 / ℹ fail 27`. All 27 failures are in
  `src/services/card-due-tasks.test.ts` (AC1–AC10, AC15, FIX1/FIX2 cases), each with the identical
  literal error:
  ```
  Error: card-due-tasks.test.ts calls the real, global materializeCardDueTasks(db) against this
  repo's shared dev Postgres (no test-DB isolation exists). Found 1 pre-existing non-demo
  card_details row(s) — refusing to run, since a due card among them would be materialized as a
  real user_tasks row. Clear or archive unrelated credit-card accounts from this database before
  running this test file.
  ```
  npm then reported: `npm error Lifecycle script `test` failed with error / npm error code 1`.

  **This is NOT reproducible against this migration's code.** `npm run test -w apps/api` (section
  5, run immediately before and independently again immediately after this root run) passed
  845/845 both times with the identical underlying command
  (`node --env-file-if-exists=../../.env --test "src/**/*.test.ts"`). The test's own self-guard
  message names the cause: a pre-existing non-demo `card_details` row was present in the shared
  dev Postgres (192.168.2.196) at the exact moment of the root-level run only, then absent again
  moments later. This is a known, documented property of this specific test file (it explicitly
  self-guards against exactly this condition rather than silently mutating shared data) — a
  **flaky, environment/data-state-dependent failure orthogonal to the code under review**, not a
  regression introduced by this slice. Flagging it as required ("any OTHER failure is a real
  finding") rather than treating it as a pass, per instructions — but it is not attributable to
  the moved/repointed files.

- **`@compass/extractor`**: `ℹ tests 63 / ℹ pass 62 / ℹ fail 1`. The one failure:
  ```
  file:///home/udai/PennyPilot/apps/extractor/src/statement-duplicate.test.ts:30
  Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this
  repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running
  `npm run test -w apps/extractor`.
  ```
  This matches the brief's named, accepted, pre-existing waiver exactly (missing `DATABASE_URL`
  packaging gap) — not treated as a regression.

- **`@compass/ingestor`**: `ℹ tests 12 / ℹ pass 12 / ℹ fail 0`.
- **`@compass/web`**: `ℹ tests 264 / ℹ pass 264 / ℹ fail 0`.
- **`@compass/ai`**: `ℹ tests 32 / ℹ pass 32 / ℹ fail 0`.
- **`@compass/shared`**: `ℹ tests 212 / ℹ pass 212 / ℹ fail 0`.

Root-cause note (not further chased, per read-only scope): both `@compass/api` and
`@compass/extractor` workspaces failed, which is why the root `npm run test --workspaces` exited 1
overall — `@compass/extractor` is the accepted waiver; `@compass/api`'s single-run failure is an
environmental/shared-DB-state flake, evidenced by two clean 845/845 runs of the identical command
bracketing it.

## 7. Route snapshot sha256

```
$ sha256sum apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
7800feb971c2e570040a299addf207960a0866f2a7feb377c4a2cf84bf4255c8  apps/api/src/route-table.snapshot.txt
```
Exit code: 0. **Both hashes match the required values exactly** — byte-identical, unchanged.

## 8. AC9 — per-file diff of the 12 moved files (load-bearing)

Method: `diff <(git show HEAD:<old-path>) <new-path>` for each of the 12. All 12 pass: every diff
consists exclusively of import-line changes (6 of the 12 have **zero** diff at all, because those
files' imports needed no depth/split adjustment).

```
=== apps/api/src/services/budgets.ts -> apps/api/src/modules/planning/services/budgets.ts ===
11,15c11,15
< import type { Db } from "../db/index.ts";
< import { budgetLines, budgets } from "../db/schema.ts";
< import { HttpError } from "../lib/errors.ts";
< import { assertOwnedCategory } from "./ownership.ts";
< import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "./periods.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { budgetLines, budgets } from "../schema.ts";
> import { HttpError } from "../../../lib/errors.ts";
> import { assertOwnedCategory } from "../../../services/ownership.ts";
> import { currentPeriodKey, periodRange, prevPeriodKey, spentByCategory } from "../../../services/periods.ts";
--- diff exit: 1 (differences found, import-lines-only) ---

=== apps/api/src/services/goals.ts -> apps/api/src/modules/planning/services/goals.ts ===
11,15c11,16
< import type { Db } from "../db/index.ts";
< import { alertLedger, goals, holdingEvents, retirementDetails, transactions } from "../db/schema.ts";
< import { HttpError } from "../lib/errors.ts";
< import { listAccounts } from "../modules/ledger/services/accounts.ts";
< import { getPortfolio } from "../modules/investments/services/holdings.ts";
---
> import type { Db } from "../../../db/index.ts";
> import { alertLedger, holdingEvents, retirementDetails, transactions } from "../../../db/schema.ts";
> import { goals } from "../schema.ts";
> import { HttpError } from "../../../lib/errors.ts";
> import { listAccounts } from "../../ledger/services/accounts.ts";
> import { getPortfolio } from "../../investments/services/holdings.ts";
19,23c20,24
< import { createNotification } from "./notifications.ts";
< import { incomeExpense, periodRange, prevPeriodKey, currentPeriodKey } from "./periods.ts";
< import { prefEnabled } from "./prefs.ts";
< import { getProjectionSettings } from "../modules/planning/services/projection-settings.ts";
< import { committedForGoal } from "../modules/investments/services/sip-commitments.ts";
---
> import { createNotification } from "../../../services/notifications.ts";
> import { incomeExpense, periodRange, prevPeriodKey, currentPeriodKey } from "../../../services/periods.ts";
> import { prefEnabled } from "../../../services/prefs.ts";
> import { getProjectionSettings } from "./projection-settings.ts";
> import { committedForGoal } from "../../investments/services/sip-commitments.ts";
--- diff exit: 1 (differences found, import-lines-only) ---

=== apps/api/src/services/goal-allocation.ts -> .../modules/planning/services/goal-allocation.ts ===
--- diff exit: 0 (byte-identical; file has no cross-module imports needing change) ---

=== apps/api/src/services/goal-allocation.test.ts -> .../modules/planning/services/goal-allocation.test.ts ===
--- diff exit: 0 (byte-identical; imports only "./goal-allocation.ts", still sibling after move) ---

=== apps/api/src/services/goal-plan.ts -> .../modules/planning/services/goal-plan.ts ===
--- diff exit: 0 (byte-identical; only imports @compass/shared) ---

=== apps/api/src/services/goal-plan.test.ts -> .../modules/planning/services/goal-plan.test.ts ===
--- diff exit: 0 (byte-identical; imports only "./goal-plan.ts") ---

=== apps/api/src/services/goal-projection.ts -> .../modules/planning/services/goal-projection.ts ===
--- diff exit: 0 (byte-identical; no imports) ---

=== apps/api/src/services/goal-projection.test.ts -> .../modules/planning/services/goal-projection.test.ts ===
--- diff exit: 0 (byte-identical; imports only "./goal-projection.ts") ---

=== apps/api/src/services/goal-returns.ts -> .../modules/planning/services/goal-returns.ts ===
--- diff exit: 0 (byte-identical; imports only "./goal-allocation.ts", still sibling after move) ---

=== apps/api/src/services/goal-returns.test.ts -> .../modules/planning/services/goal-returns.test.ts ===
--- diff exit: 0 (byte-identical; imports only "./goal-returns.ts") ---

=== apps/api/src/routes/budgets.ts -> apps/api/src/modules/planning/routes/budgets.ts ===
23,24c23,24
< import { invalidateUserCache } from "../services/cache.ts";
< import { enqueueBudgetEvaluation } from "../jobs/index.ts";
---
> import { invalidateUserCache } from "../../../services/cache.ts";
> import { enqueueBudgetEvaluation } from "../../../jobs/index.ts";
--- diff exit: 1 (differences found, import-lines-only) ---

=== apps/api/src/routes/goals.ts -> apps/api/src/modules/planning/routes/goals.ts ===
--- diff exit: 0 (byte-identical; "../services/goals.ts" stays a valid sibling-relative import
    after both route and service moved into the module together) ---
```

**AC9 verdict: PASS for all 12 files.** No handler body, route URL, status code, Zod schema, SQL
predicate, `userId` filter, cache key or TTL changed anywhere. `diff exit 1` above means "lines
differ" (standard `diff` semantics), not a test failure — every non-empty diff shown is entirely
import specifiers.

## 9. Split-import rule in `goals.ts`

```
$ sed -n '1,20p' apps/api/src/modules/planning/services/goals.ts
...
10: import { CreateGoalSchema, isRetirementAccount, ReorderGoalsSchema } from "@compass/shared";
11: import type { Db } from "../../../db/index.ts";
12: import { alertLedger, holdingEvents, retirementDetails, transactions } from "../../../db/schema.ts";
13: import { goals } from "../schema.ts";
14: import { HttpError } from "../../../lib/errors.ts";
```

Confirmed exactly as specified: `goals` (line 13) comes from `../schema.ts` (planning's own
barrel); `alertLedger, holdingEvents, retirementDetails, transactions` (line 12) come from
`../../../db/schema.ts`. PASS.

## 10. Repointed-file import lines, quoted, with depth check

- `apps/api/src/app.ts` (at `apps/api/src/`):
  ```
  23: import { budgetRoutes } from "./modules/planning/routes/budgets.ts";
  26: import { goalRoutes } from "./modules/planning/routes/goals.ts";
  ```
  Correct — `app.ts` is a sibling of `modules/`, so `./modules/planning/routes/*` is right.

- `apps/api/src/services/notifications.ts` (at `apps/api/src/services/`):
  ```
  7: import { getUtilization } from "../modules/planning/services/budgets.ts";
  ```
  Correct — one level up to `src/`, then into `modules/`.

- `apps/api/src/services/autopilot.ts` (at `apps/api/src/services/`):
  ```
  6: import { getForecast } from "./cashflow.ts";
  7: import { equityShareOfInvestable, OTHER_BAND_PCT } from "../modules/planning/services/goal-plan.ts";
  8: import { getGoalProgress, listGoals } from "../modules/planning/services/goals.ts";
  ```
  Correct — line 6 `./cashflow.ts` is untouched exactly as required (cashflow.ts moves in Slice 2);
  lines 7–8 correctly repointed at the same depth as notifications.ts.

- `apps/api/src/services/ai/tools.ts` (at `apps/api/src/services/ai/`, one level deeper):
  ```
  6:  import { buildReport } from "../reports.ts";
  7:  import { getUtilization } from "../../modules/planning/services/budgets.ts";
  8:  import { getInsights } from "../insights.ts";
  10: import { listGoals } from "../../modules/planning/services/goals.ts";
  ```
  Correct — lines 6 and 8 (`../reports.ts`, `../insights.ts`) are untouched exactly as required
  (Slice 2); lines 7 and 10 correctly use `../../modules/planning/...` (two levels up from
  `services/ai/` to `src/`, then into `modules/`).

- `apps/api/src/modules/investments/services/sip-commitments.ts` (at
  `apps/api/src/modules/investments/services/`):
  ```
  6: import { accountAllocationClass, holdingAllocationClass, type GoalAllocationClass } from "../../planning/services/goal-allocation.ts";
  ```
  Correct — two levels up to `modules/`, then into the peer `planning/` module, per the
  peer-module-services rule.

- `apps/api/src/services/dashboard.ts` (at `apps/api/src/services/`):
  ```
  7: import { getUtilization } from "../modules/planning/services/budgets.ts";
  ```
  Correct, and matches the DELEGATION doc's explicitly-flagged "deliberate interim churn" — this
  line reverts to `./budgets.ts` when `dashboard.ts` itself moves into the module in Slice 2.

All six repointed-file import sets PASS.

## 11. `app.ts` register-block invariance

```
$ git diff HEAD -- apps/api/src/app.ts
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index bf4d97d..77711c9 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -20,10 +20,10 @@ import { healthRoutes } from "./routes/health.ts";
 import { authRoutes } from "./routes/auth.ts";
 import { ledgerRoutes } from "./modules/ledger/plugin.ts";
 import { importRoutes } from "./routes/imports.ts";
-import { budgetRoutes } from "./routes/budgets.ts";
+import { budgetRoutes } from "./modules/planning/routes/budgets.ts";
 import { dashboardRoutes } from "./routes/dashboard.ts";
 import { notificationRoutes } from "./routes/notifications.ts";
-import { goalRoutes } from "./routes/goals.ts";
+import { goalRoutes } from "./modules/planning/routes/goals.ts";
 import { investmentsRoutes } from "./modules/investments/plugin.ts";
 import { cashflowRoutes } from "./routes/cashflow.ts";
 import { billRoutes } from "./routes/bills.ts";
```
Exit code: 0 (git diff itself); the diff content shown above is the entirety of the file's change
— two import specifiers, nothing else.

```
$ grep -n "app.register(" apps/api/src/app.ts
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
224: (compress at 226)
```
16 route registrations (119–140), identical count and order to what the delegation states was
present before this slice. PASS.

## 12. `db/schema.smoke.test.ts` diff and re-run

```
$ git diff HEAD -- apps/api/src/db/schema.smoke.test.ts
diff --git a/apps/api/src/db/schema.smoke.test.ts b/apps/api/src/db/schema.smoke.test.ts
index 2018858..db67fed 100644
--- a/apps/api/src/db/schema.smoke.test.ts
+++ b/apps/api/src/db/schema.smoke.test.ts
@@ -19,7 +19,7 @@ test("schema barrel exposes users and projectionSettings exactly once, with corr
   assert.equal(
     schema.projectionSettings,
     projectionSettings,
-    "projectionSettings must be the same table object re-exported from modules/planning/schema.ts",
+    "projectionSettings must be the same table object re-exported from db/schema.ts to modules/planning/schema.ts",
   );
 
   const usersConfig = getTableConfig(schema.users);
```
Exactly one string-literal line changed. PASS.

```
$ cd apps/api && node --test src/db/schema.smoke.test.ts
✔ schema barrel exposes users and projectionSettings exactly once, with correct table names/columns (2.276037ms)
✔ a real createDb() instance (non-connecting stub pool) exposes db.query.users and db.query.projectionSettings at runtime (3.98703ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 933.986932
```
Exit code: 0. 2/2 pass. PASS.

## 13. Resolver-based unresolvable-import scan

Script written to
`/tmp/claude-1001/-home-udai-PennyPilot/ad09ead0-26c7-444d-9b89-3b727c4e538e/scratchpad/resolver.mjs`
(not in the repo). Walks every `*.ts` under `apps/api/src`, extracts all four static specifier
forms (`import … from`, `import type … from`, `export … from`, bare `import "…"`, and dynamic
`import("…")`), keeps only relative (`.`-prefixed) specifiers, and resolves each against the
importing file's directory trying exact path → `+".ts"` → `"/index.ts"`, accepting only a regular
file (`fs.statSync(...).isFile()`).

```
$ node resolver.mjs
files scanned: 224
specifiers scanned: 689
unresolvable count: 0
```
0 unresolvable, magnitude consistent with the task's ~223 files / ~686 specifiers reference point
(review-3's baseline). PASS.

## 14. Scope check

- `apps/api/src/db/schema.ts` — diff (full text already shown in section 2 of the earlier reading)
  is exactly the Slice-0 change (delete `export * from "../modules/planning/schema.ts";`, insert
  the `projectionSettings` `pgTable()` block after `subscriptionDismissals`, update the doc
  comment). No further edits this slice.
- `apps/api/src/modules/planning/plugin.ts`:
  ```
  $ git diff HEAD -- apps/api/src/modules/planning/plugin.ts
  (no output)
  ```
  Exit code 0, empty diff — untouched. PASS.
- The 5 flat services + their route files still due to move in Slice 2, existence + diff check:
  ```
  EXISTS: apps/api/src/services/cashflow.ts
  EXISTS: apps/api/src/services/bills.ts
  EXISTS: apps/api/src/services/insights.ts
  EXISTS: apps/api/src/services/reports.ts
  EXISTS: apps/api/src/services/dashboard.ts
  EXISTS: apps/api/src/routes/cashflow.ts
  EXISTS: apps/api/src/routes/bills.ts
  EXISTS: apps/api/src/routes/insights.ts
  EXISTS: apps/api/src/routes/reports.ts
  EXISTS: apps/api/src/routes/dashboard.ts

  $ git diff HEAD -- apps/api/src/services/cashflow.ts apps/api/src/services/bills.ts \
      apps/api/src/services/insights.ts apps/api/src/services/reports.ts \
      apps/api/src/routes/cashflow.ts apps/api/src/routes/bills.ts \
      apps/api/src/routes/insights.ts apps/api/src/routes/reports.ts \
      apps/api/src/routes/dashboard.ts
  (no output)
  ```
  All 9 of those files (everything except `dashboard.ts`'s service, covered separately) are
  byte-identical to HEAD. `services/dashboard.ts`'s only change is the single line-7 specifier
  already quoted in full in section 10 above. PASS — matches the brief's expectation exactly.

Existence check for the 12 old flat paths (all deleted) and 12 new module paths (all present) also
run; all 24 assertions correct (deleted-path set matches AC9's 12, new-path set matches).

---

## Deviations from the brief's "what should now be true"

None in the code under review. **One deviation to flag prominently:** step 6's root `npm run test`
exited 1 not solely from the accepted `apps/extractor` waiver, but also from a second,
**non-reproducible** `apps/api` failure (818/845, 27 fails, all in
`services/card-due-tasks.test.ts`, all with the identical "pre-existing non-demo card_details row"
self-guard message). Two independent runs of the exact same underlying api-test command,
bracketing the root run, both passed 845/845/0-fail/exit-0. This looks like a shared-dev-Postgres
data-state race rather than anything caused by this slice's file moves/import repoints — but it is
reported per the brief's instruction that "any OTHER failure is a real finding," not silently
folded into the accepted waiver.

## Unresolved risks

- The `apps/api` root-test-run flake (section 6) was not root-caused beyond what the test's own
  error message states; it was not chased further because doing so is out of scope for a read-only
  verification pass and risks mutating the shared dev database.
