# Task 9.3 — Catalog Canonicalization + Unit Normalization: Investigation

Date: 2026-08-21  
Investigator: implementation worker (read-only pass)

---

## 1. Shopping schema (`apps/api/src/modules/shopping/schema.ts`)

### pgEnums (lines 58–76)

```ts
// line 58
export const shoppingListStatus = pgEnum("shopping_list_status", ["active", "archived"]);

// line 60–64
export const shoppingListItemStatus = pgEnum("shopping_list_item_status", [
  "pending",
  "bought",
  "dropped",
]);

// line 67
/** Base units — one per measurement kind. Mass in g, volume in ml, count in pieces. */
export const normalizedUnit = pgEnum("normalized_unit", ["g", "ml", "piece"]);

// line 69–74
export const priceSourceKind = pgEnum("price_source_kind", [
  "quick_commerce",
  "ecommerce",
  "local_store",
  "manual",
]);

// line 76
export const cartDraftStatus = pgEnum("cart_draft_status", ["draft", "ordered", "abandoned"]);
```

### `catalogItems` table (lines 84–105)

```ts
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
```

Key facts:
- `canonicalName` is `text NOT NULL`. A unique index `(user_id, canonical_name)` prevents duplicate catalog entries per user.
- `brand` is `text` nullable — no NOT NULL.
- `categoryId` is nullable UUID FK → `categories.id` (set null on delete). **Unenforced cross-owner** per schema comment line 24.
- `packQuantityBase` is `bigint(mode:"number")` nullable — quantity in base units (g/ml/piece).
- `unit` is `normalizedUnit` nullable — paired with `packQuantityBase` by CHECK constraint.
- CHECK `catalog_items_quantity_unit_paired`: `(packQuantityBase IS NULL) = (unit IS NULL)` — quantity and unit must both be null or both non-null.
- No `brand`-level uniqueness — two items can share a brand; canonical uniqueness is name-only.

### `shoppingListItems` table (lines 148–172)

```ts
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
```

Key facts:
- No `user_id` of its own — scoped through `list_id` (schema comment line 146). In backup, it is a `LINKED_TABLE`.
- `rawText` is `text NOT NULL` — verbatim user input, always retained even after `catalogItemId` resolves.
- `catalogItemId` is nullable UUID FK → `catalogItems.id` (set null on delete). **Unenforced cross-owner** (schema comment line 25).
- `quantityBase` / `unit` paired by CHECK, same pattern as `catalogItems`.
- `position` is `integer NOT NULL DEFAULT 0`, with nonneg CHECK.

### Other tables with `unit` column

All five other shopping tables (`priceObservations`, `pantryItems`, `cartDrafts`, `habitProfiles`, `priceSources`) use the same `normalizedUnit` enum in quantity/unit pairing columns. Money fields (`pricePaise`, `mrpPaise`, `totalPaise`) are `bigint(mode:"number") NOT NULL` with nonneg CHECKs.

---

## 2. Shared shopping contracts (`packages/shared/src/schemas/shopping.ts`)

### Enums exported (lines 32–48)

```ts
export const NormalizedUnitSchema = z.enum(["g", "ml", "piece"]);
export type NormalizedUnit = z.infer<typeof NormalizedUnitSchema>;

export const UnitKindSchema = z.enum(["mass", "volume", "count"]);
export type UnitKind = z.infer<typeof UnitKindSchema>;

export const ShoppingListStatusSchema = z.enum(["active", "archived"]);
export const ShoppingListItemStatusSchema = z.enum(["pending", "bought", "dropped"]);
export const PriceSourceKindSchema = z.enum(["quick_commerce", "ecommerce", "local_store", "manual"]);
export const CartDraftStatusSchema = z.enum(["draft", "ordered", "abandoned"]);
```

**`NormalizedUnitSchema` values: `"g"`, `"ml"`, `"piece"` — exactly 3.** The test at `shopping.test.ts:25–30` confirms `"kg"` and `"litre"` are rejected.

### Entity schemas exported (lines 51–170)

