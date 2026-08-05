# Sonnet Worker Delegation — 014-migrate-planning (roadmap 1.5)

Read `tasks/014-migrate-planning/TASK.md` in full before starting. It is authoritative; this file is the
execution brief, not a replacement. Where the two disagree, TASK.md wins and you **stop and report the
conflict** rather than picking one.

**This is a relocation, not a rewrite.** The only new code permitted is the new test files. No handler
body, route URL, status code, Zod schema, SQL predicate, cache key, TTL or `userId` filter may change.

## Routing (who writes what)

- **`backend-engineer`** — **all implementation.** Every change under `apps/api/src/`, including the new
  test files. Invoke it as a CLI wrapper, not a Task agent:
  `/home/udai/.claude/bin/backend-engineer tasks/014-migrate-planning/backend-<N>.md "<full prompt>"`
  The path must not already exist; increment `<N>` per run.
- **`sonnet-worker`** — grunt work only: invoking that CLI, running gate commands, capturing evidence,
  and the `CLAUDE.md` / `tasks/*.md` doc edits. A worker that invokes the engineer is a **pure conduit**
  — it writes no code and makes no judgement calls, and it does the doc edits in a *separate* call from
  the implementation call so the two never blur.

Do not write `apps/api/src/**` yourself. If `backend-engineer` returns something violating the
Must-Not-Change list, report it — do not hand-patch it into shape.

**File-naming rule (learned from task 1.4):** `backend-<N>.md` belongs to `backend-engineer`;
write your own findings to `implementation-<N>.md`. Never overwrite the engineer's file — its
first-hand account is evidence.

---

# Iteration 1 — Slice 0 (schema, design decision D1)

This slice is gated and independently verified **before** any file moves. It is the novel part.

## Approved plan (P1, P2)

- P1: Baseline before touching anything — `npm run test -w apps/api` count (expect 842, exit 0);
  sha256 of `apps/api/src/route-surface.snapshot.txt` (expect `a368d4eb…4122`) and
  `route-table.snapshot.txt` (expect `7800feb9…55c8`); content-hash manifest of `apps/api/drizzle/`;
  and a pre-migration T17 run (expect ~223 files / ~686 relative specifiers / **0** unresolvable).
- P2: The D1 schema change + the new planning schema smoke test.

## Required changes (backend-engineer)

1. **Move the `projectionSettings` definition** out of `apps/api/src/modules/planning/schema.ts` into
   `apps/api/src/db/schema.ts`, inserted **immediately after the `subscriptionDismissals` definition's
   closing `);` at line 747** (line 748 is blank; 749 starts the next declaration).
   **Character-for-character identical**, including its `/** Per-user assumptions … */` doc comment and
   its four columns in their existing order: `user_id`, `equity_return_bps`, `created_at`, `updated_at`.
   `db/schema.ts` already imports `integer`, `pgTable`, `timestamp`, `uuid` and binds `users` — add no
   new imports for this.
2. **Delete `apps/api/src/db/schema.ts:22`** — `export * from "../modules/planning/schema.ts";`
3. **Rewrite `apps/api/src/modules/planning/schema.ts`** as a thin named re-export, modelled closely on
   `apps/api/src/modules/credit/schema.ts` (read it first — match its doc-comment style):
   ```ts
   export {
     budgets, budgetLines, budgetAlerts, goals, subscriptionDismissals, projectionSettings,
     budgetPeriod, goalType,
   } from "../../db/schema.ts";
   ```
   Its doc comment must explain: planning is now uniform with the other four modules; the barrel does
   **not** `export *` back; task 1.9 owns physical ownership. It must **not** claim the FK-cycle
   rationale verbatim from credit/ledger without checking it applies — planning's real constraint is
   `goals.id` inbound FKs from `accounts`/`holdings`/`sips` and `budget_lines`/`budget_alerts` outbound
   to `categories` (TASK.md F4).
