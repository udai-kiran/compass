# Task 059 — Independent Verification Report (verification-1.md)

Verifier: Claude Sonnet 4.6 (independent worker, read-only)
Date: 2026-08-18

---

## Files Inspected

- tasks/059-planning-routes-simple/TASK.md
- apps/api/src/modules/planning/routes/planning-analysis.ts
- apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts
- apps/api/src/modules/credit/routes/revolving-debt.ts
- apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts
- apps/api/src/route-surface.snapshot.txt (via git diff)
- apps/api/src/modules/planning/plugin.ts (via git diff)
- apps/api/src/modules/credit/plugin.ts (via git diff)

## Files Changed

NONE. This is a verify brief.

---

## A. EXIT CODE + TOTALS — Dispute Settled

**`npm run test` (root) exits 1, not 0.**

Confirmed by: `npm run test > /tmp/testout.txt 2>&1; echo "EXIT=$?"` → `EXIT=1`

Per-workspace totals (from `npm run test 2>&1 | grep -E "^ℹ"`):

| Workspace     | tests | pass | fail | skip |
|---------------|-------|------|------|------|
| api           |   799 |  771 |   27 |    1 |
| extractor     |    74 |   73 |    1 |    0 |
| ingestor      |    12 |   12 |    0 |    0 |
| web           |   270 |  270 |    0 |    0 |
| ai            |    32 |   32 |    0 |    0 |
| shared        |   212 |  212 |    0 |    0 |
| **TOTAL**     | **1399** | **1370** | **28** | **1** |

Pre-059 baseline: 1386 total / 1359 pass / 26 fail / 1 skip.

**Delta: +13 tests, +11 pass, +2 fail, 0 skip change.**

The implementer's claim of "EXIT=0 with 212 tests (packages/shared)" was demonstrably wrong — they ran `npm run test 2>&1 | tail -70` which printed the last workspace (shared) only, and then reported `echo "EXIT=$?"` which captured the exit code of `tail`, not `npm run test`. The actual exit code is 1.

---

## B. PREVIOUSLY-PASSING TEST REGRESSIONS

**No genuine new regressions (iii).**

Pre-059 api had 25 env-gated failures. Now api has 27 failures. The two additional failures are:
- `src/modules/planning/routes/planning-analysis.route.test.ts` — (ii) new AC4b integration file, throws at module load with `"planning-analysis.route.test.ts needs DATABASE_URL set"`. Expected by design.
- `src/modules/credit/routes/revolving-debt.route.test.ts` — (ii) new AC4b integration file, same `requireEnv` throw pattern. Expected by design.

All other 25 api failures are (i) known pre-existing environment-gated files (require DATABASE_URL / REDIS_URL / SESSION_SECRET). The extractor failure (`src/statement-duplicate.test.ts`) is also pre-existing.

**No category (iii) regressions found.**

---

## C. Snapshot

`wc -l apps/api/src/route-surface.snapshot.txt` → **319** lines. ✓

`git diff -- apps/api/src/route-surface.snapshot.txt` shows **exactly 6 added lines, nothing removed, no other changes**:

```
+GET /api/credit/revolving-debt
+GET /api/planning/data-completeness
+GET /api/planning/income-surplus
+HEAD /api/credit/revolving-debt
+HEAD /api/planning/data-completeness
+HEAD /api/planning/income-surplus
```

313 → 319 as specified. AC2 ✓ AC3 ✓

`node --test apps/api/src/app.route-snapshot.test.ts` passes 7/7. ✓

---

## D. Hermetic Tests — Real Route Plugin vs Stub Routes

**FINDING: The hermetic tests do NOT register the real `planningAnalysisRoutes` or `revolvingDebtRoutes` plugin. They register hand-rolled stub routes that mirror the real route schemas but return fixture data directly.**