- `NormalizedUnitInfoSchema` — `{ unit, kind, label }` (line 51)
- `ShoppingUnitsResponseSchema` — `{ units: NormalizedUnitInfo[] }` (line 58)
- `CatalogItemSchema` — with paired refinement on `packQuantityBase`/`unit` (line 63)
- `PriceSourceSchema` (line 78)
- `ShoppingListSchema` (line 89)
- `ShoppingListItemSchema` — with paired refinement on `quantityBase`/`unit` (line 99)
- `PriceObservationSchema` — with paired refinement (line 116)
- `PantryItemSchema` — with paired refinement (line 132)
- `CartDraftSchema` (line 147)
- `HabitProfileSchema` — with paired refinement on `consumptionBasePerMonth`/`unit` (line 158)

### CRUD contracts exported (lines 173–244)

- `CreateShoppingListSchema` — `{ name: string(1–120 trimmed), note: string(max 1000) | null }` (line 176)
- `UpdateShoppingListSchema` — PUT, all required, no defaults (line 188)
- `CreateShoppingListItemSchema` — `{ rawText, catalogItemId?, quantityBase?, unit? }` with paired refinement (line 196)
- `UpdateShoppingListItemSchema` — PUT, all required (line 215)
- `ReorderItemsSchema` — `{ orderedIds: uuid[] }`, no-duplicate refinement (line 232)
- `ShoppingListWithItemsSchema` — `ShoppingListSchema` extended with `items: ShoppingListItem[]` (line 241)

**No `CreateCatalogItemSchema`, `UpdateCatalogItemSchema`, or any catalog write schema exists yet** — the catalog is read-only from shared contracts as of 9.1/9.2. Task 9.3 must add these.

---

## 3. `packages/shared/src/money.ts` — Exported functions (full file, lines 1–47)

```ts
export const SafePaiseSchema = z.number().int().refine(Number.isSafeInteger, "...");

export function rupeesToPaise(rupees: number): number   // line 14
export function paiseToRupees(paise: number): number    // line 18
export function formatINR(paise: number): string        // line 27
export function standardEmiPaise(
  principalPaise: number,
  annualRateBps: number,
  installments: number,
): number                                               // line 36
```

There are **no unit-related helpers** in `money.ts`. The file contains only monetary (paise) conversion and formatting helpers. No `baseToDisplay`, `displayToBase`, `kg_to_g`, `L_to_ml`, or similar unit-conversion functions exist anywhere in `packages/shared/src/`.

For task 9.3, `unitPricePaise` (price per base unit) would need to be added or derived inline. Since it is just `pricePaise / packQuantityBase` (integer division, keeping paise), there is no existing helper for it. If the coordinator wants a shared helper it must be added to `packages/shared/src/money.ts` or a new `packages/shared/src/units.ts`.

---

## 4. Extractor match discipline (`apps/extractor/src/extract.ts`)

### `matchAccount` (lines 252–276)

```ts
/**
 *      debit-card last-4 (the strong signal); if two accounts share a last-4, the
 *      bank named in the hint breaks the tie;
 *   2. failing that, fall back to a run appearing in exactly one account name
 *      (covers accounts whose last-4 was typed into the label, not the field).
 * Only a unique hit wins — a wrong guess never silently mis-assigns. Null
 * otherwise; the reviewer picks the account on accept.
 */
export function matchAccount(hint: string, accounts: AccountRef[]): string | null {
  const digits = hint.match(/\d{3,4}/g);
  if (!digits || digits.length === 0) return null;
  const lower = hint.toLowerCase();
  for (const run of digits) {
    const hits = accounts.filter(
      (a) => a.accountLast4 === run || a.debitCardLast4 === run,
    );
    if (hits.length === 1) return hits[0]!.id;
    if (hits.length > 1) {
      const byBank = hits.filter(
        (a) => a.institution && lower.includes(a.institution.toLowerCase()),
      );
      if (byBank.length === 1) return byBank[0]!.id;
    }
  }
  for (const run of digits) {
    const hits = accounts.filter((a) => a.name.includes(run));
    if (hits.length === 1) return hits[0]!.id;
  }
  return null;
}
```

