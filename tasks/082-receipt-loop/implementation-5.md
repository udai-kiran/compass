# Implementation-5 — Task 082 F6c

## Status
COMPLETE — all three required commands pass.

## Files Inspected
- `apps/api/src/modules/shopping/services/receipt-confirm.ts`
- `apps/api/src/modules/shopping/services/receipt-confirm.test.ts`
- `apps/api/src/modules/shopping/services/consumption-rate.ts`
- `apps/api/src/modules/shopping/services/consumption-rate.test.ts`
- `apps/api/src/modules/shopping/schema.ts` (read for `pantryItems` shape)
- `apps/api/src/db/index.ts` (read to confirm relational schema setup)
- `apps/api/src/db/schema.ts` (read to confirm pantryItems/catalogItems re-exported)
- `tasks/082-receipt-loop/TASK.md`
- `tasks/082-receipt-loop/DELEGATION.md`

## Files Changed

### `apps/api/src/modules/shopping/services/receipt-confirm.ts`
- **Imports**: Added `asc` to drizzle-orm imports; added `catalogItems`, `pantryItems` to schema imports.
- **P1**: Exported `AggregatedItem` type (moved from local inside `confirmReceipt` to module level). Exported `choosePantryReplenishment(items, catalogUnit, pantryUnit)` — compatible iff `(catalogUnit == null || catalogUnit === unit) && (pantryUnit == null || pantryUnit === unit)`; prefers catalogUnit match, then pantryUnit match, then first compatible; no compatible → null.
- **P2**: Catalog query now includes `eq(catalogItems.userId, userId)` so only owned rows populate `catalogInfoMap`. After building the catalog map, a second batch query loads `{catalogItemId, unit}` from `pantryItems` filtered by `userId` and by the owned catalog ids (`ownedCatalogIds = [...catalogInfoMap.keys()]`) into `pantryMap`.
- **P3**: Added `orderBy: [asc(receiptLines.position), asc(receiptLines.id)]` to the confirmed lines `findMany` query.
- **P4**: Replaced the old `pantryChoiceMap` logic with a loop that (a) skips if `catalogInfoMap.get(catalogItemId)` is absent (missing owned catalog row → skip, not catalogUnit=null), (b) looks up `pantryUnit` from `pantryMap`, (c) calls `choosePantryReplenishment(items, catInfo.unit, pantryUnit)`, (d) calls `replenishPantry` only when chooser returns non-null. All shopping_list_items are still inserted for every aggregate before this loop.

### `apps/api/src/modules/shopping/services/receipt-confirm.test.ts`
- Added imports: `choosePantryReplenishment` (value) and `AggregatedItem` (type) from `./receipt-confirm.ts`.
- **Deleted** the local "aggregation by catalogItemId: groups quantities by catalogId" test (false F6 — tested a local copy, not the real exported function).
- **Added 11 chooser tests** covering all TASK.md P6 cases:
  - catalog g, items [g, ml] → picks g
  - catalog g, g not first [ml, g] → still picks g
  - catalog g, items only ml → null
  - catalog null, pantry g, [ml, g] → picks g (Review-8 abort case)
  - catalog null, pantry g, only ml → null
  - catalog null, pantry null, [ml, g] → first (ml)
  - catalog g, pantry ml → null (conflict)
  - empty items → null
  - catalog g + pantry g, mixed aggregates → g
  - catalog g + pantry g, no g aggregate → null
  - returned item is original object (quantity preserved, same reference)

### `apps/api/src/modules/shopping/services/consumption-rate.ts`
- Added `pantryItems` to schema imports.
- **P5**: Exported `resolveLearningUnit(catalogUnit, pantryUnit): string | null` — catalog if set, else pantry if set, else null.
- **P5**: Modified `learnConsumptionRate`: existing catalog read now stores result as `catalogUnit`; if `catalogUnit === null`, reads the user's pantry row unit into `pantryUnit`; passes `resolveLearningUnit(catalogUnit, pantryUnit)` as the `targetUnit` to `computeConsumptionRate`. Blend/outlier/rate math unchanged.

