## BLOCKING

1. The newly added public-interface documentation misstates `listGoals` behavior. It says the function “returns all non-archived goals” at [goals.ts:9](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:9), but the query has no `archivedAt IS NULL` predicate at [goals.ts:76](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:76)–[goals.ts:80](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:80), and `toGoal` explicitly reports archived state. Runtime behavior is correctly byte-preserved from `HEAD`; the new public contract is inaccurate. Since documenting goal progress/projection as a reusable interface is an explicit acceptance criterion, the comment must describe the existing behavior rather than promise filtering that does not exist.

## Non-blocking

No non-blocking implementation findings.

## Verification

- All 7 moved route files are behavior-identical to their `HEAD` versions after removing import declarations.
- All 11 moved service files are behavior-identical after removing imports, except for the intentional public-interface comment above. No handler, SQL predicate, `userId` filter, Zod schema, cache key, TTL, or status code changed.
- All 6 moved service tests are behavior-identical apart from import paths.
- All 701 current relative TypeScript import specifiers resolve to regular files. No off-by-one import happens to resolve through an unintended same-named file.
- The split-import rule is correctly applied:
  - `goals` comes from the local planning schema while external-domain tables come from the database barrel at [goals.ts:35](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:35)–[goals.ts:36](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:36).
  - `subscriptionDismissals` is local and the ledger/system tables are from the database barrel at [bills.ts:4](/home/udai/PennyPilot/apps/api/src/modules/planning/services/bills.ts:4)–[bills.ts:5](/home/udai/PennyPilot/apps/api/src/modules/planning/services/bills.ts:5).
  - Cashflow’s external tables come from the database barrel at [cashflow.ts:5](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:5).
  - The deeper AI imports correctly resolve into planning at [summary.ts:5](/home/udai/PennyPilot/apps/api/src/services/ai/summary.ts:5) and [tools.ts:6](/home/udai/PennyPilot/apps/api/src/services/ai/tools.ts:6).
- `projectionSettings` has exactly one definition, at [db/schema.ts:749](/home/udai/PennyPilot/apps/api/src/db/schema.ts:749). Its complete definition is byte-identical to the former `HEAD` block, including columns, defaults, references, order, and comment.
- Planning’s schema contains no executable `pgTable` or `pgEnum` call and is a thin named re-export of all six tables and two enums at [schema.ts:24](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.ts:24).
- `db/schema.ts` has no import or re-export from a `modules/` path. The schema graph is therefore acyclic: planning schema → database schema → core schema.
- The new schema smoke test genuinely checks:
  - identity and SQL names for all six tables at [schema.smoke.test.ts:26](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:26);
  - identity for both enums at [schema.smoke.test.ts:40](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:40);
  - runtime `db.query` availability for every table at [schema.smoke.test.ts:50](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:50).
- The pre-existing database smoke test changed only its assertion message at [db/schema.smoke.test.ts:22](/home/udai/PennyPilot/apps/api/src/db/schema.smoke.test.ts:22), and it passes.
- Because the projection table definition and exported schema object are unchanged in database identity, Drizzle sees the same `public.projection_settings` table, columns, defaults, and FK. `npm run db:generate` should therefore produce no migration.
- `app.ts` makes exactly one planning registration, after `importRoutes` and before `notificationRoutes`, at [app.ts:128](/home/udai/PennyPilot/apps/api/src/app.ts:128).
- The plugin registers all eight groups, without a Fastify prefix, at [plugin.ts:29](/home/udai/PennyPilot/apps/api/src/modules/planning/plugin.ts:29)–[plugin.ts:38](/home/udai/PennyPilot/apps/api/src/modules/planning/plugin.ts:38).
- `route-surface.snapshot.txt` has the required SHA-256: `a368d4ebfcb6bd9638ae24a3334e5b7fe61798e3cb82bdec12a06e93becc4122`, identical to `HEAD`.
- Independently parsing the `HEAD` and current route-table trees produced 283 `(method,url)` pairs in each, with zero additions and zero removals. The route-table change is pure re-nesting.
- Budget alerts remain in the alerts worker, gated by `prefEnabled(..., "budget")`, at [jobs/index.ts:345](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:345)–[jobs/index.ts:351](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:351). Only `notifications.ts`’s `getUtilization` import changed at [notifications.ts:7](/home/udai/PennyPilot/apps/api/src/services/notifications.ts:7).
- Cache behavior is preserved:
  - `dashboard`, TTL 300: [dashboard.ts:17](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:17)–[dashboard.ts:20](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:20)
  - `trends:${months}`, TTL 300: [dashboard.ts:48](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:48)–[dashboard.ts:50](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:50)
  - `forecast:90`, TTL 300: [cashflow.ts:14](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:14), [cashflow.ts:56](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:56)
  - `insights:${period}`, TTL 300: [insights.ts:22](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/insights.ts:22)
- All invalidation sites remain intact: the event subscriber at [app.ts:62](/home/udai/PennyPilot/apps/api/src/app.ts:62), planning budget mutation at [budgets.ts:32](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/budgets.ts:32), both credit EMI paths at [emis.ts:29](/home/udai/PennyPilot/apps/api/src/modules/credit/routes/emis.ts:29) and [emis.ts:32](/home/udai/PennyPilot/apps/api/src/modules/credit/routes/emis.ts:32), and all six SIP paths beginning at [sips.ts:52](/home/udai/PennyPilot/apps/api/src/modules/investments/routes/sips.ts:52).
- The plugin test uses `hasRoute()` introspection and does not inject requests at [plugin.test.ts:30](/home/udai/PennyPilot/apps/api/src/modules/planning/plugin.test.ts:30)–[plugin.test.ts:46](/home/udai/PennyPilot/apps/api/src/modules/planning/plugin.test.ts:46).
- The planning route tests register the complete plugin at [planning.route.test.ts:57](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/planning.route.test.ts:57), establish real empty-row preconditions, require exact status 403, and verify no rows were written at [planning.route.test.ts:93](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/planning.route.test.ts:93)–[planning.route.test.ts:152](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/planning.route.test.ts:152). A missing route returning 404 would fail.
- Every planning mutation remains protected by the global demo-mode `onRequest` chokepoint at [auth.ts:43](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:43)–[auth.ts:74](/home/udai/PennyPilot/apps/api/src/plugins/auth.ts:74).

Executed gates:

- API typecheck: passed.
- ESLint with `--quiet`: passed.
- API tests: 848 passed, 0 failed.
- Both route snapshot tests passed.

This change is **not ready to ship (commit)** until the inaccurate `listGoals` public-interface documentation is corrected.