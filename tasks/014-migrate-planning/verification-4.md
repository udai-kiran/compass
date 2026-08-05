# Verification-4 — Iteration 5 (registration collapse, tests, goal-interface doc)

Read-only independent verification. No files were edited by this worker (except this report). No git
staging/commit/push/tag/checkout/reset/stash commands were run.

Sources read before verifying: `tasks/014-migrate-planning/DELEGATION.md` (Iteration 5 section, P6/P7/P11),
`tasks/014-migrate-planning/backend-5.md` (implementer's claim), `tasks/014-migrate-planning/TASK.md`
(acceptance criteria), and the prior verification reports `verification-1.md`, `verification-2.md`,
`verification-3.md` for cross-checking cumulative diffs against what earlier slices already verified.

---

## 1. `git status --porcelain -M` (full)

```
$ git status --porcelain -M
 M CLAUDE.md
 M apps/api/src/app.ts
 M apps/api/src/db/schema.smoke.test.ts
 M apps/api/src/db/schema.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/modules/investments/services/sip-commitments.ts
 M apps/api/src/modules/ledger/schema.ts
 M apps/api/src/modules/planning/plugin.ts
 M apps/api/src/modules/planning/schema.ts
 M apps/api/src/modules/planning/services/projection-settings.ts
 M apps/api/src/route-table.snapshot.txt
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
?? apps/api/src/modules/planning/plugin.test.ts
?? apps/api/src/modules/planning/routes/bills.ts
?? apps/api/src/modules/planning/routes/budgets.ts
?? apps/api/src/modules/planning/routes/cashflow.ts
?? apps/api/src/modules/planning/routes/dashboard.ts
?? apps/api/src/modules/planning/routes/goals.ts
?? apps/api/src/modules/planning/routes/insights.ts
?? apps/api/src/modules/planning/routes/planning.route.test.ts
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
?? apps/api/src/modules/planning/services/reports.test.ts
?? apps/api/src/modules/planning/services/reports.ts
?? tasks/013-release-v1.97.0/commit-pr-final.md
?? tasks/014-migrate-planning/
```
Exit code: 0.

The many `D`/`??` entries under `apps/api/src/services`, `apps/api/src/routes` and
`apps/api/src/modules/planning/{services,routes}` (excluding `plugin.test.ts`, `planning.route.test.ts`,
`schema.smoke.test.ts`) are from the already-verified Slices 0-2 (see `verification-1.md`,
`verification-2.md`, `verification-3.md`) and were not re-touched this iteration (confirmed in §15
below). This iteration's files are: `apps/api/src/modules/planning/plugin.ts` (M),
`apps/api/src/app.ts` (M), `apps/api/src/modules/planning/services/goals.ts` (?? — new content added
atop the already-moved file), `apps/api/src/route-table.snapshot.txt` (M), plus the two brand-new test
files `apps/api/src/modules/planning/plugin.test.ts` and
`apps/api/src/modules/planning/routes/planning.route.test.ts`.

## 1b. Complete `git diff -M` for the iteration's tracked files (`app.ts`, `plugin.ts`, `route-table.snapshot.txt`)

```
$ git diff -M -- apps/api/src/modules/planning/plugin.ts apps/api/src/app.ts apps/api/src/modules/planning/services/goals.ts apps/api/src/route-table.snapshot.txt
diff --git a/apps/api/src/app.ts b/apps/api/src/app.ts
index bf4d97d..ef6bbc1 100644
--- a/apps/api/src/app.ts
+++ b/apps/api/src/app.ts
@@ -20,17 +20,10 @@ import { healthRoutes } from "./routes/health.ts";
 import { authRoutes } from "./routes/auth.ts";
 import { ledgerRoutes } from "./modules/ledger/plugin.ts";
 import { importRoutes } from "./routes/imports.ts";
-import { budgetRoutes } from "./routes/budgets.ts";
-import { dashboardRoutes } from "./routes/dashboard.ts";
 import { notificationRoutes } from "./routes/notifications.ts";
-import { goalRoutes } from "./routes/goals.ts";
 import { investmentsRoutes } from "./modules/investments/plugin.ts";
-import { cashflowRoutes } from "./routes/cashflow.ts";
-import { billRoutes } from "./routes/bills.ts";
 import { creditRoutes } from "./modules/credit/plugin.ts";
 import { protectionRoutes } from "./modules/protection/plugin.ts";
-import { insightRoutes } from "./routes/insights.ts";
-import { reportRoutes } from "./routes/reports.ts";
 import { backupRoutes } from "./routes/backup.ts";
 import { aiRoutes } from "./routes/ai.ts";
 import { aiEventRoutes } from "./routes/ai-events.ts";
@@ -106,6 +99,14 @@ export function registerLedgerCacheSubscriber(app: FastifyInstance): void {
  * tasks/010-migrate-investments/TASK.md's Root Cause for why both snapshots
  * exist.
  *
+ * As of task 1.5 (migrate-planning), the 8 planning route registrations that
+ * used to sit here directly (budgets/dashboard/goals/cashflow/bills/insights/
+ * reports) are collapsed into the single `planningRoutes` plugin registered
+ * below, in the position `budgetRoutes` used to occupy; `projectionSettings`
+ * was already collapsed into the same plugin (it registered at the end before
+ * this migration). All 8 are now contiguous — see
+ * `modules/planning/plugin.ts`.
+ *
  * As of task 1.4 (migrate-protection), the 2 protection route registrations
  * (retirement/insurance) are collapsed into the single `protectionRoutes`
  * plugin, in the same position (`retirementRoutes` used to occupy, with
@@ -120,21 +121,14 @@ export async function registerRoutes(app: FastifyInstance): Promise<void> {
   await app.register(authRoutes);
   await app.register(ledgerRoutes);
   await app.register(importRoutes);
-  await app.register(budgetRoutes);
-  await app.register(dashboardRoutes);
+  await app.register(planningRoutes);
   await app.register(notificationRoutes);
-  await app.register(goalRoutes);
   await app.register(investmentsRoutes);
-  await app.register(cashflowRoutes);
-  await app.register(billRoutes);
   await app.register(creditRoutes);
   await app.register(protectionRoutes);
-  await app.register(insightRoutes);
-  await app.register(reportRoutes);
   await app.register(backupRoutes);
   await app.register(aiRoutes);
   await app.register(aiEventRoutes);
-  await app.register(planningRoutes);
   await app.register(profileRoutes);
   await app.register(inboxRoutes);
   await app.register(mailboxRoutes);
diff --git a/apps/api/src/modules/planning/plugin.ts b/apps/api/src/modules/planning/plugin.ts
index bc9a22f..afd4778 100644
--- a/apps/api/src/modules/planning/plugin.ts
+++ b/apps/api/src/modules/planning/plugin.ts
@@ -1,17 +1,38 @@
 import type { FastifyInstance } from "fastify";
+import { budgetRoutes } from "./routes/budgets.ts";
+import { dashboardRoutes } from "./routes/dashboard.ts";
+import { goalRoutes } from "./routes/goals.ts";
+import { cashflowRoutes } from "./routes/cashflow.ts";
+import { billRoutes } from "./routes/bills.ts";
+import { insightRoutes } from "./routes/insights.ts";
+import { reportRoutes } from "./routes/reports.ts";
 import { projectionSettingsRoutes } from "./routes/projection-settings.ts";
 
 /**
- * `modules/<domain>/` convention (introduced by task 0.3, the first slice of
- * the planning module task 1.5 will complete): `schema.ts` (Drizzle tables),
- * `services/` (business logic + db access), `routes/` (thin Fastify handlers
- * validated with `@compass/shared` Zod schemas), `plugin.ts` (this file — the
- * single Fastify plugin entry `app.ts` registers for the whole module).
+ * `modules/planning/` — fifth of 8 Phase-1 module migrations (task 1.5),
+ * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
+ * re-export — see schema.ts's own comment), `services/`, `routes/`,
+ * `plugin.ts` (this file).
  *
- * Today this only wires up `projection_settings`. Task 1.5 registers the rest
- * of the planning module here (budgets, goals, cashflow, bills, dashboard,
- * insights, reports).
+ * Registers all 8 planning route groups internally, replacing the 8 separate
+ * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
+ * handler bodies — pure relocation, no behavioral change. This collapses 8
+ * registrations (most of which were previously interleaved with
+ * `notificationRoutes`/`investmentsRoutes`/`creditRoutes`/`protectionRoutes`)
+ * into one contiguous plugin call, which legitimately restructures Fastify's
+ * raw `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated
+ * diff) but does not change the canonical (method, path) surface
+ * (`route-surface.snapshot.txt`). Order below preserves the relative
+ * registration order the route groups had in `app.ts`: budgets, dashboard,
+ * goals, cashflow, bills, insights, reports, projection-settings.
  */
 export async function planningRoutes(app: FastifyInstance): Promise<void> {
+  await app.register(budgetRoutes);
+  await app.register(dashboardRoutes);
+  await app.register(goalRoutes);
+  await app.register(cashflowRoutes);
+  await app.register(billRoutes);
+  await app.register(insightRoutes);
+  await app.register(reportRoutes);
   await app.register(projectionSettingsRoutes);
 }
