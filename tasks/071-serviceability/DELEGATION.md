# Sonnet Worker Delegation — 071 (Phase B)

## Task
071 — Platform Serviceability & Delivery ETA (task 10.2)

## Approved Plan
- P1: Add deliveryEtaBand enum + new fields to priceSources + serviceabilityChecks table in schema.ts
- P2: Run npm run db:generate to produce migration SQL
- P3: Extend shared Zod schemas
- P4: Write services/serviceability.ts — upsert (conflict on sourceId+pincode), list with isStale, ownership guard
- P5: Write route file with relative paths; register in plugin.ts
- P6: Update backup.ts ALL_TABLES/USER_TABLES
- P7: Update schema.smoke.test.ts and schema.decomposition.test.ts
- P8: Write unit tests
- P9: Update route snapshot files

## Files and Symbols
- `apps/api/src/modules/shopping/schema.ts` — add deliveryEtaBand pgEnum, serviceabilityChecks table; add nullable fields to priceSources
- `apps/api/drizzle/` — new migration
- `packages/shared/src/schemas/shopping.ts` — add DeliveryEtaBandSchema, ServiceabilityCheckSchema, CreateServiceabilityCheckSchema; extend PriceSourceSchema with new nullable fields
- `apps/api/src/modules/shopping/services/serviceability.ts` — NEW
- `apps/api/src/modules/shopping/services/serviceability.test.ts` — NEW
- `apps/api/src/modules/shopping/routes/serviceability.ts` — NEW (relative paths)
- `apps/api/src/modules/shopping/plugin.ts` — register route
- `apps/api/src/modules/system/services/backup.ts` — add serviceability_checks to ALL_TABLES + USER_TABLES
- `apps/api/src/modules/shopping/schema.smoke.test.ts` — update counts (8→9 tables, 5→6 enums)
- `apps/api/src/db/schema.decomposition.test.ts` — update shopping resident sets
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Required Changes

### 1. shopping/schema.ts additions
Add to existing priceSources table (nullable columns only — safe for existing rows):
```ts
deliveryFeePaise: bigint("delivery_fee_paise", { mode: "number" }),
minCartPaise: bigint("min_cart_paise", { mode: "number" }),
deliveryEtaBand: deliveryEtaBandEnum("delivery_eta_band"),
```

Add new enum (before priceSources table):
```ts
export const deliveryEtaBandEnum = pgEnum("delivery_eta_band", [
  "instant", "same_day", "next_day", "scheduled"
]);
// null means unknown — no "unknown" enum value to avoid two unknown states
```

Add new table:
```ts
export const serviceabilityChecks = pgTable(
  "serviceability_checks",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
    priceSourceId: uuid("price_source_id").notNull().references(() => priceSources.id, { onDelete: "cascade" }),
    pincode: text("pincode").notNull(),
    isServiceable: boolean("is_serviceable"), // nullable — null = unknown
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("serviceability_checks_source_pincode_idx").on(t.priceSourceId, t.pincode),
    index("serviceability_checks_user_idx").on(t.userId),
    check("serviceability_checks_pincode_nonempty", sql`length("pincode") > 0`),
  ]
);
```

Also add CHECK constraints to priceSources for new fields:
```ts
check("price_sources_delivery_fee_nonneg", sql`"delivery_fee_paise" IS NULL OR "delivery_fee_paise" >= 0`),
check("price_sources_min_cart_nonneg", sql`"min_cart_paise" IS NULL OR "min_cart_paise" >= 0`),
```

Update the existing priceSources table definition to include the new fields and checks.

### 2. shared Zod schemas (packages/shared/src/schemas/shopping.ts)
```ts
export const DeliveryEtaBandSchema = z.enum(["instant", "same_day", "next_day", "scheduled"]);
export type DeliveryEtaBand = z.infer<typeof DeliveryEtaBandSchema>;
```

Extend PriceSourceSchema:
```ts
export const PriceSourceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: PriceSourceKindSchema,
  url: z.string().nullable(),
  isActive: z.boolean(),
  deliveryFeePaise: z.number().int().nonnegative().nullable(),
  minCartPaise: z.number().int().nonnegative().nullable(),
  deliveryEtaBand: DeliveryEtaBandSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
```

Add:
```ts
export const ServiceabilityCheckSchema = z.object({
  id: z.uuid(),
  priceSourceId: z.uuid(),
  pincode: z.string().min(1),
  isServiceable: z.boolean().nullable(), // null = unknown, never assumed true
  isStale: z.boolean(), // computed: observedAt > 24h ago
  observedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});

export const CreateServiceabilityCheckSchema = z.object({
  pincode: z.string().min(1).max(10).regex(/^\d{6}$/, "pincode must be 6 digits"),
  isServiceable: z.boolean().nullable(),
});
```

### 3. services/serviceability.ts
```ts
export const SERVICEABILITY_STALE_HOURS = 24;

function isStaleCheck(observedAt: Date, now = new Date()): boolean {
  return (now.getTime() - observedAt.getTime()) > SERVICEABILITY_STALE_HOURS * 60 * 60 * 1000;
}

export async function upsertServiceabilityCheck(db, userId, sourceId, pincode, isServiceable) {
  // assertOwnedPriceSource first (import from ownership.ts)
  // ON CONFLICT (priceSourceId, pincode) DO UPDATE SET isServiceable, observedAt=now(), userId
  // IMPORTANT: pincode is stored locally only — never pass to AI or external services
}

export async function listServiceabilityForUser(db, userId, pincode?, now = new Date()) {
  // query serviceability_checks by userId (optionally filter by pincode)
  // join with price_sources to verify ownership
  // compute isStale per row
}

export async function getServiceabilityForSource(db, userId, sourceId, pincode, now = new Date()) {
  // get single check for source+pincode; null if not found
}
```

### 4. Route (relative paths)
- GET /sources/:sourceId/serviceability — list all serviceability checks for a source
- PUT /sources/:sourceId/serviceability/:pincode — upsert check

### 5. backup.ts update
Add "serviceability_checks" to ALL_TABLES after "price_sources". Add serviceability_checks: "user_id" to USER_TABLES.

### 6. schema.smoke.test.ts update
Read the existing file. Update:
- Table count: 8 → 9
- Enum count: 5 → 6
- Add serviceabilityChecks to the imported symbols list
- Add deliveryEtaBandEnum to the imported symbols list
- Add assertions for new price_sources fields (deliveryFeePaise, minCartPaise, deliveryEtaBand)

### 7. schema.decomposition.test.ts update
Read the existing file. Update shopping resident tables to include "serviceability_checks" and shopping resident enums to include "delivery_eta_band".

## Must Not Change
- Existing priceSources schema columns (only ADD nullable columns)
- Existing routes or services
- backup.ts entries already present (price_sources, price_observations, etc.)

## Acceptance Criteria
- AC1: price_sources has nullable deliveryFeePaise, minCartPaise, deliveryEtaBand
- AC2: serviceabilityChecks table with nullable isServiceable
- AC3: isServiceable: null returned when unknown — never defaulted to true
- AC4: isStale: true when observedAt > 24h old
- AC5: sourceId ownership verified; cross-user returns 404
- AC6: serviceability_checks in ALL_TABLES and USER_TABLES
- AC7: schema.smoke.test.ts and decomposition.test.ts pass
- AC8: typecheck + lint + test green

## Commands
1. `npm run db:generate -w apps/api` (after schema changes)
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/api`

## Required Evidence
- All files changed with line counts
- Complete diff
- Migration SQL content
- All command outputs and exit codes
- Any plan deviations or blockers
