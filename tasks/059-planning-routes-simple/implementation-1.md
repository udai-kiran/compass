# Task 059 — Implementation Evidence

## Files Inspected (not changed)
- `apps/api/src/modules/planning/routes/goals.ts` — exemplar route shape
- `apps/api/src/modules/planning/routes/cashflow.ts` — querystring exemplar
- `apps/api/src/modules/planning/routes/dashboard.ts` — querystring exemplar
- `apps/api/src/modules/credit/routes/overdraft-details.ts` — credit route exemplar
- `apps/api/src/modules/planning/routes/planning.route.test.ts` — integration test pattern
- `apps/api/src/modules/planning/services/income-surplus.ts` — service signature
- `apps/api/src/modules/planning/services/data-completeness.ts` — service signature
- `apps/api/src/modules/credit/services/revolving-debt.ts` — service signature
- `packages/shared/src/schemas/planning.ts` — IncomeSurplusResultSchema, DataCompletenessReportSchema
- `packages/shared/src/schemas/credit.ts` — HouseholdRevolvingDebtSchema
- `apps/api/src/app.route-snapshot.test.ts` — snapshot comparison logic

## Files Created (new untracked)
- `apps/api/src/modules/planning/routes/planning-analysis.ts`
- `apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts`
- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts`

## Files Modified (tracked)
- `apps/api/src/modules/planning/plugin.ts` — added planningAnalysisRoutes import + register
- `apps/api/src/modules/planning/plugin.test.ts` — 8→9 route files, added planning-analysis.ts entry
- `apps/api/src/modules/credit/plugin.ts` — added revolvingDebtRoutes import + register
- `apps/api/src/modules/credit/plugin.test.ts` — 4→5 route files, added revolving-debt.ts entry
- `apps/api/src/route-surface.snapshot.txt` — regenerated (313→319 lines)
- `apps/api/src/route-table.snapshot.txt` — regenerated

## Commands and Literal Output

### Command 1: git status --short (BEFORE)
```
 M apps/api/src/modules/household/routes/settlements.ts
 M apps/api/src/modules/household/routes/splits.ts
 M apps/api/src/modules/household/services/grants.ts
 M apps/api/src/modules/household/services/membership.ts
 M apps/api/src/modules/planning/services/goal-plan.test.ts
 M apps/api/src/modules/planning/services/goal-plan.ts
 M apps/api/src/modules/planning/services/income-surplus.test.ts
 M apps/api/src/modules/planning/services/rebalancing-plan.test.ts
 M apps/web/src/lib/household-queries.ts
 M packages/shared/src/index.ts
?? apps/api/src/modules/credit/services/credit-schemas.test.ts
?? apps/api/src/modules/planning/services/planning-schemas.test.ts
?? packages/shared/src/schemas/credit.ts
?? packages/shared/src/schemas/planning.ts
?? screen-shots/
?? tasks/057-green-baseline/
?? tasks/058-planning-api/
?? tasks/059-planning-routes-simple/
```

### Command 2: npm run test (BEFORE baseline)
```
ℹ tests 212
ℹ pass 212
ℹ fail 0
EXIT=0
```
(Last 40 lines of output showed packages/shared workspace totals)

### Command 3: wc -l apps/api/src/route-surface.snapshot.txt (BEFORE)
```
313 apps/api/src/route-surface.snapshot.txt
```

### Command 5: npm run typecheck
```
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

EXIT=0
```

### Command 6: npm run lint
```
> compass@0.1.0 lint
> eslint .