### `matchCategory` (lines 278–297)

```ts
/**
 * ... No match → null, and the reviewer picks it. Never creates a
 * category; it only points at an existing one.
 */
export function matchCategory(
  label: string,
  direction: TxnDirection,
  categories: CategoryRef[],
): string | null {
  const want = label.trim().toLowerCase();
  if (!want) return null;
  const kind = direction === "credit" ? "income" : "expense";
  const hit = categories.find(
    (c) => c.kind === kind && c.name.trim().toLowerCase() === want,
  );
  return hit ? hit.id : null;
}
```

**Match discipline summary:**
- `matchAccount`: only a **unique** digit-run hit wins. Two hits with the same last-4 require a further bank-name signal; if still ambiguous → `null`. Never guesses.
- `matchCategory`: **verbatim name** (case-insensitive, trimmed), correct kind only. No fuzzy match. No hit → `null`. Never creates.
- Both return `null` on ambiguity/no-match; the reviewer resolves manually.

**For task 9.3 catalog matching**, the pattern to mirror: given a raw text string, look it up by `canonicalName` case-insensitively within the user's catalog. Unique hit → return the `catalogItems.id`. Multiple or zero hits → return `null` (reviewer / new-entry path). Never auto-create or auto-guess. The `uniqueIndex("catalog_items_user_name_idx").on(t.userId, t.canonicalName)` at the DB level ensures a canonical name is unique per user, so a case-insensitive exact match will always be unique-or-zero at the DB level.

---

## 5. Existing shopping services and routes — signatures

### Services (`apps/api/src/modules/shopping/services/`)

**`lists.ts`** — exports (lines 71–343):
```ts
export async function createList(db: Db, userId: string, input: CreateShoppingList): Promise<ShoppingList>
export async function listLists(db: Db, userId: string, statusFilter?: "active" | "archived"): Promise<ShoppingList[]>
export async function getList(db: Db, userId: string, listId: string): Promise<ShoppingListWithItems>
export async function updateList(db: Db, userId: string, listId: string, input: UpdateShoppingList): Promise<ShoppingList>
export async function deleteList(db: Db, userId: string, listId: string): Promise<void>
export async function addItem(db: Db, userId: string, listId: string, input: CreateShoppingListItem): Promise<ShoppingListWithItems>
export async function updateItem(db: Db, userId: string, listId: string, itemId: string, input: UpdateShoppingListItem): Promise<ShoppingListWithItems>
export async function deleteItem(db: Db, userId: string, listId: string, itemId: string): Promise<ShoppingListWithItems>
export async function reorderItems(db: Db, userId: string, listId: string, input: ReorderItems): Promise<ShoppingListWithItems>
```

**`ownership.ts`** — exports (lines 26–77):
```ts
export async function assertOwnedList(db: DbOrTx, userId: string, listId: string): Promise<void>
export async function assertOwnedCatalogItem(db: DbOrTx, userId: string, catalogItemId: string | null | undefined): Promise<void>
export async function assertOwnedListItem(db: DbOrTx, userId: string, listId: string, itemId: string): Promise<void>
```
All throw `HttpError(404)` on cross-owner or missing row.

**`units.ts`** — exports (lines 12–16):
```ts
export const NORMALIZED_UNITS: readonly NormalizedUnitInfo[] = [
  { unit: "g", kind: "mass", label: "gram" },
  { unit: "ml", kind: "volume", label: "millilitre" },
  { unit: "piece", kind: "count", label: "piece" },
];
```

**`pantry.ts`** — exports (lines 29–33, stubs only):
```ts
export function pantryItemsForUser(db: DbOrTx, userId: string)   // returns select query builder
export function habitProfilesForUser(db: DbOrTx, userId: string) // returns select query builder
```
(Read-only; no write path yet.)

### Routes (`apps/api/src/modules/shopping/routes/`)

**`lists.ts`** — registers all CRUD + reorder endpoints under `/api/shopping/lists`. Imports from `@compass/shared` schemas and `services/lists.ts`. Top of file: lines 1–40.

