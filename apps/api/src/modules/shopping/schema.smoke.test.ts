import { test } from "node:test";
import assert from "node:assert/strict";
import { getTableName, getTableColumns } from "drizzle-orm";
import { getTableConfig } from "drizzle-orm/pg-core";
import {
  catalogItems,
  priceSources,
  shoppingLists,
  shoppingListItems,
  priceObservations,
  pantryItems,
  cartDrafts,
  habitProfiles,
  shoppingListStatus,
  shoppingListItemStatus,
  normalizedUnit,
  priceSourceKind,
  cartDraftStatus,
} from "./schema.ts";

// ── 1. Table name assertions ─────────────────────────────────────────────────

test("all 8 shopping tables resolve to the expected Postgres names", () => {
  assert.equal(getTableName(catalogItems), "catalog_items");
  assert.equal(getTableName(priceSources), "price_sources");
  assert.equal(getTableName(shoppingLists), "shopping_lists");
  assert.equal(getTableName(shoppingListItems), "shopping_list_items");
  assert.equal(getTableName(priceObservations), "price_observations");
  assert.equal(getTableName(pantryItems), "pantry_items");
  assert.equal(getTableName(cartDrafts), "cart_drafts");
  assert.equal(getTableName(habitProfiles), "habit_profiles");
});

// ── 2. Every _paise column has Drizzle columnType PgBigInt53 ─────────────────

test("every _paise column across all 8 tables has columnType PgBigInt53", () => {
  const allTables = [
    catalogItems,
    priceSources,
    shoppingLists,
    shoppingListItems,
    priceObservations,
    pantryItems,
    cartDrafts,
    habitProfiles,
  ];

  const paiseColumns: Array<{ table: string; col: string; type: string }> = [];
  for (const table of allTables) {
    const tableName = getTableName(table);
    const cols = getTableColumns(table);
    for (const [, col] of Object.entries(cols)) {
      if (col.name.endsWith("_paise")) {
        paiseColumns.push({ table: tableName, col: col.name, type: col.columnType });
      }
    }
  }

  // Verify we found paise columns (guards against the loop being vacuous)
  assert.ok(paiseColumns.length > 0, "expected to find at least one _paise column across the 8 tables");

  for (const { table, col, type } of paiseColumns) {
    assert.equal(
      type,
      "PgBigInt53",
      `${table}.${col} must be PgBigInt53 (integer paise), got ${type}`,
    );
  }
});

// ── 3. shopping_list_items has no user_id; all others do ─────────────────────

test("shopping_list_items has no user_id column; the other 7 tables all have user_id", () => {
  const listItemCols = getTableColumns(shoppingListItems);
  assert.equal(
    "userId" in listItemCols,
    false,
    "shopping_list_items must not have a userId/user_id column (parent-scoped)",
  );

  const tablesWithUserId = [
    catalogItems,
    priceSources,
    shoppingLists,
    priceObservations,
    pantryItems,
    cartDrafts,
    habitProfiles,
  ];
  for (const table of tablesWithUserId) {
    const cols = getTableColumns(table);
    assert.ok(
      "userId" in cols,
      `${getTableName(table)} must have a userId (user_id) column`,
    );
  }
});

// ── 4. Enum enumValues ───────────────────────────────────────────────────────

test("shoppingListStatus has exactly ['active', 'archived']", () => {
  assert.deepEqual(shoppingListStatus.enumValues, ["active", "archived"]);
});

test("shoppingListItemStatus has exactly ['pending', 'bought', 'dropped']", () => {
  assert.deepEqual(shoppingListItemStatus.enumValues, ["pending", "bought", "dropped"]);
});

test("normalizedUnit has exactly ['g', 'ml', 'piece']", () => {
  assert.deepEqual(normalizedUnit.enumValues, ["g", "ml", "piece"]);
});

test("priceSourceKind has exactly ['quick_commerce', 'ecommerce', 'local_store', 'manual']", () => {
  assert.deepEqual(priceSourceKind.enumValues, ["quick_commerce", "ecommerce", "local_store", "manual"]);
});

