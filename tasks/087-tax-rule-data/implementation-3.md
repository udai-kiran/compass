# Task 087 — Fix round 3 implementation report

## Per-item resolution

- **K1** DONE: Added `regimeSourceEnum` to `taxResidents` Set (line 85) and to the enum identity map loop (line 271) in `schema.decomposition.test.ts`. The "exports exactly 74 tables + 58 enums" count was already correct (regimeSourceEnum was in the barrel); only the residents set and identity map were missing it.
- **K2** DONE: Added `concurrency: concurrent chosen and inferred writes satisfy resolution invariant (10 iterations)` test in `regime-preference.test.ts` inside the existing `if (dbUrl)` guard block. Uses `Promise.all([upsertRegimePreference, updateInferredRegime])` on fresh user+fy pairs, checks that (1) readable fields match what was written, and (2) the resolution invariant holds: chosen→effective==chosen/source==chosen; else inferred→effective==inferred/source==inferred; else effective==new/source==default. Used non-null assertions (`!`) on `as const` array indexing to satisfy TypeScript.
- **K3** DONE: Created `apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts` using the `mock.module` pattern from `planning-analysis.hermetic.test.ts`. Stubs `../services/regime-preference.ts` before importing the real route. Three tests: GET ?fy=2025-27 → 400, PUT fy=2025-27 → 400, GET ?fy=2025-26 → 200 with stub result verified.
- **K4** N/A (decision, no code): demo-PUT-403 test deliberately omitted per TASK.md documented rationale.
- **K5** DONE: Comment in `tax-rules.ts` FY2026-27 block updated from "was enacted in February 2026" to "was introduced in February 2026 and received presidential assent on 30 March 2026, confirming the same slabs as FY 2025-26."

## Files changed

- `apps/api/src/db/schema.decomposition.test.ts` — K1: two single-line edits
- `apps/api/src/modules/tax/services/regime-preference.test.ts` — K2: added ~50-line concurrency test block
- `apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts` — K3: new file (103 lines)
- `apps/api/src/lib/tax-rules.ts` — K5: comment-only 3-line edit

## Complete diff

```diff
diff --git a/apps/api/src/db/schema.decomposition.test.ts b/apps/api/src/db/schema.decomposition.test.ts
--- a/apps/api/src/db/schema.decomposition.test.ts
+++ b/apps/api/src/db/schema.decomposition.test.ts
@@ taxResidents
-const taxResidents = new Set([
-  "taxRegimePreferences", "taxRegimeEnum",
-]);
+const taxResidents = new Set([
+  "taxRegimePreferences", "taxRegimeEnum", "regimeSourceEnum",
+]);

@@ enum identity map
-    for (const k of ["taxRegimeEnum"]) {
+    for (const k of ["taxRegimeEnum", "regimeSourceEnum"]) {
       enumMap[k] = { module: tax as unknown as Record<string, unknown>, key: k };
     }

diff --git a/apps/api/src/lib/tax-rules.ts b/apps/api/src/lib/tax-rules.ts
--- a/apps/api/src/lib/tax-rules.ts
+++ b/apps/api/src/lib/tax-rules.ts
@@ FY 2026-27 comment
-// Finance Act 2026 was enacted in February 2026 and confirmed the same slabs as
-// FY 2025-26. These entries carry those rates forward. Update if a revised Act
-// is published.
+// Finance Act 2026 was introduced in February 2026 and received presidential
+// assent on 30 March 2026, confirming the same slabs as FY 2025-26. These
+// entries carry those rates forward. Update if a revised Act is published.

diff --git a/apps/api/src/modules/tax/services/regime-preference.test.ts b/apps/api/src/modules/tax/services/regime-preference.test.ts
--- added concurrency test inside if (dbUrl) block ---
+  test("concurrency: concurrent chosen and inferred writes satisfy resolution invariant (10 iterations)", async () => {
+    const COVERED_FYS = ["2023-24", "2024-25", "2025-26", "2026-27"] as const;
+    const REGIMES = ["old", "new"] as const;
+    for (let i = 0; i < 10; i++) {
+      const userId = await createTestUser();
+      const fy = COVERED_FYS[i % COVERED_FYS.length]!;
+      const chosenRegime = REGIMES[i % 2]!;
+      const inferredRegime = REGIMES[(i + 1) % 2]!;
+      await Promise.all([
+        upsertRegimePreference(db, userId, fy, chosenRegime),
+        updateInferredRegime(db, userId, fy, inferredRegime),
+      ]);
+      const row = await getRegimePreference(db, userId, fy);
+      // chosen field coherence
+      assert.ok(row.chosen === null || row.chosen === chosenRegime, ...);
+      assert.ok(row.inferredRegime === null || row.inferredRegime === inferredRegime, ...);
+      // resolution invariant
+      if (row.chosen !== null) {
+        assert.equal(row.effective, row.chosen, ...);
+        assert.equal(row.source, "chosen", ...);
+      } else if (row.inferredRegime !== null) {
+        assert.equal(row.effective, row.inferredRegime, ...);
+        assert.equal(row.source, "inferred", ...);
+      } else {
+        assert.equal(row.effective, "new", ...);
+        assert.equal(row.source, "default", ...);
+      }
+    }
+  });

diff --git a/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts b/apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts
--- new file ---
+ (103 lines — mock.module stub + buildHermeticApp() + 3 test cases)
```

