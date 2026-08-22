/**
 * shopping.ts — shared Zod contracts for the Shopping Intelligence pillar (task 9.1).
 *
 * Persistence source of truth: apps/api/src/modules/shopping/schema.ts.
 *
 * Money is always integer paise. `nonNegativePaiseField` (prices, MRPs, totals)
 * and `quantityField` (base-unit quantities) are local helpers, not exported.
 *
 * Quantities are integers in one base unit per kind — g / ml / piece — so
 * unit-price comparison across pack sizes is exact integer arithmetic. A
 * quantity is meaningless without its unit: the pairing is enforced by a CHECK
 * constraint per table (`*_quantity_unit_paired`) and mirrored by a Zod
 * refinement, so a quantity can never exist without its unit.
 *
 * Entity schemas omit `userId`: every shopping endpoint is already scoped to the
 * session user, so echoing the owner id back would add nothing and widen the
 * response surface.
 */

import { z } from "zod";

/** Integer paise that cannot be negative — a price, MRP or basket total. */
function nonNegativePaiseField() {
  return z.number().int().nonnegative().safe();
}

/** Integer quantity in base units (g / ml / piece). Never negative. */
function quantityField() {
  return z.number().int().nonnegative().safe();
}

export const NormalizedUnitSchema = z.enum(["g", "ml", "piece"]);
export type NormalizedUnit = z.infer<typeof NormalizedUnitSchema>;

export const UnitKindSchema = z.enum(["mass", "volume", "count"]);
export type UnitKind = z.infer<typeof UnitKindSchema>;

export const ShoppingListStatusSchema = z.enum(["active", "archived"]);
export type ShoppingListStatus = z.infer<typeof ShoppingListStatusSchema>;

export const ShoppingListItemStatusSchema = z.enum(["pending", "bought", "dropped"]);
export type ShoppingListItemStatus = z.infer<typeof ShoppingListItemStatusSchema>;

export const PriceSourceKindSchema = z.enum(["quick_commerce", "ecommerce", "local_store", "manual"]);
export type PriceSourceKind = z.infer<typeof PriceSourceKindSchema>;

export const CartDraftStatusSchema = z.enum(["draft", "ordered", "abandoned"]);
export type CartDraftStatus = z.infer<typeof CartDraftStatusSchema>;

/**
 * Delivery speed band for a price source.
 * null means unknown — there is no "unknown" enum value to avoid two
 * representations of the same absent state.
 */
export const DeliveryEtaBandSchema = z.enum(["instant", "same_day", "next_day", "scheduled"]);
export type DeliveryEtaBand = z.infer<typeof DeliveryEtaBandSchema>;

/** One entry in the normalized-unit vocabulary the API publishes. */
export const NormalizedUnitInfoSchema = z.object({
  unit: NormalizedUnitSchema,
  kind: UnitKindSchema,
  label: z.string().min(1),
});
export type NormalizedUnitInfo = z.infer<typeof NormalizedUnitInfoSchema>;

export const ShoppingUnitsResponseSchema = z.object({
  units: z.array(NormalizedUnitInfoSchema),
});
export type ShoppingUnitsResponse = z.infer<typeof ShoppingUnitsResponseSchema>;