test("cartDraftStatus has exactly ['draft', 'ordered', 'abandoned']", () => {
  assert.deepEqual(cartDraftStatus.enumValues, ["draft", "ordered", "abandoned"]);
});

// ── 5. Every quantity-bearing table has a paired unit column ──────────────────

test("habit_profiles has a unit column (no quantity-bearing table is missing its unit)", () => {
  const cols = getTableColumns(habitProfiles);
  assert.ok("unit" in cols, "habit_profiles must have a unit column");
});

test("every table carrying a quantity or consumption column also has a unit column", () => {
  const allTables: Array<[string, ReturnType<typeof getTableColumns>]> = [
    ["catalog_items", getTableColumns(catalogItems)],
    ["price_sources", getTableColumns(priceSources)],
    ["shopping_lists", getTableColumns(shoppingLists)],
    ["shopping_list_items", getTableColumns(shoppingListItems)],
    ["price_observations", getTableColumns(priceObservations)],
    ["pantry_items", getTableColumns(pantryItems)],
    ["cart_drafts", getTableColumns(cartDrafts)],
    ["habit_profiles", getTableColumns(habitProfiles)],
  ];

  // A column carries a quantity if its DB name ends with _quantity_base or
  // equals consumption_base_per_month. Every such table must also expose a unit column.
  const quantityPattern = /(?:^|_)quantity_base$|^consumption_base_per_month$/;

  for (const [tableName, cols] of allTables) {
    const hasQuantityCol = Object.values(cols).some((col) => quantityPattern.test(col.name));
    if (!hasQuantityCol) continue;

    assert.ok(
      "unit" in cols,
      `${tableName} has a quantity column but is missing a paired unit column`,
    );
  }
});

// ── 6. CHECK constraints exist on the Drizzle schema objects ─────────────────

test("catalog_items has exactly the expected CHECK constraints", () => {
  const checks = getTableConfig(catalogItems).checks.map((c) => c.name).sort();
  assert.deepEqual(checks, [
    "catalog_items_pack_quantity_nonneg",
    "catalog_items_quantity_unit_paired",
  ]);
});

test("shopping_list_items has exactly the expected CHECK constraints", () => {
  const checks = getTableConfig(shoppingListItems).checks.map((c) => c.name).sort();
  assert.deepEqual(checks, [
    "shopping_list_items_position_nonneg",
    "shopping_list_items_quantity_nonneg",
    "shopping_list_items_quantity_unit_paired",
  ]);
});

test("price_observations has exactly the expected CHECK constraints", () => {
  const checks = getTableConfig(priceObservations).checks.map((c) => c.name).sort();
  assert.deepEqual(checks, [
    "price_observations_mrp_nonneg",
    "price_observations_pack_quantity_nonneg",
    "price_observations_price_nonneg",
    "price_observations_quantity_unit_paired",
  ]);
});

test("pantry_items has exactly the expected CHECK constraints", () => {
  const checks = getTableConfig(pantryItems).checks.map((c) => c.name).sort();
  assert.deepEqual(checks, [
    "pantry_items_quantity_nonneg",
    "pantry_items_quantity_unit_paired",
  ]);
});

test("cart_drafts has exactly the expected CHECK constraints", () => {
  const checks = getTableConfig(cartDrafts).checks.map((c) => c.name).sort();
  assert.deepEqual(checks, ["cart_drafts_total_nonneg"]);
});

test("habit_profiles has exactly the expected CHECK constraints", () => {
  const checks = getTableConfig(habitProfiles).checks.map((c) => c.name).sort();
  assert.deepEqual(checks, [
    "habit_profiles_consumption_nonneg",
    "habit_profiles_consumption_unit_paired",
    "habit_profiles_observation_count_nonneg",
  ]);
});

test("shopping_lists has exactly zero CHECK constraints", () => {
  const checks = getTableConfig(shoppingLists).checks;
  assert.equal(checks.length, 0, "shopping_lists must have no CHECK constraints");
});

test("price_sources has exactly zero CHECK constraints", () => {
  const checks = getTableConfig(priceSources).checks;
  assert.equal(checks.length, 0, "price_sources must have no CHECK constraints");
});
