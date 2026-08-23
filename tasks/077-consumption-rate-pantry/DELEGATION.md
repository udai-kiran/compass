# Sonnet Worker Delegation — Iteration 1

## Task
077 — Consumption-Rate Learning + Pantry Management (task 11.1)

## Approved Plan
- P1: Add shared Zod schemas
- P2: Implement consumption-rate.ts (pure functions + DB wrapper)
- P3: Implement pantry-management.ts
- P4: Hook lists.ts on bought transition
- P5: Write pantry routes
- P6: Write habit-profiles routes
- P7: Register routes in plugin.ts
- P8: Write consumption-rate tests (9 cases)
- P9: Write pantry-management tests (8 cases)
- P10: Update route snapshots

## Files and Symbols

### New files to create
- `apps/api/src/modules/shopping/services/consumption-rate.ts`
- `apps/api/src/modules/shopping/services/consumption-rate.test.ts`
- `apps/api/src/modules/shopping/services/pantry-management.ts`
- `apps/api/src/modules/shopping/services/pantry-management.test.ts`
- `apps/api/src/modules/shopping/routes/pantry.ts`
- `apps/api/src/modules/shopping/routes/habit-profiles.ts`

### Files to modify
- `packages/shared/src/schemas/shopping.ts` — append new schemas after existing CheckoutRecommendationSchema
- `apps/api/src/modules/shopping/services/lists.ts` — add bought-transition hook
- `apps/api/src/modules/shopping/plugin.ts` — register 2 new route files
- `apps/api/src/route-surface.snapshot.txt` — add new routes in sorted order
- `apps/api/src/route-table.snapshot.txt` — add new routes in sorted order

### Existing files to reference (read, do not modify)
- `apps/api/src/modules/shopping/schema.ts` — pantryItems, habitProfiles table shapes
- `apps/api/src/modules/shopping/services/pantry.ts` — existing read services
- `apps/api/src/modules/shopping/services/ownership.ts` — assertOwnedCatalogItem
- `apps/api/src/modules/shopping/routes/price-observations.ts` — route pattern reference
- `packages/shared/src/schemas/shopping.ts` — existing schemas to extend

## Required Changes

### 1. `packages/shared/src/schemas/shopping.ts`
Append after `CheckoutRecommendationSchema`:
```ts
// ─── Pantry & Habit Profile contracts (task 11.1) ───────────────────────────

/** Pantry item enriched with habit profile + catalog info for display. */
export const PantryItemWithHabitSchema = z.object({
  id: z.uuid(),
  catalogItemId: z.uuid(),
  canonicalName: z.string(),
  brand: z.string().nullable(),
  quantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  lastPurchasedAt: z.coerce.date().nullable(),
  expectedDepletionAt: z.coerce.date().nullable(),
  consumptionBasePerMonth: quantityField().nullable(),
  consumptionUnit: NormalizedUnitSchema.nullable(),
  observationCount: z.number().int().nonnegative(),
  lastComputedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
export type PantryItemWithHabit = z.infer<typeof PantryItemWithHabitSchema>;

export const PantryListResponseSchema = z.object({
  items: z.array(PantryItemWithHabitSchema),
});
export type PantryListResponse = z.infer<typeof PantryListResponseSchema>;

export const ReplenishPantrySchema = z.object({
  quantityBase: quantityField(),
  unit: NormalizedUnitSchema,
});
export type ReplenishPantry = z.infer<typeof ReplenishPantrySchema>;

export const CorrectPantrySchema = z.object({
  quantityBase: quantityField(),
  unit: NormalizedUnitSchema,
});
export type CorrectPantry = z.infer<typeof CorrectPantrySchema>;

export const HabitProfileListResponseSchema = z.object({
  profiles: z.array(HabitProfileSchema),
});
export type HabitProfileListResponse = z.infer<typeof HabitProfileListResponseSchema>;

export const RecomputeHabitResponseSchema = z.object({
  profile: HabitProfileSchema,
  purchaseCount: z.number().int().nonnegative(),
});
export type RecomputeHabitResponse = z.infer<typeof RecomputeHabitResponseSchema>;
```

### 2. `consumption-rate.ts`
See TASK.md P2 for full spec. Key points:
- Named exports: `MIN_PURCHASES`, `OUTLIER_MULTIPLIER`, `MS_PER_DAY`
- `computeConsumptionRate` pure function — integer math only, `Math.floor` everywhere
- `learnConsumptionRate` DB wrapper — query bought items through list join
- Uses `median()` helper (sorted middle element)
- ESM `.ts` imports

### 3. `pantry-management.ts`
See TASK.md P3 for full spec. Key points:
- `computeDecayedQuantity` and `computeExpectedDepletionMs` — pure, exported, integer-only
- `replenishPantry` — asserts ownership, validates unit, decays then adds, upserts
- `correctPantry` — asserts ownership, validates unit, dampens rate 80/20
- `decayAllPantryItems` — batch decay all user's pantry items
- Import `assertOwnedCatalogItem` from `../services/ownership.ts`

### 4. `lists.ts` hook
In the `updateItem` function, after setting status to 'bought':
- If new status is 'bought' AND catalogItemId is not null AND quantityBase and unit are set:
  - Fire-and-forget: call replenishPantry wrapped in try/catch (must not fail list update)
  - Import replenishPantry from ./pantry-management.ts

### 5. Routes
Pattern: follow `price-observations.ts` route structure. Use `app.withTypeProvider<ZodTypeProvider>()`.
- Pantry: GET /pantry, POST /pantry/:catalogItemId/replenish, POST /pantry/:catalogItemId/correct, POST /pantry/decay
- Habits: GET /habits, POST /habits/:catalogItemId/recompute
- All routes: `{ preHandler: [app.authenticate] }` or however auth is done in existing routes

### 6. Tests
Pure function tests only (no DB needed). Follow existing test patterns in `consumption-rate.test.ts` and `pantry-management.test.ts`.

## Must Not Change
- DB schema (no migrations)
- Existing pantry.ts read services
- Existing Zod schemas
- Backup registration
- Any file in apps/web/

## Acceptance Criteria
- AC1-AC10 from TASK.md
- All new files use ESM `.ts` extension imports
- Integer-only arithmetic (no parseFloat, no decimal division without Math.floor)
- assertOwnedCatalogItem called on all write routes

## Commands
1. `npm run typecheck` — must exit 0
2. `npm run lint` — must exit 0
3. `npm run test -w apps/api` — must exit 0, report all test cases

## Required Evidence
- List of all files changed/created
- Complete diff of each file
- `npm run typecheck` output and exit code
- `npm run lint` output and exit code
- `npm run test -w apps/api` output (full test names and results) and exit code
- Any plan deviations or blockers