4. **Update the stale doc comments (F15):**
   - `apps/api/src/db/schema.ts:32-35` — no longer says `projectionSettings` lives in the planning module.
   - `apps/api/src/modules/ledger/schema.ts:9-12` and `:21-25` — remove the `projection_settings`
     exception; all five modules are now thin re-exports.
   - `apps/api/src/db/schema.smoke.test.ts:22` — the assertion **message** only. See the gate order in
     Commands: the test must first be run and pass **completely unmodified**, evidence captured, and only
     then may this string change. Its diff must be string-literal-only.
   - Leave `modules/planning/plugin.ts`'s comment for Iteration 2 (P6 rewrites that file anyway).
5. **Create `apps/api/src/modules/planning/schema.smoke.test.ts`** — exactly **3** `test()` cases,
   modelled on `modules/credit/schema.smoke.test.ts` (2 cases) plus one addition:
   - (1) the 6 tables resolve with correct SQL table names
   - (2) the 2 enums (`budgetPeriod`, `goalType`)
   - (3) **new, beyond precedent:** a constructed-Drizzle runtime assertion that `db.query.<name>`
     exists for **all six** planning tables. Use the non-connecting stub-`pg.Pool` technique from
     `apps/api/src/db/schema.smoke.test.ts:34-53` — copy that approach, including a stub that throws if
     queried, so no DB connection is opened.

## Must not change
- Any **other** `pgTable(...)`/`pgEnum(...)` in `db/schema.ts` — no edits, no reordering. Exactly one
  definition is added and it is the moved one.
- `apps/api/src/route-surface.snapshot.txt` — byte-frozen. If it changes, stop and report.
- `apps/api/src/db/schema.smoke.test.ts` assertions/logic — message strings only, after the gate.
- `apps/api/src/services/backup.ts` — the 6 planning tables are already listed; no change needed.
- Any route file, service file or `app.ts` — those are Iteration 2. Slice 0 is schema-only.
- `modules/planning/services/projection-settings.ts` — it imports `projectionSettings` from
  `../schema.ts`, which still resolves. Do not repoint it.
- Do not create `modules/planning/tables.ts`. That was iteration-1's rejected design (TASK.md D1).

## Acceptance criteria for this iteration
- AC2 (partial): `modules/planning/schema.ts` has zero `pgTable(` and zero `pgEnum(`; `db/schema.ts`'s
  `pgTable(` count rises by exactly 1; `db/schema.smoke.test.ts` passes **unmodified** (evidence
  captured before the message edit).
- AC3: `db/schema.ts`'s only local schema import/re-export is `./core-schema.ts`.
- AC10: `npm run db:generate` → zero diff, proven by the manifest before and after.
- AC12/T17: zero unresolvable relative specifiers, with scan counts reported.
- AC13 is **not** in this iteration (`CLAUDE.md` is edited by you, see below).
- Test count after this iteration: **842 → 845 (+3)**, the three new smoke cases. Report literal numbers.

## Your own edits (sonnet-worker, not backend-engineer)
- `CLAUDE.md:49` (AC13) — remove the two false propositions: that `db/schema.ts` "re-exports each
  module's `schema.ts`", and that "every `modules/<domain>/schema.ts`" imports from `db/core-schema.ts`.
  Accurate replacement: the barrel holds every `pgTable()`/`pgEnum()` definition and is the single
  Drizzle Kit entry point; each `modules/<domain>/schema.ts` is a thin named re-export of that domain's
  tables so module code imports from `../schema.ts`; `db/schema.ts` imports shared identity tables from
  `db/core-schema.ts` (currently just `users`), a narrow cycle-free leaf — **not** a general destination
  for every cross-module FK; task 1.9 converts these thin surfaces into physical ownership. Keep it to
  roughly the existing length and voice. **Do not touch any other line of `CLAUDE.md`.**
- No `tasks/*.md` roadmap edits yet — those are Iteration 3, after every gate passes.

## Commands (run from repo root unless noted; quote literal output + exit code for each)

**Order matters for step 5 — the unmodified-test evidence must be captured before the message edit.**

1. Baseline (P1): `npm run test -w apps/api`; `sha256sum apps/api/src/route-surface.snapshot.txt
   apps/api/src/route-table.snapshot.txt`; drizzle manifest; pre-migration T17 run.
2. Delegate the `apps/api/src/**` changes to `backend-engineer`.
3. `npm run typecheck`
4. `npm run lint`
5. From `apps/api`: `node --test src/db/schema.smoke.test.ts` **with the file unmodified** —
   confirm `git diff -- src/db/schema.smoke.test.ts` is empty at this point, capture both. *Then* apply
   the message-string edit and re-run.
