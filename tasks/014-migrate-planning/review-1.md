## Verdict

The plan is **not implementation-ready**.

D1 is technically acyclic and would preserve Drizzle’s schema visibility, but its stated justification rests on a false claim: moving `projectionSettings` back into `db/schema.ts` would **not** require changing `db/schema.smoke.test.ts`. That simpler, precedent-aligned alternative should be reconsidered before implementation.

A second blocking error is F11/R1: `autopilot.goals` is a scheduled planning-data consumer, so the proposed roadmap correction would replace one inaccurate cron description with another.

## BLOCKING findings

### B1 — D1 rejects the simplest alternative on a false premise

The plan says moving `projectionSettings` back into `db/schema.ts` “forces an edit” to the existing smoke test [TASK.md:106](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:106), [TASK.md:108](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:108). F5 makes the same claim [TASK.md:43](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:43).

That is false.

The existing test compares the object exported by the database barrel with the object exported by the planning schema [schema.smoke.test.ts:17](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:17), [schema.smoke.test.ts:19](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:19). If:

```ts
// db/schema.ts
export const projectionSettings = pgTable(...);

// modules/planning/schema.ts
export { projectionSettings } from "../../db/schema.ts";
```

then both imports still resolve to the same object and the test passes unmodified. The runtime assertion at [schema.smoke.test.ts:20](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:20) does not encode where the definition physically lives.

That alternative is materially simpler:

- Planning would follow the same transitional thin-schema convention as ledger, credit, investments, and protection.
- `db/schema.ts` would no longer import any planning schema surface.
- There would be no extra `tables.ts` transitional abstraction for task 1.9 to remove.
- The existing smoke test would remain unchanged.
- Drizzle Kit would continue to have its single schema entry point [drizzle.config.ts:7](/home/udai/PennyPilot/apps/api/drizzle.config.ts:7), [drizzle.config.ts:9](/home/udai/PennyPilot/apps/api/drizzle.config.ts:9).
- The physical table definition would still be verbatim, so no SQL migration should result.

This does reverse task 0.3’s physical-placement choice, but “a previous task placed it there” is not by itself an architectural constraint. The current task already proposes another physical move—from `schema.ts` to `tables.ts`—so it cannot consistently treat physical relocation as prohibited.

The plan should either choose the uniform thin re-export approach or give a stronger technical reason for preserving physical ownership now. The current “test-enforced” rationale is incorrect.

### B2 — F11 and roadmap change R1 omit the scheduled `autopilot.goals` planning path

F11 says only `bills.remind` touches a planning table on a schedule and that no other planning cron exists [TASK.md:74](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:74). R1 proposes correcting the roadmap based on that claim [TASK.md:184](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:184), [TASK.md:186](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:186).

But the code schedules `autopilot.goals` weekly [jobs/index.ts:221](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:221), [jobs/index.ts:224](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:224). Its worker invokes `runGoalReview`, and the plan itself recognizes this path in F10 [TASK.md:69](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:69).

`runGoalReview` calls `evaluateGoalPlans` [autopilot.ts:229](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:229), [autopilot.ts:235](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:235). That function calls `listGoals` and `getGoalProgress` [autopilot.ts:195](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:195), [autopilot.ts:197](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:197), [autopilot.ts:201](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:201). Those services query the planning-owned `goals` table directly [goals.ts:47](/home/udai/PennyPilot/apps/api/src/services/goals.ts:47), [goals.ts:53](/home/udai/PennyPilot/apps/api/src/services/goals.ts:53), and goal progress also reads projection settings [goals.ts:248](/home/udai/PennyPilot/apps/api/src/services/goals.ts:248).

Therefore the accurate statement is:

- There is no budget-rollover or subscription-detection cron.
- `bills.remind` is the scheduled bill/subscription path.
- `autopilot.goals` is a scheduled consumer of planning’s goal/projection services and tables.
- Budget-alert evaluation is reactive through the alerts queue rather than cron-driven.

R1 must preserve this distinction instead of saying only `bills.remind` schedules planning-table work.

