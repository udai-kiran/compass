# Implementation-2 — FIX PASS (review-2 findings)

## Files Inspected
- `apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts`
- `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts`
- `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts`
- `apps/api/src/modules/planning/routes/planning-analysis.ts`
- `apps/api/src/modules/planning/services/income-surplus.ts`
- `apps/api/src/modules/planning/services/data-completeness.ts`
- `apps/api/src/modules/credit/services/revolving-debt.ts`
- `apps/api/src/modules/planning/plugin.ts`
- `apps/api/src/modules/credit/plugin.ts`
- `apps/api/package.json`
- `apps/api/src/db/shared/hubs.ts`, `spines.ts`
- `apps/api/src/modules/credit/schema.ts`

## Files Changed
1. `apps/api/package.json` — added `--experimental-test-module-mocks` flag to enable `mock.module`
2. `apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts` — FIX 1: full rewrite using real plugin + mock.module; FIX 5: `?today=` test strengthened
3. `apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts` — FIX 1: full rewrite using real plugin + mock.module
4. `apps/api/src/modules/planning/routes/planning-analysis.route.test.ts` — FIX 3: real row inserts; FIX 4: cross-user isolation with real data
5. `apps/api/src/modules/credit/routes/revolving-debt.route.test.ts` — FIX 3: real card+statement inserts; FIX 4: cross-user isolation
6. `apps/api/src/modules/planning/routes/planning-analysis.ts` — FIX 5: corrected `today` comment
7. `apps/api/src/modules/planning/services/income-surplus.ts` — FIX 2: owner-only doc comment on `getIncomeSurplus`
8. `apps/api/src/modules/planning/services/data-completeness.ts` — FIX 2: owner-only doc comment on `getDataCompletenessReport`
9. `apps/api/src/modules/credit/services/revolving-debt.ts` — FIX 2: owner-only doc comment on `getHouseholdRevolvingDebt`
10. `apps/api/src/modules/planning/plugin.ts` — FIX 6: corrected false "same URLs/pure relocation" comment
11. `apps/api/src/modules/credit/plugin.ts` — FIX 6: corrected false "same URLs/pure relocation" comment

## Implementation Details

### FIX 1 — Hermetic tests rewritten with real plugin + mock.module
`mock.module` from `node:test` requires `--experimental-test-module-mocks` (confirmed
in Node 24.18.0 — the API is `undefined` without the flag). Added this flag to the
`test` script in `apps/api/package.json`.

Mechanism: at top-level (before importing the route plugin), each test file calls
`await mock.module(new URL("../services/<name>.ts", import.meta.url).href, { exports: { ... } })`
to register a stub. The URL is resolved from the test file's directory — same directory
as the route file — so the absolute URL matches what the route imports. Then
`const { planningAnalysisRoutes } = await import("./planning-analysis.ts")` loads
the REAL plugin, which binds to the stub exports. A minimal Fastify app decorates
`app.db` with `{} as unknown as Db` (value never used since the mocked service ignores
its arguments) and registers the real plugin. All tests inject against this real handler.

The `?today=` test uses a mutable `capturedLookback` variable to verify the real route
validator passes the argument through correctly. The empty-cards revolving-debt test uses
a mutable `stubReturn` variable to avoid re-mocking the same module URL (which errors
with `ERR_INVALID_STATE: The module is already mocked`).

### Non-vacuity proof (FIX 1)
- Checksum before break: `5374d2b08ec0b440661c8762d352e7ec090ccd20b908d2df6e7c6173f6534610`
- Changed `"/api/planning/income-surplus"` → `"/api/planning/income-surplus-BROKEN"` in route file
- `node --experimental-test-module-mocks --test ...planning-analysis.hermetic.test.ts` → 7 FAIL (404 for broken path)
- Reverted; checksum after: `5374d2b08ec0b440661c8762d352e7ec090ccd20b908d2df6e7c6173f6534610` (byte-exact match)
- Re-run: 9 PASS

### FIX 2 — Service doc comments
- `income-surplus.ts:117` — added `/** ... OWNER-ONLY SCOPING: ... */` before `getIncomeSurplus`
- `data-completeness.ts:159` — added `/** ... OWNER-ONLY SCOPING: ... today not exposed... */` before `getDataCompletenessReport`
- `revolving-debt.ts:87` — added `/** ... OWNER-ONLY SCOPING: name overpromises... */` before `getHouseholdRevolvingDebt`
- No logic changed.

### FIX 3 — AC4b fixtures exercise documented risks
`planning-analysis.route.test.ts`: added `createBankAccount` and `createStatementReconciliation`
helpers; new test "user with account: returns non-empty accounts array, period constraint not
triggered" creates an account + statementReconciliations row (period="2026-07", totalDuePaise=5_000_000,
minDuePaise=250_000) and asserts non-empty accounts array.