6. From `apps/api`: `node --test src/modules/planning/schema.smoke.test.ts`
7. From `apps/api`: `node --env-file-if-exists=../../.env --test src/services/backup.test.ts`
8. `npm run test -w apps/api` — expect 845
9. `npm run db:generate` + manifest after; diff the manifests
10. T18: extract the `projectionSettings` block from git's copy of the old file and from the new
    `db/schema.ts`, and diff the two extracts — must be empty
11. T17 post-change run
12. `git status --porcelain` and the full `git diff`

**Do not run any git command that stages, commits, pushes or tags.** Read-only git only.

## Required evidence
- files created / modified / deleted, explicitly
- the complete diff
- every command, its literal output, and its exit code
- before/after test counts with the +3 reconciled
- the two snapshot sha256s before and after (must be unchanged — nothing in this slice touches routes)
- the drizzle manifest before and after
- the T18 extract-diff (empty)
- T17 scan counts and unresolvable count, before and after
- proof that `db/schema.smoke.test.ts` passed unmodified, captured before the message edit
- plan deviations or blockers — state them, never silently absorb them

The engineer's own account goes to `backend-1.md`. A pure-conduit worker writes no report of its own;
the gate evidence is captured by the separate verification call (`verification-N.md`).

---

# Iteration 2 — Slice 1 (budgets + goals + the four goal-* helpers)

**Interim-state rule for this slice and the next:** move files and repoint `app.ts`'s *import
specifiers* only. Do **not** collapse registrations into `plugin.ts` yet — that is Iteration 4. So after
this slice `app.ts` still makes the same number of `app.register(...)` calls in the same order, and
**both** route snapshots must stay byte-identical. That isolates the route-table change to one step.

## Files to move (10)
Services → `apps/api/src/modules/planning/services/`:
`budgets.ts`, `goals.ts`, `goal-allocation.ts`, `goal-plan.ts`, `goal-projection.ts`, `goal-returns.ts`
Their 4 colocated tests move too: `goal-allocation.test.ts`, `goal-plan.test.ts`,
`goal-projection.test.ts`, `goal-returns.test.ts` (note: `budgets.ts` and `goals.ts` have no tests).
Routes → `apps/api/src/modules/planning/routes/`: `budgets.ts`, `goals.ts`

## Import rules (the part most likely to be got wrong)
1. **Split-import rule.** A module's own tables come from `../schema.ts`; every other table comes from
   `../../../db/schema.ts`; **never** from a peer module's `schema.ts`. Planning-owned tables are:
   `budgets`, `budgetLines`, `budgetAlerts`, `goals`, `subscriptionDismissals`, `projectionSettings`
   (+ enums `budgetPeriod`, `goalType`). Everything else is another domain's.
   Known mixed imports that must be split:
   - `services/goals.ts:12` — `alertLedger, goals, holdingEvents, retirementDetails, transactions`:
     `goals` → `../schema.ts`; the other four → `../../../db/schema.ts`.
2. **Depth adjustments** (target unchanged, specifier depth changes): `../db/index.ts` →
   `../../../db/index.ts`; `../lib/*` → `../../../lib/*`; flat shared services such as
   `../services/ownership.ts`, `periods.ts`, `notifications.ts`, `prefs.ts`, `cache.ts`, `balances.ts`
   → `../../../services/<name>.ts`.
3. **Peer-module services** keep their target, change depth: `../modules/ledger/services/X.ts` →
   `../../ledger/services/X.ts`; same for `../modules/investments/services/X.ts`.
4. **Two imports become intra-module** and must be rewritten as such:
   - `services/goals.ts:22` — `getProjectionSettings` → `./projection-settings.ts`
   - `modules/planning/services/projection-settings.ts:6` — `DEFAULT_EQUITY_RETURN_BPS` → now
     `./goal-returns.ts` (it currently reaches out to `../../../services/goal-returns.ts`)
5. **Route files' `../services/<name>.ts` imports stay relative-to-sibling** — after the move both the
   route and its service are inside the module, so `../services/budgets.ts` still resolves. Verify, do
   not assume.
