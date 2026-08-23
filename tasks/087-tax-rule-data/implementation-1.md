# Implementation Report: Task 087 — 13.1 FY Tax-Rule Data & Regime Preference

## Files Inspected
- `tasks/087-tax-rule-data/TASK.md`
- `tasks/087-tax-rule-data/DELEGATION.md`
- `apps/api/src/modules/investments/services/capital-gains.ts` (read before edit)
- `apps/api/src/db/schema.ts` (read before edit)
- `apps/api/src/app.ts` (read before edit)
- `apps/api/src/modules/system/services/backup.ts` (read before edit)
- `packages/shared/src/index.ts` (read before edit)
- `apps/api/src/modules/system/schema.ts` (read for pattern)
- `apps/api/src/modules/shopping/plugin.ts` (read for pattern)
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` (read for pattern)
- `apps/api/src/db/core-schema.ts` (read for FK target)
- `apps/api/src/app.route-snapshot.test.ts` (read for snapshot regeneration procedure)
- `apps/api/src/route-surface.snapshot.txt` (read before edit)
- `apps/api/src/route-table.snapshot.txt` (read before edit)
- `apps/api/src/modules/system/services/backup.test.ts` (read to understand backup test structure)
- `apps/api/src/db/schema.decomposition.test.ts` (read to understand count assertions)
- `apps/api/drizzle/0012_simple_nightshade.sql` (read — confirmed migration already generated)

## Files Changed

### New files
- `apps/api/src/lib/financial-year.ts`
- `apps/api/src/lib/financial-year.test.ts`
- `apps/api/src/lib/tax-rules.ts`
- `apps/api/src/lib/tax-rules.test.ts`
- `apps/api/src/modules/tax/schema.ts`
- `apps/api/src/modules/tax/plugin.ts`
- `apps/api/src/modules/tax/routes/regime-preference.ts`
- `apps/api/src/modules/tax/services/regime-preference.ts`
- `packages/shared/src/schemas/tax.ts`

### Modified files
- `apps/api/src/modules/investments/services/capital-gains.ts` — removed local `fyOf`/`fyRange`/`currentFy` definitions; imports from `../../lib/financial-year.ts`; re-exports `fyOf`/`fyRange` to preserve existing API
- `apps/api/src/db/schema.ts` — added `taxRegimePreferences` and `taxRegimeEnum` re-exports from tax module
- `apps/api/src/app.ts` — added `import { taxRoutes }` and `await app.register(taxRoutes, { prefix: "/api/tax" })`
- `apps/api/src/modules/system/services/backup.ts` — added `tax_regime_preferences` to `ALL_TABLES` and `USER_TABLES`
- `packages/shared/src/index.ts` — added `export * from "./schemas/tax.ts"`
- `apps/api/src/route-surface.snapshot.txt` — regenerated from actual app (adds `GET/HEAD/PUT /api/tax/regime-preference`; also picks up pre-existing deposit routes that the prior task added but didn't snapshot)
- `apps/api/src/route-table.snapshot.txt` — regenerated from actual app (same rationale)

## Implementation Details

### Step 1: `lib/financial-year.ts`
Extracted `fyOf` (with input validation), `fyRange`, `parseFy` (strict format + consistency check), and `currentFy` to a shared lib. `parseFy` validates: `^\d{4}-\d{2}$` format and that the two-digit suffix matches `(startYear + 1) % 100`, handling century rollovers (e.g. `"1999-00"` is valid, `"1999-01"` is not).

`capital-gains.ts` imports the three functions from the new location and re-exports `fyOf`/`fyRange` under the same names to preserve the module's existing public API surface.

### Step 2: `lib/tax-rules.ts`
Effective-dated income-tax data for FY 2023-24 through FY 2026-27, both regimes. All amounts in paise, all rates in basis points.

Key data:
- **FY 2025-26 new regime**: 7 slabs (0-4L nil, 4-8L 5%, 8-12L 10%, 12-16L 15%, 16-20L 20%, 20-24L 25%, >24L 30%); std deduction ₹75,000; rebate 87A ₹60,000 (income ≤ ₹12L)
- **FY 2025-26 old regime**: 4 slabs (0-2.5L nil, 2.5-5L 5%, 5-10L 20%, >10L 30%); std deduction ₹50,000; rebate 87A ₹12,500 (income ≤ ₹5L)
- **Surcharge**: Old regime has 37% top band (>5Cr); new regime capped at 25%
- **Cess**: 400 bps (4%) universally
- **Deduction caps**: 80C ₹1.5L (old only), 80CCD(1B) ₹50k (old only), 80CCD(2) percentage-based both regimes, 80D self ₹25k + parents-senior ₹50k (old only)
- **Advance tax**: 4 instalments at 15%/45%/75%/100% cumulative; 234B/234C at 100 bps/month; senior citizens exempt
- Boot-time slab overlap validation: confirms each slab's lower = previous slab's upper + 1, last slab has null upper

### Step 3: Tax module (`modules/tax/`)
- **schema.ts**: `taxRegimeEnum` pgEnum for `'old' | 'new'`; `taxRegimePreferences` with composite PK `(user_id, fy)`, `chosen` (nullable), `inferred_regime` (nullable), `inferred_at` (nullable), `effective` (not null), `source` (not null).
- **services/regime-preference.ts**: `getRegimePreference` returns db row or default (new regime); `upsertRegimePreference` writes only `chosen`, preserves existing `inferred_regime`; `updateInferredRegime` internal-only, preserves `chosen`.
- **routes/regime-preference.ts**: `GET /regime-preference?fy=...` and `PUT /regime-preference` with Zod validation via `fastify-type-provider-zod`.
- **plugin.ts**: registers `regimePreferenceRoutes`.

### Step 4: Shared schemas (`packages/shared/src/schemas/tax.ts`)
- `FySchema`: regex `^\d{4}-\d{2}$`
- `RegimeSchema`: enum `["old", "new"]`
- `RegimeSourceSchema`: enum `["chosen", "inferred", "default"]`
- `RegimePreferenceSchema`, `GetRegimePreferenceQuerySchema`, `UpsertRegimePreferenceBodySchema`

### Step 5: Migration
The `tax_regime_preferences` table and `tax_regime` enum were already generated in migration `0012_simple_nightshade.sql` by a prior task on this branch (deposit_details task). Running `db:generate` confirms "No schema changes, nothing to migrate" — the migration SQL already exists.

### Step 6: Route snapshots
Both snapshots were regenerated via an inline Node script that boots Fastify with `registerRoutes()` and writes the actual output. The canonical surface snapshot also picks up 2 pre-existing deposit-details routes (`GET/HEAD /api/holdings/:id/deposit` and `GET/HEAD /api/holdings/:id/deposit/schedule`) that the prior task added but hadn't updated the snapshot for.

## Commands Run and Their Exact Output

### Individual lib tests (before wiring)

```
$ node --test apps/api/src/lib/financial-year.test.ts
✔ fyOf: April 1 is the first day of the new FY (0.620954ms)
... [16 tests]
ℹ tests 16
ℹ pass 16
ℹ fail 0
```

```
$ node --test apps/api/src/lib/tax-rules.test.ts
✔ getRegimeRules: throws on unknown FY (0.857354ms)
... [31 tests]
ℹ tests 31
ℹ pass 31
ℹ fail 0
```

### After wiring: typecheck
```
$ npm run typecheck
> @compass/api@0.1.0 typecheck — tsc --noEmit
> @compass/docs@0.1.0 typecheck — tsc --noEmit
> @compass/extractor@0.1.0 typecheck — tsc --noEmit
> @compass/ingestor@0.1.0 typecheck — tsc --noEmit
> @compass/web@0.1.0 typecheck — tsc --noEmit
> @compass/ai@0.1.0 typecheck — tsc --noEmit
> @compass/shared@0.1.0 typecheck — tsc --noEmit
EXIT CODE: 0
```

### Route snapshot test (first run — raw table needed update)
```
$ node --test apps/api/src/app.route-snapshot.test.ts
✔ canonical route surface ... (107ms)
✖ raw printRoutes() tree ... (39ms)
```

### Snapshot regeneration
```
# inline script writing both snapshot files from actual Fastify printRoutes() output
Written route-surface.snapshot.txt
Written route-table.snapshot.txt
```

### Route snapshot test (after regeneration)
```
$ node --test apps/api/src/app.route-snapshot.test.ts
✔ canonical route surface ... (87ms)
✔ raw printRoutes() tree ... (39ms)
✔ assertRouteTableMatches rejects an added route (0.18ms)
✔ assertRouteTableMatches rejects a removed route (0.06ms)
✔ assertRouteTableMatches rejects a renamed route (0.06ms)
✔ assertRouteTableMatches rejects a method change (GET -> POST) (0.05ms)
✔ assertRouteTableMatches accepts identical tables (0.09ms)
ℹ tests 7
ℹ pass 7
ℹ fail 0
```

### Schema decomposition test
```
$ node --test apps/api/src/db/schema.decomposition.test.ts
▶ db/schema.ts decomposition
  ✔ exports exactly 74 tables + 57 enums + users with no duplicates (0.68ms)
  ✔ has Object.is-identical tables for all residents (0.31ms)
  ✔ has Object.is-identical enums for all residents (0.24ms)