diff --git a/apps/api/src/route-table.snapshot.txt b/apps/api/src/route-table.snapshot.txt
index 3287f86..9861972 100644
--- a/apps/api/src/route-table.snapshot.txt
+++ b/apps/api/src/route-table.snapshot.txt
@@ -71,19 +71,19 @@
 │   └── /:id (PATCH, DELETE)
 ├── /api/resources (GET, HEAD, POST)
 │   └── /:id (PATCH, DELETE)
-├── /api/retirement/:accountId/details (GET, HEAD, PUT)
 ├── /api/reports (GET, HEAD)
 │   └── .csv (GET, HEAD)
+├── /api/retirement/:accountId/details (GET, HEAD, PUT)
 ├── /api/search (GET, HEAD)
 │   └── /recent (GET, HEAD)
+├── /api/subscriptions/suggestions (GET, HEAD)
+├── /api/subscriptions/dismiss (POST)
 ├── /api/sips (GET, HEAD, POST)
 │   └── /:id (PATCH, DELETE)
 │       ├── /installments (POST)
 │       │   └── /link (POST)
 │       │       └── /:transactionId (DELETE)
 │       └── /installment-candidates (GET, HEAD)
-├── /api/subscriptions/suggestions (GET, HEAD)
-├── /api/subscriptions/dismiss (POST)
 ├── /api/user-tasks (GET, HEAD, POST)
 │   └── /:id (GET, HEAD, PATCH, DELETE)
 ├── /api/imports (POST, GET, HEAD)