### B3 — The proposed schema verification does not prove every required relational query surface

D1 would, in fact, expose all six planning tables to Drizzle because `createDb` passes the complete `* as schema` namespace from `db/schema.ts` [db/index.ts:3](/home/udai/PennyPilot/apps/api/src/db/index.ts:3), [db/index.ts:14](/home/udai/PennyPilot/apps/api/src/db/index.ts:14), and D1 keeps all planning tables exported through that barrel.

However, the proposed new smoke test only describes:

- object identity for six tables,
- two enums,
- a special three-hop identity check for `projectionSettings`

[TASK.md:153](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:153), [TASK.md:154](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:154).

The existing database smoke test checks `db.query.users` and `db.query.projectionSettings` only [schema.smoke.test.ts:34](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:34), [schema.smoke.test.ts:46](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:46). Yet planning production code relies on at least:

- `db.query.budgets` [budgets.ts:27](/home/udai/PennyPilot/apps/api/src/services/budgets.ts:27)
- `db.query.budgetLines` [budgets.ts:40](/home/udai/PennyPilot/apps/api/src/services/budgets.ts:40)
- `db.query.goals` [goals.ts:47](/home/udai/PennyPilot/apps/api/src/services/goals.ts:47)
- `db.query.subscriptionDismissals` [bills.ts:112](/home/udai/PennyPilot/apps/api/src/services/bills.ts:112)
- `db.query.projectionSettings` [projection-settings.ts:9](/home/udai/PennyPilot/apps/api/src/modules/planning/services/projection-settings.ts:9)

`budgetAlerts` is used through the query builder rather than `db.query`, but should still be in the runtime schema.

The plan must add a constructed-Drizzle assertion covering `db.query` for every planning table that is expected to appear there. This is especially warranted because the user-facing design requirement explicitly calls out relational query availability.

## D1 technical assessment

### The proposed graph is acyclic

As proposed, the relevant local graph would be:

```text
modules/planning/schema.ts
  ├─→ ../../db/schema.ts
  └─→ ./tables.ts
         └─→ ../../db/core-schema.ts

db/schema.ts
  ├─→ ./core-schema.ts
  └─→ ../modules/planning/tables.ts
```

There is no path from `tables.ts` back to either planning’s barrel or the database barrel. `core-schema.ts` imports only Drizzle primitives and defines `users` [core-schema.ts:1](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:1), [core-schema.ts:11](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:11).

Other checked surfaces do not introduce a hidden back edge:

- `db/index.ts` imports the database barrel but is not imported by either schema leaf [db/index.ts:3](/home/udai/PennyPilot/apps/api/src/db/index.ts:3).
- `drizzle.config.ts` names only `./src/db/schema.ts` [drizzle.config.ts:7](/home/udai/PennyPilot/apps/api/drizzle.config.ts:7), [drizzle.config.ts:9](/home/udai/PennyPilot/apps/api/drizzle.config.ts:9).
- No `relations(...)` declarations exist under `apps/api/src`, so there is no relations module adding another edge.
- `db/core-schema.ts` has no dependency on `db/schema.ts` or any module schema.

AC3’s wording is nevertheless imprecise: it says `db/schema.ts` “imports/re-exports only” `core-schema.ts` and planning’s `tables.ts` [TASK.md:201](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:201), even though the file obviously also imports Drizzle packages and contains all remaining definitions [schema.ts:1](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1). It should say “its only local schema dependencies are …”.

### Existing table-object identity would survive D1

D1’s re-export chain would preserve one table object:

```text
tables.ts definition
  → planning/schema.ts named re-export
  → db/schema.ts star re-export
```

Therefore the existing equality assertion would still pass [schema.smoke.test.ts:18](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:18), [schema.smoke.test.ts:20](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:20).

The assertion message would become stale because it says the object is re-exported “from modules/planning/schema.ts” [schema.smoke.test.ts:22](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:22), while `db/schema.ts` would actually re-export from `tables.ts`. That does not make the test fail, but “passes unmodified” is not the same as “remains precisely documented.”

### Drizzle Kit and `db.query` should remain intact

