# Sonnet Worker Delegation — Iteration 1

## Task
079 — Predictive Replenishment Cart Drafts (task 11.2)

## Approved Plan
- P1: Schema migration — cart_draft_items table
- P2: Shared Zod schemas
- P3: Cart draft generator service (pure + DB)
- P4: Routes (CRUD + generate)
- P5: Register in plugin, update snapshots
- P6: Tests (pure functions + edge cases)
- P7: Backup registration

## Files and Symbols

### Reference files (read first)
- `tasks/079-predictive-cart/TASK.md` — full spec with review findings
- `apps/api/src/modules/shopping/schema.ts` — existing cartDrafts table, existing table patterns
- `apps/api/src/modules/shopping/services/pantry-management.ts` — computeDecayedQuantity, computeExpectedDepletionMs
- `apps/api/src/modules/shopping/services/consumption-rate.ts` — MS_PER_DAY
- `apps/api/src/modules/shopping/services/ownership.ts` — assertOwnedCatalogItem pattern
- `apps/api/src/modules/shopping/services/price-observations.ts` — listObservations, STALE_DAYS
- `apps/api/src/modules/shopping/routes/pantry.ts` — route pattern reference
- `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES, LINKED_TABLES, USER_TABLES
- `packages/shared/src/schemas/shopping.ts` — existing schemas
- `apps/api/src/db/schema.ts` — barrel re-export

### New files to create
- `apps/api/src/modules/shopping/services/cart-draft-generator.ts`
- `apps/api/src/modules/shopping/services/cart-draft-generator.test.ts`
- `apps/api/src/modules/shopping/routes/cart-drafts.ts`

### Files to modify
- `apps/api/src/modules/shopping/schema.ts` — add cartDraftItems table
- `apps/api/src/db/schema.ts` — re-export cartDraftItems
- `apps/api/src/modules/system/services/backup.ts` — add cart_draft_items to ALL_TABLES, LINKED_TABLES
- `packages/shared/src/schemas/shopping.ts` — add new schemas
- `apps/api/src/modules/shopping/plugin.ts` — register cart-drafts route
- Route snapshots

## Required Changes

### 1. Schema: cartDraftItems table
Add after cartDrafts in schema.ts:
```ts
export const cartDraftItems = pgTable(
  "cart_draft_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    cartDraftId: uuid("cart_draft_id").notNull()
      .references(() => cartDrafts.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id")
      .references(() => catalogItems.id, { onDelete: "set null" }),  // NULLABLE
    quantityBase: bigint("quantity_base", { mode: "number" }),
    unit: normalizedUnit("unit"),
    reason: text("reason").notNull(),
    suggestedPricePaise: bigint("suggested_price_paise", { mode: "number" }),
    suggestedSourceId: uuid("suggested_source_id")
      .references(() => priceSources.id, { onDelete: "set null" }),
    substitutionForItemId: uuid("substitution_for_item_id"),  // no FK, just a pointer
    priceDeltaPaise: bigint("price_delta_paise", { mode: "number" }),
    isRemoved: boolean("is_removed").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cart_draft_items_draft_idx").on(t.cartDraftId),
    check("cart_draft_items_quantity_nonneg", sql`"quantity_base" IS NULL OR "quantity_base" >= 0`),
    check("cart_draft_items_quantity_unit_paired", sql`("quantity_base" IS NULL) = ("unit" IS NULL)`),
    check("cart_draft_items_price_nonneg", sql`"suggested_price_paise" IS NULL OR "suggested_price_paise" >= 0`),
  ],
);
```

Then run: `npm run db:generate` and `npm run db:migrate`

### 2. Shared Zod schemas
Append to shopping.ts:
```ts
// ─── Cart Draft Items contracts (task 11.2) ─────────────────────────────────

