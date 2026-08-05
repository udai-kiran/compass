All steps are complete and verified. Here is my report.

## Summary

### STEP 1 — collapsed registrations in `plugin.ts`
Rewrote `apps/api/src/modules/planning/plugin.ts` to register all 8 route groups in the exact order `budgets, dashboard, goals, cashflow, bills, insights, reports, projectionSettings`, following the header-comment style of `credit/plugin.ts`. The stale comment (which claimed the module "only wires up projection_settings") was rewritten.

### STEP 2 — `app.ts` collapse
- Deleted the 7 individual planning route imports (`budgetRoutes`, `dashboardRoutes`, `goalRoutes`, `cashflowRoutes`, `billRoutes`, `insightRoutes`, `reportRoutes`) and their 7 `app.register(...)` calls.
- Deleted the old `await app.register(planningRoutes);` (previously the last planning registration carrying only projection-settings).
- Added a single `await app.register(planningRoutes);` after `importRoutes` and before `notificationRoutes` (line 124).
- Kept the `planningRoutes` import and extended the header comment with a task-1.5 paragraph in the established style.
- `app.ts` contains exactly ONE planning registration (`grep` shows 3 `planningRoutes` occurrences: the import, the comment, and the single `app.register` call).

### STEP 3 — `modules/planning/plugin.test.ts`
New hermetic test with exactly 1 `test()` case using `hasRoute()` introspection only (never `app.inject()`), asserting one representative route from each of all 8 route groups (budgets/dashboard/goals/cashflow/bills/insights/reports/projection-settings).

### STEP 4 — `modules/planning/routes/planning.route.test.ts`
New file with exactly 2 `test()` cases registering the whole `planningRoutes` plugin. Both assert **exactly 403** (a 404 would mean the route wasn't registered) on `PUT /api/budgets/monthly/2024-01` and `POST /api/goals`, and each additionally asserts no `budgets`/`goals` row was written, with preconditions checked first. No stub `storage` was decorated.

### STEP 5 — goal-interface doc comment
Added a doc-comment block at the top of `modules/planning/services/goals.ts` naming `getGoalProgress`, `listGoals`, `equityShareOfInvestable` as the planning module's public surface, listing real consumers: `modules/planning/routes/goals.ts`, `services/autopilot.ts` via the weekly `autopilot.goals` cron (`jobs/index.ts:221-228`, worker `:325-335`), and `services/ai/tools.ts`. Noted task 1.9 converts it into a declared port. Documentation only — no signature/behaviour change.

### STEP 6 — regenerated `route-table.snapshot.txt`
Regenerated exactly as `app.route-snapshot.test.ts` computes it (Fastify `logger:false`, both Zod compilers, `registerRoutes`, `app.ready()`, `printRoutes({commonPrefix:false})` via `writeFileSync` with no extra trailing newline). Confirmed the diff is **pure re-nesting** — no added, removed, or renamed method/path pair (independent extraction confirmed 283→283 pairs, added: none, removed: none, duplicates: none).

### Verification (literal output + exit codes)
- `npm run typecheck` → **exit 0**
- `npm run lint` → **exit 0**
- `npm run test -w apps/api` → **848 tests passing, 0 failing** (delta exactly **+3** from 845: +1 plugin test + 2 demo-403 tests), exit 0
- `sha256sum apps/api/src/route-surface.snapshot.txt` → `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122` (unchanged, byte-frozen)
- `apps/api/src/app.ts` contains exactly **ONE** planning registration

### Files created this iteration
- `apps/api/src/modules/planning/plugin.test.ts`
- `apps/api/src/modules/planning/routes/planning.route.test.ts`

### Files modified this iteration
- `apps/api/src/modules/planning/plugin.ts` (rewritten registrations + header comment)
- `apps/api/src/app.ts` (registration collapse + header comment)
- `apps/api/src/modules/planning/services/goals.ts` (doc comment only)
- `apps/api/src/route-table.snapshot.txt` (regenerated, pure re-nesting)

### Files deleted this iteration
- None (the many `D`/`??` entries in `git status` are from the fully-verified Slices 0–2, untouched this iteration).

No deviations. All gates passed; no changes were made to force a failing gate green.
