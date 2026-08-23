# Task: 077 — Consumption-Rate Learning + Pantry Management (task 11.1)

## Status
COMPLETE

## Objective
Build the consumption-rate learning engine and pantry management services. `habit_profiles` learns per-user consumption rate from repeat purchases (shopping list items marked "bought"). `pantry_items` tracks inferred stock, decremented over time by that rate and replenished on confirmed purchase. User corrections are persistent and feed back into the learned rate.

## Root Cause
Schema tables `habit_profiles` and `pantry_items` exist (task 9.1), with basic read services, but no business logic for rate learning, pantry decay, replenishment, or correction.

## Codex Review Findings (review-1, addressed)
- F1: No hook on "bought" transition → P10 adds call in lists.ts service
- F2: `updatedAt` unreliable as boughtAt → use current timestamp captured at status transition
- F3: Cross-owner catalogItemId → all routes use `assertOwnedCatalogItem` from `ownership.ts`
- F4: Owner-only scoping → confirmed correct, match existing pattern
- F5: Null quantity/unit items → explicit: no rate computed, return null
- F6: "Filter to same unit" target → use catalog item's unit, fall back to most-frequent unit
- F7: Float arithmetic → all math uses integer ms and floor(), no floats
- F8: Depletion from total stock → decay existing stock first, then add purchase, then compute depletion
- F9: Recompute overwrites correction → dampening factor stored in `observationCount`; recompute blends prior with new data weighted by observation count
- F10: `note` field has no column → dropped from schema
- F11: Unit mismatch → 400 error if incoming unit ≠ existing pantry/catalog unit
- F12: Outlier after removal leaves <2 → return null (insufficient data)
- F13: Test coverage → add null-qty tests, ownership assertion tests, unit-mismatch tests
- F14: Response includes catalog name → PantryItemWithHabitSchema includes canonicalName + brand

## Scope

### Existing (do not recreate)
- DB schema: `habitProfiles`, `pantryItems` tables in `modules/shopping/schema.ts`
- Zod schemas: `HabitProfileSchema`, `PantryItemSchema` in `packages/shared/src/schemas/shopping.ts`
- Read services: `pantryItemsForUser`, `habitProfilesForUser` in `services/pantry.ts`
- Backup registration: both tables in `backup.ts`
- Ownership guard: `assertOwnedCatalogItem` in `services/ownership.ts`

### New files
- `apps/api/src/modules/shopping/services/consumption-rate.ts` — rate learning engine
- `apps/api/src/modules/shopping/services/consumption-rate.test.ts` — unit tests (8+ cases)
- `apps/api/src/modules/shopping/services/pantry-management.ts` — replenish, decay, correct
- `apps/api/src/modules/shopping/services/pantry-management.test.ts` — unit tests (8+ cases)
- `apps/api/src/modules/shopping/routes/pantry.ts` — REST routes for pantry ops
- `apps/api/src/modules/shopping/routes/habit-profiles.ts` — REST routes for habit profiles

### Modified files
- `packages/shared/src/schemas/shopping.ts` — add request/response schemas
- `apps/api/src/modules/shopping/services/lists.ts` — hook on bought transition to trigger replenish + learn
- `apps/api/src/modules/shopping/plugin.ts` — register new route files
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Dependencies
- task 9.1 (schema, done), 9.2 (lists CRUD, done), 9.3 (catalog, done)

## Plan
- P1: Add shared Zod schemas in `packages/shared/src/schemas/shopping.ts`:
  - `PantryItemWithHabitSchema` — extends PantryItemSchema with: canonicalName, brand, consumptionBasePerMonth (nullable), consumptionUnit (nullable), observationCount, lastComputedAt (nullable), expectedDepletionAt (nullable)
  - `CorrectPantrySchema` — { quantityBase: number, unit: NormalizedUnitSchema } (no note)
  - `ReplenishPantrySchema` — { quantityBase: number, unit: NormalizedUnitSchema }
  - `PantryListResponseSchema` — { items: PantryItemWithHabitSchema[] }
  - `HabitProfileListResponseSchema` — { profiles: HabitProfileSchema[] }
  - `RecomputeHabitResponseSchema` — { profile: HabitProfileSchema, purchaseCount: number }

