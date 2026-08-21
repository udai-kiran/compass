import assert from "node:assert/strict";
import test from "node:test";
import { z } from "zod";
import {
  NormalizedUnitSchema,
  PriceObservationSchema,
  CatalogItemSchema,
  ShoppingListItemSchema,
  ShoppingUnitsResponseSchema,
  CartDraftSchema,
  PantryItemSchema,
  HabitProfileSchema,
  CreateShoppingListSchema,
  UpdateShoppingListSchema,
  CreateShoppingListItemSchema,
  UpdateShoppingListItemSchema,
  ReorderItemsSchema,
  ShoppingListWithItemsSchema,
  DisplayUnitSchema,
  CreateCatalogItemSchema,
  UpdateCatalogItemSchema,
  CatalogMatchResultSchema,
  CanonicalizeItemResponseSchema,
  ParsedShoppingItemSchema,
  ParseListTextRequestSchema,
  ParseListTextResponseSchema,
} from "./shopping.ts";
import { AiEventKindSchema } from "./ai-events.ts";

const NOW = new Date().toISOString();
const UUID = "00000000-0000-4000-a000-000000000001";
const UUID2 = "00000000-0000-4000-a000-000000000002";

test("NormalizedUnitSchema accepts g, ml, piece and rejects kg and litre", () => {
  assert.equal(NormalizedUnitSchema.safeParse("g").success, true);
  assert.equal(NormalizedUnitSchema.safeParse("ml").success, true);
  assert.equal(NormalizedUnitSchema.safeParse("piece").success, true);
  assert.equal(NormalizedUnitSchema.safeParse("kg").success, false);
  assert.equal(NormalizedUnitSchema.safeParse("litre").success, false);
});

test("PriceObservationSchema rejects a fractional pricePaise", () => {
  const result = PriceObservationSchema.safeParse({
    id: UUID,
    catalogItemId: UUID,
    priceSourceId: UUID2,
    pricePaise: 149.5,
    mrpPaise: null,
    packQuantityBase: null,
    unit: null,
    observedAt: NOW,
    createdAt: NOW,
  });
  assert.equal(result.success, false);
});

test("PriceObservationSchema rejects a negative packQuantityBase and accepts null", () => {
  const base = {
    id: UUID,
    catalogItemId: UUID,
    priceSourceId: UUID2,
    pricePaise: 14900,
    mrpPaise: null,
    unit: null,
    observedAt: NOW,
    createdAt: NOW,
  };
  const rejectResult = PriceObservationSchema.safeParse({ ...base, packQuantityBase: -1 });
  assert.equal(rejectResult.success, false);
  const acceptResult = PriceObservationSchema.safeParse({ ...base, packQuantityBase: null });
  assert.equal(acceptResult.success, true);
});