✔ db/schema.ts decomposition (1.79ms)
ℹ tests 3
ℹ pass 3
ℹ fail 0
```

### Backup test (static portions)
```
$ DATABASE_URL="postgresql://localhost/dummy" node --test apps/api/src/modules/system/services/backup.test.ts
✔ the full backup covers every table in the schema (1.05ms)
✔ sips precedes holding_events in ALL_TABLES (0.10ms)
✔ shopping table parents precede their children in ALL_TABLES (0.08ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.10ms)
✔ no table is scoped both directly and through a parent (0.11ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.28ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.20ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.15ms)
✔ restore defers cyclic and self-referencing foreign keys (0.19ms)
✔ restoreDump's second pass issues an update for every column ... (0.67ms)
✔ the mocked restoreDump records postings every column ... (0.42ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key ... (0.25ms)
[DB-backed tests fail with connection error — pre-existing; no DB available]
```

### Lint
```
$ npm run lint
EXIT CODE: 0
```

### Migration generate
```
$ cd apps/api && DATABASE_URL="postgresql://localhost/dummy" npx drizzle-kit generate
75 tables
... tax_regime_preferences 9 columns 0 indexes 1 fks ...
No schema changes, nothing to migrate 😴
```
(The migration `0012_simple_nightshade.sql` was already generated by a prior task on this branch and includes both `tax_regime` enum and `tax_regime_preferences` table with correct composite PK and FK.)

### Full test suite
```
$ DATABASE_URL="postgresql://compass:password@localhost:5432/compass" npm run test
... [route snapshot tests: 7 pass] ...
... [schema decomposition: 3 pass] ...
... [financial-year: 16 pass] ...
... [tax-rules: 31 pass] ...
... [backup static: 12 pass] ...
[DB-backed and Redis-backed tests: pre-existing failures — no DB/Redis available]
```

Key non-DB test counts across `@compass/api`: 351 pass / 0 fail (for the hermetic tests), plus all shared workspace tests pass.

## Assumptions
1. The `taxRegimeEnum` pgEnum defined in `tax/schema.ts` is the same `tax_regime` type referenced in migration `0012_simple_nightshade.sql` — confirmed by Drizzle Kit saying "No schema changes, nothing to migrate".
2. The schema decomposition test was pre-written expecting 74 tables + 57 enums with tax module already included — I only needed to create the actual module for it to pass.
3. DB-backed test failures (backup round-trip, route integration tests) are pre-existing: they require a real Postgres + Redis instance not available in this environment.
4. `fyOf`/`fyRange` re-exports from `capital-gains.ts` preserve the module's existing public API — confirmed no other files import them from that location (only `holdings.ts` imports `getCapitalGains` from `capital-gains.ts`).

## Unresolved Risks
- The FY 2026-27 slabs are carried forward from 2025-26 since Budget 2026 has not been presented as of August 2025. The data is marked with a comment noting this, and `getRegimeRules("2026-27", ...)` will return placeholder data until updated.
- The route snapshots now include pre-existing deposit routes (`/api/holdings/:id/deposit`) that were added by a prior task but not previously snapshotted. This is expected and correct — the snapshots now reflect the actual running app.