The schema namespace passed to Drizzle comes from `db/schema.ts` [db/index.ts:3](/home/udai/PennyPilot/apps/api/src/db/index.ts:3), [db/index.ts:15](/home/udai/PennyPilot/apps/api/src/db/index.ts:15). Under D1 it would still contain:

- `projectionSettings`, re-exported from `tables.ts`
- `budgets`, `budgetLines`, `budgetAlerts`, `goals`, and `subscriptionDismissals`, still physically declared in the barrel
- both enums

The five flat definitions currently occur at [schema.ts:561](/home/udai/PennyPilot/apps/api/src/db/schema.ts:561), [schema.ts:563](/home/udai/PennyPilot/apps/api/src/db/schema.ts:563), [schema.ts:579](/home/udai/PennyPilot/apps/api/src/db/schema.ts:579), [schema.ts:598](/home/udai/PennyPilot/apps/api/src/db/schema.ts:598), [schema.ts:682](/home/udai/PennyPilot/apps/api/src/db/schema.ts:682), [schema.ts:693](/home/udai/PennyPilot/apps/api/src/db/schema.ts:693), and [schema.ts:736](/home/udai/PennyPilot/apps/api/src/db/schema.ts:736).

Thus Drizzle Kit should still see every table and generate no SQL diff. This conclusion is based on the actual exported namespace, not merely the visual import graph.

### Characterization of rejected alternatives

1. **Move `projectionSettings` back into `db/schema.ts`: unfairly rejected.** It does not force a smoke-test edit and is the clearest alternative for this transitional phase.

2. **Accept the cycle: fairly rejected.** The cycle is real, and avoiding reliance on ESM evaluation/re-export behavior matches the explicit convention in the other modules [ledger/schema.ts:21](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:21), [credit/schema.ts:22](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.ts:22).

3. **Have services import owned tables directly from `db/schema.ts`: fairly rejected.** It would discard the established local schema boundary described at [credit/schema.ts:15](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.ts:15) and [ledger/schema.ts:14](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:14).

4. **Physically move all tables now: directionally fair, but overstated as “blocked.”** It is not intrinsically impossible. It would require decomposing additional FK targets or SCCs, particularly `goals` and ledger’s `categories`, and is therefore an inappropriate expansion for a pure-relocation task. The relevant current FK edges are real: `accounts → goals` [schema.ts:198](/home/udai/PennyPilot/apps/api/src/db/schema.ts:198), `budgetLines → categories` around [schema.ts:579](/home/udai/PennyPilot/apps/api/src/db/schema.ts:579), and investments’ goal references at [schema.ts:1284](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1284) and [schema.ts:1446](/home/udai/PennyPilot/apps/api/src/db/schema.ts:1446).

5. **A clearly better option exists:** restore `projectionSettings` to `db/schema.ts` and make planning’s `schema.ts` one uniform named re-export of all six tables and two enums. This is the plan’s first rejected alternative, but once its false smoke-test claim is removed, it is the cleanest transitional design.

If physical planning ownership must be preserved for policy reasons, use a specific filename such as `projection-settings-table.ts` rather than `tables.ts`. A generic `tables.ts` containing exactly one of the module’s six tables is misleading.

### Task 1.9 naming and ownership risk

Task 1.9 explicitly requires every module’s `schema.ts` to hold the real definitions it owns, not transitional re-exports [01.09-cross-module-ports.md:16](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:16), [01.09-cross-module-ports.md:20](/home/udai/PennyPilot/tasks/01.09-cross-module-ports.md:20).

D1 would leave two transitional planning surfaces:

- `schema.ts`, containing mixed physical and reverse re-exports
- `tables.ts`, physically owning only `projectionSettings`

The plan does record this for task 1.9 [TASK.md:190](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:190), so it is not forgotten. The naming is still confusing because `tables.ts` sounds like the module’s authoritative physical table collection. Prefer either the uniform thin schema or a narrowly named leaf.

## Other plan findings

### NB1 — F1’s inventory is correct, but “half-migrated” is not