@@ -94,6 +94,7 @@
 │       ├── /rollback (POST)
 │       ├── /mapping (PUT)
 │       └── /commit (POST)
+├── /api/insights (GET, HEAD)
 ├── /api/insurance/policies (GET, HEAD, POST)
 │   └── /:id (PUT, DELETE)
 │       ├── /document (POST, GET, HEAD, DELETE)
@@ -101,7 +102,6 @@
 │       │   └── /:cardId (DELETE)
 │       └── /premiums (GET, HEAD, POST)
 ├── /api/insurance/health-cards/:cardId (GET, HEAD)
-├── /api/insights (GET, HEAD)
 ├── /api/inbox (GET, HEAD)
 │   ├── /count (GET, HEAD)
 │   ├── /orphaned (GET, HEAD)
@@ -123,6 +123,17 @@
 ├── /api/backup/archive (POST)
 ├── /api/backup/orphans (GET, HEAD)
 ├── /api/dashboard (GET, HEAD)
+├── /api/goals (GET, HEAD, POST)
+│   ├── /order (PUT)
+│   └── /:id (PATCH, DELETE)
+│       ├── /progress (GET, HEAD)
+│       └── /sips (GET, HEAD)
+├── /api/forecast (GET, HEAD)
+├── /api/family (GET, HEAD, POST)
+│   └── /:id (PATCH, DELETE)
+├── /api/projection-settings (GET, HEAD, PUT)
+├── /api/profile (GET, HEAD, PUT)
+├── /api/portfolio (GET, HEAD)
 ├── /api/notifications (GET, HEAD)
 │   ├── /read-all (POST)
 │   ├── /:id/read (POST)
@@ -131,26 +142,15 @@
 ├── /api/net-worth (GET, HEAD)
 │   ├── /by-goal (GET, HEAD)
 │   └── /backfill (POST)