6. The 4 moved test files must have their subject-import specifiers updated.

## Outside importers to repoint in this slice (import specifier ONLY)
- `apps/api/src/services/notifications.ts:7` — `./budgets.ts` → `../modules/planning/services/budgets.ts`
- `apps/api/src/services/autopilot.ts:7,9` — `./goal-plan.ts` and `./goals.ts` → planning paths
  (leave its `./cashflow.ts` on line 6 alone — `cashflow.ts` moves in the next slice)
- `apps/api/src/services/ai/tools.ts:7,10` — `../budgets.ts`, `../goals.ts` → planning paths
- `apps/api/src/modules/investments/services/sip-commitments.ts:6` — `../../../services/goal-allocation.ts`
  → `../../planning/services/goal-allocation.ts`
- `apps/api/src/app.ts` — the `budgetRoutes` and `goalRoutes` import specifiers only. Do not move,
  reorder or collapse the `app.register(...)` calls.

## Also in this slice
- `apps/api/src/db/schema.smoke.test.ts:22` — the stale assertion **message string only**. Its
  unmodified-pass evidence has now been captured (verification-1.md step 9), so this edit is unblocked.
  It currently says the object is "re-exported from modules/planning/schema.ts"; that is now backwards —
  it is defined in `db/schema.ts` and re-exported *to* planning. Change the string, nothing else; the
  diff for this file must be a single string literal.

## Must not change
- Any handler body, route URL, status code, Zod schema, SQL predicate, `userId` filter, cache key or TTL.
- `route-surface.snapshot.txt` **and** `route-table.snapshot.txt` — both byte-frozen this slice.
- `services/notifications.ts`, `prefs.ts`, `periods.ts`, `cache.ts`, `ownership.ts`, `balances.ts`,
  `autopilot.ts` — these stay flat; only their import specifiers may change where listed above.
- `modules/planning/plugin.ts` and the `app.register(...)` call sites — Iteration 4 owns those.
- `db/schema.ts` — no further edits; Slice 0 finished with it.
- The 5 flat services that move in the next slice (`cashflow`, `bills`, `dashboard`, `insights`,
  `reports`) and their routes — do not touch them.

## Acceptance criteria for this iteration
- typecheck exit 0, lint exit 0.
- `npm run test -w apps/api` still **845** — this slice adds no tests and must lose none.
- Both route snapshot sha256s **unchanged**.
- The 10 moved files' diffs are **import-line-only** (plus the `git` rename detection); no logic delta.
- No relative import anywhere resolves to a now-deleted flat path (resolver check).

## Commands
1. `npm run typecheck`  2. `npm run lint`  3. `npm run test -w apps/api`
4. `sha256sum apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt`
5. the resolver-based unresolvable-import check  6. `git status --porcelain` and the full `git diff -M`

**Do not run any git command that stages, commits, pushes or tags.**

## Iteration 2 outcome — moves landed, repoints did not
`backend-2.md` was never written and the wrapper exited 1, but the work was **partially applied**.
Assessed read-only in `assessment-1.md`:
- **All 12 file moves landed correctly**, and the import lines *inside* those 12 files are correct per
  the split-import, depth and intra-module rules. That half is done and needs no rework.
- **None of the 6 outside-importer repoints were applied.** `typecheck` fails (exit 2) with 9 `TS2307`
  unresolvable-module errors plus 4 cascading `TS7006`. An independent resolver scan found exactly the
  same 9 specifiers, cross-confirming tsc.
- Nothing out of scope was touched: `db/schema.ts` carries only its Slice-0 diff, `plugin.ts` untouched,
  `app.register(...)` count and order unchanged, both route snapshots byte-identical.

### Coordinator error — the slice boundary cut through an intra-domain import
`apps/api/src/services/dashboard.ts:7` imports `./budgets.ts`. `budgets.ts` moved in Slice 1;
`dashboard.ts` does not move until Slice 2. So my brief simultaneously **omitted** `dashboard.ts` from
the outside-importer list *and* **forbade** touching it this slice — an unsatisfiable instruction. The
assessing worker flagged the conflict rather than resolving it on its own authority, which is correct.

