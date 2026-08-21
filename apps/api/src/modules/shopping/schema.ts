/**
 * shopping module — 8 resident tables + 5 resident enums for the Shopping
 * Intelligence pillar (task 9.1). The first domain built natively on the
 * Phase-1 module pattern rather than migrated onto it.
 *
 * Cross-domain FK targets are imported from their owning files — `users` from
 * `db/core-schema.ts`, `categories` from `db/shared/foundation.ts`. No
 * cross-module schema imports.
 *
 * Money is integer paise (`bigint`, mode "number") — never float rupees.
 *
 * Quantities are integers in ONE base unit per kind — grams for mass,
 * millilitres for volume, pieces for count — so unit-price comparison across
 * pack sizes ("is a 1kg pack cheaper per gram than 2x500g?") stays exact
 * integer arithmetic. A quantity is meaningless without its unit: the pairing
 * is enforced by a CHECK constraint per table (`*_quantity_unit_paired`) and
 * mirrored by a Zod refinement in `packages/shared/src/schemas/shopping.ts`,
 * so a quantity can never exist without its unit.
 *
 * CROSS-OWNER FOREIGN KEYS — unenforced, and a prerequisite for task 9.2.
 * A foreign key proves a row exists, not that the caller owns it (see the same
 * warning in `lib/ownership.ts`). The complete list of client-supplied foreign
 * keys in this module — all 8 are unenforced today:
 *   - `catalog_items.category_id` → could point at another user's category
 *   - `shopping_list_items.list_id` → could write a line into another user's list
 *   - `shopping_list_items.catalog_item_id` → could point at another user's catalog item
 *   - `price_observations.catalog_item_id` → could point at another user's catalog item
 *   - `price_observations.price_source_id` → could point at another user's price source
 *   - `pantry_items.catalog_item_id` → could point at another user's catalog item
 *   - `cart_drafts.price_source_id` → could point at another user's price source
 *   - `habit_profiles.catalog_item_id` → could point at another user's catalog item
 * That is
 * currently unreachable because task 9.1 adds no write paths, but it must be
 * closed before any write lands: a per-user backup exports children by `user_id`
 * (or via their list) and would omit a cross-owner parent, so the parent-first
 * restore would then fail its FK insert. Every client-supplied foreign key in
 * task 9.2 must go through an ownership guard in `lib/ownership.ts` (or a new
 * shopping equivalent), matching how every other domain validates writes.
 */

import { sql } from "drizzle-orm";
import {
  bigint,
  boolean,
  check,
  index,
  integer,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { users } from "../../db/core-schema.ts";
import { categories } from "../../db/shared/foundation.ts";

export const shoppingListStatus = pgEnum("shopping_list_status", ["active", "archived"]);

export const shoppingListItemStatus = pgEnum("shopping_list_item_status", [
  "pending",
  "bought",
  "dropped",
]);

/** Base units — one per measurement kind. Mass in g, volume in ml, count in pieces. */
export const normalizedUnit = pgEnum("normalized_unit", ["g", "ml", "piece"]);

export const priceSourceKind = pgEnum("price_source_kind", [
  "quick_commerce",
  "ecommerce",
  "local_store",
  "manual",
]);

export const cartDraftStatus = pgEnum("cart_draft_status", ["draft", "ordered", "abandoned"]);

/**
 * Canonical purchasable item, per user. Deliberately user-scoped rather than a
 * global curated catalog: Compass has no admin/owner-privileged data path (see
 * CLAUDE.md), and a per-user catalog keeps the per-user backup a complete
 * reconstruction. Canonicalization of raw text into these rows is task 9.3.
 */
export const catalogItems = pgTable(
  "catalog_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    canonicalName: text("canonical_name").notNull(),
    brand: text("brand"),
    /** optional link to the ledger category this item's spend books against */
    categoryId: uuid("category_id").references(() => categories.id, { onDelete: "set null" }),
    packQuantityBase: bigint("pack_quantity_base", { mode: "number" }),
    unit: normalizedUnit("unit"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("catalog_items_user_name_idx").on(t.userId, t.canonicalName),
    check("catalog_items_pack_quantity_nonneg", sql`"pack_quantity_base" IS NULL OR "pack_quantity_base" >= 0`),
    check("catalog_items_quantity_unit_paired", sql`("pack_quantity_base" IS NULL) = ("unit" IS NULL)`),
  ],
);

/** A shopping platform or store a price was observed on. */
export const priceSources = pgTable(
  "price_sources",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: priceSourceKind("kind").notNull(),
    url: text("url"),
    isActive: boolean("is_active").notNull().default(true),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("price_sources_user_name_idx").on(t.userId, t.name)],
);

export const shoppingLists = pgTable(
  "shopping_lists",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: shoppingListStatus("status").notNull().default("active"),
    note: text("note"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("shopping_lists_user_idx").on(t.userId)],
);

/**
 * A line on a list. `rawText` is what the user actually typed or pasted and is
 * retained verbatim even after `catalogItemId` resolves, so capture (9.4/9.5)
 * is never lossy and canonicalization stays re-runnable.
 *
 * No `user_id` of its own — scoped through `list_id` (see backup.ts LINKED_TABLES).
 */