### `apps/api/src/modules/shopping/services/consumption-rate.test.ts`
- Added `resolveLearningUnit` to the import line.
- Added `describe("resolveLearningUnit")` block with 3 tests: catalog g + pantry ml → g; catalog null + pantry g → g; both null → null.

## Commands and Literal Output

### `npm run typecheck`
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present
[all workspaces: api, docs, extractor, ingestor, web, ai, shared]
```
Exit code: **0**

### `npm run lint`
```
> compass@0.1.0 lint
> eslint .
```
Exit code: **0**

### `node --test apps/api/src/modules/shopping/services/receipt-confirm.test.ts apps/api/src/modules/shopping/services/consumption-rate.test.ts`
```
▶ computeConsumptionRate
  ✔ case 1: 0 purchases → null
  ✔ case 2: 1 purchase → null (< MIN_PURCHASES)
  ✔ case 3: 2 purchases, 30 days apart, 1000g each → rate = 1000g/month
  ✔ case 4: 5 regular purchases + 1 outlier (5× quantity) → outlier excluded, rate from regulars
  ✔ case 5: mixed units → only target-unit purchases considered
  ✔ case 6: all purchases at same timestamp → null (degenerate interval)
  ✔ case 7: all purchases have null quantity → handled by caller filtering, empty → null
  ✔ case 8: outlier exclusion leaves <2 → null
  ✔ case 9: 3 purchases with irregular intervals → median interval used (not mean)
✔ computeConsumptionRate
▶ resolveLearningUnit
  ✔ catalog g, pantry ml → g (catalog takes precedence)
  ✔ catalog null, pantry g → g (falls back to pantry)
  ✔ both null → null (most-frequent-observation path)
✔ resolveLearningUnit
✔ computeTotalPaise: sums line prices correctly
✔ computeTotalPaise: null prices treated as 0
✔ computeTotalPaise: all null → 0
✔ validateTotal: positive safe integer passes
✔ validateTotal: zero throws
✔ validateTotal: negative throws
✔ validateTotal: exceeds safe integer throws
✔ deduplication of confirmedLineIds: Set removes duplicates
✔ choosePantryReplenishment: catalog g, items [g, ml] → picks g
✔ choosePantryReplenishment: catalog g, g not first: [ml, g] → still picks g
✔ choosePantryReplenishment: catalog g, items only ml → null
✔ choosePantryReplenishment: catalog null, pantry g, items [ml, g] → picks g (Review-8 abort case)
✔ choosePantryReplenishment: catalog null, pantry g, items only ml → null
✔ choosePantryReplenishment: catalog null, pantry null, items [ml, g] → first (ml)
✔ choosePantryReplenishment: catalog g, pantry ml → null (catalog/pantry conflict)
✔ choosePantryReplenishment: empty items → null
✔ choosePantryReplenishment: catalog g and pantry g, mixed aggregates → g
✔ choosePantryReplenishment: catalog g and pantry g, no matching g aggregate → null
✔ choosePantryReplenishment: returned item is the original aggregate object (quantity preserved)
✔ double-confirm prevention: status check rejects non-reconciled
✔ ledger amount is negative total (expense sign convention)
ℹ tests 33  ℹ suites 2  ℹ pass 33  ℹ fail 0  ℹ cancelled 0  ℹ skipped 0  ℹ todo 0
```
Exit code: **0**

## Assumptions
- `pantryItems` relational query is available via `db.query.pantryItems` (confirmed: it is exported in `db/schema.ts` and registered via `drizzle(pool, { schema })`).
- Concurrent catalog/pantry mutation between batch loads and `replenishPantry` call is out of scope per plan (no locks/retries added).

## Unresolved Risks
- Chooser/resolver tests do not prove confirm wiring (all inserts / one pantry call) — stated residual per TASK.md P6.
- Pre-existing habit-blend ignores `existing.unit !== result.unit` — out of 082 per TASK.md.
