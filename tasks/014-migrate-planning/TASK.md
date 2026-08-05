# Task: 014-migrate-planning (roadmap 1.5)

## Status
COMPLETE & SHIPPED — commit `bede18a`, PR #163 merged to main as `f58ad0f`, tagged **v1.99.0**
(publish CI triggered). Implemented across 5 slices, independently verified, Codex-reviewed (1 blocking
finding fixed), roadmap R1-R4 landed. `apps/api` 848/848, both snapshots correct, zero migration diff.
Staged as an explicit 64-file list (git detected all 24 moves as renames); the stray
`tasks/013-release-v1.97.0/commit-pr-final.md` was deliberately left untracked.

## Objective
Move the planning domain (7 flat route files, 11 flat services, 6 colocated test files) into
`apps/api/src/modules/planning/`, joining the `projection_settings` slice task 0.3 already put there,
and bring planning onto the same thin-schema convention as the four completed modules.
**No runtime behaviour changes.** URLs, handler bodies, SQL, cache keys and TTLs are all invariant; the
structural change is Fastify registration nesting plus file locations. The only additions are test files
and doc comments.

## Root Cause
Not a defect — roadmap task 1.5, the fifth of eight Phase-1 module migrations (1.1 ledger, 1.2 credit,
1.3 investments, 1.4 protection are `done`).

## Decisive facts (verified; investigation-1.md, investigation-2.md, review-1.md)

**F1 — planning is partially migrated.** `modules/planning/` exists from task 0.3 with `plugin.ts`(17),
`schema.ts`(13), and the projection-settings route/service + their 2 tests (345 lines total). Precisely:
**1 of 8 route groups, 1 of 6 tables, 1 service.** It is missing `schema.smoke.test.ts` and
`plugin.test.ts`, which all four completed modules have. The roadmap's "8 route groups" is stale — 7 are
flat, `projection-settings` is done. (Corrected per review-1 NB1: this is *partially*, not "half",
migrated.)

**F2 — planning is the one module `db/schema.ts` re-exports FROM.** `db/schema.ts:22` is
`export * from "../modules/planning/schema.ts";` because `projection_settings` was *physically* moved by
0.3 (a single-owner table whose only FK is to `users` in the cycle-free `db/core-schema.ts` leaf). Every
other module went the opposite way — a thin re-export out of `db/schema.ts`, with each module's
`schema.ts` documenting that the barrel deliberately does **not** `export *` back
(`modules/credit/schema.ts:21-24`, `modules/ledger/schema.ts:21-25`).

**F3 — therefore the naive move creates a real ES-module cycle.** If `modules/planning/schema.ts` gains
thin re-exports of the 5 still-flat planning tables while `db/schema.ts:22` still `export *`s from it,
the graph becomes `planning/schema.ts → db/schema.ts → planning/schema.ts`. This is the exact hazard the
other four modules' schema comments are written to avoid. Resolving it is the one genuinely novel piece
of design in this task; everything else is the established recipe.