Root cause: I classified `dashboard.ts → budgets.ts` as "within-domain" from investigation-1 §4c. That is
true of the *end state* but false of the *interim* state, and slicing one domain across two steps is
exactly what makes interim states observable. **Any future slicing of a domain must first enumerate
intra-domain imports that cross the slice boundary.** Checked for the rest: `dashboard.ts:7` is the only
one — `goals.ts` and `budgets.ts` depend on no Slice-2 service, and the 9 dangling specifiers reconcile
exactly as app.ts(2) + notifications(1) + autopilot(2) + ai/tools(2) + sip-commitments(1) +
dashboard(1) = 9, with no remainder.

---

# Iteration 3 — Slice 1 completion (import repoints only)

No file moves. No logic. Every edit is a single import specifier, except one assertion message string.
Repoint each of the 9 dangling specifiers:

- `apps/api/src/app.ts` — `budgetRoutes` → `./modules/planning/routes/budgets.ts`,
  `goalRoutes` → `./modules/planning/routes/goals.ts`. **Import specifiers only** — do not move,
  reorder, collapse or renumber any `app.register(...)` call.
- `apps/api/src/services/notifications.ts:7` — `./budgets.ts` →
  `../modules/planning/services/budgets.ts`
- `apps/api/src/services/autopilot.ts` — `./goal-plan.ts` and `./goals.ts` → planning paths.
  **Leave its `./cashflow.ts` import alone** — `cashflow.ts` does not move until Slice 2.
- `apps/api/src/services/ai/tools.ts` — `../budgets.ts` and `../goals.ts` → planning paths.
  **Leave its `../reports.ts` and `../insights.ts` imports alone** — Slice 2.
- `apps/api/src/modules/investments/services/sip-commitments.ts:6` →
  `../../planning/services/goal-allocation.ts`
- `apps/api/src/services/dashboard.ts:7` — `./budgets.ts` →
  `../modules/planning/services/budgets.ts`. **This one is deliberate interim churn**: when
  `dashboard.ts` itself moves in Slice 2 this line becomes `./budgets.ts` again. Accepted so that the
  tree is green and verifiable at every gate rather than only at the end.
- `apps/api/src/db/schema.smoke.test.ts:22` — the assertion **message string only** (now unblocked; its
  unmodified-pass evidence is in `verification-1.md` step 9). It says the object is "re-exported from
  modules/planning/schema.ts", which is backwards: it is defined in `db/schema.ts` and re-exported *to*
  planning. One string literal; nothing else in that file.

Gates: typecheck exit 0, lint exit 0, `npm run test -w apps/api` = **845**, both route snapshots
byte-identical, resolver scan reports **0** unresolvable specifiers.

---

# Iteration 4 — Slice 2 (cashflow, bills, dashboard, insights, reports)

Same discipline as Slice 1, and the **same interim-state rule**: move files and repoint import
specifiers only. Do **not** touch `plugin.ts` or any `app.register(...)` call — Iteration 5 owns the
registration collapse. Both route snapshots stay byte-frozen this slice.

**Learn from Slice 1's failure:** that run did the moves and silently skipped every outside-importer
repoint, leaving the tree broken. The repoints are not optional trailing cleanup — they are half the
task. Do them in the same pass and verify `typecheck` is green before reporting.

## Files to move (12)
Services → `apps/api/src/modules/planning/services/`:
`cashflow.ts`, `bills.ts`, `dashboard.ts`, `insights.ts`, `reports.ts`
Their 2 colocated tests move too: `insights.test.ts`, `reports.test.ts`
(`cashflow.ts`, `bills.ts` and `dashboard.ts` have no colocated tests.)
Routes → `apps/api/src/modules/planning/routes/`:
`cashflow.ts`, `bills.ts`, `dashboard.ts`, `insights.ts`, `reports.ts`

## Import rules
Identical to Slice 1: own tables from `../schema.ts` (`subscriptionDismissals` is planning-owned;
`recurringTemplates`, `alertLedger`, `accounts`, `holdings`, `sips`, `categories` are **not**, so they
come from `../../../db/schema.ts`); flat shared services → `../../../services/<name>.ts`; peer modules
`../modules/<x>/…` → `../../<x>/…`; `../db/…` → `../../../db/…`; `../lib/…` → `../../../lib/…`.