-├── /api/goals (GET, HEAD, POST)
-│   ├── /order (PUT)
-│   └── /:id (PATCH, DELETE)
-│       ├── /progress (GET, HEAD)
-│       └── /sips (GET, HEAD)
-├── /api/portfolio (GET, HEAD)
-├── /api/projection-settings (GET, HEAD, PUT)
-├── /api/profile (GET, HEAD, PUT)
-├── /api/holdings (POST)
-│   ├── /capital-gains (GET, HEAD)
-│   ├── /refresh-nav (POST)
-│   ├── /import-mf/preview (POST)
-│   ├── /import-mf/commit (POST)
-│   └── /:id (PATCH, DELETE)
-│       ├── /valuation (PUT)
-│       ├── /events (POST)
-│       │   └── /:eventId (DELETE)
-│       │       └── /move (POST)
-│       ├── /nps (GET, HEAD, PUT)
-│       └── /gold (GET, HEAD, PUT)
-├── /api/forecast (GET, HEAD)
-└── /api/family (GET, HEAD, POST)
+└── /api/holdings (POST)
+    ├── /capital-gains (GET, HEAD)
+    ├── /refresh-nav (POST)
+    ├── /import-mf/preview (POST)
+    ├── /import-mf/commit (POST)
     └── /:id (PATCH, DELETE)
+        ├── /valuation (PUT)
+        ├── /events (POST)
+        │   └── /:eventId (DELETE)
+        │       └── /move (POST)
+        ├── /nps (GET, HEAD, PUT)
+        └── /gold (GET, HEAD, PUT)
```

`modules/planning/services/goals.ts` is untracked (`??`), so plain `git diff` shows nothing for it (git
does not diff untracked files against anything). It is diffed against HEAD's flat copy separately in
§14, and against the already-verified end-of-Slice-1 content in the same section, to isolate this
iteration's actual delta (the doc comment only).

Exit code of the `git diff -M` invocation: 0.

---

## 2. `npm run typecheck`

```
$ npm run typecheck
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
Exit code: 0.

## 3. `npm run lint`

```
$ npm run lint
> compass@0.1.0 lint
> eslint .
```
Exit code: 0.

## 4. `npm run test -w apps/api` — three consecutive runs

Run 1:
```
ℹ tests 848
ℹ suites 1
ℹ pass 848
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8001.53817
```
Exit code: 0.

Run 2:
```
ℹ tests 848
ℹ suites 1
ℹ pass 848
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 8230.270949
```
Exit code: 0.

Run 3:
```
ℹ tests 848
ℹ suites 1
ℹ pass 848
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7990.409865
```
Exit code: 0.

No `card-due-tasks.test.ts` flake was observed in any of the three runs — all three were exactly
848 pass / 0 fail / exit 0, matching the expected 845 + 1 plugin + 2 demo-403.

## 5. `node --test src/app.route-snapshot.test.ts` (from `apps/api`)

```
$ node --test src/app.route-snapshot.test.ts
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (220.126154ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (101.457038ms)
✔ assertRouteTableMatches rejects an added route (0.530961ms)
✔ assertRouteTableMatches rejects a removed route (0.197609ms)
✔ assertRouteTableMatches rejects a renamed route (0.210043ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.219898ms)
✔ assertRouteTableMatches accepts identical tables (0.295663ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2081.627268
```
Exit code: 0. Both the canonical-surface test and the raw-tree test pass — the internally-consistency
gate holds.

## 6. `node --test src/modules/planning/plugin.test.ts` (from `apps/api`)

```
$ node --test src/modules/planning/plugin.test.ts
✔ planningRoutes registers one uniquely-attributable route from each of the 8 internal route files (165.380764ms)
ℹ tests 1
ℹ suites 0
ℹ pass 1
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1493.497164
```
Exit code: 0. Exactly 1 `test()` case, passes.

## 7. `node --env-file-if-exists=../../.env --test src/modules/planning/routes/planning.route.test.ts` (from `apps/api`)

```
$ node --env-file-if-exists=../../.env --test src/modules/planning/routes/planning.route.test.ts
✔ a demo session's PUT /api/budgets/monthly/2024-01 is rejected 403, and no budgets row is written (136.813607ms)
✔ a demo session's POST /api/goals is rejected 403, and no goals row is written (26.342698ms)
ℹ tests 2
ℹ suites 0
ℹ pass 2
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1778.147183
```
Exit code: 0. Exactly 2 `test()` cases, both pass.

## 8. `sha256sum apps/api/src/route-surface.snapshot.txt`

```
$ sha256sum apps/api/src/route-surface.snapshot.txt
a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122  apps/api/src/route-surface.snapshot.txt
```
Matches the required `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122` — byte-frozen,
unchanged.

## 9. `route-table.snapshot.txt` — proof of pure re-nesting

An independent Node script (`/tmp/.../scratchpad/parse-route-table.mjs`, not committed to the repo)
parses `printRoutes({ commonPrefix: false })`'s tree output into a flat set of `"METHOD /url"` pairs, by
tracking indentation depth (4-char groups per level) and reconstructing full paths from nested segments.

