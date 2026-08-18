# implementation-2.md — Task 058 Stage 2

## Files changed (Stage 2 only)

New files:
- `packages/shared/src/schemas/planning.ts` — 6 planning schema groups (19 exports)
- `packages/shared/src/schemas/credit.ts` — revolving-debt schemas (4 exports)
- `apps/api/src/modules/planning/services/planning-schemas.test.ts` — 36 tests
- `apps/api/src/modules/credit/services/credit-schemas.test.ts` — 14 tests

Modified:
- `packages/shared/src/index.ts` — added 2 `export *` lines (planning.ts, credit.ts)
- `apps/api/src/modules/planning/services/rebalancing-plan.test.ts` — replaced `> 0` with exact assertion `assert.equal(evt.equityToSwitchPaise, 10_800_000)`

NOT mine (pre-existing dirty tree, 8 files):
- task 057: household/routes/splits.ts, settlements.ts, household/services/grants.ts, membership.ts, planning/services/income-surplus.test.ts, web/src/lib/household-queries.ts
- Stage 1: planning/services/goal-plan.ts, goal-plan.test.ts

---

## Zod API choices

**Money fields:** `z.number().int().safe()` — Zod v4 `.safe()` was verified available at startup. This rejects NaN, Infinity, and values outside `Number.MAX_SAFE_INTEGER`, which `.int()` alone does NOT guarantee. Local non-exported `paiseField()` helper used in both files.

**YYYY-MM-DD dates:** `z.iso.date()` — verified available in installed Zod v4; outputs `string`.

**YYYY-MM year-month:** explicit regex `z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/)` — not an ISO date, so `z.iso.date()` would be wrong.

---

## equityToSwitchPaise exact value

Test case: goalType="home", monthsToTarget=24, fundedPaise=5_00_000_00, monthlyInflowPaise=0, equityReturnBps=1200, debtReturnBps=700, today=2026-08-18.

From actual `buildGlidePathSchedule` output (verified by running the code):
- steps[0].projectedCorpusPaise = 50_000_000 (= fundedPaise)
- Projection: 50_000_000 × 1.08¹ = 54_000_000 (blendedBps=800 for 20/80 band)
- steps[1].projectedCorpusPaise = 54_000_000 (Math.round(54_000_000) = 54_000_000)
- equityChangePct = |20 - 0| = 20
- equityToSwitchPaise = Math.round(54_000_000 × 20 / 100) = **10_800_000**

Asserted as `assert.equal(evt.equityToSwitchPaise, 10_800_000)` replacing the prior `assert.ok(evt.equityToSwitchPaise > 0)`.

---

## Parity assertion non-vacuous proof

Temporarily changed `projectedCorpusPaise: paiseField()` → `z.string()` in GlideStepSchema:

```
npm run typecheck -w apps/api:
  src/modules/planning/services/planning-schemas.test.ts(92,3): error TS2344:
  Type 'false' does not satisfy the constraint 'true'.
EXIT=2
```

After revert, typecheck exits 0. SHA256 before and after revert matches:
`0c4bc76f565f8d6e05c4369360601160476fff7915c52a6083f8da0b23ebe8dc`

---

## Command outputs and exit codes

### 1. git status --short (before edits)
```
 M apps/api/src/modules/household/routes/settlements.ts
 M apps/api/src/modules/household/routes/splits.ts
 M apps/api/src/modules/household/services/grants.ts
 M apps/api/src/modules/household/services/membership.ts
 M apps/api/src/modules/planning/services/goal-plan.test.ts
 M apps/api/src/modules/planning/services/goal-plan.ts
 M apps/api/src/modules/planning/services/income-surplus.test.ts
 M apps/web/src/lib/household-queries.ts
?? screen-shots/
?? tasks/057-green-baseline/
?? tasks/058-planning-api/
```

### 2. npm run test (before, baseline) — EXIT=0 (note: pre-existing baseline exits 0 due to pipeline; full suite exit is 1 when measured directly)

Baseline totals:
- extractor: 74 tests, 73 pass, 1 fail (statement-duplicate.test.ts)
- ingestor: 12 tests, 12 pass, 0 fail
- web: 270 tests, 270 pass, 0 fail
- ai: 32 tests, 32 pass, 0 fail
- shared: 212 tests, 212 pass, 0 fail
- api: 786 pass, 25 fail (DATABASE_URL-gated files at module load)

Note: The delegation stated exit 1 as baseline, consistent with the direct measurement `npm run test > /dev/null 2>&1; echo "EXIT=$?"` → `EXIT=1`.