Planning currently has one of eight route groups migrated, one of six tables physically migrated, and one service slice. Calling it “half-migrated” [TASK.md:18](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:18) is inaccurate.

The concrete inventory is correct:

- `plugin.ts` is 17 lines.
- `schema.ts` is 13 lines.
- The route, service, and two tests total 315 lines.
- Including `plugin.ts` and `schema.ts`, the slice totals 345 lines.

The roadmap does list eight route groups, including projection settings [01.05-migrate-planning.md:10](/home/udai/PennyPilot/tasks/01.05-migrate-planning.md:10), so seven remain flat.

### NB2 — AC7 arithmetic is internally consistent only because the plan invents a third schema test

The real precedent counts are:

| Module | `schema.smoke.test.ts` | `plugin.test.ts` |
|---|---:|---:|
| ledger | 2 | 1 |
| credit | 2 | 1 |
| investments | 2 | 1 |
| protection | 2 | 1 |

Examples are visible at [ledger/schema.smoke.test.ts:36](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.smoke.test.ts:36), [ledger/schema.smoke.test.ts:46](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.smoke.test.ts:46), and [ledger/plugin.test.ts:32](/home/udai/PennyPilot/apps/api/src/modules/ledger/plugin.test.ts:32). Protection follows the same 2+1 structure [protection/schema.smoke.test.ts:20](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.smoke.test.ts:20), [protection/schema.smoke.test.ts:30](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.smoke.test.ts:30), [protection/plugin.test.ts:23](/home/udai/PennyPilot/apps/api/src/modules/protection/plugin.test.ts:23).

Therefore strict precedent plus two demo tests would add:

```text
2 schema + 1 plugin + 2 route = 5
842 → 847
```

The plan explicitly proposes a novel third schema test [TASK.md:154](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:154), so its stated `+6` arithmetic [TASK.md:212](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:212) is mathematically correct as written:

```text
3 schema + 1 plugin + 2 route = 6
842 → 848
```

But it is not what the precedent files contain. The plan should plainly call the third test a D1-specific addition, or preferably fold the three-hop identity assertion into the existing tables test and expect `842 → 847`. If B3’s comprehensive `db.query` runtime test is added as a separate case, that may again change the delta and must be reconciled explicitly.

I re-ran the real API suite: it currently reports exactly 842 tests, 842 pass, 0 fail.

### NB3 — The move scope count is presented ambiguously

D2 says “Moves into `modules/planning/` (18 files)” [TASK.md:119](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:119), then lists 7 routes, 11 services, and 6 tests [TASK.md:120](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:120), [TASK.md:125](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:125).

That is 18 production files plus 6 tests, or 24 moved files total. AC9’s “18 moved files” [TASK.md:217](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:217) apparently means production files only. State that explicitly.

### NB4 — The plan should enumerate the import rewrite matrix for the moved files

The outside-importer inventory is complete. The six outside files are:

- `services/notifications.ts`
- `services/autopilot.ts`
- `services/ai/summary.ts`
- `services/ai/tools.ts`
- `jobs/index.ts`
- `modules/investments/services/sip-commitments.ts`

Their current imports are visible at [notifications.ts:7](/home/udai/PennyPilot/apps/api/src/services/notifications.ts:7), [autopilot.ts:6](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:6), [ai/tools.ts:6](/home/udai/PennyPilot/apps/api/src/services/ai/tools.ts:6), [jobs/index.ts:5](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:5), and [sip-commitments.ts:6](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-commitments.ts:6).

However, moving the production files also requires many depth and split-import changes inside those files. Examples include:

- `budgets.ts` must split planning-owned `budgets`/`budgetLines` from external dependencies and adjust `db`, `lib`, `ownership`, and `periods` paths [budgets.ts:11](/home/udai/PennyPilot/apps/api/src/services/budgets.ts:11).
- `goals.ts` currently mixes owned `goals` with external `alertLedger`, `holdingEvents`, `retirementDetails`, and `transactions` in one import [goals.ts:12](/home/udai/PennyPilot/apps/api/src/services/goals.ts:12).
- `bills.ts` mixes owned `subscriptionDismissals` with external `recurringTemplates` and `alertLedger` [bills.ts:5](/home/udai/PennyPilot/apps/api/src/services/bills.ts:5).
- `cashflow.ts` has flat shared-service, database, library, ledger-module, and investments-module imports that all change depth [cashflow.ts:4](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:4).
- The six moved tests must change their source import specifiers, such as [goal-plan.test.ts:3](/home/udai/PennyPilot/apps/api/src/services/goal-plan.test.ts:3) and [reports.test.ts:6](/home/udai/PennyPilot/apps/api/src/services/reports.test.ts:6).

The plan’s “split-import rule and depth adjustments” is directionally adequate, but a source-aware import-resolution gate should be added, as the protection precedent did. Clean typechecking catches most omissions, but an explicit check that no relative import resolves to any deleted flat path is stronger and consistent with the previous refined plan.

### NB5 — Plugin registration order should be specified explicitly

The current registration order is:

```text
budgets
dashboard
notifications
goals
investments
cashflow
bills
credit
protection
insights
reports
...
projection-settings
```

[app.ts:123](/home/udai/PennyPilot/apps/api/src/app.ts:123) through [app.ts:137](/home/udai/PennyPilot/apps/api/src/app.ts:137).

The plan says the planning plugin will register all eight groups but does not state their internal order [TASK.md:165](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:165). It should specify:

```text
budgets, dashboard, goals, cashflow, bills, insights, reports, projection-settings
```

That preserves the relative order of planning groups as they appear today. Collapsing them at the current budget position necessarily moves some groups around unrelated plugins, explaining the expected raw route-tree re-nesting while preserving the canonical method/path surface.

### NB6 — “Only new behaviour” is slightly misleading

The objective says the only new behavior is new tests and doc comments [TASK.md:9](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:9). Tests and comments are not runtime behavior. The actual intended runtime behavior is no change.

The relocation does change Fastify encapsulation and registration nesting. Existing global auth and security hooks are installed before route registration [app.ts:174](/home/udai/PennyPilot/apps/api/src/app.ts:174), [app.ts:227](/home/udai/PennyPilot/apps/api/src/app.ts:227), so they should continue to cover the nested routes. The proposed demo-mode tests are useful compatibility coverage, but the plan should describe this as structural change with invariant behavior, not “new behavior.”

### NB7 — Cache assertions are accurate but should distinguish moved from untouched files

There are exactly four cached aggregate call sites:

- dashboard, TTL 300 [dashboard.ts:20](/home/udai/PennyPilot/apps/api/src/services/dashboard.ts:20)
- trends, TTL 300 [dashboard.ts:50](/home/udai/PennyPilot/apps/api/src/services/dashboard.ts:50)
- forecast, TTL 300 [cashflow.ts:14](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:14), [cashflow.ts:56](/home/udai/PennyPilot/apps/api/src/services/cashflow.ts:56)
- insights, TTL 300 [insights route:22](/home/udai/PennyPilot/apps/api/src/routes/insights.ts:22)

There are exactly ten invocation sites of `invalidateUserCache`:

- one in `app.ts` [app.ts:69](/home/udai/PennyPilot/apps/api/src/app.ts:69)
- one in budgets [budgets route:32](/home/udai/PennyPilot/apps/api/src/routes/budgets.ts:32)
- two in credit EMIs [emis.ts:29](/home/udai/PennyPilot/apps/api/src/modules/credit/routes/emis.ts:29), [emis.ts:32](/home/udai/PennyPilot/apps/api/src/modules/credit/routes/emis.ts:32)
- six in SIP routes, from [sips.ts:52](/home/udai/PennyPilot/apps/api/src/modules/investments/routes/sips.ts:52) through [sips.ts:108](/home/udai/PennyPilot/apps/api/src/modules/investments/routes/sips.ts:108)

The budget and four cache-producing files move, so they are not literally “untouched”; their relevant import specifiers change. The cache keys, TTLs, and invocation bodies should be byte-preserved.

### NB8 — Budget-alert verification is good but should include the producer chain

The plan correctly preserves:

- evaluation in `services/notifications.ts` [notifications.ts:87](/home/udai/PennyPilot/apps/api/src/services/notifications.ts:87)
- preference gating in the alerts worker [jobs/index.ts:345](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:345), [jobs/index.ts:349](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:349)
- reactive enqueue after ledger mutation [app.ts:67](/home/udai/PennyPilot/apps/api/src/app.ts:67), [app.ts:70](/home/udai/PennyPilot/apps/api/src/app.ts:70)
- direct budget-write invalidation/enqueue [budgets route:31](/home/udai/PennyPilot/apps/api/src/routes/budgets.ts:31), [budgets route:33](/home/udai/PennyPilot/apps/api/src/routes/budgets.ts:33)

AC4 checks the worker and `notifications.ts` import [TASK.md:204](/home/udai/PennyPilot/tasks/014-migrate-planning/TASK.md:204), but the safest invariant also includes both enqueue producers. No new functional behavior test is strictly necessary for a move because the existing subscriber test covers the event path, but the final diff review should quote these producer calls as well.

## F1–F14 factual disposition

- **F1 — Partly wrong.** The concrete inventory and 345-line total are correct; “half-migrated” is not.
- **F2 — Correct.** The reverse export is at [schema.ts:22](/home/udai/PennyPilot/apps/api/src/db/schema.ts:22), and the other modules deliberately avoid it.
- **F3 — Correct.** Adding reverse re-exports to the current planning schema would form a real cycle.
- **F4 — Partly wrong/overstated.** The cited FK constraints are real, but physical movement is not impossible; it requires broader schema decomposition and is therefore out of scope.
- **F5 — Wrong.** The test enforces object identity, not physical file ownership. Moving the definition back into the database barrel with a thin planning re-export would pass it unmodified.
- **F6 — Correct.** Drizzle Kit has one entry point, and dropping the planning export would remove the table from schema discovery.
- **F7 — Correct.** Evaluation and preference gating remain in system-oriented flat services [notifications.ts:87](/home/udai/PennyPilot/apps/api/src/services/notifications.ts:87), [prefs.ts:69](/home/udai/PennyPilot/apps/api/src/services/prefs.ts:69).
- **F8 — Correct in substance.** The cache invalidation inventory and ten-call count are accurate.
- **F9 — Correct.** Task 1.8 currently claims `projection_settings` [01.08-migrate-system.md:10](/home/udai/PennyPilot/tasks/01.08-migrate-system.md:10), while task 1.5 also claims it [01.05-migrate-planning.md:10](/home/udai/PennyPilot/tasks/01.05-migrate-planning.md:10).
- **F10 — Correct.** `autopilot.ts` imports the three planning services [autopilot.ts:6](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:6), [autopilot.ts:8](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:8), is 241 lines, and is job-driven.
- **F11 — Wrong.** `autopilot.goals` is also a scheduled planning-data path.
- **F12 — Correct.** The five named production services have no same-basename colocated test.
- **F13 — Correct.** The API suite presently passes 842/842; the two snapshot hashes also exactly match the values stated in the plan.
- **F14 — Correct based on the current web tree.** The web planning endpoints are centralized in the identified query/page files, including budgets/dashboard/trends, goals/cashflow/forecast/bills, settings, insights, and reports.

## Required plan changes before implementation

1. Reopen D1 and correct F5. Prefer moving `projectionSettings` back into `db/schema.ts` with a uniform thin planning schema, or document a technically compelling reason not to.
2. Correct F11 and R1 to include the scheduled `autopilot.goals` planning path.
3. Add a runtime smoke assertion for every planning `db.query.<table>` surface.
4. Reconcile AC7 with the real precedent counts and explicitly identify any D1-specific extra test.
5. Clarify that 24 files move in total: 18 production files and 6 tests.
6. Specify the planning plugin’s internal route-registration order.
7. Add a source-aware deleted-import resolution check.
8. Rename `tables.ts` to a specific leaf name if D1 is retained.

Until B1–B3 are resolved, the plan should remain in `PLAN_REVIEW`.