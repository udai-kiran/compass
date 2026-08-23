# Task 087 Fix Round 2 — Implementation Report

## Per-finding resolution

- **G1 (H1 — taxpayer variants)**: DONE. Added `TaxpayerType = 'ordinary'|'senior'|'super_senior'` to `RegimeRules`. `getRegimeRules(fy, regime, taxpayerType='ordinary')` now accepts 3rd param. Old-regime entries: ordinary (₹2.5L), senior (₹3L), super-senior (₹5L no 5%-slab) registered for all 4 FYs. New-regime normalises all types to 'ordinary'. Key format changed to `${fy}|${regime}|${taxpayerType}`.

- **G2 (H2 — 80CCD(2) and 80D matrix)**: DONE. `DeductionCap` gains `employerRatesBps?: Array<{employerType:'private'|'government', rateBpsOfBasic:number}>`. 80CCD(2) restructured: old-regime all FYs private=1000/govt=1400; new-regime FY23-24 same; new-regime FY24-25+ both=1400 (Finance Act 2024 §115BAC(1A)). 80D matrix completed: `80D_self`(₹25k), `80D_self_senior`(₹50k), `80D_parents`(₹25k), `80D_parents_senior`(₹50k) for all 4 FYs, old-regime only.

- **G3 (M1 — atomic upserts)**: DONE. `upsertRegimePreference` and `updateInferredRegime` both replaced with single `insert(...).onConflictDoUpdate({...})` statements. No pre-read. SQL CASE/COALESCE computes effective/source on merged row. `upsertRegimePreference` ON CONFLICT SET sets `chosen = excluded.chosen`, `effective = excluded.chosen` (chosen wins), `source = 'chosen'::regime_source`. `updateInferredRegime` ON CONFLICT SET preserves existing `chosen` via `coalesce(tax_regime_preferences.chosen, excluded.inferred_regime, 'new'::tax_regime)` and computes source via SQL CASE.

- **G4 (M2 — duplicate key detection)**: DONE. `addRegimeRules` checks `REGIME_RULES_MAP.has(key)` before inserting. `addDeductionCap` uses a `DEDUCTION_CAP_KEYS: Set<string>` keyed on `section|fy|regime`. `addAdvanceTaxSchedule` checks `ADVANCE_TAX_MAP.has(fy)`. All three throw at module load time on duplicate.

- **G5 (M3 — FySchema refinement)**: DONE. `FySchema` in `packages/shared/src/schemas/tax.ts` gains `.refine()` validating `(startYear+1)%100 === actualEndYY`. "2025-27" now fails Zod at the route layer (400). Services wrap `parseFy` failures as `HttpError(400)` via `assertValidCoveredFy()`.

- **G6 (M4 — uncovered FY fails loudly)**: DONE. `getDeductionCap` now calls `coveredFys()` and throws descriptive Error if FY not covered. `assertValidCoveredFy()` in service validates FY format + coverage, throws `HttpError(400)` if uncovered. All three service functions (`getRegimePreference`, `upsertRegimePreference`, `updateInferredRegime`) call it.

- **G7 (M5 — inclusive upper boundary)**: DONE. Convention flipped: `upperPaise = lakh(N)` (threshold inclusive), next `lowerPaise = lakh(N)+1`. All slab data updated across all FYs/regimes/taxpayer-types. Surcharge slabs likewise: nil band upper = `crore(0.5)`, next lower = `crore(0.5)+1`. Contiguity validator unchanged (already checks `lower === prev.upper + 1`). All tests updated with new boundary values. New contiguity test added for surcharge slabs.

- **G8 (M6 — enum-typed columns)**: DONE. Added `regimeSourceEnum = pgEnum('regime_source', ['chosen','inferred','default'])` to tax `schema.ts`. `chosen`, `inferredRegime`, `effective` now use `taxRegimeEnum()`; `source` uses `regimeSourceEnum()`. `db/schema.ts` barrel updated to export `regimeSourceEnum`. `schema.decomposition.test.ts` updated from 57 to 58 enums.

- **G9 (M7 — service tests)**: DONE. New file `apps/api/src/modules/tax/services/regime-preference.test.ts`. Pure (no-DB) tests: module exports, HttpError(400) for uncovered FY (guards fire before DB query), HttpError(400) for malformed FY. DB-backed tests: upsert idempotency, resolution order (chosen>inferred>default), PUT preserves inferred_regime, inference preserves chosen, user isolation. DB tests guarded by `process.env.DATABASE_URL` (skip in this environment — same pattern as deposit-details.test.ts).

