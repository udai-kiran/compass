# Sonnet Worker Delegation — 070 (Phase A)

## Task
070 — Price Sources & Observations API (task 10.1)

## Approved Plan
- P1: Add shared Zod schemas + shopping.test.ts tests
- P2: Add `assertOwnedPriceSource` + `assertOwnedPriceObservation` to ownership.ts
- P3: Write `services/price-sources.ts`
- P4: Write `services/price-observations.ts` (isStale via service code, injectable clock)
- P5: Write `services/platform-seeds.ts` — 11 platforms, idempotent ON CONFLICT DO NOTHING
- P6: Write route files with relative paths; register in plugin.ts
- P7: Write hermetic tests
- P8: Write DB-backed route tests
- P9: Update route snapshot files

## Files and Symbols
- `packages/shared/src/schemas/shopping.ts` — add CreatePriceSourceSchema, UpdatePriceSourceSchema, CreatePriceObservationSchema, PriceObservationWithSourceSchema (isStale: boolean), PriceObservationsResponseSchema
- `packages/shared/src/schemas/shopping.test.ts` — add tests for new schemas
- `apps/api/src/modules/shopping/services/ownership.ts` — add assertOwnedPriceSource, assertOwnedPriceObservation
- `apps/api/src/modules/shopping/services/price-sources.ts` — NEW
- `apps/api/src/modules/shopping/services/price-observations.ts` — NEW (STALE_DAYS=7 named constant)
- `apps/api/src/modules/shopping/services/platform-seeds.ts` — NEW (11 platforms, ON CONFLICT DO NOTHING)
- `apps/api/src/modules/shopping/services/price-observations.test.ts` — NEW
- `apps/api/src/modules/shopping/routes/price-sources.ts` — NEW (relative paths: /sources, /sources/:id)
- `apps/api/src/modules/shopping/routes/price-observations.ts` — NEW (relative: /observations, /observations/:id)
- `apps/api/src/modules/shopping/routes/price-sources.hermetic.test.ts` — NEW
- `apps/api/src/modules/shopping/routes/price-observations.hermetic.test.ts` — NEW
- `apps/api/src/modules/shopping/routes/price-sources.route.test.ts` — NEW (DB-backed)
- `apps/api/src/modules/shopping/routes/price-observations.route.test.ts` — NEW (DB-backed)
- `apps/api/src/modules/shopping/plugin.ts` — register new route files
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Required Changes

### 1. Shared schemas (packages/shared/src/schemas/shopping.ts)
After existing schemas, add:
```ts
export const CreatePriceSourceSchema = z.object({
  name: z.string().min(1).max(120).trim().refine(v => v.length > 0, { message: "name required" }),
  kind: PriceSourceKindSchema,
  url: z.string().url().nullable().default(null),
  isActive: z.boolean().default(true),
});
export type CreatePriceSource = z.input<typeof CreatePriceSourceSchema>;

export const UpdatePriceSourceSchema = z.object({
  name: z.string().min(1).max(120).trim().refine(v => v.length > 0, { message: "name required" }),
  kind: PriceSourceKindSchema,
  url: z.string().url().nullable(),
  isActive: z.boolean(),
});
export type UpdatePriceSource = z.input<typeof UpdatePriceSourceSchema>;

export const CreatePriceObservationSchema = z.object({
  catalogItemId: z.uuid(),
  priceSourceId: z.uuid(),
  pricePaise: nonNegativePaiseField(),
  mrpPaise: nonNegativePaiseField().nullable().default(null),
  packQuantityBase: quantityField().nullable().default(null),
  unit: NormalizedUnitSchema.nullable().default(null),
  observedAt: z.coerce.date().default(() => new Date()),
}).refine(v => (v.packQuantityBase === null) === (v.unit === null), { message: "packQuantityBase and unit must both be set or both be null" });
export type CreatePriceObservation = z.input<typeof CreatePriceObservationSchema>;

export const PriceObservationWithSourceSchema = PriceObservationSchema.extend({
  sourceName: z.string(),
  sourceKind: PriceSourceKindSchema,
  isStale: z.boolean(),
});
export type PriceObservationWithSource = z.infer<typeof PriceObservationWithSourceSchema>;

export const PriceObservationsResponseSchema = z.object({
  observations: z.array(PriceObservationWithSourceSchema),
});
```

### 2. Ownership guards (services/ownership.ts)
Read the existing file first to see patterns, then add:
- `assertOwnedPriceSource(db, userId, sourceId)` — throws HttpError 404 if not found or wrong user
- `assertOwnedPriceObservation(db, userId, obsId)` — same pattern