export const CartDraftItemSchema = z.object({
  id: z.uuid(),
  cartDraftId: z.uuid(),
  catalogItemId: z.uuid().nullable(),
  quantityBase: z.number().int().nonnegative().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  reason: z.string(),
  suggestedPricePaise: z.number().int().nonnegative().nullable(),
  suggestedSourceId: z.uuid().nullable(),
  substitutionForItemId: z.uuid().nullable(),
  priceDeltaPaise: z.number().int().nullable(),
  isRemoved: z.boolean(),
  createdAt: z.coerce.date(),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);

export const CartDraftWithItemsSchema = CartDraftSchema.extend({
  items: z.array(CartDraftItemSchema),
});

export const GenerateDraftResponseSchema = z.object({
  draft: CartDraftWithItemsSchema,
  generated: z.number().int().nonnegative(),
  substitutions: z.number().int().nonnegative(),
});

export const UpdateCartDraftItemSchema = z.object({
  quantityBase: z.number().int().nonnegative().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  isRemoved: z.boolean(),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
```

### 3. Generator service
Key design decisions (from review):
- `shouldReplenish`: skip items with null consumptionBasePerMonth or null unit
- `suggestQuantity`: one month's supply = consumptionBasePerMonth, integer
- Price comparison: use unit-normalized price = Math.floor(pricePaise * 1000 / packQuantityBase) for same-unit comparisons. Skip items with no packQuantityBase.
- Latest price: query price_observations for catalogItemId ordered by observedAt DESC, limit 1, within last 7 days (STALE_DAYS)
- 30-day average: query price_observations for last 30 days, compute Math.floor(sum / count)
- Substitution: find same-unit catalog items with lower unit-normalized current price
- Empty data: return empty draft with 0 items, not an error
- totalPaise: sum of suggestedPricePaise across non-removed items (null prices treated as 0)
- Idempotency: check for existing draft with status='draft' for same user where generatedAt is same calendar day (UTC). Use transaction.
- assertOwnedDraft: new helper that checks cartDrafts.userId = userId. Use for all draft routes.
- Teaching signal: on isRemoved false→true, decrement habit observationCount by 1 (clamp at 0). Repeated updates don't re-decrement.

### 4. Routes (relative to /api/shopping prefix)
- POST /drafts/generate → generateDraft; return GenerateDraftResponseSchema
- GET /drafts → list drafts; return { drafts: CartDraftWithItemsSchema[] }
- GET /drafts/:id → single draft with items; assertOwnedDraft
- PUT /drafts/:id/items/:itemId → UpdateCartDraftItemSchema; assertOwnedDraft + verify item belongs to draft
- DELETE /drafts/:id → set status='abandoned'; assertOwnedDraft

### 5. Backup
In backup.ts:
- Add "cart_draft_items" to ALL_TABLES array
- Add to LINKED_TABLES: `cart_draft_items: { fk: "cart_draft_id", parent: "cart_drafts" }`

### 6. Tests (pure functions)
1. shouldReplenish: depletion in 3 days → true
2. shouldReplenish: depletion in 10 days → false
3. shouldReplenish: null quantity → true
4. shouldReplenish: null consumptionBasePerMonth → false (skip)
5. suggestQuantity: returns integer month's supply
6. detectPriceSpike: 125% of avg → spiked
7. detectPriceSpike: 110% of avg → not spiked
8. detectPriceSpike: no observations → not spiked (no data = no spike)
9. totalPaise computation: sum non-removed items, null prices as 0
10. Teaching signal: decrement clamps at 0

## Must Not Change
- Existing table definitions
- Existing services (pantry.ts, pantry-management.ts, consumption-rate.ts)
- Any file in apps/web/

## Commands
1. `npm run db:generate` — generate migration SQL
2. `npm run db:migrate` — apply migration
3. `npm run typecheck` — exit 0
4. `npm run lint` — exit 0
5. `npm run test -w apps/api` — exit 0 for new tests

## Required Evidence
- Files created/modified
- Migration SQL generated
- All 5 commands with exit codes
- Test case names and results
- Deviations

Write findings to `tasks/079-predictive-cart/implementation-1.md` (max 20 lines).