test("CatalogItemSchema rejects an empty canonicalName and accepts brand/categoryId as null", () => {
  const base = {
    id: UUID,
    packQuantityBase: null,
    unit: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const rejectResult = CatalogItemSchema.safeParse({ ...base, canonicalName: "", brand: null, categoryId: null });
  assert.equal(rejectResult.success, false);
  const acceptResult = CatalogItemSchema.safeParse({ ...base, canonicalName: "Rice", brand: null, categoryId: null });
  assert.equal(acceptResult.success, true);
});

test("ShoppingListItemSchema rejects an empty rawText and rejects a negative position", () => {
  const base = {
    id: UUID,
    listId: UUID,
    catalogItemId: null,
    quantityBase: null,
    unit: null,
    status: "pending" as const,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const rejectEmptyText = ShoppingListItemSchema.safeParse({ ...base, rawText: "", position: 0 });
  assert.equal(rejectEmptyText.success, false);
  const rejectNegPos = ShoppingListItemSchema.safeParse({ ...base, rawText: "Milk", position: -1 });
  assert.equal(rejectNegPos.success, false);
  const acceptResult = ShoppingListItemSchema.safeParse({ ...base, rawText: "Milk", position: 0 });
  assert.equal(acceptResult.success, true);
});

test("ShoppingUnitsResponseSchema parses valid entry and rejects an empty label", () => {
  const acceptResult = ShoppingUnitsResponseSchema.safeParse({
    units: [{ unit: "g", kind: "mass", label: "gram" }],
  });
  assert.equal(acceptResult.success, true);
  const rejectResult = ShoppingUnitsResponseSchema.safeParse({
    units: [{ unit: "g", kind: "mass", label: "" }],
  });
  assert.equal(rejectResult.success, false);
});

test("CartDraftSchema accepts totalPaise 0 and rejects totalPaise 12.5", () => {
  const base = {
    id: UUID,
    status: "draft" as const,
    priceSourceId: null,
    generatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const acceptResult = CartDraftSchema.safeParse({ ...base, totalPaise: 0 });
  assert.equal(acceptResult.success, true);
  const rejectResult = CartDraftSchema.safeParse({ ...base, totalPaise: 12.5 });
  assert.equal(rejectResult.success, false);
});

// ── Quantity↔unit pairing invariants ─────────────────────────────────────────

test("CatalogItemSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set", () => {
  const base = {
    id: UUID,
    canonicalName: "Rice",
    brand: null,
    categoryId: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  // quantity set, unit null → reject
  assert.equal(CatalogItemSchema.safeParse({ ...base, packQuantityBase: 500, unit: null }).success, false);
  // quantity null, unit set → reject
  assert.equal(CatalogItemSchema.safeParse({ ...base, packQuantityBase: null, unit: "g" }).success, false);
  // both null → accept
  assert.equal(CatalogItemSchema.safeParse({ ...base, packQuantityBase: null, unit: null }).success, true);
  // both set → accept
  assert.equal(CatalogItemSchema.safeParse({ ...base, packQuantityBase: 500, unit: "g" }).success, true);
});

test("ShoppingListItemSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set", () => {
  const base = {
    id: UUID,
    listId: UUID,
    catalogItemId: null,
    rawText: "Milk",
    status: "pending" as const,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.equal(ShoppingListItemSchema.safeParse({ ...base, quantityBase: 1000, unit: null }).success, false);
  assert.equal(ShoppingListItemSchema.safeParse({ ...base, quantityBase: null, unit: "ml" }).success, false);
  assert.equal(ShoppingListItemSchema.safeParse({ ...base, quantityBase: null, unit: null }).success, true);
  assert.equal(ShoppingListItemSchema.safeParse({ ...base, quantityBase: 1000, unit: "ml" }).success, true);
});

test("PriceObservationSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set", () => {
  const base = {
    id: UUID,
    catalogItemId: UUID,
    priceSourceId: UUID2,
    pricePaise: 14900,
    mrpPaise: null,
    observedAt: NOW,
    createdAt: NOW,
  };
  assert.equal(PriceObservationSchema.safeParse({ ...base, packQuantityBase: 500, unit: null }).success, false);
  assert.equal(PriceObservationSchema.safeParse({ ...base, packQuantityBase: null, unit: "g" }).success, false);
  assert.equal(PriceObservationSchema.safeParse({ ...base, packQuantityBase: null, unit: null }).success, true);
  assert.equal(PriceObservationSchema.safeParse({ ...base, packQuantityBase: 500, unit: "g" }).success, true);
});

test("PantryItemSchema rejects quantity-without-unit and unit-without-quantity; accepts both-null and both-set", () => {
  const base = {
    id: UUID,
    catalogItemId: UUID,
    lastPurchasedAt: null,
    expectedDepletionAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.equal(PantryItemSchema.safeParse({ ...base, quantityBase: 500, unit: null }).success, false);
  assert.equal(PantryItemSchema.safeParse({ ...base, quantityBase: null, unit: "g" }).success, false);
  assert.equal(PantryItemSchema.safeParse({ ...base, quantityBase: null, unit: null }).success, true);
  assert.equal(PantryItemSchema.safeParse({ ...base, quantityBase: 500, unit: "g" }).success, true);
});

test("HabitProfileSchema rejects consumption-without-unit and unit-without-consumption; accepts both-null and both-set", () => {
  const base = {
    id: UUID,
    catalogItemId: UUID,
    observationCount: 0,
    lastComputedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  };
  assert.equal(HabitProfileSchema.safeParse({ ...base, consumptionBasePerMonth: 30, unit: null }).success, false);
  assert.equal(HabitProfileSchema.safeParse({ ...base, consumptionBasePerMonth: null, unit: "g" }).success, false);
  assert.equal(HabitProfileSchema.safeParse({ ...base, consumptionBasePerMonth: null, unit: null }).success, true);
  assert.equal(HabitProfileSchema.safeParse({ ...base, consumptionBasePerMonth: 30, unit: "g" }).success, true);
});

// ── Non-negative money fields ─────────────────────────────────────────────────

test("PriceObservationSchema rejects pricePaise -1", () => {
  const result = PriceObservationSchema.safeParse({
    id: UUID,
    catalogItemId: UUID,
    priceSourceId: UUID2,
    pricePaise: -1,
    mrpPaise: null,
    packQuantityBase: null,
    unit: null,
    observedAt: NOW,
    createdAt: NOW,
  });
  assert.equal(result.success, false);
});

test("CartDraftSchema rejects totalPaise -1", () => {
  const result = CartDraftSchema.safeParse({
    id: UUID,
    status: "draft" as const,
    priceSourceId: null,
    totalPaise: -1,
    generatedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(result.success, false);
});

test("PriceObservationSchema rejects mrpPaise -1 but accepts mrpPaise null", () => {
  const base = {
    id: UUID,
    catalogItemId: UUID,
    priceSourceId: UUID2,
    pricePaise: 14900,
    packQuantityBase: null,
    unit: null,
    observedAt: NOW,
    createdAt: NOW,
  };
  const rejectResult = PriceObservationSchema.safeParse({ ...base, mrpPaise: -1 });
  assert.equal(rejectResult.success, false);
  const acceptResult = PriceObservationSchema.safeParse({ ...base, mrpPaise: null });
  assert.equal(acceptResult.success, true);
});

// ── HabitProfileSchema with unit set ─────────────────────────────────────────

test("HabitProfileSchema accepts a valid row with unit and consumptionBasePerMonth both set", () => {
  const result = HabitProfileSchema.safeParse({
    id: UUID,
    catalogItemId: UUID,
    consumptionBasePerMonth: 30,
    unit: "g",
    observationCount: 5,
    lastComputedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(result.success, true);
});

// ── Fractional quantity rejection ─────────────────────────────────────────────

test("quantity fields reject fractional values across all five quantity-bearing schemas", () => {
  // Each field is tested with a non-null paired unit so the pairing rule is
  // satisfied — the rejection must be due to the fraction, not the pairing.
  const catalogFrac = CatalogItemSchema.safeParse({
    id: UUID,
    canonicalName: "Rice",
    brand: null,
    categoryId: null,
    packQuantityBase: 500.5,
    unit: "g",
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(catalogFrac.success, false, "CatalogItemSchema.packQuantityBase must reject 500.5");

  const listItemFrac = ShoppingListItemSchema.safeParse({
    id: UUID,
    listId: UUID,
    catalogItemId: null,
    rawText: "Milk",
    quantityBase: 500.5,
    unit: "ml",
    status: "pending" as const,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(listItemFrac.success, false, "ShoppingListItemSchema.quantityBase must reject 500.5");

  const priceFrac = PriceObservationSchema.safeParse({
    id: UUID,
    catalogItemId: UUID,
    priceSourceId: UUID2,
    pricePaise: 14900,
    mrpPaise: null,
    packQuantityBase: 500.5,
    unit: "g",
    observedAt: NOW,
    createdAt: NOW,
  });
  assert.equal(priceFrac.success, false, "PriceObservationSchema.packQuantityBase must reject 500.5");

  const pantryFrac = PantryItemSchema.safeParse({
    id: UUID,
    catalogItemId: UUID,
    quantityBase: 500.5,
    unit: "g",
    lastPurchasedAt: null,
    expectedDepletionAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(pantryFrac.success, false, "PantryItemSchema.quantityBase must reject 500.5");

  const habitFrac = HabitProfileSchema.safeParse({
    id: UUID,
    catalogItemId: UUID,
    consumptionBasePerMonth: 500.5,
    unit: "g",
    observationCount: 0,
    lastComputedAt: null,
    createdAt: NOW,
    updatedAt: NOW,
  });
  assert.equal(habitFrac.success, false, "HabitProfileSchema.consumptionBasePerMonth must reject 500.5");
});

// ── Task 9.2 — new CRUD schemas ───────────────────────────────────────────────

test("CreateShoppingListSchema accepts name+null note, defaults note to null", () => {
  const r = CreateShoppingListSchema.safeParse({ name: "Weekly shop" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.name, "Weekly shop");
    assert.equal(r.data.note, null);
  }
});

test("CreateShoppingListSchema rejects blank name", () => {
  assert.equal(CreateShoppingListSchema.safeParse({ name: "   " }).success, false);
  assert.equal(CreateShoppingListSchema.safeParse({ name: "" }).success, false);
});

test("CreateShoppingListSchema rejects name > 120 chars", () => {
  assert.equal(CreateShoppingListSchema.safeParse({ name: "a".repeat(121) }).success, false);
});

test("CreateShoppingListSchema rejects note > 1000 chars", () => {
  assert.equal(
    CreateShoppingListSchema.safeParse({ name: "List", note: "x".repeat(1001) }).success,
    false,
  );
});

test("UpdateShoppingListSchema requires all three fields; omitting any is a 400", () => {
  // All provided — accept.
  assert.equal(
    UpdateShoppingListSchema.safeParse({ name: "Foo", note: null, status: "active" }).success,
    true,
  );
  // Missing status — reject.
  assert.equal(UpdateShoppingListSchema.safeParse({ name: "Foo", note: null }).success, false);
  // Missing note — reject.
  assert.equal(UpdateShoppingListSchema.safeParse({ name: "Foo", status: "active" }).success, false);
  // Missing name — reject.
  assert.equal(UpdateShoppingListSchema.safeParse({ note: null, status: "active" }).success, false);
});

test("CreateShoppingListItemSchema accepts rawText only (no catalogId/quantity/unit)", () => {
  const r = CreateShoppingListItemSchema.safeParse({ rawText: "Milk" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.rawText, "Milk");
    assert.equal(r.data.catalogItemId, null);
    assert.equal(r.data.quantityBase, null);
    assert.equal(r.data.unit, null);
  }
});

test("CreateShoppingListItemSchema rejects blank rawText", () => {
  assert.equal(CreateShoppingListItemSchema.safeParse({ rawText: "  " }).success, false);
});

test("CreateShoppingListItemSchema rejects rawText > 200 chars", () => {
  assert.equal(CreateShoppingListItemSchema.safeParse({ rawText: "a".repeat(201) }).success, false);
});

test("CreateShoppingListItemSchema enforces quantity/unit pairing", () => {
  // One-sided — reject.
  assert.equal(
    CreateShoppingListItemSchema.safeParse({ rawText: "Milk", quantityBase: 500 }).success,
    false,
  );
  assert.equal(
    CreateShoppingListItemSchema.safeParse({ rawText: "Milk", unit: "ml" }).success,
    false,
  );
  // Both set — accept.
  assert.equal(
    CreateShoppingListItemSchema.safeParse({ rawText: "Milk", quantityBase: 500, unit: "ml" })
      .success,
    true,
  );
});

test("UpdateShoppingListItemSchema requires all five fields; omitting any is a 400", () => {
  const full = {
    rawText: "Milk",
    catalogItemId: null,
    quantityBase: null,
    unit: null,
    status: "pending" as const,
  };
  assert.equal(UpdateShoppingListItemSchema.safeParse(full).success, true);
  // Missing status.
  const { status: _s, ...noStatus } = full;
  assert.equal(UpdateShoppingListItemSchema.safeParse(noStatus).success, false);
  // Missing catalogItemId.
  const { catalogItemId: _c, ...noCatalog } = full;
  assert.equal(UpdateShoppingListItemSchema.safeParse(noCatalog).success, false);
  // Missing quantityBase.
  const { quantityBase: _q, ...noQty } = full;
  assert.equal(UpdateShoppingListItemSchema.safeParse(noQty).success, false);
  // Missing unit.
  const { unit: _u, ...noUnit } = full;
  assert.equal(UpdateShoppingListItemSchema.safeParse(noUnit).success, false);
});

test("UpdateShoppingListItemSchema enforces quantity/unit pairing", () => {
  const base = { rawText: "Milk", catalogItemId: null, status: "bought" as const };
  assert.equal(
    UpdateShoppingListItemSchema.safeParse({ ...base, quantityBase: 500, unit: null }).success,
    false,
  );
  assert.equal(
    UpdateShoppingListItemSchema.safeParse({ ...base, quantityBase: null, unit: "ml" }).success,
    false,
  );
  assert.equal(
    UpdateShoppingListItemSchema.safeParse({ ...base, quantityBase: 500, unit: "ml" }).success,
    true,
  );
  assert.equal(
    UpdateShoppingListItemSchema.safeParse({ ...base, quantityBase: null, unit: null }).success,
    true,
  );
});

test("ReorderItemsSchema accepts an empty array", () => {
  assert.equal(ReorderItemsSchema.safeParse({ orderedIds: [] }).success, true);
});

test("ReorderItemsSchema accepts a valid list of uuids", () => {
  assert.equal(
    ReorderItemsSchema.safeParse({ orderedIds: [UUID, UUID2] }).success,
    true,
  );
});

test("ReorderItemsSchema rejects duplicate uuids", () => {
  assert.equal(
    ReorderItemsSchema.safeParse({ orderedIds: [UUID, UUID] }).success,
    false,
  );
});

test("ReorderItemsSchema rejects non-uuid strings", () => {
  assert.equal(
    ReorderItemsSchema.safeParse({ orderedIds: ["not-a-uuid"] }).success,
    false,
  );
});

test("ShoppingListWithItemsSchema accepts a list with zero items", () => {
  const r = ShoppingListWithItemsSchema.safeParse({
    id: UUID,
    name: "Groceries",
    status: "active",
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
  });
  assert.equal(r.success, true);
});

test("ShoppingListWithItemsSchema propagates item pairing refinement", () => {
  const r = ShoppingListWithItemsSchema.safeParse({
    id: UUID,
    name: "Groceries",
    status: "active",
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: UUID2,
        listId: UUID,
        catalogItemId: null,
        rawText: "Milk",
        quantityBase: 500,
        unit: null, // missing unit — should fail
        status: "pending",
        position: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  });
  assert.equal(r.success, false);
});

// ── Task 9.2 deepEqual round-trip tests ──────────────────────────────────────

test("CreateShoppingListSchema deepEqual: name+note round-trip", () => {
  const parsed = CreateShoppingListSchema.parse({ name: "Weekly shop", note: "Buy oats" });
  assert.deepEqual(parsed, { name: "Weekly shop", note: "Buy oats" });
});

test("CreateShoppingListSchema deepEqual: name only, note defaults to null", () => {
  const parsed = CreateShoppingListSchema.parse({ name: "Quick list" });
  assert.deepEqual(parsed, { name: "Quick list", note: null });
});

test("UpdateShoppingListSchema deepEqual: full replace round-trip (archived)", () => {
  const parsed = UpdateShoppingListSchema.parse({ name: "Renamed", note: "updated", status: "archived" });
  assert.deepEqual(parsed, { name: "Renamed", note: "updated", status: "archived" });
});

test("UpdateShoppingListSchema deepEqual: note null, status active round-trip", () => {
  const parsed = UpdateShoppingListSchema.parse({ name: "Active list", note: null, status: "active" });
  assert.deepEqual(parsed, { name: "Active list", note: null, status: "active" });
});

test("CreateShoppingListItemSchema deepEqual: rawText only — all optionals default to null", () => {
  const parsed = CreateShoppingListItemSchema.parse({ rawText: "Milk" });
  assert.deepEqual(parsed, { rawText: "Milk", catalogItemId: null, quantityBase: null, unit: null });
});

test("CreateShoppingListItemSchema deepEqual: rawText + quantity + unit round-trip", () => {
  const parsed = CreateShoppingListItemSchema.parse({ rawText: "Rice", quantityBase: 500, unit: "g" });
  assert.deepEqual(parsed, { rawText: "Rice", catalogItemId: null, quantityBase: 500, unit: "g" });
});

test("UpdateShoppingListItemSchema deepEqual: full replace with all fields set round-trip", () => {
  const input = {
    rawText: "Milk",
    catalogItemId: UUID,
    quantityBase: 1000,
    unit: "ml" as const,
    status: "bought" as const,
  };
  const parsed = UpdateShoppingListItemSchema.parse(input);
  assert.deepEqual(parsed, input);
});

test("UpdateShoppingListItemSchema deepEqual: all nullable fields null round-trip", () => {
  const input = {
    rawText: "Eggs",
    catalogItemId: null,
    quantityBase: null,
    unit: null,
    status: "pending" as const,
  };
  const parsed = UpdateShoppingListItemSchema.parse(input);
  assert.deepEqual(parsed, input);
});

test("ReorderItemsSchema deepEqual: two-uuid list round-trip", () => {
  const parsed = ReorderItemsSchema.parse({ orderedIds: [UUID, UUID2] });
  assert.deepEqual(parsed, { orderedIds: [UUID, UUID2] });
});

test("ReorderItemsSchema deepEqual: empty list round-trip", () => {
  const parsed = ReorderItemsSchema.parse({ orderedIds: [] });
  assert.deepEqual(parsed, { orderedIds: [] });
});

test("ShoppingListWithItemsSchema deepEqual: list with zero items round-trip", () => {
  const input = {
    id: UUID,
    name: "Groceries",
    status: "active" as const,
    note: null,
    createdAt: NOW,
    updatedAt: NOW,
    items: [],
  };
  const parsed = ShoppingListWithItemsSchema.parse(input);
  assert.deepEqual(parsed, {
    id: UUID,
    name: "Groceries",
    status: "active",
    note: null,
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    items: [],
  });
});

test("ShoppingListWithItemsSchema deepEqual: list with one item round-trip", () => {
  const input = {
    id: UUID,
    name: "Groceries",
    status: "active" as const,
    note: "Buy oats",
    createdAt: NOW,
    updatedAt: NOW,
    items: [
      {
        id: UUID2,
        listId: UUID,
        catalogItemId: null,
        rawText: "Milk",
        quantityBase: null,
        unit: null,
        status: "pending" as const,
        position: 0,
        createdAt: NOW,
        updatedAt: NOW,
      },
    ],
  };
  const parsed = ShoppingListWithItemsSchema.parse(input);
  assert.deepEqual(parsed, {
    id: UUID,
    name: "Groceries",
    status: "active",
    note: "Buy oats",
    createdAt: new Date(NOW),
    updatedAt: new Date(NOW),
    items: [
      {
        id: UUID2,
        listId: UUID,
        catalogItemId: null,
        rawText: "Milk",
        quantityBase: null,
        unit: null,
        status: "pending",
        position: 0,
        createdAt: new Date(NOW),
        updatedAt: new Date(NOW),
      },
    ],
  });
});

// ── .extend probe ─────────────────────────────────────────────────────────────

test("CatalogItemSchema is composable via .extend(): a refined schema with an extra field parses and rejects correctly", () => {
  assert.equal(typeof CatalogItemSchema.extend, "function", "CatalogItemSchema.extend must be a function");

  // Extend with one new required field.
  const ExtendedSchema = CatalogItemSchema.extend({
    internalCode: z.string().min(1),
  });

  // A row that includes the extra field must parse successfully.
  const acceptResult = ExtendedSchema.safeParse({
    id: UUID,
    canonicalName: "Rice",
    brand: null,
    categoryId: null,
    packQuantityBase: null,
    unit: null,
    createdAt: NOW,
    updatedAt: NOW,
    internalCode: "RICE-001",
  });
  assert.equal(acceptResult.success, true, "Extended schema must accept a row that includes the extra field");

  // A row missing the extra field must fail.
  const rejectResult = ExtendedSchema.safeParse({
    id: UUID,
    canonicalName: "Rice",
    brand: null,
    categoryId: null,
    packQuantityBase: null,
    unit: null,
    createdAt: NOW,
    updatedAt: NOW,
    // internalCode omitted
  });
  assert.equal(rejectResult.success, false, "Extended schema must reject a row missing the extra field");
});

// ── Task 9.3 — catalog CRUD schemas ──────────────────────────────────────────

test("DisplayUnitSchema accepts kg, g, litre, ml, piece and rejects invalid values", () => {
  assert.equal(DisplayUnitSchema.safeParse("kg").success, true);
  assert.equal(DisplayUnitSchema.safeParse("g").success, true);
  assert.equal(DisplayUnitSchema.safeParse("litre").success, true);
  assert.equal(DisplayUnitSchema.safeParse("ml").success, true);
  assert.equal(DisplayUnitSchema.safeParse("piece").success, true);
  assert.equal(DisplayUnitSchema.safeParse("liter").success, false);
  assert.equal(DisplayUnitSchema.safeParse("kilogram").success, false);
  assert.equal(DisplayUnitSchema.safeParse("").success, false);
});

test("CreateCatalogItemSchema accepts canonicalName only (all optionals default to null)", () => {
  const r = CreateCatalogItemSchema.safeParse({ canonicalName: "Atta" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.canonicalName, "Atta");
    assert.equal(r.data.brand, null);
    assert.equal(r.data.categoryId, null);
    assert.equal(r.data.packQuantityBase, null);
    assert.equal(r.data.unit, null);
  }
});

test("CreateCatalogItemSchema rejects blank canonicalName", () => {
  assert.equal(CreateCatalogItemSchema.safeParse({ canonicalName: "" }).success, false);
  assert.equal(CreateCatalogItemSchema.safeParse({ canonicalName: "   " }).success, false);
});

test("CreateCatalogItemSchema rejects canonicalName > 120 chars", () => {
  assert.equal(CreateCatalogItemSchema.safeParse({ canonicalName: "a".repeat(121) }).success, false);
});

test("CreateCatalogItemSchema enforces quantity/unit pairing", () => {
  // One-sided quantity → reject.
  assert.equal(
    CreateCatalogItemSchema.safeParse({ canonicalName: "Rice", packQuantityBase: 5000 }).success,
    false,
  );
  // One-sided unit → reject.
  assert.equal(
    CreateCatalogItemSchema.safeParse({ canonicalName: "Rice", unit: "g" }).success,
    false,
  );
  // Both set → accept.
  assert.equal(
    CreateCatalogItemSchema.safeParse({ canonicalName: "Rice", packQuantityBase: 5000, unit: "g" }).success,
    true,
  );
  // Both null → accept.
  assert.equal(
    CreateCatalogItemSchema.safeParse({ canonicalName: "Rice", packQuantityBase: null, unit: null }).success,
    true,
  );
});

test("UpdateCatalogItemSchema requires all five fields; omitting any is a 400", () => {
  const full = {
    canonicalName: "Atta",
    brand: null as string | null,
    categoryId: null as string | null,
    packQuantityBase: null as number | null,
    unit: null as string | null,
  };
  assert.equal(UpdateCatalogItemSchema.safeParse(full).success, true);
  // Missing brand → reject.
  const { brand: _b, ...noBrand } = full;
  assert.equal(UpdateCatalogItemSchema.safeParse(noBrand).success, false);
  // Missing categoryId → reject.
  const { categoryId: _c, ...noCat } = full;
  assert.equal(UpdateCatalogItemSchema.safeParse(noCat).success, false);
  // Missing packQuantityBase → reject.
  const { packQuantityBase: _q, ...noQty } = full;
  assert.equal(UpdateCatalogItemSchema.safeParse(noQty).success, false);
  // Missing unit → reject.
  const { unit: _u, ...noUnit } = full;
  assert.equal(UpdateCatalogItemSchema.safeParse(noUnit).success, false);
});

test("UpdateCatalogItemSchema enforces quantity/unit pairing", () => {
  const base = { canonicalName: "Atta", brand: null, categoryId: null };
  assert.equal(
    UpdateCatalogItemSchema.safeParse({ ...base, packQuantityBase: 5000, unit: null }).success,
    false,
  );
  assert.equal(
    UpdateCatalogItemSchema.safeParse({ ...base, packQuantityBase: null, unit: "g" }).success,
    false,
  );
  assert.equal(
    UpdateCatalogItemSchema.safeParse({ ...base, packQuantityBase: 5000, unit: "g" }).success,
    true,
  );
  assert.equal(
    UpdateCatalogItemSchema.safeParse({ ...base, packQuantityBase: null, unit: null }).success,
    true,
  );
});

test("CatalogMatchResultSchema discriminated union on status", () => {
  // matched
  const m = CatalogMatchResultSchema.safeParse({ status: "matched", catalogItemId: UUID });
  assert.equal(m.success, true);
  // ambiguous
  const a = CatalogMatchResultSchema.safeParse({ status: "ambiguous", candidateIds: [UUID, UUID2] });
  assert.equal(a.success, true);
  // none
  const n = CatalogMatchResultSchema.safeParse({ status: "none" });
  assert.equal(n.success, true);
  // missing catalogItemId for matched → reject
  assert.equal(CatalogMatchResultSchema.safeParse({ status: "matched" }).success, false);
  // unknown status → reject
  assert.equal(CatalogMatchResultSchema.safeParse({ status: "partial" }).success, false);
});

test("CanonicalizeItemResponseSchema accepts valid item + matched result", () => {
  const item = {
    id: UUID,
    listId: UUID,
    catalogItemId: UUID2,
    rawText: "Atta 5kg",
    quantityBase: null,
    unit: null,
    status: "pending" as const,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const r = CanonicalizeItemResponseSchema.safeParse({
    item,
    match: { status: "matched", catalogItemId: UUID2 },
  });
  assert.equal(r.success, true);
});

test("CanonicalizeItemResponseSchema accepts item + none result", () => {
  const item = {
    id: UUID,
    listId: UUID,
    catalogItemId: null,
    rawText: "Unknown item",
    quantityBase: null,
    unit: null,
    status: "pending" as const,
    position: 0,
    createdAt: NOW,
    updatedAt: NOW,
  };
  const r = CanonicalizeItemResponseSchema.safeParse({
    item,
    match: { status: "none" },
  });
  assert.equal(r.success, true);
});

// ── Task 9.3 deepEqual round-trips ───────────────────────────────────────────

test("CreateCatalogItemSchema deepEqual: canonicalName only — all optionals null", () => {
  const parsed = CreateCatalogItemSchema.parse({ canonicalName: "Whole Wheat Atta" });
  assert.deepEqual(parsed, {
    canonicalName: "Whole Wheat Atta",
    brand: null,
    categoryId: null,
    packQuantityBase: null,
    unit: null,
  });
});

test("CreateCatalogItemSchema deepEqual: full create round-trip with quantity", () => {
  const input = {
    canonicalName: "Brown Rice",
    brand: "India Gate",
    categoryId: UUID,
    packQuantityBase: 5000,
    unit: "g" as const,
  };
  const parsed = CreateCatalogItemSchema.parse(input);
  assert.deepEqual(parsed, input);
});

test("UpdateCatalogItemSchema deepEqual: full replace round-trip", () => {
  const input = {
    canonicalName: "Atta",
    brand: null,
    categoryId: null,
    packQuantityBase: null,
    unit: null,
  };
  const parsed = UpdateCatalogItemSchema.parse(input);
  assert.deepEqual(parsed, input);
});

test("UpdateCatalogItemSchema deepEqual: full replace with all fields set", () => {
  const input = {
    canonicalName: "Sunflower Oil",
    brand: "Saffola",
    categoryId: UUID,
    packQuantityBase: 1000,
    unit: "ml" as const,
  };
  const parsed = UpdateCatalogItemSchema.parse(input);
  assert.deepEqual(parsed, input);
});

test("CatalogMatchResultSchema deepEqual: matched round-trip", () => {
  const parsed = CatalogMatchResultSchema.parse({ status: "matched", catalogItemId: UUID });
  assert.deepEqual(parsed, { status: "matched", catalogItemId: UUID });
});

test("CatalogMatchResultSchema deepEqual: ambiguous round-trip", () => {
  const parsed = CatalogMatchResultSchema.parse({ status: "ambiguous", candidateIds: [UUID, UUID2] });
  assert.deepEqual(parsed, { status: "ambiguous", candidateIds: [UUID, UUID2] });
});

test("CatalogMatchResultSchema deepEqual: none round-trip", () => {
  const parsed = CatalogMatchResultSchema.parse({ status: "none" });
  assert.deepEqual(parsed, { status: "none" });
});

// ── Task 9.4 — paste-text capture schemas ────────────────────────────────────

test("ParsedShoppingItemSchema accepts rawText only (both quantity+unit null)", () => {
  const r = ParsedShoppingItemSchema.safeParse({ rawText: "Milk", quantityBase: null, unit: null });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.rawText, "Milk");
    assert.equal(r.data.quantityBase, null);
    assert.equal(r.data.unit, null);
  }
});

test("ParsedShoppingItemSchema accepts rawText + quantityBase + unit (all set)", () => {
  const r = ParsedShoppingItemSchema.safeParse({ rawText: "Atta", quantityBase: 2000, unit: "g" });
  assert.equal(r.success, true);
});

test("ParsedShoppingItemSchema rejects blank rawText", () => {
  assert.equal(
    ParsedShoppingItemSchema.safeParse({ rawText: "  ", quantityBase: null, unit: null }).success,
    false,
  );
});

test("ParsedShoppingItemSchema rejects rawText > 200 chars", () => {
  assert.equal(
    ParsedShoppingItemSchema.safeParse({ rawText: "a".repeat(201), quantityBase: null, unit: null }).success,
    false,
  );
});

test("ParsedShoppingItemSchema refine bites: quantity without unit is rejected", () => {
  assert.equal(
    ParsedShoppingItemSchema.safeParse({ rawText: "Rice", quantityBase: 500, unit: null }).success,
    false,
  );
});

test("ParsedShoppingItemSchema refine bites: unit without quantity is rejected", () => {
  assert.equal(
    ParsedShoppingItemSchema.safeParse({ rawText: "Rice", quantityBase: null, unit: "g" }).success,
    false,
  );
});

test("ParseListTextRequestSchema accepts text only (sourceKind defaults to freetext)", () => {
  const r = ParseListTextRequestSchema.safeParse({ text: "2kg atta, milk 1L, 6 eggs" });
  assert.equal(r.success, true);
  if (r.success) {
    assert.equal(r.data.text, "2kg atta, milk 1L, 6 eggs");
    assert.equal(r.data.sourceKind, "freetext");
  }
});

test("ParseListTextRequestSchema accepts sourceKind recipe", () => {
  const r = ParseListTextRequestSchema.safeParse({ text: "Pasta carbonara recipe…", sourceKind: "recipe" });
  assert.equal(r.success, true);
  if (r.success) assert.equal(r.data.sourceKind, "recipe");
});

test("ParseListTextRequestSchema rejects blank text", () => {
  assert.equal(ParseListTextRequestSchema.safeParse({ text: "  " }).success, false);
});

test("ParseListTextRequestSchema rejects text > 4000 chars", () => {
  assert.equal(ParseListTextRequestSchema.safeParse({ text: "a".repeat(4001) }).success, false);
});

test("ParseListTextRequestSchema rejects unknown sourceKind", () => {
  assert.equal(ParseListTextRequestSchema.safeParse({ text: "eggs", sourceKind: "photo" }).success, false);
});

test("ParseListTextResponseSchema deepEqual: available=true, one item, no message", () => {
  const item = { rawText: "Milk", quantityBase: 1000, unit: "ml" as const };
  const parsed = ParseListTextResponseSchema.parse({
    available: true,
    items: [item],
    rawInput: "milk 1L",
    message: null,
  });
  assert.deepEqual(parsed, {
    available: true,
    items: [{ rawText: "Milk", quantityBase: 1000, unit: "ml" }],
    rawInput: "milk 1L",
    message: null,
  });
});

test("ParseListTextResponseSchema deepEqual: available=false, empty items, message set", () => {
  const parsed = ParseListTextResponseSchema.parse({
    available: false,
    items: [],
    rawInput: "some text",
    message: "AI is not configured",
  });
  assert.deepEqual(parsed, {
    available: false,
    items: [],
    rawInput: "some text",
    message: "AI is not configured",
  });
});

test("ParseListTextResponseSchema rejects item with quantity-without-unit", () => {
  const r = ParseListTextResponseSchema.safeParse({
    available: true,
    items: [{ rawText: "Rice", quantityBase: 500, unit: null }],
    rawInput: "rice 500g",
    message: null,
  });
  assert.equal(r.success, false);
});

// ── AC5: AiEventKindSchema includes shopping_parse ────────────────────────────

test("AC5: AiEventKindSchema includes 'shopping_parse' (task 9.4 enum addition)", () => {
  const r = AiEventKindSchema.safeParse("shopping_parse");
  assert.equal(r.success, true, "AiEventKindSchema must accept 'shopping_parse'");
});

test("AC5: AiEventKindSchema enum values include shopping_parse", () => {
  assert.ok(
    AiEventKindSchema.options.includes("shopping_parse"),
    `Expected 'shopping_parse' in AiEventKindSchema.options; got: ${JSON.stringify(AiEventKindSchema.options)}`,
  );
});