### 4. npm run typecheck — EXIT=0
All 6 workspaces pass: extractor, ingestor, web, ai, shared, api.

### 5. npm run lint — EXIT=0
No errors, no warnings.

### 6. npm run test -w packages/shared — EXIT=0
212 tests, 212 pass, 0 fail, 0 skip.

### 7. npm run test -w apps/api — EXIT=1 (expected, DATABASE_URL-gated)
786 tests, 760 pass, 25 fail.
Failing files (all DATABASE_URL-gated, same baseline set):
- src/app.test.ts
- src/modules/ledger/services/epf-contributions.test.ts
- src/modules/ledger/services/postings-balance-parity.test.ts
- src/modules/ledger/services/postings-pr-e-parity.test.ts
- src/modules/ledger/services/reconcile-postings.test.ts
- src/modules/ledger/services/recurring.test.ts
- src/modules/ledger/services/user-tasks.test.ts
- src/modules/planning/routes/planning.route.test.ts
- src/modules/planning/routes/projection-settings.route.test.ts
- src/modules/planning/services/postings-planning-parity.test.ts
- src/modules/planning/services/projection-settings.test.ts
- src/modules/protection/routes/protection.route.test.ts
- src/modules/system/routes/system.route.test.ts
- src/modules/system/services/backup.test.ts
New test files (planning-schemas.test.ts 36, credit-schemas.test.ts 14) all PASS.

### 8. npm run test (full suite) — EXIT=1
Totals: extractor 74/73p/1f, ingestor 12/12p/0f, web 270/270p/0f, ai 32/32p/0f, shared 212/212p/0f, api 786/760p/25f.
No new failures vs baseline.

### 9. node --test rebalancing-plan.test.ts — EXIT=0
11 tests, 11 pass, 0 fail. Exact equityToSwitchPaise=10_800_000 passes.

### 10. git diff --stat and snapshot check — EXIT=0
Route snapshot files (`route-surface.snapshot.txt`, `route-table.snapshot.txt`) show empty diff — byte-identical.

### 11. grep suppressions check — EXIT=1 (no matches found)
```
grep -rnE "z\.any\(|z\.unknown\(|as any|ts-expect-error|ts-ignore|eslint-disable" \
  packages/shared/src/schemas/planning.ts \
  packages/shared/src/schemas/credit.ts \
  apps/api/src/modules/planning/services/planning-schemas.test.ts \
  apps/api/src/modules/credit/services/credit-schemas.test.ts
(no output)
EXIT=1
```
grep EXIT=1 = no matches found. Good.

---

## Acceptance criteria status

- AC1: npm run typecheck exits 0 ✓
- AC2: npm run lint exits 0 ✓
- AC3: All required names from export list importable — barrel smoke test passes ✓
- AC4: 7 parity assertions compile (6 in planning-schemas.test.ts, 1 in credit-schemas.test.ts) ✓
- AC5: Runtime safeParse tests pass for all 7 contracts (Tier A: 4 pure; Tier B: 3 DB-backed) ✓
- AC6: Every money field uses paiseField()=z.number().int().safe(); fractional table-driven tests prove .int() enforced across all 7 schemas ✓
- AC7: No z.any(), z.unknown(), as any, @ts-ignore, @ts-expect-error, eslint-disable ✓
- AC8: No new test failures vs baseline; only DATABASE_URL-gated set fails ✓
- AC9: Only allowed files modified (rebalancing-plan.test.ts for exact assertion) ✓
- AC10: Both snapshot .txt files byte-identical (empty diff) ✓
- AC11: Not applicable to Stage 2 (Stage 1 already verified) ✓

---

## Assumptions and notes

- `.safe()` on `z.number()` in Zod v4 applies `Number.isSafeInteger()` semantics, rejecting NaN, Infinity, and values > MAX_SAFE_INTEGER. Verified at runtime before use.
- `z.iso.date()` in Zod v4 outputs `string` (not a branded type), so it's structurally equal to `string` in TypeScript — parity assertions pass.
- The `Equal` helper uses tuple-wrapped conditionals to prevent union distribution. It is structural, so interface types equal object types of the same shape.
- Baseline exit code: the delegation states exit 1. My direct measurement confirms `npm run test > /dev/null 2>&1; echo "EXIT=$?"` → EXIT=1. The pipeline-based measurement shows EXIT=0 (from `tail`).

---

## Unresolved risks

None. All specified acceptance criteria met.
