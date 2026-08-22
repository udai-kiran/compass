# Verification 5 — 082 F6c

## Verdict
**PASS**

All checks present in source code. All tests pass. No deviations from spec.

---

## Per-check

### V1: choosePantryReplenishment — receipt-confirm.ts:63
- **Present**: Exported function at line 63
- **Signature**: `export function choosePantryReplenishment(items: AggregatedItem[], catalogUnit: "g"|"ml"|"piece"|null, pantryUnit: "g"|"ml"|"piece"|null): AggregatedItem | null`
- **Logic** (lines 70–91):
  - Filters compatible items: `(catalogUnit == null || catalogUnit === item.unit) && (pantryUnit == null || pantryUnit === item.unit)` ✓
  - Empty items → null ✓
  - Conflict (no compatible) → null ✓
  - Preference: catalogUnit match first (lines 79–82), then pantryUnit match (lines 85–88), else first compatible (line 91) ✓

### V2: Lookups with userId — receipt-confirm.ts:226, 240–244
- **Catalog query** (line 226): `where: and(inArray(catalogItems.id, catalogIds), eq(catalogItems.userId, userId))` ✓
  - Only owned rows populate `catalogInfoMap`
- **Pantry query** (lines 240–244): `where: and(inArray(pantryItems.catalogItemId, ownedCatalogIds), eq(pantryItems.userId, userId))` ✓
  - Only loads pantry for owned catalog ids
- **Missing catalog logic** (lines 281–283):
  - If `catalogInfoMap.get(catalogItemId)` absent → `continue` (skip pantry, no throw) ✓
  - Not treated as `catalogUnit=null`; hard skip ✓

### V3: Confirmed lines ordered — receipt-confirm.ts:157
- **Present**: `orderBy: [asc(receiptLines.position), asc(receiptLines.id)]` ✓
- Stable order (position first, then id for tie-breaking)

### V4: ALL inserts + replenish only when chooser returns item — receipt-confirm.ts:253–290
- **ALL inserts** (lines 253–266):
  - Loop over `aggregatedItems`
  - Insert ALL as `shopping_list_items` (status='bought') regardless of pantry replenish ✓
- **Replenish only when chooser returns item** (lines 280–290):
  - Loop by catalogItemId
  - Call `choosePantryReplenishment(items, catInfo.unit, pantryUnit)` (line 286)
  - Call `replenishPantry` only `if (chosen !== null)` (line 287) ✓

### V5: resolveLearningUnit and learnConsumptionRate — consumption-rate.ts:30–178
- **Exported** (line 30): `export function resolveLearningUnit(catalogUnit: string|null, pantryUnit: string|null): string|null`
- **Logic** (lines 30–37): catalog if set, else pantry if set, else null ✓
- **learnConsumptionRate** (lines 160–178):
  - Line 165: `catalogUnit = catalogRow?.unit ?? null`
  - Lines 170–176: pantry read only when `catalogUnit === null` ✓
  - Line 178: `const targetUnit = resolveLearningUnit(catalogUnit, pantryUnit)` ✓
  - Line 209: `computeConsumptionRate(purchases, targetUnit)` — passed as targetUnit ✓
  - Blend/outlier/rate math (lines 209+) unchanged ✓

### V6: Tests — receipt-confirm.test.ts + consumption-rate.test.ts
- **Imports** (receipt-confirm.test.ts:15–16):
  - `import { choosePantryReplenishment } from "./receipt-confirm.ts"` ✓
  - `import type { AggregatedItem } from "./receipt-confirm.ts"` ✓
- **P6 chooser cases** (11 tests, lines 84–154):
  1. catalog g, items [g,ml] → g ✓
  2. catalog g, g not first [ml,g] → g ✓
  3. catalog g, items only ml → null ✓
  4. catalog null, pantry g, [ml,g] → g (Review-8 abort) ✓
  5. catalog null, pantry g, only ml → null ✓
  6. catalog null, pantry null, [ml,g] → first (ml) ✓
  7. catalog g, pantry ml → null (conflict) ✓
  8. empty items → null ✓
  9. catalog g + pantry g, mixed → g ✓
  10. catalog g + pantry g, no g → null ✓
  11. returned item is original (quantity preserved) ✓
- **resolveLearningUnit tests** (consumption-rate.test.ts:137–149, 3 cases):
  1. catalog g, pantry ml → g ✓
  2. catalog null, pantry g → g ✓
  3. both null → null (most-frequent path) ✓
- **False local test deleted**: No test that used a local aggregation copy (all tests import real function) ✓

---

## Commands — exit codes & literal output

### `npm run typecheck`
```
Exit code: 0
All workspaces (api, docs, extractor, ingestor, web, ai, shared): PASS
```

### `npm run lint`
```
Exit code: 0
No linting errors.
```

### `node --test apps/api/src/modules/shopping/services/receipt-confirm.test.ts apps/api/src/modules/shopping/services/consumption-rate.test.ts`
```
Exit code: 0
✔ computeConsumptionRate (9 tests)
✔ resolveLearningUnit (3 tests)
✔ computeTotalPaise (3 tests)
✔ validateTotal (4 tests)
✔ deduplication (1 test)
✔ choosePantryReplenishment (11 tests)
✔ double-confirm prevention (1 test)
✔ ledger amount (1 test)

ℹ tests 33  pass 33  fail 0  skipped 0
```

---

## Scope verification

### Files changed (git status):
- `M apps/api/src/modules/shopping/services/consumption-rate.ts` — P5 export + learnConsumptionRate update
- `M apps/api/src/modules/shopping/services/consumption-rate.test.ts` — P6 resolver tests
- `?? apps/api/src/modules/shopping/services/receipt-confirm.ts` — P1–P4 (new file)
- `?? apps/api/src/modules/shopping/services/receipt-confirm.test.ts` — P6 chooser tests (new file)

### Not modified (as required):
- `pantry-management.ts` — no changes ✓
- `receipt-parse.ts` — not modified ✓
- `receipt-reconcile.ts` — not modified ✓
- `routes/receipts.ts` — not modified ✓
- `apps/web/` — not modified ✓

---

## Residual / not blocking

- **Chooser/resolver tests do not prove confirm wiring** (all inserts / one pantry call): stated residual in TASK.md P6. Wiring tests require DB + route integration (out of F6c scope; deferred M1).
- **Pre-existing habit-blend ignores `existing.unit !== result.unit`**: out of 082 per TASK.md.
- **Concurrent catalog/pantry mutation**: out of scope per plan (no locks/retries added; acceptable per P2).

---

## Blocking gaps
None. Implementation complete and correct.