- P2: Implement `consumption-rate.ts` (pure functions + DB wrapper):
  - Named constants: `MIN_PURCHASES = 2`, `OUTLIER_MULTIPLIER = 3`, `MS_PER_DAY = 86_400_000`
  - `computeConsumptionRate(purchases: {quantityBase: number, unit: string, boughtAt: Date}[], targetUnit: string | null)` → `{ consumptionBasePerMonth: number, unit: string, observationCount: number } | null`
    - Filter to targetUnit (catalog item's unit); if null, use most frequent unit among purchases
    - Sort by boughtAt asc; if <2 after filter → return null
    - Compute median quantity; exclude purchases with qty > OUTLIER_MULTIPLIER × median
    - After exclusion, if <2 remain → return null
    - Compute median inter-purchase interval in integer ms
    - If median interval = 0 → return null (all same timestamp, degenerate)
    - Rate = `Math.floor(medianQuantity * 30 * MS_PER_DAY / medianIntervalMs)` (integer, floor)
    - Return { consumptionBasePerMonth: rate, unit: targetUnit, observationCount: filtered.length }
  - `learnConsumptionRate(db, userId, catalogItemId)` → DB wrapper:
    - Query shopping_list_items WHERE status='bought' AND catalogItemId=X, JOIN shopping_lists WHERE userId=Y
    - Get catalog item's unit as targetUnit
    - For each bought item: use quantityBase + unit; skip items where quantityBase/unit is null
    - Timestamp: use updatedAt (documented limitation — best available; no boughtAt column)
    - Call computeConsumptionRate; if null → do not create/update profile
    - If result: upsert habit_profiles, blending with prior if observationCount > 0:
      - newRate = Math.floor((priorRate * priorCount + computedRate * newCount) / (priorCount + newCount))
      - This preserves correction influence: corrections reduce priorCount, so recompute doesn't fully overwrite

- P3: Implement `pantry-management.ts`:
  - `computeDecayedQuantity(currentQty: number, consumptionPerMonth: number, elapsedMs: number)` → integer (pure):
    - `Math.max(0, currentQty - Math.floor(consumptionPerMonth * elapsedMs / (30 * MS_PER_DAY)))`
  - `computeExpectedDepletionMs(stockQty: number, consumptionPerMonth: number)` → integer ms or null (pure):
    - If consumptionPerMonth <= 0 → null; else `Math.floor(stockQty * 30 * MS_PER_DAY / consumptionPerMonth)`
  - `replenishPantry(db, userId, catalogItemId, quantityBase, unit)`:
    - Assert ownership via `assertOwnedCatalogItem(db, userId, catalogItemId)`
    - Validate unit matches catalog item's unit (or catalog unit is null) → 400 on mismatch
    - Load existing pantry item; decay existing stock to now if habit profile exists
    - newStock = decayedStock + quantityBase
    - Compute expectedDepletionAt from newStock and habit rate
    - Upsert pantry_items with newStock, unit, lastPurchasedAt=now, expectedDepletionAt
    - Call learnConsumptionRate to update habit profile
  - `correctPantry(db, userId, catalogItemId, quantityBase, unit)`:
    - Assert ownership
    - Validate unit matches existing pantry/catalog unit → 400 on mismatch
    - Update pantry_items with new quantityBase
    - If habit profile exists: apply dampening:
      - impliedRate based on difference between expected and actual stock level
      - newRate = Math.floor(existingRate * 0.8 + impliedRate * 0.2)
      - Decrease observationCount by 1 (min 1) to give correction more weight in future blending
    - Recompute expectedDepletionAt from corrected stock and adjusted rate
  - `decayAllPantryItems(db, userId)`:
    - Load all pantry items with habit profiles (JOIN); for each: compute decayed quantity
    - Batch update pantry_items with new quantities and updatedAt=now
    - Skip items with no habit profile or null consumption rate

- P4: Hook in `lists.ts` — modify the `updateItem` service function:
  - When status transitions to 'bought' AND catalogItemId is not null AND quantityBase/unit are set:
    - Call `replenishPantry` (fire-and-forget, catch errors — list update must not fail due to pantry)
  - This auto-triggers rate learning through replenishPantry

- P5: Write routes in `routes/pantry.ts` (all relative to /api/shopping prefix):
  - `GET /pantry` — list pantry items LEFT JOIN habit_profiles LEFT JOIN catalog_items; return PantryListResponseSchema
  - `POST /pantry/:catalogItemId/replenish` — validate ReplenishPantrySchema body, call replenishPantry
  - `POST /pantry/:catalogItemId/correct` — validate CorrectPantrySchema body, call correctPantry
  - `POST /pantry/decay` — call decayAllPantryItems, return { decayed: count }

- P6: Write routes in `routes/habit-profiles.ts`:
  - `GET /habits` — list all habit profiles for user
  - `POST /habits/:catalogItemId/recompute` — assert ownership, call learnConsumptionRate, return RecomputeHabitResponseSchema

- P7: Register routes in plugin.ts

- P8: Write unit tests for consumption-rate.ts (pure functions):
  1. 0 purchases → null
  2. 1 purchase → null (< MIN_PURCHASES)
  3. 2 purchases, 30 days apart, 1000g each → rate = 1000g/month
  4. 5 regular purchases + 1 outlier (5× quantity) → outlier excluded, rate from regulars
  5. Mixed units → only target-unit purchases considered
  6. All same timestamp → null (degenerate interval)
  7. All purchases have null quantity → null (nothing to compute)
  8. Outlier exclusion leaves <2 → null
  9. 3 purchases, irregular intervals → median interval used (not mean)

- P9: Write unit tests for pantry-management.ts (pure functions):
  1. computeDecayedQuantity: 1000g, 33g/day rate (990/month), 10 days → 1000 - floor(990*10*86400000/(30*86400000)) = 1000 - 330 = 670
  2. computeDecayedQuantity: 100g, 50g/day rate, 10 days → 0 (not negative)
  3. computeDecayedQuantity: 0 consumption rate → no decay
  4. computeExpectedDepletionMs: 1000g stock, 1000g/month rate → 30 days in ms
  5. computeExpectedDepletionMs: 0 consumption rate → null
  6. Correction dampening: rate 1000, corrected stock implies rate 500 → new rate = floor(1000*0.8 + 500*0.2) = 900
  7. Correction dampening: rate 500, corrected stock implies rate 1000 → new rate = floor(500*0.8 + 1000*0.2) = 600
  8. computeDecayedQuantity: negative elapsed (clock skew) → no decay (max 0 elapsed)

- P10: Update route snapshots

## Acceptance Criteria
- AC1: Consumption rate learned from purchase history; <2 purchases → no confident rate (null)
- AC2: Pantry level decays by rate and replenishes on confirmed purchase
- AC3: User correction is persistent and adjusts the learned rate (dampening 80/20 blend + observationCount decrease)
- AC4: Irregular/one-off purchases (>3× median qty) excluded from rate computation
- AC5: Owner-only scoping: all write routes call assertOwnedCatalogItem; reads filter by userId
- AC6: All quantities are integers — no float arithmetic, all division uses Math.floor
- AC7: Items with null quantityBase/unit produce no rate (explicitly handled, not crash)
- AC8: Unit mismatch between incoming and existing → 400 error
- AC9: Hook on bought transition fires replenishment (fire-and-forget, does not block list update)
- AC10: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0 with all consumption-rate and pantry-management test cases visible

## Non-Goals
- Household sharing (withSharing seam documented, not wired)
- Scheduled job for periodic decay (manual trigger route suffices; job added in a future task)
- AI-based consumption prediction
- Cart draft generation (task 11.2)
- Adding a boughtAt column (documented limitation: updatedAt used as best proxy)