Evidence from `planning-analysis.hermetic.test.ts`:
- `buildHermeticApp` calls `app.withTypeProvider()` and registers its own `r.get(...)` routes with stub handlers `async () => incomeSurplusStub`.
- The real `planningAnalysisRoutes` function is never imported or called.
- Comment at line 89-99 confirms: "The cleanest hermetic approach is to register a plugin that directly declares routes using the same schema contract but returns stub data."

Same pattern in `revolving-debt.hermetic.test.ts` — real `revolvingDebtRoutes` not imported.

**Assessment:** These tests prove the Zod schema contract (IncomeSurplusResultSchema, DataCompletenessReportSchema, HouseholdRevolvingDebtSchema) serializes correctly through `fastify-type-provider-zod`'s `serializerCompiler`. They do NOT prove the actual route plugin handlers are wired correctly (i.e. that `app.db` and `req.session!.userId` are passed correctly to the service). The tests catch serializer rejection of the schema, but not routing wiring bugs in the actual files.

Pass counts: planning hermetic → 11/11 pass. credit hermetic → 2/2 pass.

The tests are **genuinely useful for their stated purpose** (schema/serializer validation) but fall short of testing the real route plugin code path. This is a documentation accuracy issue: the test file comments say "real route plugin" at line 7 of `revolving-debt.hermetic.test.ts` ("real serializerCompiler and the real route schema"), which is accurate for the schema but inaccurate for the route plugin itself.

---

## E. Handlers — One Service Call Plus Return, No DB Queries

**YES. All 3 handlers are exactly one service call plus return with no DB access.**

`planning-analysis.ts`:
- income-surplus handler (line 43-44): `async (req) => getIncomeSurplus(app.db, req.session!.userId, req.query.lookbackMonths)`
- data-completeness handler (line 59): `async (req) => getDataCompletenessReport(app.db, req.session!.userId)`

`revolving-debt.ts`:
- revolving-debt handler (line 33): `async (req) => getHouseholdRevolvingDebt(app.db, req.session!.userId)`

No `db.select`, `db.execute`, or Drizzle query calls. No branching business logic. AC6 ✓

---

## F. Fastify Schema Key, Validation Tests

**YES: schema key is `querystring` (not `query`).** `planning-analysis.ts` line 37: `querystring: z.object({...})`. AC4 per TASK.md ✓

**lookbackMonths validation tests — ALL PRESENT in hermetic test:**
- omitted → defaults to 12: test "lookbackMonths defaults to 12 when omitted" → PASS ✓
- valid coerced string '6': test "lookbackMonths coerces string '6'" → PASS ✓
- 0 → 400: test "lookbackMonths=0 rejected 400" → PASS ✓
- 121 → 400: test "lookbackMonths=121 rejected 400" → PASS ✓
- fractional → 400: test "fractional lookbackMonths rejected 400" → PASS ✓
- non-numeric → 400: test "non-numeric lookbackMonths rejected 400" → PASS ✓
- `?today=` silently stripped: test "?today= is silently ignored (Zod strips unknown keys)" → PASS ✓

AC11 ✓

---

## G. Modified Files — Scope Compliance

**Only expected files changed.** `git diff --name-only` shows (beyond pre-059 dirty 057/058 files):
- `apps/api/src/modules/credit/plugin.ts` — appends `revolvingDebtRoutes` after `overdraftDetailsRoutes` ✓
- `apps/api/src/modules/planning/plugin.ts` — appends `planningAnalysisRoutes` after `projectionSettingsRoutes` ✓
- `apps/api/src/modules/credit/plugin.test.ts` — updated count to 5 ✓
- `apps/api/src/modules/planning/plugin.test.ts` — updated count to 9 ✓
- `apps/api/src/route-surface.snapshot.txt` — +6 lines ✓
- `apps/api/src/route-table.snapshot.txt` — regenerated ✓