- **G10 (L1/L2/L3 — fyOf calendar validation, fyLabel, FY26-27 comment)**: DONE. `fyOf` adds Date.UTC round-trip validation (rejects Feb 30, month 13, etc.). `fyLabel(fy)` added returning `"FY 2025-26"`. FY 2026-27 comment updated: "Finance Act 2026 was enacted in February 2026 and confirmed the same slabs as FY 2025-26." Tests added for all three.

## Files changed

- `apps/api/src/lib/financial-year.ts` — G10 (calendar validation in fyOf, fyLabel function)
- `apps/api/src/lib/financial-year.test.ts` — G10 (impossible date tests, fyLabel tests; import fyLabel)
- `apps/api/src/lib/tax-rules.ts` — G1 G2 G4 G6 G7 (complete rewrite with all changes)
- `apps/api/src/lib/tax-rules.test.ts` — G1 G2 G6 G7 (updated boundary values, new tests)
- `packages/shared/src/schemas/tax.ts` — G5 (FySchema .refine)
- `apps/api/src/modules/tax/schema.ts` — G8 (regimeSourceEnum; enum-typed columns)
- `apps/api/src/modules/tax/services/regime-preference.ts` — G3 G6 (atomic upserts, assertValidCoveredFy)
- `apps/api/src/db/schema.ts` — G8 (add regimeSourceEnum to barrel export)
- `apps/api/src/db/schema.decomposition.test.ts` — G8 (57→58 enum count)
- NEW `apps/api/src/modules/tax/services/regime-preference.test.ts` — G9
- NEW `apps/api/drizzle/0013_same_angel.sql` — G8 (generated by db:generate)
- NEW `apps/api/drizzle/meta/0013_snapshot.json` — G8 (generated by db:generate)

## Commands run and literal output

### Gate 1: node --test financial-year.test.ts tax-rules.test.ts
```
ℹ tests 63
ℹ pass 63
ℹ fail 0
duration_ms 80.699506
```
Exit code: 0

### Gate 2: DATABASE_URL="postgresql://localhost/dummy" node --test backup.test.ts
```
ℹ tests 36
ℹ pass 12
ℹ fail 24
duration_ms 554.447742
```
Exit code: 1 — 12 static tests pass; 24 DB-backed tests fail with ECONNREFUSED (no Postgres at localhost — expected, same as prior runs).

### Gate 3: npm run typecheck
All 6 workspaces pass, no errors.
Exit code: 0

### Gate 4: npm run lint
No errors.
Exit code: 0

### Gate 5: node --test schema.decomposition.test.ts app.route-snapshot.test.ts
```
ℹ tests 10
ℹ pass 10
ℹ fail 0
duration_ms 952.91368
```
Exit code: 0

### npm run db:generate
Generated: `drizzle/0013_same_angel.sql`
Content:
```sql
CREATE TYPE "public"."regime_source" AS ENUM('chosen', 'inferred', 'default');--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "chosen" SET DATA TYPE "public"."tax_regime" USING "chosen"::"public"."tax_regime";--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "inferred_regime" SET DATA TYPE "public"."tax_regime" USING "inferred_regime"::"public"."tax_regime";--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "effective" SET DATA TYPE "public"."tax_regime" USING "effective"::"public"."tax_regime";--> statement-breakpoint
ALTER TABLE "tax_regime_preferences" ALTER COLUMN "source" SET DATA TYPE "public"."regime_source" USING "source"::"public"."regime_source";
```

## Assumptions

- Surcharge slab contiguity validator was not updated because it already checks `lower === prev.upper + 1`; only the data values changed.
- For `upsertRegimePreference` G3: on first insert (no conflict), `effective` is set directly to `chosen` and `source` to `"chosen"` — correct because there's no existing inferred row. The ON CONFLICT branch fires for updates, where existing `inferredRegime` is already in the DB but doesn't affect the effective since chosen always wins.
- `schema.decomposition.test.ts` enum count update (57→58) is the only snapshot-like test touched; route snapshots were unaffected.

## Unresolved risks

- The DB-backed tests in `regime-preference.test.ts` cannot be run in this environment. They are structurally correct and follow the established pattern but are unverified against a real database.
- `upsertRegimePreference` simplified the effective computation: since chosen always wins and we're setting it in this path, `effective = excluded.chosen` is always correct. The test in G9 verifying "PUT preserves inferred_regime" reads the row back to confirm inferred_regime survives — this also verifies the ON CONFLICT branch does not wipe inferred_regime.