EXIT=0
```

### Command 7: node --test apps/api/src/app.route-snapshot.test.ts
```
✔ canonical route surface ((method, path) pairs) matches the committed snapshot byte-for-byte — the real 'unchanged API surface' gate (255.894353ms)
✔ raw printRoutes() tree matches the committed snapshot byte-for-byte (86.586715ms)
✔ assertRouteTableMatches rejects an added route (0.58471ms)
✔ assertRouteTableMatches rejects a removed route (0.21634ms)
✔ assertRouteTableMatches rejects a renamed route (0.230358ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.159863ms)
✔ assertRouteTableMatches accepts identical tables (0.315019ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ duration_ms 1980.729721
```

### Command 8: node --test plugin.test.ts (both)
```
✔ creditRoutes registers one uniquely-attributable route from each of the 5 internal route files (140.250183ms)
✔ planningRoutes registers one uniquely-attributable route from each of the 9 internal route files (147.372614ms)
ℹ tests 2
ℹ pass 2
ℹ fail 0
ℹ duration_ms 1477.059667
```

### Command 9: wc -l apps/api/src/route-surface.snapshot.txt (AFTER)
```
319 apps/api/src/route-surface.snapshot.txt
```

### Command 10: git diff -- apps/api/src/route-surface.snapshot.txt
```
diff --git a/apps/api/src/route-surface.snapshot.txt b/apps/api/src/route-surface.snapshot.txt
index 0548d2f..f6a845f 100644
--- a/apps/api/src/route-surface.snapshot.txt
+++ b/apps/api/src/route-surface.snapshot.txt
@@ -55,6 +55,7 @@ GET /api/cashflow
 GET /api/cashflow/export.csv
 GET /api/categories
 GET /api/categories/tree
+GET /api/credit/revolving-debt
 GET /api/dashboard
 GET /api/emis
 GET /api/emis/:templateId/installments
@@ -93,6 +94,8 @@ GET /api/net-worth
 GET /api/net-worth/by-goal
 GET /api/notification-prefs
 GET /api/notifications
+GET /api/planning/data-completeness
+GET /api/planning/income-surplus
 GET /api/portfolio
 GET /api/profile
 GET /api/projection-settings
@@ -145,6 +148,7 @@ HEAD /api/cashflow
 HEAD /api/cashflow/export.csv
 HEAD /api/categories
 HEAD /api/categories/tree
+HEAD /api/credit/revolving-debt
 HEAD /api/dashboard
 HEAD /api/emis
 HEAD /api/emis/:templateId/installments
@@ -183,6 +187,8 @@ HEAD /api/net-worth
 HEAD /api/net-worth/by-goal
 HEAD /api/notification-prefs
 HEAD /api/notifications
+HEAD /api/planning/data-completeness
+HEAD /api/planning/income-surplus
 HEAD /api/portfolio
 HEAD /api/profile
 HEAD /api/projection-settings
```
Exactly 6 lines added: 3 GET + 3 HEAD (Fastify auto-registered HEAD for each GET).

### Command 11: npm run test (AFTER)
Full output shows:
- New failing files (requireEnv throws, by design, AC4b):
  - `✖ src/modules/credit/routes/revolving-debt.route.test.ts`
  - `✖ src/modules/planning/routes/planning-analysis.route.test.ts`
- These two files added to the pre-existing set of env-gated failing files.
- No previously-passing test fails.
- exit code: EXIT=0

Workspace totals visible in tail-50:
```
ℹ tests 212
ℹ pass 212
ℹ fail 0
ℹ duration_ms 398.754429
EXIT=0
```
(packages/shared still 212; api workspace runs 799+ tests but env-gated failures don't affect exit code)

### Command 12: grep suppressions
```
(no output — zero suppression matches)
```
Command:
```
grep -rnE "as any|ts-expect-error|ts-ignore|eslint-disable" \
  apps/api/src/modules/planning/routes/planning-analysis.ts \
  apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts \
  apps/api/src/modules/planning/routes/planning-analysis.route.test.ts \
  apps/api/src/modules/credit/routes/revolving-debt.ts \
  apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts \
  apps/api/src/modules/credit/routes/revolving-debt.route.test.ts \
  apps/api/src/modules/planning/plugin.ts \
  apps/api/src/modules/credit/plugin.ts
```

## Hermetic Test Output (AC4a — PASS)

```
node --test apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts \
            apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts

✔ GET /api/credit/revolving-debt — 200 and schema-valid body (133.803919ms)
✔ GET /api/credit/revolving-debt — empty cards returns 200 with zero totals (5.44562ms)
✔ GET /api/planning/income-surplus — 200 and schema-valid body (no query) (141.471691ms)
✔ GET /api/planning/income-surplus — lookbackMonths defaults to 12 when omitted (8.73416ms)
✔ GET /api/planning/income-surplus — lookbackMonths coerces string '6' (4.110023ms)
✔ GET /api/planning/income-surplus — lookbackMonths=0 rejected 400 (6.248049ms)
✔ GET /api/planning/income-surplus — lookbackMonths=121 rejected 400 (4.216319ms)
✔ GET /api/planning/income-surplus — fractional lookbackMonths rejected 400 (3.8769ms)
✔ GET /api/planning/income-surplus — non-numeric lookbackMonths rejected 400 (3.935403ms)
✔ GET /api/planning/data-completeness — 200 and schema-valid body (5.1663ms)
✔ GET /api/planning/data-completeness — ?today= is silently ignored (Zod strips unknown keys) (3.836624ms)
ℹ tests 11
ℹ pass 11
ℹ fail 0
ℹ duration_ms 620.736147
```

## Integration Test Output (AC4b — WRITTEN BUT UNRUN)
Labels: written but unrun — cannot be verified without DB/Redis

```
node --test apps/api/src/modules/planning/routes/planning-analysis.route.test.ts

Error: planning-analysis.route.test.ts needs DATABASE_URL set (a real Postgres/Redis-backed app
boot) — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (planning-analysis.route.test.ts:27:11)
    at planning-analysis.route.test.ts:34:1
✖ apps/api/src/modules/planning/routes/planning-analysis.route.test.ts (3889ms)
ℹ tests 1
ℹ fail 1
EXIT=0
```

```
node --test apps/api/src/modules/credit/routes/revolving-debt.route.test.ts

Error: revolving-debt.route.test.ts needs DATABASE_URL set (a real Postgres/Redis-backed app
boot) — export it (see apps/api/.env) before running `npm run test -w apps/api`.
    at requireEnv (revolving-debt.route.test.ts:27:11)
    at revolving-debt.route.test.ts:34:1
✖ apps/api/src/modules/credit/routes/revolving-debt.route.test.ts (4092ms)
ℹ tests 1
ℹ fail 1
EXIT=0
```

## Implementation Details

### Route shape
Each handler is exactly one service call plus a return:
- `planning-analysis.ts` line 42: `async (req) => getIncomeSurplus(app.db, req.session!.userId, req.query.lookbackMonths)`
- `planning-analysis.ts` line 53: `async (req) => getDataCompletenessReport(app.db, req.session!.userId)`
- `revolving-debt.ts` line 34: `async (req) => getHouseholdRevolvingDebt(app.db, req.session!.userId)`

No `db.select`, `db.execute`, `db.query`, or Drizzle call in any handler. No branching.

### 6 new snapshot lines (verbatim)
```
GET /api/credit/revolving-debt
GET /api/planning/data-completeness
GET /api/planning/income-surplus
HEAD /api/credit/revolving-debt
HEAD /api/planning/data-completeness
HEAD /api/planning/income-surplus
```

## Assumptions
- The snapshot regeneration script (inline Node ESM) correctly calls `registerRoutes` from `app.ts` — confirmed by the test passing byte-exact.
- `planningAnalysisRoutes` registered after `projectionSettingsRoutes` per brief; `revolvingDebtRoutes` registered after `overdraftDetailsRoutes`.
- Route order within `planning-analysis.ts`: income-surplus first, then data-completeness.

## Unresolved Risks
1. **Real-DB 500 risk (a)**: `Number(bigintString)` / Drizzle `mode:"number"` can exceed `Number.MAX_SAFE_INTEGER`; the contract's `.safe()` correctly rejects → 500. Documented in route doc comments, not fixed.
2. **Real-DB 500 risk (b)**: `statement_reconciliations.period` is unconstrained `text` while the contract demands `YYYY-MM`; malformed legacy data → 500. Documented, not fixed.
3. **Owner-only scoping**: All three endpoints return owner-only data; shared accounts/cards are omitted. Documented in route doc comments with reference to task 061.
4. **Integration tests cannot be verified here**: AC4b tests will only prove correctness with a live DB+Redis. The hermetic tests (AC4a) cover serializer path and query validation.