### 3. services/price-sources.ts
- `listPriceSources(db, userId)` → PriceSource[]
- `createPriceSource(db, userId, data: CreatePriceSource)` → PriceSource (ON CONFLICT (user_id, name) → 409)
- `updatePriceSource(db, userId, sourceId, data: UpdatePriceSource)` → PriceSource (assertOwned first)
- `deletePriceSource(db, userId, sourceId)` → void (soft: set isActive=false, assertOwned first)

### 4. services/price-observations.ts
```ts
export const STALE_DAYS = 7;
// Injectable clock for testing:
export function isStaleObservation(observedAt: Date, now = new Date()): boolean {
  return (now.getTime() - observedAt.getTime()) > STALE_DAYS * 24 * 60 * 60 * 1000;
}
```
- `listObservations(db, userId, catalogItemId, now?: Date)` → PriceObservationWithSource[] — join with price_sources, compute isStale
- `createObservation(db, userId, data)` → PriceObservation (assertOwnedCatalogItem, assertOwnedPriceSource first — import existing assertOwnedCatalogItem from ownership.ts)
- `deleteObservation(db, userId, obsId)` → void (assertOwnedPriceObservation first)

### 5. services/platform-seeds.ts
11 platforms (ON CONFLICT (user_id, name) DO NOTHING — idempotent):
1. Blinkit (quick_commerce), url: https://blinkit.com
2. Swiggy Instamart (quick_commerce), url: https://www.swiggy.com/instamart
3. Zepto (quick_commerce), url: https://www.zeptonow.com
4. BigBasket (ecommerce), url: https://www.bigbasket.com
5. JioMart (ecommerce), url: https://www.jiomart.com
6. DMart (ecommerce), url: https://www.dmart.in
7. Flipkart (ecommerce), url: https://www.flipkart.com
8. Amazon (ecommerce), url: https://www.amazon.in
9. DealShare (ecommerce), url: https://dealshare.in
10. MilkBasket (quick_commerce), url: https://www.milkbasket.com
11. Local Kirana (local_store), url: null
```ts
export async function ensurePlatformSeeds(db: Db, userId: string): Promise<void> {
  // ON CONFLICT DO NOTHING — idempotent. Never overwrites user edits.
  // ADAPTER INTERFACE NOTE: Future live-scraping adapters should implement:
  //   interface PriceAdapter { fetch(catalogItemId, sourceId): Promise<PriceObservation | null> }
  // and be registered as disabled-by-default compose profiles (like apps/ingestor).
  // Core never ships a scraper.
  await db.insert(priceSources).values(PLATFORM_SEEDS.map(s => ({ ...s, userId }))).onConflictDoNothing();
}
```

### 6. Routes
- Route files use relative paths (shopping plugin mounts at /api/shopping)
- GET /sources: call ensurePlatformSeeds, then listPriceSources
- POST /sources: createPriceSource
- PUT /sources/:id: updatePriceSource
- DELETE /sources/:id: deletePriceSource (returns 204)
- GET /observations: require catalogItemId query param, call listObservations
- POST /observations: createObservation
- DELETE /observations/:id: deleteObservation (returns 204)

### 7. Route snapshot update
After running the app test to discover what routes are registered, update:
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`
Run `npm run test -w apps/api` and read the snapshot failure output to get the exact new content, then update the files.

## Must Not Change
- `apps/api/src/modules/shopping/schema.ts` — no schema changes (tables already exist)
- Any existing route files
- `apps/api/src/modules/system/services/backup.ts` — already has price_sources, price_observations

## Acceptance Criteria
- AC1: GET /api/shopping/sources triggers seed; returns 11 platform sources for new user
- AC2: POST /api/shopping/observations creates observation; GET returns it with isStale: false
- AC3: isStale: true when observedAt >7 days ago
- AC4: Cross-user FK on POST /observations returns 404
- AC5: Duplicate source name returns 409
- AC6: typecheck + lint + test green

## Commands
1. Read existing files before editing: ownership.ts, plugin.ts, lists.ts (for service patterns), existing route tests for patterns
2. `npm run typecheck` — must exit 0
3. `npm run lint` — must exit 0
4. `npm run test -w apps/api` — must exit 0 (will fail first on snapshot mismatch, showing expected content for snapshot update)
5. `npm run test -w packages/shared` — must exit 0

## Required Evidence
- List of all files changed with line counts
- Complete diff
- Output of `npm run typecheck`, `npm run lint`, `npm run test -w apps/api`, `npm run test -w packages/shared`
- Exit codes for all commands
- Any plan deviations or blockers