export const CatalogItemSchema = z.object({
  id: z.uuid(),
  canonicalName: z.string().min(1),
  brand: z.string().nullable(),
  categoryId: z.uuid().nullable(),
  packQuantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).refine(
  (v) => (v.packQuantityBase === null) === (v.unit === null),
  { message: "packQuantityBase and unit must both be set or both be null" },
);
export type CatalogItem = z.infer<typeof CatalogItemSchema>;

export const PriceSourceSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  kind: PriceSourceKindSchema,
  url: z.string().nullable(),
  isActive: z.boolean(),
  /** Delivery fee in integer paise — null means not applicable or unknown. */
  deliveryFeePaise: z.number().int().nonnegative().nullable(),
  /** Minimum cart value in integer paise — null means unknown. */
  minCartPaise: z.number().int().nonnegative().nullable(),
  /** Delivery speed band — null means unknown. */
  deliveryEtaBand: DeliveryEtaBandSchema.nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type PriceSource = z.infer<typeof PriceSourceSchema>;

export const ShoppingListSchema = z.object({
  id: z.uuid(),
  name: z.string().min(1),
  status: ShoppingListStatusSchema,
  note: z.string().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type ShoppingList = z.infer<typeof ShoppingListSchema>;

export const ShoppingListItemSchema = z.object({
  id: z.uuid(),
  listId: z.uuid(),
  catalogItemId: z.uuid().nullable(),
  rawText: z.string().min(1),
  quantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  status: ShoppingListItemStatusSchema,
  position: z.number().int().nonnegative(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
export type ShoppingListItem = z.infer<typeof ShoppingListItemSchema>;

export const PriceObservationSchema = z.object({
  id: z.uuid(),
  catalogItemId: z.uuid(),
  priceSourceId: z.uuid(),
  pricePaise: nonNegativePaiseField(),
  mrpPaise: nonNegativePaiseField().nullable(),
  packQuantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  observedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
}).refine(
  (v) => (v.packQuantityBase === null) === (v.unit === null),
  { message: "packQuantityBase and unit must both be set or both be null" },
);
export type PriceObservation = z.infer<typeof PriceObservationSchema>;

export const PantryItemSchema = z.object({
  id: z.uuid(),
  catalogItemId: z.uuid(),
  quantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  lastPurchasedAt: z.coerce.date().nullable(),
  expectedDepletionAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
export type PantryItem = z.infer<typeof PantryItemSchema>;

export const CartDraftSchema = z.object({
  id: z.uuid(),
  status: CartDraftStatusSchema,
  priceSourceId: z.uuid().nullable(),
  totalPaise: nonNegativePaiseField(),
  generatedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CartDraft = z.infer<typeof CartDraftSchema>;

export const HabitProfileSchema = z.object({
  id: z.uuid(),
  catalogItemId: z.uuid(),
  consumptionBasePerMonth: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  observationCount: z.number().int().nonnegative(),
  lastComputedAt: z.coerce.date().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
}).refine(
  (v) => (v.consumptionBasePerMonth === null) === (v.unit === null),
  { message: "consumptionBasePerMonth and unit must both be set or both be null" },
);
export type HabitProfile = z.infer<typeof HabitProfileSchema>;

// ─── Shopping-list CRUD contracts (task 9.2) ─────────────────────────────────

/** Create a new shopping list. */
export const CreateShoppingListSchema = z.object({
  /** 1–120 characters, trimmed, non-empty. */
  name: z.string().min(1).max(120).trim().refine((v) => v.length > 0, { message: "name must not be blank after trimming" }),
  /** Optional free-text note, max 1000 characters. */
  note: z.string().max(1000).nullable().default(null),
});
export type CreateShoppingList = z.input<typeof CreateShoppingListSchema>;

/**
 * PUT (full replace) update of a shopping list. Every field is REQUIRED —
 * NO .default() — so an omitted field is a 400 (no preserve-on-omission).
 */
export const UpdateShoppingListSchema = z.object({
  name: z.string().min(1).max(120).trim().refine((v) => v.length > 0, { message: "name must not be blank after trimming" }),
  note: z.string().max(1000).nullable(),
  status: ShoppingListStatusSchema,
});
export type UpdateShoppingList = z.input<typeof UpdateShoppingListSchema>;

/** Add a new item to a shopping list. */
export const CreateShoppingListItemSchema = z.object({
  /** Verbatim user text, 1–200 characters, trimmed non-empty. */
  rawText: z.string().min(1).max(200).trim().refine((v) => v.length > 0, { message: "rawText must not be blank after trimming" }),
  /** Optional link to a catalog item the user owns. */
  catalogItemId: z.uuid().nullable().default(null),
  /** Quantity in base units (g / ml / piece). Must be paired with unit. */
  quantityBase: quantityField().nullable().default(null),
  /** Unit for the quantity. Must be paired with quantityBase. */
  unit: NormalizedUnitSchema.nullable().default(null),
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
export type CreateShoppingListItem = z.input<typeof CreateShoppingListItemSchema>;

/**
 * PUT (full replace) update of a shopping list item. Every field is REQUIRED —
 * NO .default() — so an omitted field is a 400 (no preserve-on-omission).
 */
export const UpdateShoppingListItemSchema = z.object({
  rawText: z.string().min(1).max(200).trim().refine((v) => v.length > 0, { message: "rawText must not be blank after trimming" }),
  catalogItemId: z.uuid().nullable(),
  quantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  status: ShoppingListItemStatusSchema,
}).refine(
  (v) => (v.quantityBase === null) === (v.unit === null),
  { message: "quantityBase and unit must both be set or both be null" },
);
export type UpdateShoppingListItem = z.input<typeof UpdateShoppingListItemSchema>;

/**
 * Reorder the items of a shopping list. `orderedIds` must be EXACTLY the list's
 * current item ids — same cardinality, no duplicates, no foreign/missing ids.
 * Duplicate uuids are rejected at the Zod boundary.
 */
export const ReorderItemsSchema = z.object({
  orderedIds: z.array(z.uuid()),
}).refine(
  (v) => new Set(v.orderedIds).size === v.orderedIds.length,
  { message: "orderedIds must not contain duplicate ids", path: ["orderedIds"] },
);
export type ReorderItems = z.input<typeof ReorderItemsSchema>;

/** A shopping list together with its ordered items (response shape for GET /lists/:id). */
export const ShoppingListWithItemsSchema = ShoppingListSchema.extend({
  items: z.array(ShoppingListItemSchema),
});
export type ShoppingListWithItems = z.infer<typeof ShoppingListWithItemsSchema>;

// ─── Catalog CRUD contracts (task 9.3) ───────────────────────────────────────

/**
 * Display units accepted by `convertToBaseQuantity` (user-facing input).
 * Extends `NormalizedUnitSchema` with the higher-order display units `kg` and
 * `litre` that map to base units `g` and `ml` respectively.
 */
export const DisplayUnitSchema = z.enum(["kg", "g", "litre", "ml", "piece"]);
export type DisplayUnit = z.infer<typeof DisplayUnitSchema>;

/** Create a new catalog item for the current user. */
export const CreateCatalogItemSchema = z.object({
  /** Canonical product name, 1–120 chars, trimmed. Must be unique per user (case-sensitive at DB level). */
  canonicalName: z.string().min(1).max(120).trim().refine((v) => v.length > 0, {
    message: "canonicalName must not be blank after trimming",
  }),
  /** Optional brand name, max 200 chars. */
  brand: z.string().max(200).nullable().default(null),
  /** Optional link to a ledger category (user-owned). Cross-owner FK is unenforced at DB level. */
  categoryId: z.uuid().nullable().default(null),
  /** Typical pack quantity in base units (g / ml / piece). Paired with unit. */
  packQuantityBase: quantityField().nullable().default(null),
  /** Normalized unit for packQuantityBase. Must be set iff packQuantityBase is set. */
  unit: NormalizedUnitSchema.nullable().default(null),
}).refine(
  (v) => (v.packQuantityBase === null) === (v.unit === null),
  { message: "packQuantityBase and unit must both be set or both be null" },
);
export type CreateCatalogItem = z.input<typeof CreateCatalogItemSchema>;

/**
 * PUT (full replace) update of a catalog item. Every field is REQUIRED —
 * NO .default() — so an omitted field is a 400 (no preserve-on-omission).
 */
export const UpdateCatalogItemSchema = z.object({
  canonicalName: z.string().min(1).max(120).trim().refine((v) => v.length > 0, {
    message: "canonicalName must not be blank after trimming",
  }),
  brand: z.string().max(200).nullable(),
  categoryId: z.uuid().nullable(),
  packQuantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
}).refine(
  (v) => (v.packQuantityBase === null) === (v.unit === null),
  { message: "packQuantityBase and unit must both be set or both be null" },
);
export type UpdateCatalogItem = z.input<typeof UpdateCatalogItemSchema>;

/**
 * Result of a catalog match attempt. Discriminated on `status`:
 * - `matched`:   exactly one catalog item matched — auto-link is safe.
 * - `ambiguous`: two or more items matched (case-insensitive) — never auto-resolved.
 * - `none`:      no match — item remains a raw-text-only entry.
 */
export const CatalogMatchResultSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("matched"), catalogItemId: z.uuid() }),
  z.object({ status: z.literal("ambiguous"), candidateIds: z.array(z.uuid()) }),
  z.object({ status: z.literal("none") }),
]);
export type CatalogMatchResult = z.infer<typeof CatalogMatchResultSchema>;

/**
 * Response shape for POST /lists/:listId/items/:itemId/canonicalize.
 * Always returns the (possibly updated) item and the match result, so callers
 * can surface ambiguous candidates to the user without an extra GET.
 */
export const CanonicalizeItemResponseSchema = z.object({
  item: ShoppingListItemSchema,
  match: CatalogMatchResultSchema,
});
export type CanonicalizeItemResponse = z.infer<typeof CanonicalizeItemResponseSchema>;

// ─── Paste-text list capture contracts (task 9.4) ────────────────────────────

/**
 * One candidate item returned by the AI parse route. The client reviews these
 * and then calls POST /lists/:id/items for each accepted item.
 *
 * `rawText` mirrors the item's name verbatim (1–200 chars, trimmed, non-empty).
 * `quantityBase` / `unit` are always paired — both set or both null — matching
 * the DB CHECK constraint and the `CreateShoppingListItemSchema` invariant.
 */
export const ParsedShoppingItemSchema = z
  .object({
    /** The item name verbatim from the model (1–200 chars, trimmed, non-empty). */
    rawText: z
      .string()
      .min(1)
      .max(200)
      .trim()
      .refine((v) => v.length > 0, { message: "rawText must not be blank after trimming" }),
    /** Quantity in base units (g / ml / piece). Must be paired with unit. */
    quantityBase: quantityField().nullable(),
    /** Normalized unit. Must be paired with quantityBase. */
    unit: NormalizedUnitSchema.nullable(),
  })
  .refine((v) => (v.quantityBase === null) === (v.unit === null), {
    message: "quantityBase and unit must both be set or both be null",
  });
export type ParsedShoppingItem = z.infer<typeof ParsedShoppingItemSchema>;

/**
 * Request body for POST /api/shopping/parse-text.
 * `sourceKind` selects the system prompt: "freetext" (default) or "recipe".
 */
export const ParseListTextRequestSchema = z.object({
  /** The raw text to parse (1–4000 chars, trimmed, non-empty). */
  text: z
    .string()
    .min(1)
    .max(4000)
    .trim()
    .refine((v) => v.length > 0, { message: "text must not be blank after trimming" }),
  /** Prompt variant. Default: "freetext". */
  sourceKind: z.enum(["freetext", "recipe"]).default("freetext"),
});
export type ParseListTextRequest = z.input<typeof ParseListTextRequestSchema>;

/**
 * Response body for POST /api/shopping/parse-text.
 *
 * - `available`: false when the user has no AI provider configured.
 * - `items`: zero or more candidate rows (empty on bad model output, never a 500).
 * - `rawInput`: the original text echoed back for client-side replay.
 * - `message`: human-readable explanation when `available` is false or items is empty.
 */
export const ParseListTextResponseSchema = z.object({
  available: z.boolean(),
  items: z.array(ParsedShoppingItemSchema),
  rawInput: z.string(),
  message: z.string().nullable(),
});
export type ParseListTextResponse = z.infer<typeof ParseListTextResponseSchema>;

// ─── Price Sources & Observations CRUD contracts (task 10.1) ─────────────────

/** Create a new price source for the current user. */
export const CreatePriceSourceSchema = z.object({
  /** Platform or store name, 1–120 chars, trimmed. Must be unique per user. */
  name: z.string().min(1).max(120).trim().refine((v) => v.length > 0, { message: "name required" }),
  /** Source kind — quick_commerce, ecommerce, local_store, or manual. */
  kind: PriceSourceKindSchema,
  /** Optional homepage or product-URL, or null for physical stores. */
  url: z.string().url().nullable().default(null),
  /** Whether this source is active. Defaults to true. */
  isActive: z.boolean().default(true),
});
export type CreatePriceSource = z.input<typeof CreatePriceSourceSchema>;

/**
 * PUT (full replace) update of a price source. Every field is REQUIRED —
 * NO .default() — so an omitted field is a 400 (no preserve-on-omission).
 */
export const UpdatePriceSourceSchema = z.object({
  name: z.string().min(1).max(120).trim().refine((v) => v.length > 0, { message: "name required" }),
  kind: PriceSourceKindSchema,
  url: z.string().url().nullable(),
  isActive: z.boolean(),
});
export type UpdatePriceSource = z.input<typeof UpdatePriceSourceSchema>;

/** Create a new price observation for a catalog item at a source. */
export const CreatePriceObservationSchema = z.object({
  /** Catalog item this price applies to (must be owned by the caller). */
  catalogItemId: z.uuid(),
  /** Price source (must be owned by the caller). */
  priceSourceId: z.uuid(),
  /** Observed price in integer paise. */
  pricePaise: nonNegativePaiseField(),
  /** Maximum retail price in integer paise, or null if unknown. */
  mrpPaise: nonNegativePaiseField().nullable().default(null),
  /** Pack quantity in base units this price applies to. Paired with unit. */
  packQuantityBase: quantityField().nullable().default(null),
  /** Normalized unit for packQuantityBase. Must be set iff packQuantityBase is set. */
  unit: NormalizedUnitSchema.nullable().default(null),
  /** When the price was observed. Defaults to now. */
  observedAt: z.coerce.date().default(() => new Date()),
}).refine(
  (v) => (v.packQuantityBase === null) === (v.unit === null),
  { message: "packQuantityBase and unit must both be set or both be null" },
);
/** Infer the output type (observedAt is always a Date after coercion). */
export type CreatePriceObservation = z.infer<typeof CreatePriceObservationSchema>;

/**
 * A price observation enriched with its source name and kind, plus a staleness
 * flag computed in the service layer (> 7 days from observedAt to now).
 */
export const PriceObservationWithSourceSchema = PriceObservationSchema.extend({
  sourceName: z.string(),
  sourceKind: PriceSourceKindSchema,
  isStale: z.boolean(),
});
export type PriceObservationWithSource = z.infer<typeof PriceObservationWithSourceSchema>;

/** Response shape for GET /observations?catalogItemId=. */
export const PriceObservationsResponseSchema = z.object({
  observations: z.array(PriceObservationWithSourceSchema),
});
export type PriceObservationsResponse = z.infer<typeof PriceObservationsResponseSchema>;

// ─── Serviceability contracts (task 10.2) ────────────────────────────────────

/**
 * One serviceability record for a price source × pincode pair.
 * `isServiceable` is 3-valued: true=yes, false=no, null=unknown.
 * null NEVER means "available" — unknown is explicit.
 * `isStale` is computed server-side: observedAt older than 24 hours.
 */
export const ServiceabilityCheckSchema = z.object({
  id: z.uuid(),
  priceSourceId: z.uuid(),
  pincode: z.string().min(1),
  isServiceable: z.boolean().nullable(),
  isStale: z.boolean(),
  observedAt: z.coerce.date(),
  createdAt: z.coerce.date(),
});
export type ServiceabilityCheck = z.infer<typeof ServiceabilityCheckSchema>;

/**
 * Body for PUT /sources/:sourceId/serviceability/:pincode.
 * Pincode must be exactly 6 decimal digits (Indian PIN code format).
 */
export const CreateServiceabilityCheckSchema = z.object({
  isServiceable: z.boolean().nullable(),
});
export type CreateServiceabilityCheck = z.infer<typeof CreateServiceabilityCheckSchema>;

// ─── Photo list capture contracts (task 9.5) ─────────────────────────────────

/**
 * Response body for POST /api/shopping/parse-image.
 *
 * - `available`: false when the user has no AI provider configured or the
 *   provider does not support vision.
 * - `items`: zero or more candidate rows (empty on bad model output or
 *   unreadable photo — never a 500).
 * - `message`: human-readable explanation when `available` is false or items
 *   is empty; null when items were successfully extracted.
 *
 * NO `storageKey` field — the image is transient (stored briefly for the AI
 * call then deleted), so there is nothing for the client to reference.
 */
export const ParseListImageResponseSchema = z.object({
  available: z.boolean(),
  items: z.array(ParsedShoppingItemSchema),
  message: z.string().nullable(),
});
export type ParseListImageResponse = z.infer<typeof ParseListImageResponseSchema>;

// ─── Basket Arbitrage contracts (task 10.3) ───────────────────────────────────

/**
 * The assignment of list items to one source in an arbitrage split.
 * `priceEvidenceByItemId` records the exact observation used for each item so
 * the client can surface prices and their staleness without a second round-trip.
 */
export const ArbitrageSourcePlanSchema = z.object({
  sourceId: z.uuid(),
  sourceName: z.string(),
  /** Sum of item prices assigned to this source, in integer paise. */
  itemSubtotalPaise: z.number().int().nonnegative(),
  /** Delivery fee added per this source, in integer paise. */
  deliveryFeePaise: z.number().int().nonnegative(),
  /** Minimum cart value for this source (informational only), or null if unknown. */
  minCartPaise: z.number().int().nonnegative().nullable(),
  /** itemSubtotalPaise + deliveryFeePaise, in integer paise. */
  totalPaise: z.number().int().nonnegative(),
  /** Shopping list item IDs assigned to this source. */
  assignedItemIds: z.array(z.uuid()),
  /** Price evidence per assigned item — key is the shopping list item ID. */
  priceEvidenceByItemId: z.record(
    z.uuid(),
    z.object({
      pricePaise: z.number().int().nonnegative(),
      observedAt: z.coerce.date(),
    }),
  ),
});
export type ArbitrageSourcePlan = z.infer<typeof ArbitrageSourcePlanSchema>;

/**
 * Result of the basket arbitrage optimizer for a shopping list.
 *
 * `splits` is the cheapest assignment of priced items across sources.
 * `unpricedItemIds` lists items with no price observation on any source —
 * never silently dropped.
 * `savingPaise` = bestSingleSourceTotalPaise − grandTotalPaise (may be 0 when
 * single-source is already optimal, or when bestSingle is null).
 * `tooFewSources` is true when there are 0 sources, or exactly 1 source and
 * no single source covers all priced items.
 */
export const BasketArbitrageResultSchema = z.object({
  splits: z.array(ArbitrageSourcePlanSchema),
  grandTotalPaise: z.number().int().nonnegative(),
  bestSingleSourceTotalPaise: z.number().int().nonnegative().nullable(),
  savingPaise: z.number().int(),
  unpricedItemIds: z.array(z.uuid()),
  tooFewSources: z.boolean(),
});
export type BasketArbitrageResult = z.infer<typeof BasketArbitrageResultSchema>;

// ─── Price History, Buy-Now-vs-Wait & Honesty Check contracts (task 10.7) ────

export const PriceTrendSchema = z.enum(["rising", "falling", "stable", "insufficient_data"]);
export type PriceTrend = z.infer<typeof PriceTrendSchema>;

export const TrendConfidenceSchema = z.enum(["low", "medium", "high", "insufficient_data"]);
export type TrendConfidence = z.infer<typeof TrendConfidenceSchema>;

/**
 * One point in the price history for a catalog item.
 * `unitPricePaisePerBase` is pricePaise / packQuantityBase; null when no pack
 * size information is available for this observation.
 */
export const PriceHistoryPointSchema = z.object({
  pricePaise: z.number().int().nonnegative(),
  /** pricePaise / packQuantityBase; null if no pack size info. */
  unitPricePaisePerBase: z.number().nonnegative().nullable(),
  packQuantityBase: quantityField().nullable(),
  unit: NormalizedUnitSchema.nullable(),
  sourceId: z.uuid(),
  observedAt: z.coerce.date(),
});
export type PriceHistoryPoint = z.infer<typeof PriceHistoryPointSchema>;

/** Response for GET /catalog/:itemId/price-history. */
export const PriceHistoryResponseSchema = z.object({
  catalogItemId: z.uuid(),
  /** null when no sourceId filter was applied. */
  sourceId: z.uuid().nullable(),
  points: z.array(PriceHistoryPointSchema),
});
export type PriceHistoryResponse = z.infer<typeof PriceHistoryResponseSchema>;

/**
 * Buy-now-vs-wait recommendation derived from price trend linear regression.
 * Returns `trend: "insufficient_data"` when fewer than MIN_OBSERVATIONS=5
 * observations exist or fewer than MIN_DISTINCT_DAYS=3 distinct calendar days
 * are covered.
 */
export const BuyNowVsWaitSchema = z.object({
  trend: PriceTrendSchema,
  confidence: TrendConfidenceSchema,
  /** Always 5 — returned for client explainability. */
  minObservationsRequired: z.literal(5),
  observationCount: z.number().int().nonnegative(),
  /** Always 3 — returned for client explainability. */
  distinctDaysRequired: z.literal(3),
  distinctDayCount: z.number().int().nonnegative(),
  /** Recommended price in paise; null when trend is insufficient_data or stable. */
  recommendationPaise: z.number().int().nullable(),
});
export type BuyNowVsWait = z.infer<typeof BuyNowVsWaitSchema>;

/**
 * Result of a price-honesty check for a claimed MRP against observed prices.
 * `flagged` is true when the claimed MRP exceeds the highest observed price by
 * more than INFLATION_THRESHOLD_PCT=110%.
 */
export const PriceHonestyResultSchema = z.object({
  catalogItemId: z.uuid(),
  /** null when no sourceId filter was applied. */
  sourceId: z.uuid().nullable(),
  claimedMrpPaise: z.number().int().nonnegative(),
  /** null when no observations exist in the 30-day window. */
  maxObservedPricePaise: z.number().int().nonnegative().nullable(),
  /** Always 110 — returned for client explainability. */
  inflationThresholdPct: z.literal(110),
  flagged: z.boolean(),
  evidence: z.array(PriceHistoryPointSchema),
});
export type PriceHonestyResult = z.infer<typeof PriceHonestyResultSchema>;

// ─── Checkout Recommendation contracts (task 10.6) ───────────────────────────

/**
 * One line in a checkout recommendation — the per-item breakdown of costs for
 * the recommended source and card combination. Delivery fee and offer savings
 * are split proportionally across items assigned to the same source.
 */
export const CheckoutLineSchema = z.object({
  itemId: z.uuid(),
  sourceId: z.uuid(),
  /** null when no card provides a net benefit for this source. */
  cardAccountId: z.uuid().nullable(),
  baseItemPricePaise: z.number().int().nonnegative(),
  /** Proportional share of the source's delivery fee for this item. */
  deliveryFeeSharePaise: z.number().int().nonnegative(),
  /** Offer saving attributed to this item (proportional share of the source-level saving). */
  offerSavingPaise: z.number().int().nonnegative(),
  /** Points-based value attributed to this item; 0 when no configured redemption route. */
  pointsValuePaise: z.number().int().nonnegative(),
  /** baseItemPricePaise + deliveryFeeSharePaise − offerSavingPaise − pointsValuePaise (≥ 0). */
  effectiveCostPaise: z.number().int().nonnegative(),
});
export type CheckoutLine = z.infer<typeof CheckoutLineSchema>;

/**
 * Full checkout recommendation for a shopping list. Lines cover all priced
 * items; unpriced items are reported separately. `savingVsNaivePaise` compares
 * the recommendation's total effective cost against the plain arbitrage result
 * (no card, no offer).
 */
export const CheckoutRecommendationSchema = z.object({
  recommends: z.literal(true),
  lines: z.array(CheckoutLineSchema),
  totalEffectiveCostPaise: z.number().int().nonnegative(),
  /** grandTotalPaise (arbitrage) − totalEffectiveCostPaise; may be negative if no saving. */
  savingVsNaivePaise: z.number().int(),
  unpricedItemIds: z.array(z.uuid()),
  notes: z.array(z.string()),
});
export type CheckoutRecommendation = z.infer<typeof CheckoutRecommendationSchema>;