Known mixed imports that must be split:
- `services/bills.ts:5` — `recurringTemplates, subscriptionDismissals, alertLedger`:
  `subscriptionDismissals` → `../schema.ts`; `recurringTemplates` and `alertLedger` →
  `../../../db/schema.ts`.
- `services/cashflow.ts:5` — `accounts, holdings, recurringTemplates, sips` are all other domains' →
  all four to `../../../db/schema.ts`.

Imports that become intra-module siblings (verify, do not assume):
- `services/dashboard.ts:7` — repoint **back** to `./budgets.ts`. This reverses the deliberate interim
  churn introduced in Iteration 3, now that both files live in the same directory.
- `services/cashflow.ts` → `getTrends` from `./dashboard.ts`
- `services/reports.ts` → `./insights.ts` and `./periods.ts`… **careful**: `periods.ts` does NOT move
  and stays flat, so it is `../../../services/periods.ts`. Only `insights.ts` is a sibling.
- the 5 route files' `../services/<name>.ts` imports resolve to their moved siblings.

## Outside importers to repoint (import specifier ONLY)
- `apps/api/src/services/autopilot.ts` — `./cashflow.ts` → `../modules/planning/services/cashflow.ts`
  (its other two planning imports were already repointed in Iteration 3; leave them)
- `apps/api/src/services/ai/summary.ts` — `../reports.ts` and `../insights.ts` →
  `../../modules/planning/services/…` (this file is one directory deeper than `services/` — check the
  depth, do not copy a specifier from a shallower file)
- `apps/api/src/services/ai/tools.ts` — `../reports.ts` and `../insights.ts` → same treatment
  (its `budgets`/`goals` imports were already repointed in Iteration 3; leave them)
- `apps/api/src/jobs/index.ts` — `evaluateBillReminders` from `../services/bills.ts` →
  `../modules/planning/services/bills.ts`
- `apps/api/src/app.ts` — the `dashboardRoutes`, `cashflowRoutes`, `billRoutes`, `insightRoutes` and
  `reportRoutes` import specifiers. **Specifiers only** — do not move, reorder or collapse any
  `app.register(...)` call.

## Must not change
- Any handler body, route URL, status code, Zod schema, SQL predicate, `userId` filter.
- **Cache keys and TTLs** — `"dashboard"`, `` `trends:${months}` ``, `"forecast:90"` (all @300 in
  `dashboard.ts`/`cashflow.ts`) and `` `insights:${period}` `` @300 in `routes/insights.ts`. These move
  file but must be byte-identical.
- `route-surface.snapshot.txt` and `route-table.snapshot.txt` — both byte-frozen this slice.
- `services/periods.ts`, `cache.ts`, `balances.ts`, `ownership.ts`, `notifications.ts`, `prefs.ts`,
  `autopilot.ts` — stay flat; only the listed import specifiers change.
- `modules/planning/plugin.ts`, `db/schema.ts`, and every file already moved in Slice 1.
- The `alertLedger` dedup usage in `bills.ts` and the `evaluateBillReminders` signature — `jobs/index.ts`
  calls it, and the boot catch-up at `jobs/index.ts:378-381` must keep working.

## Acceptance criteria
- typecheck exit 0, lint exit 0.
- `npm run test -w apps/api` still **845**.
- Both route snapshot sha256s unchanged.
- All 12 moved files' diffs import-line-only.
- Resolver scan: 0 unresolvable specifiers.
- Afterwards `apps/api/src/services/` must contain **no** planning service and
  `apps/api/src/routes/` **no** planning route — all 24 flat paths from the task are gone.

---

# Iteration 5 — registration collapse, tests, goal-interface doc (P6, P7, P11)

This is the **only** slice permitted to change `route-table.snapshot.txt`. `route-surface.snapshot.txt`
stays byte-frozen — if it moves, a route was genuinely added, removed, renamed or had its method
changed, which is a failure, not a thing to regenerate.

## P6 — collapse the registrations
1. Rewrite `apps/api/src/modules/planning/plugin.ts` to register all 8 route groups **in this exact
   order**, preserving their relative order in today's `app.ts`:
   `budgets, dashboard, goals, cashflow, bills, insights, reports, projectionSettings`.
   Follow the header-comment style of `modules/credit/plugin.ts`. The existing comment (which says the
   module "only wires up projection_settings" and that "task 1.5 registers the rest") is now stale and
   must be rewritten.