## Commands and exact output

### Gate 1 (with required --experimental-test-module-mocks flag)

Command:
```
node --experimental-test-module-mocks --test apps/api/src/db/schema.decomposition.test.ts apps/api/src/modules/tax/routes/regime-preference.hermetic.test.ts apps/api/src/modules/tax/services/regime-preference.test.ts
```

Output:
```
▶ db/schema.ts decomposition
  ✔ exports exactly 74 tables + 58 enums + users with no duplicates (0.685987ms)
  ✔ has Object.is-identical tables for all residents (0.323226ms)
  ✔ has Object.is-identical enums for all residents (0.240578ms)
✔ db/schema.ts decomposition (1.788609ms)
(node:55500) ExperimentalWarning: Module mocking is an experimental feature and might change at any time
✔ GET /regime-preference?fy=2025-27 — 400 (FY end-year suffix inconsistent with start year) (64.60752ms)
✔ PUT /regime-preference body={fy:'2025-27',...} — 400 (FY end-year suffix inconsistent) (4.14391ms)
✔ GET /regime-preference?fy=2025-26 — 200 and reaches service stub (proves route→service wiring) (2.856164ms)
✔ regime-preference module exports getRegimePreference, upsertRegimePreference, updateInferredRegime (0.454676ms)
✔ getRegimePreference: HttpError(400) for FY outside coveredFys (0.910355ms)
✔ upsertRegimePreference: HttpError(400) for FY outside coveredFys (0.182879ms)
✔ getRegimePreference: HttpError(400) for malformed FY (e.g. '2025-27') (0.124507ms)
ℹ tests 10
ℹ suites 1
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 380.785953
```
Exit code: 0

Note: The brief's gate command lacks `--experimental-test-module-mocks`. Without it, the hermetic test fails with `TypeError: mock.module is not a function`. The flag is required and present in `apps/api/package.json`'s `test` script (so `npm run test -w apps/api` includes it automatically). The same requirement applies to the two existing hermetic tests in the repo. The gate was run with the flag added.

### Gate 2: npm run typecheck

Command: `npm run typecheck`

Output:
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
```
Exit code: 0

### Gate 3: npm run lint

Command: `npm run lint`

Output:
```
> compass@0.1.0 lint
> eslint .
```
Exit code: 0

## Deviations

1. Gate 1 command required `--experimental-test-module-mocks` (not in brief's command). Added it to run the hermetic test; it is already present in `apps/api/package.json`'s `test` script. Without it, `mock.module` is not available and the hermetic test crashes at module load time.

2. Concurrency test (K2) uses non-null assertions (`!`) on `as const` array indexing — TypeScript with `noUncheckedIndexedAccess`-adjacent strictness infers `T | undefined` for tuple indexed by a variable. Non-null assertions are safe here because `i % length` is always in-bounds.

3. DB-backed tests (K2) remain inside the existing `if (dbUrl)` guard and were not executed (no DATABASE_URL in this environment). This matches the existing pattern in the file and in the brief ("guarded like the existing ones").

## Unresolved risks

None. All K1–K5 items resolved. Gate 1/2/3 pass. K4 rationale is recorded in TASK.md.