export const shoppingListItems = pgTable(
  "shopping_list_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listId: uuid("list_id")
      .notNull()
      .references(() => shoppingLists.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id").references(() => catalogItems.id, {
      onDelete: "set null",
    }),
    rawText: text("raw_text").notNull(),
    quantityBase: bigint("quantity_base", { mode: "number" }),
    unit: normalizedUnit("unit"),
    status: shoppingListItemStatus("status").notNull().default("pending"),
    position: integer("position").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("shopping_list_items_list_idx").on(t.listId),
    check("shopping_list_items_quantity_nonneg", sql`"quantity_base" IS NULL OR "quantity_base" >= 0`),
    check("shopping_list_items_quantity_unit_paired", sql`("quantity_base" IS NULL) = ("unit" IS NULL)`),
    check("shopping_list_items_position_nonneg", sql`"position" >= 0`),
  ],
);

/** One price seen for one catalog item on one source at one instant. */
export const priceObservations = pgTable(
  "price_observations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    priceSourceId: uuid("price_source_id")
      .notNull()
      .references(() => priceSources.id, { onDelete: "cascade" }),
    pricePaise: bigint("price_paise", { mode: "number" }).notNull(),
    mrpPaise: bigint("mrp_paise", { mode: "number" }),
    /** pack size this price was for — may differ from the catalog item's default */
    packQuantityBase: bigint("pack_quantity_base", { mode: "number" }),
    unit: normalizedUnit("unit"),
    observedAt: timestamp("observed_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("price_observations_item_observed_idx").on(t.catalogItemId, t.observedAt),
    index("price_observations_user_idx").on(t.userId),
    check("price_observations_price_nonneg", sql`"price_paise" >= 0`),
    check("price_observations_mrp_nonneg", sql`"mrp_paise" IS NULL OR "mrp_paise" >= 0`),
    check("price_observations_pack_quantity_nonneg", sql`"pack_quantity_base" IS NULL OR "pack_quantity_base" >= 0`),
    check("price_observations_quantity_unit_paired", sql`("pack_quantity_base" IS NULL) = ("unit" IS NULL)`),
  ],
);

/**
 * What the household currently has on hand. Household-scoped in the product
 * sense — a household consumes as one unit — but physically `user_id`-owned and
 * read through `withSharing()` (`lib/sharing.ts`), which is the single guard for
 * owned-or-shared-to-me visibility. A later pass adds the read services.
 */
export const pantryItems = pgTable(
  "pantry_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    quantityBase: bigint("quantity_base", { mode: "number" }),
    unit: normalizedUnit("unit"),
    lastPurchasedAt: timestamp("last_purchased_at", { withTimezone: true }),
    expectedDepletionAt: timestamp("expected_depletion_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("pantry_items_user_item_idx").on(t.userId, t.catalogItemId),
    check("pantry_items_quantity_nonneg", sql`"quantity_base" IS NULL OR "quantity_base" >= 0`),
    check("pantry_items_quantity_unit_paired", sql`("quantity_base" IS NULL) = ("unit" IS NULL)`),
  ],
);

/** Header for a predicted cart (task 11.2 adds the lines). */
export const cartDrafts = pgTable(
  "cart_drafts",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    status: cartDraftStatus("status").notNull().default("draft"),
    priceSourceId: uuid("price_source_id").references(() => priceSources.id, {
      onDelete: "set null",
    }),
    totalPaise: bigint("total_paise", { mode: "number" }).notNull().default(0),
    generatedAt: timestamp("generated_at", { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("cart_drafts_user_idx").on(t.userId),
    check("cart_drafts_total_nonneg", sql`"total_paise" >= 0`),
  ],
);

/**
 * Learned consumption rate per catalog item (task 11.1 computes it).
 * `consumptionBasePerMonth` is an integer count of base units per 30-day month
 * — an integer rate, so no float creeps into replenishment math.
 *
 * Household-scoped in the same sense as `pantryItems`: read through
 * `withSharing()`, not raw `user_id`.
 */
export const habitProfiles = pgTable(
  "habit_profiles",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    catalogItemId: uuid("catalog_item_id")
      .notNull()
      .references(() => catalogItems.id, { onDelete: "cascade" }),
    consumptionBasePerMonth: bigint("consumption_base_per_month", { mode: "number" }),
    unit: normalizedUnit("unit"),
    observationCount: integer("observation_count").notNull().default(0),
    lastComputedAt: timestamp("last_computed_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex("habit_profiles_user_item_idx").on(t.userId, t.catalogItemId),
    check("habit_profiles_consumption_nonneg", sql`"consumption_base_per_month" IS NULL OR "consumption_base_per_month" >= 0`),
    check("habit_profiles_consumption_unit_paired", sql`("consumption_base_per_month" IS NULL) = ("unit" IS NULL)`),
    check("habit_profiles_observation_count_nonneg", sql`"observation_count" >= 0`),
  ],
);
