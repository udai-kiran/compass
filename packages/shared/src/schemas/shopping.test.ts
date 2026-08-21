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
} from "./shopping.ts";

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