`revolving-debt.route.test.ts`: added `createCardWithStatement` helper that creates a credit_card
account, inserts a `cardDetails` row (with aprBps=4200 to exercise `estimateMonthlyCharge`), and a
`statementReconciliations` row with the current period (YYYY-MM), totalDuePaise=5_000_000,
minDuePaise=250_000. New test asserts `cards.length > 0`.

Both files still fail at module load (requireEnv throws) — correct and expected.

### FIX 4 — Cross-user isolation tests meaningful
- `planning-analysis.route.test.ts`: isolation test now creates a bank account for user A;
  asserts user B has 0 accounts in data-completeness (instead of both empty).
- `revolving-debt.route.test.ts`: isolation test now creates a credit card+statement for user A;
  asserts user B has 0 cards; verifies no user-A card IDs appear in user B response.

### FIX 5 — `today` comment corrected + test strengthened
`planning-analysis.ts:51-55`: corrected from "Zod strips unknown keys" to "route defines NO
querystring schema, so query params not processed; handler omits today argument; service defaults
today = new Date()".

Hermetic test: `?today= is silently ignored` test now asserts `body.asOf !== "2020-01-01"` AND
`body.asOf === "2026-08-18"` (fixture value). Integration test: similar `assert.notEqual(body.asOf,
"2020-01-01")` assertion.

### FIX 6 — Plugin false comments corrected
`planning/plugin.ts`: replaced "same URLs / pure relocation / no behavioral change" with accurate
text: the first 8 groups are pure relocation; the 9th (`planningAnalysisRoutes`) ADDS two new URL
paths not previously in `app.ts`.
`credit/plugin.ts`: same — first 4 are pure relocation; 5th (`revolvingDebtRoutes`) ADDS one new URL.

## Commands Run

```
sha256sum apps/api/src/modules/planning/routes/planning-analysis.ts
# → 5374d2b0... (before break)

node --experimental-test-module-mocks --test apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts
# → 7 FAIL (with -BROKEN path)

# reverted, then:
sha256sum apps/api/src/modules/planning/routes/planning-analysis.ts
# → 5374d2b0... (matches — byte-exact restore)

node --experimental-test-module-mocks --test apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts
# → 11/11 PASS

npm run typecheck ; echo "EXIT=$?"
# EXIT=0

npm run lint ; echo "EXIT=$?"
# EXIT=0

wc -l apps/api/src/route-surface.snapshot.txt
# 319

node --experimental-test-module-mocks --test apps/api/src/app.route-snapshot.test.ts
# 7/7 PASS

npm run test > /tmp/059-test.txt 2>&1 ; echo "EXIT=$?" ; tail -70 /tmp/059-test.txt
# EXIT=1
```

## Test Results — Root `npm run test`

```
EXIT=1

@compass/api:    tests 799 / pass 771 / fail 27
@compass/extractor: tests 74 / pass 73 / fail 1  (pre-existing DB-gated)
@compass/ingestor:  tests 12 / pass 12 / fail 0
@compass/web:       tests 270 / pass 270 / fail 0
@compass/ai:        tests 32 / pass 32 / fail 0
@compass/shared:    tests 212 / pass 212 / fail 0
Total: 1399 / 1370 / 28 / 0 skip (1 in extractor from previous)
```

Matches expected: exit 1, ~1399/1370/28. The 28 failures are:
- 27 api: 25 pre-existing DB/Redis-gated + 2 NEW AC4b files (planning-analysis.route.test.ts,
  revolving-debt.route.test.ts) — fail at module load by design (requireEnv throws)
- 1 extractor: statement-duplicate.test.ts needs DATABASE_URL — pre-existing

No genuine regression vs baseline.

## Suppression Check

```
grep -rnE "as any|ts-expect-error|ts-ignore|eslint-disable" <all changed files>
# → no output (no suppressions)
```

## Assumptions
- `--experimental-test-module-mocks` flag is stable enough for Node 24.18.0 (confirmed working)
- The `exports` key is the non-deprecated form of `namedExports` in Node 24's mock.module API
- Both snapshot files remain byte-exact at 319 lines (unmodified)
- Plugin enumeration test counts (9 and 5) remain unmodified

## Unresolved Risks
- AC4b integration tests still cannot be run without DB/Redis — residual 500 risks for
  `Number.MAX_SAFE_INTEGER` and malformed `period` remain open until the tests run against a real DB
- `--experimental-test-module-mocks` is marked experimental — could change in a future Node release