No service files modified. No existing route files modified. No shared schema files modified (packages/shared/src/index.ts and packages/shared/src/schemas/*.ts were already dirty from 058). No `app.ts` changes.

**Registration order correct:**
- `planningAnalysisRoutes` registered last, after `projectionSettingsRoutes` (plugin.ts line 37-38) ✓
- `revolvingDebtRoutes` registered last, after `overdraftDetailsRoutes` (plugin.ts line 25-26) ✓

AC7 ✓

---

## H. Route Doc Comments — Owner-Only + 500 Risks

Both route files have prominent doc comments. Quoting `planning-analysis.ts` lines 8-29:

> "OWNER-ONLY SCOPING: Both endpoints return data for the authenticated user's own accounts only. `withSharing` (lib/sharing.ts) is deliberately NOT used..." and "RESIDUAL REAL-DB 500 RISKS (AC12): (a) Number(bigintString) / Drizzle mode:"number" can exceed Number.MAX_SAFE_INTEGER, which the contract's .safe() then correctly rejects → 500. (b) statement_reconciliations.period is unconstrained text (spines.ts:204-207) while the contract demands strict YYYY-MM, so malformed legacy data → 500."

`revolving-debt.ts` has identical structure documenting shared-cards omission and same two 500 risks.

AC5 ✓, AC12 ✓

---

## I. Suppressions

Grep across all 6 new files for `as any`, `@ts-ignore`, `@ts-expect-error`, `eslint-disable` returned no output. AC9 ✓

---

## J. Pre-existing Dirty Files (057/058) — Unchanged / Staging

**Pre-059 dirty files are unchanged and unreverted.** The following files appear in `git diff --name-only` as modified relative to HEAD (all pre-existing from 057/058):
- `apps/api/src/modules/household/routes/settlements.ts`
- `apps/api/src/modules/household/routes/splits.ts`
- `apps/api/src/modules/household/services/grants.ts`
- `apps/api/src/modules/household/services/membership.ts`
- `apps/api/src/modules/planning/services/goal-plan.test.ts`
- `apps/api/src/modules/planning/services/goal-plan.ts`
- `apps/api/src/modules/planning/services/income-surplus.test.ts`
- `apps/api/src/modules/planning/services/rebalancing-plan.test.ts`
- `apps/web/src/lib/household-queries.ts`
- `packages/shared/src/index.ts`

**Nothing staged.** `git status --short | grep "^A "` → no output.

**screen-shots/ is still untracked.** `git status --short | grep "^?? screen-shots"` → `?? screen-shots/`

---

## Summary of AC Pass/Fail

| AC  | Result | Notes |
|-----|--------|-------|
| AC1 | ✓ PASS | typecheck EXIT=0, lint EXIT=0 |
| AC2 | ✓ PASS | snapshot 319 lines, +6 exactly |
| AC3 | ✓ PASS | route-snapshot.test.ts 7/7 pass |
| AC4a | ✓ PASS (with caveat) | hermetic tests pass 11+2=13; but stub routes not real plugin |
| AC4b | ✓ by design FAIL | 2 new route.test.ts files throw at module load as expected |
| AC5 | ✓ PASS | owner-only documented |
| AC6 | ✓ PASS | single service call per handler |
| AC7 | ✓ PASS | no service/shared/existing-route changes |
| AC8 | ✓ PASS | 0 new regressions; 2 new AC4b fails expected |
| AC9 | ✓ PASS | no suppressions |
| AC10 | ✓ PASS | all 3 are GETs |
| AC11 | ✓ PASS | all 7 validation cases present and passing |
| AC12 | ✓ PASS | both 500 risks documented in comments |

## One Notable Gap

The hermetic tests test the schema/serializer contract using **hand-rolled stub routes**, not the real `planningAnalysisRoutes` / `revolvingDebtRoutes` plugins. This means a typo in the handler call (e.g. wrong arg order, wrong service function) would not be caught by the hermetic tests. Typecheck catches the type contract, but a runtime wiring bug survives until the AC4b integration tests run with a real database. This is an inherent limitation of the test strategy, not a new finding — the TASK.md anticipated it.