**`units.ts`** — `GET /api/shopping/units` returning `ShoppingUnitsResponseSchema`. Function signature:
```ts
export async function shoppingUnitRoutes(app: FastifyInstance): Promise<void>
```

---

## 6. Backup coverage (`apps/api/src/modules/system/services/backup.ts`)

### `ALL_TABLES` (lines 32–49) — shopping tables present at line 47–48:

```ts
export const ALL_TABLES = [
  // ... (other tables) ...
  "catalog_items", "price_sources", "shopping_lists", "shopping_list_items",
  "price_observations", "pantry_items", "cart_drafts", "habit_profiles",
] as const;
```

All 8 shopping tables from task 9.1 are listed. ✓

### `USER_TABLES` (line 71):
```ts
catalog_items: "user_id", price_sources: "user_id", shopping_lists: "user_id",
price_observations: "user_id", pantry_items: "user_id", cart_drafts: "user_id",
habit_profiles: "user_id",
```
Seven of eight are in `USER_TABLES` (scoped by `user_id`). ✓

### `LINKED_TABLES` (line 92):
```ts
shopping_list_items: { fk: "list_id", parent: "shopping_lists" },
```
`shopping_list_items` is in `LINKED_TABLES` (no direct `user_id`; scoped through `shopping_lists`). ✓

**Conclusion:** All 8 shopping tables are covered in backup. Task 9.3 adds **no new tables**, so backup coverage needs no update.

---

## 7. Unit enum values and unit-conversion/normalization code

### Exact enum values

Postgres enum `normalized_unit` (schema.ts:67): `["g", "ml", "piece"]`  
Zod `NormalizedUnitSchema` (shopping.ts:32): `z.enum(["g", "ml", "piece"])`  
`NORMALIZED_UNITS` array (units.ts:12–16): `g → mass/gram`, `ml → volume/millilitre`, `piece → count/piece`

### Unit-conversion code: does not exist

A thorough search of the repo finds:
- No `kg → g` (×1000) conversion helper anywhere.
- No `L/litre → ml` (×1000) conversion helper.
- No `toBase`, `fromBase`, `displayToBase`, `baseToDisplay`, or similar functions.
- The shopping test (`packages/shared/src/schemas/shopping.test.ts:25–30`) explicitly confirms `"kg"` and `"litre"` are **rejected** by `NormalizedUnitSchema`.
- The schema comment (schema.ts:12–14) documents the design decision: **quantities are stored only in base units** (grams, millilitres, pieces). There is no "display unit" layer in the DB or service code; conversion from user-supplied non-base units (e.g. "2 kg" → 2000 g) will need to be implemented in task 9.3 as new code.

**Implication for task 9.3:** The canonicalization service will need to:
1. Parse the user's raw text unit (e.g. "kg", "litre", "L", "kilo") into a display unit.
2. Multiply the display quantity by the appropriate factor (kg×1000→g, L×1000→ml) to produce a `quantityBase` in the normalized unit.
3. There is no existing repo utility for this — it must be written fresh, likely in `apps/api/src/modules/shopping/services/canonicalize.ts` (new file for task 9.3) or a shared helper if the coordinator decides it belongs in `packages/shared`.

---

## Files inspected

- `/work/personal/compass/apps/api/src/modules/shopping/schema.ts`
- `/work/personal/compass/packages/shared/src/schemas/shopping.ts`
- `/work/personal/compass/packages/shared/src/money.ts`
- `/work/personal/compass/apps/extractor/src/extract.ts` (lines 248–297)
- `/work/personal/compass/apps/api/src/modules/shopping/services/lists.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/services/ownership.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/services/units.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/services/pantry.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/routes/lists.ts`
- `/work/personal/compass/apps/api/src/modules/shopping/routes/units.ts`
- `/work/personal/compass/apps/api/src/modules/system/services/backup.ts` (lines 32–101)
- `/work/personal/compass/packages/shared/src/schemas/shopping.test.ts` (grep)

## Files changed

None (investigate brief — read-only).