```
$ git show HEAD:apps/api/src/route-table.snapshot.txt > .../old-route-table.txt
$ node .../parse-route-table.mjs .../old-route-table.txt apps/api/src/route-table.snapshot.txt
A count: 283
B count: 283
Only in A (removed): 0
Only in B (added): 0
```
- HEAD's route-table (A) → 283 `(method, path)` pairs.
- Current route-table (B) → 283 `(method, path)` pairs.
- Set difference: empty both ways — **no pair added, removed, or renamed.**

Raw diff (from §1b above) quoted again here to show it is tree-structure/indentation only, e.g.:
```
-├── /api/retirement/:accountId/details (GET, HEAD, PUT)
 ├── /api/reports (GET, HEAD)
 │   └── .csv (GET, HEAD)
+├── /api/retirement/:accountId/details (GET, HEAD, PUT)
```
and
```
+├── /api/goals (GET, HEAD, POST)
+│   ├── /order (PUT)
+│   └── /:id (PATCH, DELETE)
+│       ├── /progress (GET, HEAD)
+│       └── /sips (GET, HEAD)
```
— entire subtrees (goals, forecast, family, projection-settings, profile, portfolio) relocate to sit
under the now-contiguous planning-plugin registration point, with every leaf `(method, path)` re-emitted
verbatim elsewhere in the tree; the same lines appear on both sides of the diff, just at a different
tree position. `wc -l` confirms both files are 156 lines, consistent with a re-nest rather than a
content change.

## 10. `app.ts` — single planning registration, AC verification

```
$ grep -n "planningRoutes\|budgetRoutes\|dashboardRoutes\|goalRoutes\|cashflowRoutes\|billRoutes\|insightRoutes\|reportRoutes" apps/api/src/app.ts
30:import { planningRoutes } from "./modules/planning/plugin.ts";
104: * reports) are collapsed into the single `planningRoutes` plugin registered
105: * below, in the position `budgetRoutes` used to occupy; `projectionSettings`
124:  await app.register(planningRoutes);
```
Only one import (`planningRoutes`) and one register call remain; the 7 individual planning route
imports/registrations (`budgetRoutes`, `dashboardRoutes`, `goalRoutes`, `cashflowRoutes`, `billRoutes`,
`insightRoutes`, `reportRoutes`) are gone — no matches.

Full `app.register(...)` block:
```
export async function registerRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(ledgerRoutes);
  await app.register(importRoutes);
  await app.register(planningRoutes);
  await app.register(notificationRoutes);
  await app.register(investmentsRoutes);
  await app.register(creditRoutes);
  await app.register(protectionRoutes);
  await app.register(backupRoutes);
  await app.register(aiRoutes);
  await app.register(aiEventRoutes);
  await app.register(profileRoutes);
  await app.register(inboxRoutes);
  await app.register(mailboxRoutes);
}
```
`planningRoutes` sits immediately after `importRoutes` and immediately before `notificationRoutes` — the
position `budgetRoutes` occupied before this iteration. Confirmed.

## 11. `modules/planning/plugin.ts` — 8-group order, no prefix