**F4 — the 5 remaining tables are out of scope to physically move.** `goals.id` is referenced by
`accounts.goalId` (ledger, `db/schema.ts:198`), `holdings.goalId` (investments, `db/schema.ts:1284`) and
`sips.goalId` (investments, `db/schema.ts:1444-1446`); `budget_lines.categoryId` and
`budget_alerts.categoryId` reference ledger's `categories` (`db/schema.ts:586-588`, `606-608`). A
physical relocation would require decomposing the `goals`/`categories` FK component as well — possible,
but that is task 1.9's chartered SCC work, not a pure-relocation task's. (Reworded per review-1: "not
impossible", just out of scope.)

**F5 — `db/schema.smoke.test.ts` enforces table-object IDENTITY, not physical location.**
It asserts `schema.projectionSettings === projectionSettings` where the right-hand side is imported from
`../modules/planning/schema.ts` (`:8,17-23`), and that `db.query.projectionSettings` exists on a
constructed Drizzle instance (`:34,46-53`). **Any** arrangement in which both specifiers resolve to one
object passes it unmodified — including moving the definition into `db/schema.ts` and re-exporting it
from planning. *(Corrected: plan iteration 1 claimed this test forced the definition to stay in the
module. That was wrong, and it was the sole stated reason for rejecting the simplest design. Found by
review-1 B1; verified myself by reading the test.)*

**F6 — `drizzle.config.ts:9` has exactly one entry point**, `./src/db/schema.ts`, and `db/index.ts:3,14`
builds `db.query.*` from `import * as schema` of that barrel. The barrel must keep exporting every table
or `db:generate` produces a destructive diff and `db.query.<table>` disappears.

**F7 — `evaluateBudgetAlerts` is not in a planning file.** It lives in `services/notifications.ts:87-122`
and its pref gate `prefEnabled` in `services/prefs.ts:69-78`. Both belong to the **system** module —
roadmap 1.8 explicitly lists `notifications`, `notification_prefs`, `alert_ledger`. The roadmap's "this
module owns the budget-evaluation subscriber" is misleading. Only `notifications.ts:7`'s
`import { getUtilization } from "./budgets.ts"` needs repointing.

**F8 — dashboard/trends cache invalidation is scattered outside planning**, by design. Exactly 10
`invalidateUserCache` call sites: `app.ts:69` (generic `ledger.mutated` subscriber),
`routes/budgets.ts:32` (planning's own — moves with the route), `modules/credit/routes/emis.ts:29,32`,
and `modules/investments/routes/sips.ts:52,62,72,82,92,108`. The 8 outside planning import only the
generic `invalidateUserCache` from `services/cache.ts`, which is not a planning file, so none of them
breaks on this move.

**F9 — roadmap 1.8 wrongly claims `projection_settings`.** `tasks/01.08-migrate-system.md:10` lists it
among the system module's tables, but 0.3 placed it in planning and 1.5 lists it too. Two tasks claim
one table; 1.8's list is the stale one.

**F10 — `services/autopilot.ts` (241 lines) is homeless.** It depends on 3 planning services
(`cashflow.ts`, `goal-plan.ts`, `goals.ts` — `autopilot.ts:6,7,9`), is routed nowhere, and is driven by
the weekly `autopilot.goals` cron (`jobs/index.ts:221-228`, worker `:325-335`). It appears in no roadmap
task's route/table/service list (1.6 "automation/AI" is scoped to `services/ai/*` only).

**F11 — the roadmap over-lists crons, but there are TWO scheduled planning paths, not one.**
No budget-rollover and no subscription-detection cron exists; budget-alert evaluation is reactive off
`ledger.mutated`, not scheduled. The scheduled planning work is:
(a) `bills.remind` (`jobs/index.ts:177-181,254-258`, plus a boot re-run at `:379-381`) → `bills.ts`;
(b) `autopilot.goals` (`jobs/index.ts:221-228,325-335`) → `runGoalReview` → `evaluateGoalPlans`
(`autopilot.ts:229,235,195-201`) → `listGoals`/`getGoalProgress`, which read the planning-owned `goals`
table (`goals.ts:47,53`) and projection settings (`goals.ts:248`).
*(Corrected: iteration 1 claimed only `bills.remind`. Found by review-1 B2; verified myself.)*

**F12 — 5 of 11 planning services have no colocated test**: `budgets.ts`, `goals.ts`, `cashflow.ts`,
`bills.ts`, `dashboard.ts`. This does not block a relocation (the import-lines-only diff gate and the
byte-frozen route surface prove it), but it means behaviour is not test-guarded, so the diff gate is
load-bearing and must not be softened.

**F13 — baseline.** `npm run test -w apps/api` → **842 pass, 0 fail, exit 0** (independently re-run and
confirmed by review-1). `route-surface.snapshot.txt` sha256 `a368d4eb…4122`; `route-table.snapshot.txt`
sha256 `7800feb9…55c8` (both confirmed by review-1).

**F14 — no web consumer builds a planning path outside the snapshot** (call sites enumerated in
investigation-2.md §6).

**F15 — four doc-comment blocks across three files, plus one test assertion message, go stale under D1.**
`modules/ledger/schema.ts:9-12` ("unlike task 0.3's single-table `projection_settings` case") and
`:21-25` ("unlike `projection_settings`, a single-owner table where the barrel genuinely needs the
module's only copy"); `db/schema.ts:32-35`; `modules/planning/plugin.ts:5-13` (stale via P6 rather than
D1 specifically). Also the assertion *message* at `db/schema.smoke.test.ts:22` ("re-exported from
modules/planning/schema.ts") becomes directionally backwards. (My own finding while validating
review-1 B1; not raised by that review.)

**F16 — `CLAUDE.md:49` is live guidance that D1 falsifies.** It states "`db/schema.ts` stays the schema
barrel — it re-exports each module's `schema.ts` — and both it and every `modules/<domain>/schema.ts`
import shared identity tables from `db/core-schema.ts`". After D1 the barrel re-exports **no** module
schema, and no module `schema.ts` imports `core-schema.ts` (all five are thin named re-exports). The
first clause is in fact already inaccurate for the four completed modules — planning was the only case
that ever made it true. This is repository instruction text, not historical record, so it must be
corrected. (Found by review-2 B1; verified myself at `CLAUDE.md:49`.)

## Design decision D1 — the schema cycle (the one novel piece)

**Chosen: make planning uniform with the other four modules — move `projectionSettings` into
`db/schema.ts` and turn `modules/planning/schema.ts` into a pure thin named re-export.**

- Move the `projectionSettings` `pgTable()` definition **verbatim** (including its doc comment) from
  `modules/planning/schema.ts` into `db/schema.ts`, grouped with the other planning tables. Reorder
  nothing else.
- Delete `db/schema.ts:22` (`export * from "../modules/planning/schema.ts";`).
- `modules/planning/schema.ts` becomes a thin named re-export of all 6 tables + 2 enums
  (`budgets`, `budgetLines`, `budgetAlerts`, `goals`, `subscriptionDismissals`, `projectionSettings`,
  `budgetPeriod`, `goalType`) from `../../db/schema.ts`, following `modules/credit/schema.ts` exactly.

Why this is right:
- **Acyclic and uniform**: `planning/schema.ts → db/schema.ts → core-schema.ts`. `db/schema.ts` ends up
  depending on **no module at all** — a barrel invariant that is trivial to state and test (AC3).
- **One convention, zero special cases.** All five modules then look identical, and task 1.9 has exactly
  one file per module to convert into physical ownership.
- `db/schema.smoke.test.ts` still passes unmodified: identity is preserved through the re-export (F5).
- Zero SQL: the definition text is unchanged, so `db:generate` diffs to nothing (AC10 proves it).

This reverses task 0.3's physical placement of one table. That is a deliberate, recorded trade: 0.3 moved
it as a scaffold demonstration, and 1.9 owns the real physical decomposition for all eight modules at
once under a proper SCC analysis. Carrying one bespoke half-migrated schema until then buys nothing.

Rejected alternatives (recorded so 1.9 does not relitigate):
- **Leaf + barrel split** (`modules/planning/tables.ts` keeping `projectionSettings` physical, barrel
  re-exporting the rest). This was iteration 1's choice. It is genuinely acyclic, but it was selected on
  a false premise (F5) and leaves planning with a bespoke two-file schema plus a `tables.ts` that would
  hold one of the module's six tables — a misleading name and an extra transitional surface for 1.9 to
  unpick. Rejected on review-1 B1.
- **Accept the cycle** (F3). It would probably *work*, since `db/schema.ts` never dereferences a planning
  binding at module-eval time and ES re-export bindings resolve lazily. "Probably works via evaluation
  order" is precisely what four existing schema comments call out as the thing to avoid.
- **Have planning services import their own tables from `../../../db/schema.ts`.** Cycle-free and cheap,
  but abandons the module-boundary discipline: 1.9 would then have to edit every planning service
  instead of one `schema.ts`.
- **Physically move all 6 tables now.** Out of scope per F4; task 1.9.

## Design decision D2 — scope boundary

**Moves into `modules/planning/` — 18 production files + 6 colocated tests = 24 files total:**
- routes (7): `budgets.ts`(130), `goals.ts`(64), `cashflow.ts`(35), `bills.ts`(40), `dashboard.ts`(26),
  `insights.ts`(27), `reports.ts`(31)
- services (11): `budgets.ts`(286), `goals.ts`(360), `goal-allocation.ts`(99), `goal-plan.ts`(130),
  `goal-projection.ts`(133), `goal-returns.ts`(162), `cashflow.ts`(157), `bills.ts`(166),
  `dashboard.ts`(127), `insights.ts`(284), `reports.ts`(160)
- tests (6): the colocated tests of `goal-allocation`, `goal-plan`, `goal-projection`, `goal-returns`,
  `insights`, `reports` (804 lines), each moving beside its service

**Stays flat, with reasons:**
- `services/notifications.ts`, `services/prefs.ts` → task 1.8 system module (F7)
- `services/periods.ts`, `services/cache.ts`, `services/ownership.ts`, `services/balances.ts` → shared
  utilities, task 1.9 flat-services cleanup
- `services/autopilot.ts` → homeless (F10); recorded for 1.9, not adopted here
- `services/ai/*` → task 1.6
- all 5 flat table definitions → `db/schema.ts`, task 1.9 (F4)

## Design decision D3 — what counts as stale documentation

D1 contradicts statements written by earlier tasks. Only **live guidance** is corrected:
`CLAUDE.md`, source-code doc comments, and roadmap task files still `status: todo`.

**Completed task records under `tasks/` are historical evidence and are NOT rewritten** — a plan,
review, investigation or verification report is a record of what was true and decided when it ran.
Rewriting them to match later architecture destroys the audit trail and would make every future
architectural change an unbounded documentation edit. Specifically **not** touched:
`tasks/006-module-scaffold-and-route-gate/`, `tasks/007-migrate-ledger/`,
`tasks/009-claude-md-schema-ownership-note/` (review-2 lists concrete lines in each). Instead, this
task's own record states that D1 deliberately supersedes 0.3/006's physical placement and 009's
planning-specific example — a forward pointer, not a retroactive edit.

`modules/planning/services/projection-settings.test.ts:14`'s cascade comment stays: review-2 confirms it
remains true under a re-export.

## Scope
- `apps/api/src/modules/planning/**` (create/move)
- `apps/api/src/db/schema.ts` — receives the `projectionSettings` definition, loses the `export *` line,
  doc comment updated. **The one intentional exception to the standing "no `pgTable` edits in
  `db/schema.ts`" rule of tasks 1.1-1.4**, gated by AC2 + AC10.
- `apps/api/src/app.ts` — collapse 7 registrations + the existing planning one into one
- import-specifier-only edits in: `services/notifications.ts:7`, `services/autopilot.ts:6,7,9`,
  `services/ai/summary.ts:5,6`, `services/ai/tools.ts:6,7,8,10`, `jobs/index.ts:5`,
  `modules/investments/services/sip-commitments.ts:6`
- comment-only edits: `modules/ledger/schema.ts:9-12,21-25`, `db/schema.smoke.test.ts:22` message (F15)
- `CLAUDE.md:49` — correct the schema-ownership sentence (F16). Live guidance, in scope.
- `apps/api/src/route-table.snapshot.txt` (regenerate — will legitimately change)
- roadmap: `tasks/01.05-migrate-planning.md`, `tasks/01.08-migrate-system.md`,
  `tasks/01.09-cross-module-ports.md`, `tasks/README.md`

## Dependencies
1.1 (`done`) established the recipe. No blocking dependency.

## Plan
- P1: Baseline — re-measure the 842 count, confirm both snapshot sha256s match F13 before touching
  anything. Capture the drizzle content-hash manifest.
- P2: **Slice 0 (schema, D1).** Move the `projectionSettings` definition into `db/schema.ts`
  **immediately after the `subscriptionDismissals` definition ends (`db/schema.ts:747`)**, character-for-
  character identical including its doc comment and its four columns in their existing order
  (`user_id`, `equity_return_bps`, `created_at`, `updated_at`) — proven by extracting the block before
  and after and diffing the two extracts to empty (review-2 NB2/NB3). Delete the `export *` line;
  rewrite `modules/planning/schema.ts` as a thin named re-export of 6 tables
  + 2 enums modelled on `modules/credit/schema.ts`; update the F15 doc comments and F16's
  `CLAUDE.md:49`. Add
  `modules/planning/schema.smoke.test.ts` — 3 `test()` cases: (1) the 6 tables resolve with correct
  table names, (2) the 2 enums, (3) a constructed-Drizzle runtime assertion that `db.query.<table>`
  exists for **all 6** planning tables (per review-1 B3).
  Gate before P3: typecheck, `db/schema.smoke.test.ts` green **unmodified**, `db:generate` zero diff.
  Independently verified before proceeding — this is the novel part.
- P3: **Slice 1 (budgets + goals).** Move `services/{budgets,goals,goal-allocation,goal-plan,
  goal-projection,goal-returns}.ts` + their 4 tests and `routes/{budgets,goals}.ts`. Apply the
  split-import rule (own tables from `../schema.ts`, every other table from `../../../db/schema.ts`,
  never from a peer module's `schema.ts`) and the depth adjustments. Flip
  `modules/planning/services/projection-settings.ts:6` to the now intra-module `./goal-returns.ts`, and
  `services/goals.ts:22` to `./projection-settings.ts`.
- P4: **Slice 2 (the other five).** Move `services/{cashflow,bills,dashboard,insights,reports}.ts` + the
  2 tests and `routes/{cashflow,bills,dashboard,insights,reports}.ts`, same discipline.
- P5: Update the 6 outside importers (Scope list) — import specifier changes only.
- P6: Rewrite `plugin.ts` to register all 8 route groups **in this order**: `budgets, dashboard, goals,
  cashflow, bills, insights, reports, projectionSettings` — preserving their relative order in today's
  `app.ts` (review-1 NB5). Update `app.ts` to a single `await app.register(planningRoutes);` at the
  position `budgetRoutes` occupies today (line 123), deleting the other 7 imports/registrations and the
  old line-137 planning registration. Add `plugin.test.ts` (1 `test()`, `hasRoute()` introspection only,
  never `app.inject()`).
- P7: Add `routes/planning.route.test.ts` — 2 demo-403 tests (`PUT /api/budgets/:period/:key` and
  `POST /api/goals`), each also asserting the mutation did not occur.
- P8: Confirm the 24 original flat paths no longer exist, and that no relative import anywhere under
  `apps/api/src` still resolves to one of them (AC12).
- P9: Compare (do not regenerate) `route-surface.snapshot.txt` — byte-identical. Regenerate
  `route-table.snapshot.txt` — a diff IS expected (8 registrations collapse to 1, same as task 1.2);
  read it and confirm it is pure re-nesting, no added/removed/renamed path.
- P10: `npm run db:generate` — zero diff, proven by the content-hash manifest before and after.
- P11: Document the goal interface (AC6) — a doc comment block naming
  `getGoalProgress`/`listGoals`/`equityShareOfInvestable` as the planning module's public surface, its
  real current consumers (`routes/goals.ts` and `services/autopilot.ts` via the weekly `autopilot.goals`
  cron, F11b), and 1.9's port plan. Doc only; no signature change.
- P12: Full gate — typecheck, lint, test. Read the complete diff.
- P13: Roadmap — R1-R4 below.

## Roadmap changes (P13)
- **R1** — `tasks/01.05-migrate-planning.md`: note `projection-settings` was already migrated by 0.3 (F1);
  correct the cron description to name **both** scheduled paths, `bills.remind` and `autopilot.goals`,
  and state that budget-alert evaluation is reactive rather than cron-driven (F11); replace AC2's
  misleading "owns the subscriber" framing with AC4's verifiable wording; tick the boxes with evidence;
  flip `status: todo` → `done` **last**.
- **R2** — `tasks/01.08-migrate-system.md:10`: remove `projection_settings` from the system module's
  table list (F9), with a one-line note that planning owns it.
- **R3** — `tasks/01.09-cross-module-ports.md`: add `services/autopilot.ts` to the flat-services cleanup
  scope (F10).
- **R4** — `tasks/README.md`: update the 1.5 row.

## Acceptance Criteria
- AC1: `route-surface.snapshot.txt` byte-identical (sha256 still `a368d4eb…4122`).
  `route-table.snapshot.txt` regenerated; its diff contains no added, removed or renamed
  `(method, path)` — re-nesting only.
- AC2: `modules/planning/schema.ts` contains no `pgTable(` and no `pgEnum(`. `db/schema.ts` gains exactly
  one `pgTable(` (`projection_settings`, verbatim) and loses its `export *` line; no other table
  definition is added, removed or reordered. `db/schema.smoke.test.ts` passes **unmodified** — captured
  as evidence *before* the F15 message-string amendment, whose diff must be string-literals-only.
- AC3: `db/schema.ts` has no dependency on any module — its only local schema import/re-export is
  `./core-schema.ts`. (Wording tightened per review-1: this is about *local schema* dependencies; the
  file obviously still imports `drizzle-orm/pg-core`.)
- AC4: budget-alert evaluation unchanged: `evaluateBudgetAlerts` still in `services/notifications.ts`,
  still called from `jobs/index.ts`'s `alertsWorker` behind `prefEnabled(..., "budget")`, and **both**
  enqueue producers still intact (`app.ts:67-72` subscriber and `routes/budgets.ts:31-33`). The only
  delta is `notifications.ts:7`'s import specifier — quote its before/after line.
- AC5: dashboard/trends caching unchanged: the 4 `cached(...)` call sites keep byte-identical key names,
  TTLs and bodies (`"dashboard"`, `trends:${months}`, `"forecast:90"`, `insights:${period}`, all @300);
  of the 10 `invalidateUserCache` call sites, the 8 outside planning are byte-identical and untouched,
  and the 2 inside (`app.ts:69`, the budgets route) change in no way except file location.
- AC6: goal progress/projection documented as a public interface (P11), naming its real current
  consumers including the `autopilot.goals` cron.
- AC7: `npm run test -w apps/api` green, **842 → 848 (+6)** = 3 schema-smoke + 1 plugin + 2 demo-403.
  Note the precedent modules have **2** smoke cases and **1** plugin case each (review-1 NB2, counted in
  the real files); the third smoke case is a deliberate addition for review-1 B3's `db.query` coverage,
  not precedent. Re-measure the baseline first; if the delta is not exactly +6, explain it rather than
  round it away.
- AC8: typecheck exit 0, lint exit 0 across all 7 workspaces. Root `npm run test` may exit 1 **only**
  from the known, pre-existing `apps/extractor` `DATABASE_URL` packaging gap (waived identically by
  tasks 1.3 and 1.4); any other failure is a real one.
- AC9: the 18 moved **production** files' diffs consist **exclusively** of import-line changes; the 6
  moved test files likewise change only their import specifiers. No handler body, route URL, status code,
  Zod schema, SQL predicate or `userId` filter gained or lost.
- AC10: `npm run db:generate` produces zero diff, proven by a content-hash manifest of
  `apps/api/drizzle/` captured before and after.
- AC11: R1-R4 all landed, 1.5 `status: done` only after every other AC is proven.
- AC12: **every** relative import specifier under `apps/api/src` resolves to a file that exists —
  proven by resolving specifiers against their importing file's directory, not by substring grep and not
  by typecheck alone (review-1 NB4, strengthened by review-2 B2). This is the general form of "nothing
  still points at one of the 24 deleted paths", and unlike a grep it also catches same-directory
  specifiers such as `./budgets.ts` and extensionless ones.
- AC13: `CLAUDE.md:49` corrected per F16 — it must no longer claim the barrel re-exports module schemas
  or that module `schema.ts` files import `core-schema.ts`.

## Verification
- T1: sha256 of both snapshot files before and after.
- T2: `grep -c "pgTable(\|pgEnum(" modules/planning/schema.ts` → 0; `db/schema.ts` `pgTable(` count
  before/after differs by exactly +1.
- T3: `node --test src/db/schema.smoke.test.ts` with the file unmodified (`git diff` on it empty at that
  point).
- T4: import-graph proof for AC3.
- T5: `node --test src/modules/planning/schema.smoke.test.ts`
- T6: `node --test src/modules/planning/plugin.test.ts`
- T7: `node --env-file-if-exists=../../.env --test src/modules/planning/routes/planning.route.test.ts`
- T8: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts` (unmodified)
- T9: `npm run typecheck`
- T10: `npm run lint`
- T11: `npm run test -w apps/api` — before/after counts, +6 reconciled
- T12: `npm run test` (root)
- T13: `npm run db:generate` + drizzle manifest before/after
- T14: full `git diff`, read file by file
- T15: test each of the 24 expected-deleted paths explicitly (18 production + 6 tests) with
  `test ! -e <path>`, reporting one line per path — not a bare directory listing (review-2 NB4)
- T16: the literal before/after of `services/notifications.ts:7`
- T17 (AC12): a **resolver-based** check, not a grep. Walk every `*.ts` under `apps/api/src` and extract
  every static specifier in **all four** forms:
  1. `import … from "…"` — including `import type … from "…"` (still statically resolved)
  2. `export … from "…"`
  3. `import "…"` — **bare side-effect import**, which has no `from` clause
  4. literal `import("…")`

  Keep only specifiers beginning with `.`; **exclude** non-relative package specifiers such as
  `@compass/shared` and `node:*` — they are not paths relative to the importer.

  Resolution must accept only a **regular file**, never a bare directory. For each specifier try, in
  order: the exact path, then `+ .ts`, then `/index.ts`; accept the first that is a regular file
  (`fs.statSync(...).isFile()`). The repo convention is explicit `.ts` extensions (`CLAUDE.md:7`) under
  NodeNext resolution (`tsconfig.base.json:5-6`), so the exact-path case should carry essentially all of
  them; the fallbacks exist so the check does not produce false failures.

  Expected output: zero unresolvable specifiers. Report the count of files and specifiers scanned, so an
  empty result cannot be confused with a check that matched nothing.

  Run it **before** the migration too, to establish it reports zero on a clean tree. Review-3 ran an
  equivalent check on the current tree and got 223 files / 686 relative specifiers / 0 unresolvable —
  reproduce those magnitudes; a materially smaller scan count means the extractor is missing forms.
- T18: extract-and-diff proof that the moved `projectionSettings` block is character-identical (P2)

## Non-Goals
- Physically relocating the 5 remaining planning tables (F4 — task 1.9).
- Moving `notifications.ts`/`prefs.ts` (task 1.8) or `services/ai/*` (task 1.6).
- Adopting `services/autopilot.ts` into planning.
- Backfilling tests for the 5 untested planning services (F12) — out of scope, and the diff gate is what
  proves this relocation safe.
- Changing any route URL, handler body, Zod schema, cache key, TTL or SQL.
- Fixing the `apps/extractor` `DATABASE_URL` packaging gap.

## Review dispositions — review-1
- **B1 (D1 rejected the simplest option on a false premise) — VALID, ACCEPTED.** I verified
  `db/schema.smoke.test.ts` myself: it asserts object identity, not physical location, so F5 as written
  was false and it was my only stated reason for rejecting the uniform option. D1 rewritten to the
  uniform thin re-export; the leaf+barrel split is now a recorded rejected alternative. Follow-on I found
  while validating this and the review did not: F15, four doc comments plus one assertion message that
  go stale under the new D1, now in Scope.
- **B2 (F11 omits the scheduled `autopilot.goals` path) — VALID, ACCEPTED.** Verified the call chain.
  F11 rewritten to name both scheduled paths; R1 updated so the roadmap correction does not replace one
  inaccuracy with another.
- **B3 (smoke test does not cover every `db.query` surface) — VALID, ACCEPTED.** Folded in as the third
  smoke case in P2, with AC7 explicitly flagging it as beyond precedent.
- **NB1 ("half-migrated" inaccurate) — VALID.** F1 now states 1 of 8 routes, 1 of 6 tables, 1 service.
- **NB2 (AC7 arithmetic vs precedent) — VALID.** Precedent is 2+1, not 3+1. AC7 keeps +6 but now says
  plainly that the third case is a B3-driven addition rather than precedent.
- **NB3 (18 vs 24 files) — VALID.** D2 and AC9 now distinguish 18 production + 6 tests.
- **NB4 (source-aware deleted-import check) — VALID.** Added as AC12/T17.
- **NB5 (plugin registration order unspecified) — VALID.** Order fixed in P6.
- **NB6 ("only new behaviour" misleading) — VALID.** Objective reworded to "no runtime behaviour
  changes… the structural change is Fastify registration nesting plus file locations".
- **NB7 (cache files do move, so "untouched" is wrong) — VALID.** AC5 now separates the 8 untouched
  outside call sites from the 2 that move.
- **NB8 (include both enqueue producers) — VALID.** Added to AC4.
- **F4 "blocked" overstated — VALID.** Reworded to out-of-scope rather than impossible.
- **AC3 wording imprecise — VALID.** Now scoped to *local schema* dependencies.
- Review-1's independent re-runs agreeing with F13 (842/842) and both snapshot hashes are recorded as
  corroboration, not as a substitute for my own P1 baseline.

## Review dispositions — review-2
- **B1 (`CLAUDE.md:49` stale and omitted) — VALID, ACCEPTED.** Verified the line myself. This is the
  most consequential stale text precisely because it is instruction rather than record. Now F16, in
  Scope, in P2, and AC13. The review's related observation about completed task records is answered by
  D3: they are evidence and stay untouched.
- **B2 (T17 grep has false negatives) — VALID, ACCEPTED.** Decisive concrete case: `notifications.ts`
  and `autopilot.ts` both live in `services/` and import `./budgets.ts`, `./goals.ts`, `./cashflow.ts`,
  `./goal-plan.ts` — specifiers with no `services/` segment, so the old pattern could not see them, and
  a missed edit would have passed the check silently. T17 is now a resolver-based existence check over
  every relative specifier, with a pre-migration run to prove the check can fail and a scanned-count
  report so an empty result is meaningful. That generalizes past the 24 paths.
- **NB1 (F15 said "three" but listed four) — VALID.** F15 now reads "four doc-comment blocks across
  three files, plus one test assertion message", and notes the plugin comment is stale via P6, not D1.
- **NB2 (pgTable count does not prove "verbatim") — VALID.** P2 now requires an extract-and-diff of the
  moved block (T18); the counting check alone was too weak for the claim being made.
- **NB3 (insertion point ambiguous) — VALID.** Planning tables are split across two regions of
  `db/schema.ts`, so "grouped with the other planning tables" was genuinely ambiguous. Pinned to
  immediately after `subscriptionDismissals` (`db/schema.ts:747`), per the review's suggestion.
- **NB4 (T15 too weak) — VALID.** Now an explicit per-path existence assertion over all 24.
- Review-2's independent verification of the D1 import graph, object identity, the four-column
  assertion, all six `db.query` surfaces, the drizzle-kit zero-diff reasoning, F11's job wiring and the
  AC7 precedent counts (2+1 per module, so +6 → 848 is right) is recorded as corroboration. Its
  observation that zero migration diff cannot be *proven* before implementation is correct and is
  exactly why AC10's before/after manifest exists.

## Review dispositions — review-3
- **B1 (T17 omits side-effect imports; resolution not file-only) — VALID, ACCEPTED.** `import "./x.ts"`
  has no `from` clause, so my enumerated forms genuinely missed it, and "exists on disk" would let a
  directory pass. T17 now specifies all four specifier forms, explicit exclusion of package specifiers,
  and file-only resolution with an ordered candidate list.
- **Review-3's independent run of the equivalent check (223 files / 686 relative specifiers / 0
  unresolvable) — ACCEPTED as corroboration** that AC12's pre-migration expectation of zero is
  achievable, and folded into T17 as a magnitude cross-check against a silently under-matching
  extractor.
- **CLAUDE.md:49 characterization confirmed complete**, and leaving exact replacement prose to the
  implementer judged acceptable — the false propositions to remove are named precisely. It also
  confirms no *other* live-guidance sentence in `CLAUDE.md` is newly falsified, and notes `CLAUDE.md:43`
  was already imprecise about `app.ts` before this task — pre-existing, not mine to fix here.
- **D3 confirmed consistent with how 1.1-1.4 actually behaved** (live roadmap updated, completed records
  retained). No item classified as history is functioning as current guidance.
- **P2 insertion point confirmed**: `db/schema.ts:747` is the closing `);` of `subscriptionDismissals`,
  748 is blank, 749 starts the next declaration — insertion lands between complete declarations, and
  `projectionSettings` depends only on `users`, which is bound before all table declarations.
- **T15's 24-path set confirmed exact** (7 routes + 11 services + 6 tests), no path misnamed.
- **AC7 confirmed still 842 → 848 (+6)**; this revision added no test cases.

## Progress — Slice 0 (schema, D1): COMPLETE and independently verified
Implemented by `backend-engineer` (`backend-1.md`), verified by an uninvolved worker
(`verification-1.md`). Evidence I checked myself, both by reading the changed files and by reading the
literal output in the verification report:
- `apps/api` **845/845 pass, fail 0, exit 0** — 842 → 845 (+3), exactly the 3 new smoke cases.
- **Step-9 gate PASSED**: `git diff -- apps/api/src/db/schema.smoke.test.ts` empty and the test passes
  2/2 **unmodified** — the load-bearing proof that table-object identity survived the move.
- Both route snapshots byte-identical (`a368d4eb…4122`, `7800feb9…55c8`) — correct, this slice touches
  no routes.
- `db:generate` → "No schema changes, nothing to migrate"; 135-file drizzle manifest identical
  before/after (AC10).
- T18 extract-diff **empty** — the moved `projectionSettings` block is character-identical, doc comment
  and four columns in order.
- AC3 PASSED: `db/schema.ts`'s only local schema specifier is `./core-schema.ts` — the barrel now
  depends on no module.
- AC13 PASSED: exactly one `CLAUDE.md` line changed; both false propositions removed.
- typecheck exit 0, lint exit 0, `backup.test.ts` 13/13 unmodified.

### Coordinator error — AC2's literal gate was mis-specified
AC2/T2 said to prove the move by `grep -c "pgTable("`. The counts came back 1 (not 0) for
`modules/planning/schema.ts` and +2 (not +1) for `db/schema.ts`, because the **doc comments** written by
this very task contain the literal substrings `` `pgTable()` ``/`` `pgEnum()` `` inside backticks. The
property asserted is "no table is *defined* here"; the metric counts text occurrences. Semantically the
change is correct — I read both files myself and confirmed `modules/planning/schema.ts` contains only an
`export { … } from` and `db/schema.ts` gained exactly one real declaration.

This is the third instance in this series of the same coordinator failure mode — task 012's `--numstat`
gate, task 013's unsatisfiable `git diff | grep` redaction gate, and now this: **gating on a metric that
does not measure the asserted property.** The verifier was right to report the literal mismatch instead
of quietly reinterpreting it. Future gates of this shape must exclude comments, e.g. match
`^export const \w+ = pgTable(` at line start rather than a bare substring.

## Progress — Slice 1 (budgets + goals + 4 goal-* helpers): COMPLETE and independently verified
Landed in two passes: `backend-2.md`'s run applied all 12 file moves correctly but exited 1 without
writing a report and without any of the outside-importer repoints (assessed read-only in
`assessment-1.md`); `backend-3.md` then applied the 9 repoints + 1 string literal. Verified by an
uninvolved worker in `verification-2.md`:
- typecheck exit 0, lint exit 0, `apps/api` **845/845 pass, 0 fail** (unchanged — this slice adds no
  tests and lost none).
- Both route snapshots byte-identical, as required: no registration was moved, reordered or collapsed.
- **AC9 PASSED across all 12 moved files** — every diff is import-specifiers-only; 6 of the 12 have no
  diff at all. No handler body, URL, status code, Zod schema, SQL predicate, `userId` filter, cache key
  or TTL changed.
- Split-import rule confirmed in `modules/planning/services/goals.ts`: `goals` from `../schema.ts`,
  `alertLedger`/`holdingEvents`/`retirementDetails`/`transactions` from `../../../db/schema.ts`.
- `db/schema.smoke.test.ts` diff is exactly one string literal and it still passes.
- Resolver scan: 224 files / 689 specifiers / **0 unresolvable**.

### Known flake, not a regression — `card-due-tasks.test.ts`
The root `npm run test` run showed `apps/api` at 818/845 with 27 failures, all in
`modules/credit/services/card-due-tasks.test.ts`, each self-guarding against a pre-existing non-demo
`card_details` row in the **shared dev Postgres**. Two runs of the identical command bracketing that
one both passed 845/845 exit 0. This is shared-database data-state contamination, in the credit module,
untouched by this task. Recorded so a later run of the full suite is not misread as a planning
regression — but it does mean `apps/api` tests are not hermetic against the shared dev DB, which is
worth its own task eventually.

## Progress — Slice 2 (cashflow, bills, dashboard, insights, reports): COMPLETE and independently verified
Run by the user directly; no `backend-4.md` report was produced, so the code is the only account and was
verified from scratch in `verification-3.md`:
- typecheck exit 0, lint exit 0, `apps/api` **845/845 pass, 0 fail** across **three** consecutive runs
  (no `card-due-tasks` flake this time).
- Both route snapshots byte-identical — registrations still uncollapsed, as the interim rule requires.
- **AC9 PASSED across all 12 moved files** — import-line-only; 6 of 12 have no diff at all.
- **AC5 PASSED** — `"dashboard"`, `` `trends:${months}` ``, `"forecast:90"` and `` `insights:${period}` ``
  all still @300 and byte-identical; all 8 `invalidateUserCache` sites outside planning untouched.
- **All 24 flat paths confirmed gone** by explicit `test ! -e` per path.
- Resolver scan: 224 files / 683 specifiers / **0 unresolvable**. `db:generate` zero diff (135-file
  manifest identical).
- `app.register(...)` block unchanged in count, order and line numbers; `app.ts`'s diff is
  import-specifiers-only on 5 lines.

**Remaining work:** Iteration 5 only — collapse the 8 registrations into `plugin.ts` (P6), add
`plugin.test.ts` and the 2 demo-403 tests (P7), document the goal interface (P11), regenerate
`route-table.snapshot.txt`, then the roadmap edits (P13/R1-R4).

## Progress — Iteration 5 (registration collapse, tests, goal doc): COMPLETE and verified
`backend-5.md` implemented P6/P7/P11; first invocation was a silent no-op (exit 0, zero changes, no
report — I caught it by re-reading the tree, not by trusting the exit code), the re-run landed.
Verified in `verification-4.md` and by my own reads:
- `apps/api` **848/848 pass, 0 fail** across three consecutive runs (+3 = 1 plugin + 2 demo-403).
- `plugin.ts` registers all 8 groups in the required order, no prefix; `app.ts` makes exactly ONE
  planning registration at the old `budgetRoutes` position (after `importRoutes`, before
  `notificationRoutes`).
- `route-surface.snapshot.txt` byte-frozen (`a368d4eb…4122`). `route-table.snapshot.txt` regenerated;
  independent parse gives 283 `(method,url)` pairs on both HEAD and current with **zero** added/removed/
  renamed — pure re-nesting. `app.route-snapshot.test.ts` passes 7/7.
- `planning.route.test.ts` is genuine: whole-plugin registration, exact 403 (a 404 fails it), real
  empty-row preconditions, no-row-written assertions, no stub `storage` decorated.

## Codex implementation review — review-4 disposition
- **B1 (goal-interface doc misstated `listGoals`) — VALID, ACCEPTED.** The P11 doc comment I specified
  said `listGoals` "returns all non-archived goals", but the function filters only on `userId` (no
  `archivedAt` predicate) — I verified the body at `modules/planning/services/goals.ts:76-82` myself. A
  wrong contract on the one interface AC6 exists to document is a real defect, not cosmetic. Fixed via
  `backend-6.md` (comment-only): line 9 now reads "returns all of a user's goals (including archived),
  ordered by sort order then creation time." typecheck/lint exit 0, tests still 848/848. My own error in
  the delegation brief, not the engineer's — I dictated the inaccurate wording.
- **No other blocking or non-blocking implementation findings.** Codex independently confirmed: all
  moved files import-lines-only, the split-import rule correct in goals/bills/cashflow and the deeper
  `ai/*` files, `projectionSettings` defined exactly once with a byte-identical block, the schema graph
  acyclic, `db:generate` zero-diff by construction, all cache keys/TTLs and all 10 `invalidateUserCache`
  sites preserved, budget-alert eval still gated on `prefEnabled(...,'budget')`, and every planning
  mutation still demo-safe via the auth-hook chokepoint. Recorded as corroboration, checked against the
  code for the load-bearing claims, not taken on faith.

## Roadmap edits (P13/R1-R4): DONE
Coordinator-authored (these are `tasks/` files):
- **R1** — `tasks/01.05-migrate-planning.md`: noted 0.3 already did projection-settings; corrected the
  subscriber/cron framing (evaluateBudgetAlerts is a system-module file; only `bills.remind` +
  `autopilot.goals` are planning-touching crons); all 5 ACs ticked with evidence; `status: done`.
- **R2** — `tasks/01.08-migrate-system.md`: removed `projection_settings` from the system table list with
  a note that planning owns it (resolves the F9 two-tasks-one-table duplication).
- **R3** — `tasks/01.09-cross-module-ports.md`: added `services/autopilot.ts` to the flat-services
  cleanup scope (F10).
- **R4** — `tasks/README.md`: 1.5 row flipped to `done`.
- `tasks/01.09`'s `depends:` already included `1.5` — no change needed.

## Final validation
All plan items P1-P13 implemented; all AC1-AC13 proven by independent verification I read literally;
Codex reviewed the final code and its one blocking finding is fixed and re-verified; no unapproved
changes. **Task 1.5 is COMPLETE.** Remaining Phase-1 work: 1.6, 1.7, 1.8, then 1.9 + 1.10 (the closure
gate). Nothing here is committed — that awaits an explicit user request with a coordinator-authored file
list.

## Supersession note
D1 deliberately supersedes task 0.3/006's physical placement of `projection_settings` in
`modules/planning/schema.ts`, and task 009's use of planning as "the only physical module slice" as a
worked example. Neither of those task records is edited (D3). Task 1.9 remains the owner of physical
per-module schema ownership for all eight modules.
