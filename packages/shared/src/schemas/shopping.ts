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