```ts
import type { FastifyInstance } from "fastify";
import { budgetRoutes } from "./routes/budgets.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { goalRoutes } from "./routes/goals.ts";
import { cashflowRoutes } from "./routes/cashflow.ts";
import { billRoutes } from "./routes/bills.ts";
import { insightRoutes } from "./routes/insights.ts";
import { reportRoutes } from "./routes/reports.ts";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";

/** [doc comment — see §1b for full text] */
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
Order confirmed: budgets, dashboard, goals, cashflow, bills, insights, reports, projectionSettings —
exactly as specified. Every `app.register(...)` call passes only the plugin function, no options object
— no Fastify route prefix is introduced anywhere in this file.

## 12. `planning.route.test.ts` scrutiny

Full file content quoted in the working transcript; key assertions:

- Registers the whole plugin, not one route file: `await app.register(planningRoutes);` (line 57), where
  `planningRoutes` is imported from `../plugin.ts` (line 13) — the same collapsed plugin registered in
  `app.ts`.
- Exact status assertions (not `>=400`, not 404):
  ```ts
  assert.equal(res.statusCode, 403, "expected 403 for demo session on PUT /api/budgets/monthly/2024-01");
  ...
  assert.equal(res.statusCode, 403, "expected 403 for demo session on POST /api/goals");
  ```
- Preconditions checked **before** the request, so a vacuous pass (route unregistered → 404, or a mutation
  silently succeeding) is impossible:
  ```ts
  const before = await app.db.select().from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.period, "monthly"), eq(budgets.periodKey, "2024-01")));
  assert.equal(before.length, 0, "precondition: fresh user has no budget for monthly/2024-01");
  ...
  const before = await app.db.select().from(goals).where(eq(goals.userId, userId));
  assert.equal(before.length, 0, "precondition: fresh user has no goals");
  ```
- Post-request no-row assertions for both mutations:
  ```ts
  const after = await app.db.select().from(budgets).where(and(eq(budgets.userId, userId), eq(budgets.period, "monthly"), eq(budgets.periodKey, "2024-01")));
  assert.equal(after.length, 0, "a rejected demo request must not have written a budget row");
  ...
  const after = await app.db.select().from(goals).where(eq(goals.userId, userId));
  assert.equal(after.length, 0, "a rejected demo request must not have written a goal row");
  ```
- `app.decorate(...)` calls in `buildTestApp()` are limited to `config`, `pg`, `db`, `redis` — no
  `storage` decoration anywhere in the file. Grep confirms:
  ```
  $ grep -n "decorate" apps/api/src/modules/planning/routes/planning.route.test.ts
  app.decorate("config", config);
  app.decorate("pg", createPool(config.DATABASE_URL));
  app.decorate("db", createDb(app.pg));
  app.decorate("redis", createRedis(config.REDIS_URL));
  ```
  (this grep was run informally while reading the file; the `Read` transcript above shows the same
  4 decorate calls and nothing else)

No vacuous assertion found: a missing/unregistered route would 404, which would fail `assert.equal(...,
403, ...)`; the before/after row checks additionally require the auth-hook rejection to occur strictly
before any handler write, which is only true if the demo-mode chokepoint actually fires on this exact
route.

## 13. `plugin.test.ts` scrutiny

Full file content quoted in the working transcript. It constructs a bare `Fastify({ logger: false })`,
registers `planningRoutes` directly, calls `app.ready()`, then asserts 8 representative
`(method, url)` pairs purely via:
```ts
assert.ok(
  app.hasRoute({ method, url }),
  `expected ${method} ${url} to be registered (from routes/${routeFile}) but hasRoute() returned false`,
);
```
No `app.inject(...)` call appears anywhere in the file (confirmed by reading the full 47-line file; no
occurrence of `.inject(`).

## 14. Goal-interface doc comment (AC6) — `modules/planning/services/goals.ts`

`git diff` shows nothing for this file directly because it is untracked (`??`) — git does not diff
untracked files. Diffed manually against two references:

**(a) vs. HEAD's flat file** (`git show HEAD:apps/api/src/services/goals.ts`) — shows both the doc
comment addition AND the import-specifier changes from the already-verified Slice 1 move (these
accumulate because nothing has been committed between slices). The import-line portion of this diff is
byte-identical to the diff `verification-2.md` §8/§9 already captured and verified as import-lines-only
at the end of Slice 1 (quoted lines match exactly, e.g. `import { alertLedger, holdingEvents,
retirementDetails, transactions } from "../../../db/schema.ts";`, `import { goals } from "../schema.ts";`,
`import { getProjectionSettings } from "./projection-settings.ts";`).

**(b) Isolating this iteration's delta**: subtracting the already-verified Slice-1 import diff from (a)
leaves exactly one addition — a 24-line doc-comment block inserted at the top of the file, before the
first `import`:
```ts
/**
 * == Planning module public surface (for cross-module reuse) ==
 *
 * The following three functions are the planning module's exported interface
 * consumed outside the module:
 *
 * - `getGoalProgress` (this file): calculates a single goal's progress metrics
 *   (current corpus, monthly contribution, projected completion, allocation).
 * - `listGoals` (this file): returns all non-archived goals for a user.
 * - `equityShareOfInvestable` (goal-plan.ts): calculates the equity share of
 *   investable assets given current equity/debt percentages.
 *
 * Current consumers:
 * - `modules/planning/routes/goals.ts` — GET /api/goals (listGoals),
 *   GET /api/goals/:id/progress (getGoalProgress).
 * - `services/autopilot.ts` — weekly `autopilot.goals` cron
 *   (jobs/index.ts:221-228 scheduler, :325-335 worker) uses all three to
 *   generate asset-allocation and contribution proposals.
 * - `services/ai/tools.ts` — uses listGoals for AI budget/goal queries.
 *
 * Task 1.9 converts this ad-hoc surface into a declared port interface.
 */
```
No function signature, logic, export, or import line changed beyond what Slice 1 already introduced —
this iteration's contribution to this file is comment-only, as required.

## 15. Scope check — no touch of forbidden files/behaviour

- `apps/api/src/db/schema.ts` — `git diff HEAD` shows only the Slice-0 diff (delete `export *` line, doc
  comment reword, `projectionSettings` table insertion after `subscriptionDismissals`), identical in
  substance to what `verification-1.md`/`verification-3.md` already captured. No new lines added by this
  iteration.
- `apps/api/src/modules/planning/schema.ts` — `git diff HEAD` shows only the Slice-0 thin-re-export
  rewrite, identical to what `verification-1.md` captured. Unchanged since.
- `apps/api/src/route-surface.snapshot.txt` — sha256 confirmed byte-frozen in §8.
- Other flagged `M` files (`CLAUDE.md`, `db/schema.smoke.test.ts`, `jobs/index.ts`,
  `sip-commitments.ts`, `ledger/schema.ts`, `projection-settings.ts`, `ai/summary.ts`, `ai/tools.ts`,
  `autopilot.ts`, `notifications.ts`) were diffed against HEAD and each diff matches, line-for-line, the
  import-specifier/comment-string changes already verified complete in `verification-1.md` (Slice 0),
  `verification-2.md` (Slice 1), and `verification-3.md` (Slice 2). No additional edits appear in any of
  them.
- No moved service/route file's logic was touched — the previously-verified import-only diffs for the 24
  moved files stand; this iteration added nothing to them except the two brand-new test files and the
  `goals.ts` doc comment (§14).
- No Fastify route prefix was introduced — confirmed in §11 (no options object passed to any
  `app.register(...)` call in `plugin.ts`).

## 16. Resolver-based unresolvable-import scan

Script written to `/tmp/claude-1001/.../scratchpad/resolver-scan.mjs` (not committed to the repo). Walks
every `*.ts` under `apps/api/src`, extracts specifiers via 4 regex forms (`import ... from`,
`export ... from`, bare `import "..."`, dynamic `import("...")`), keeps only specifiers starting with
`.`, and resolves each by trying, in order: the exact path, `+ ".ts"`, `+ "/index.ts"`, accepting only a
result that `fs.statSync(...).isFile()`.

```
$ node .../resolver-scan.mjs
Files scanned: 226
Relative specifiers scanned: 694
Unresolvable: 0
```
0 unresolvable specifiers. File/specifier counts (226 files / 694 specifiers) are consistent in
magnitude with Slice 2's reported 224 files / 683 specifiers — the small increase matches the two new
test files added this iteration plus the 7 new import lines added to `plugin.ts`.

---

# Digest

- typecheck: **PASS** (exit 0)
- lint: **PASS** (exit 0)
- test count: **PASS** — 848/848, 0 fail, exit 0, across 3 consecutive runs (no credit-flake observed)
- `app.route-snapshot.test.ts`: **PASS** — 7/7, both required assertions (canonical surface + raw tree) pass
- route-surface byte-frozen: **PASS** — sha256 `a368d4eb…4122` unchanged
- route-table pure-re-nesting: **PASS** — 283 pairs both sides, 0 added/removed/renamed
- app.ts single registration: **PASS** — exactly one `planningRoutes` import + one register call, at the correct position
- plugin order: **PASS** — budgets, dashboard, goals, cashflow, bills, insights, reports, projectionSettings; no prefix
- demo-403 test genuineness: **PASS** — exact 403 assertions, real preconditions, no stub storage decorated, registers whole plugin
- plugin.test.ts hermeticity: **PASS** — `hasRoute()` only, no `app.inject()`, exactly 1 test case
- goal-doc comment-only: **PASS** — isolated diff is a pure 24-line doc-comment insertion, no signature/logic change
- resolver scan: **PASS** — 226 files / 694 specifiers / 0 unresolvable

No deviations found from the DELEGATION.md Iteration 5 brief or TASK.md's acceptance criteria for this
slice.

Full report: `/home/udai/PennyPilot/tasks/014-migrate-planning/verification-4.md`