2. In `apps/api/src/app.ts`: delete the 7 planning route imports (`budgetRoutes`, `dashboardRoutes`,
   `goalRoutes`, `cashflowRoutes`, `billRoutes`, `insightRoutes`, `reportRoutes`) and their 7
   `app.register(...)` calls, and delete the existing `await app.register(planningRoutes);` at line 137.
   Add a single `await app.register(planningRoutes);` **at the position `budgetRoutes` occupies today
   (line 123)** — i.e. after `importRoutes`, before `notificationRoutes`. Keep the `planningRoutes`
   import. Extend `app.ts`'s header comment with a 1.5 paragraph in the established style.

## P7 — tests
3. `apps/api/src/modules/planning/plugin.test.ts` — 1 `test()`, modelled on
   `modules/credit/plugin.test.ts`. Hermetic: `hasRoute()` introspection only, **never** `app.inject()`.
   Assert a representative route from several groups, e.g. `GET /api/budgets/suggestions`,
   `GET /api/goals`, `GET /api/dashboard`, `GET /api/reports`, `GET /api/projection-settings`.
4. `apps/api/src/modules/planning/routes/planning.route.test.ts` — exactly 2 `test()` cases, modelled on
   `modules/investments/routes/networth.route.test.ts`. Register the whole `planningRoutes` plugin, not
   one route file. A **demo session** must get **exactly 403** (not 404 — a 404 would mean the route
   was not registered, so assert the precise status) on:
   - `PUT /api/budgets/:period/:key`
   - `POST /api/goals`
   Each test must ALSO assert the mutation did not occur (no `budgets` row for that period/key; no
   `goals` row). Check preconditions first so a vacuous pass is impossible.

## P11 — document the goal interface (AC6)
5. Add a doc-comment block naming `getGoalProgress`, `listGoals` and `equityShareOfInvestable` as the
   planning module's public surface for later reuse, listing its **real current consumers**:
   `modules/planning/routes/goals.ts` and `services/autopilot.ts` via the weekly `autopilot.goals` cron
   (`jobs/index.ts:221-228`, worker `:325-335`). Note that task 1.9 converts this into a declared port.
   Documentation only — **no signature change, no behaviour change**.

## Snapshot regeneration
6. `route-table.snapshot.txt` must be regenerated, because collapsing 8 interleaved registrations into
   one contiguous plugin legitimately re-nests Fastify's raw tree. Regenerate it exactly the way
   `app.route-snapshot.test.ts` computes it: construct `Fastify({ logger: false })`, apply
   `setValidatorCompiler(validatorCompiler)` and `setSerializerCompiler(serializerCompiler)`, `await
   registerRoutes(app)`, `await app.ready()`, then write `app.printRoutes({ commonPrefix: false })` via
   `writeFileSync` with **no extra trailing newline appended**. Then read the resulting diff and confirm
   it is pure re-nesting: **no added, removed or renamed `(method, path)`**.

## Must not change
- `route-surface.snapshot.txt` — byte-frozen. Any change is a failure to report, not to regenerate.
- Any route URL, handler body, status code, Zod schema, SQL predicate, `userId` filter, cache key or TTL.
- Any file moved in Slices 1-2, `db/schema.ts`, or `modules/planning/schema.ts`.
- Do not add a Fastify route prefix — the URLs are absolute in each route file.
- Do not decorate a stub `storage` on the test app in `planning.route.test.ts`: a 403 at the auth hook
  never reaches a handler body, so it is never touched. If the 403 ever regressed, the missing
  decoration makes the test fail loudly, which is the point.

## Acceptance criteria
- `route-surface.snapshot.txt` sha256 still `a368d4eb…4122`.
- `route-table.snapshot.txt` regenerated; its diff adds/removes/renames no `(method, path)`.
- typecheck exit 0, lint exit 0.
- `npm run test -w apps/api` = **848** (845 + 1 plugin + 2 demo-403). If the delta is not exactly +3,
  explain it rather than round it away.
- `app.ts` makes exactly ONE planning registration.
