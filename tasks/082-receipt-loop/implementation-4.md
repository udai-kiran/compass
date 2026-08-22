# Implementation Report — Iteration 7 (Review-7 F4b/F5b/F6b/F9)

## Files inspected
- `tasks/082-receipt-loop/TASK.md` (Review-7 section)
- `tasks/082-receipt-loop/DELEGATION.md` (Iteration 7)
- `apps/api/src/modules/shopping/routes/receipts.ts`
- `apps/api/src/modules/shopping/services/receipt-confirm.ts`
- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` (reference only)
- `apps/api/src/modules/shopping/services/pantry-management.ts` (replenishPantry signature)
- `apps/api/src/modules/shopping/services/ownership.ts` (assertOwnedCatalogItem signature)
- `apps/api/src/modules/shopping/schema.ts` (receipts columns — confirmed no updatedAt)
- `packages/shared/src/schemas/shopping.ts`
- `apps/api/src/db/index.ts` (DbOrTx type)

## Files changed
- `packages/shared/src/schemas/shopping.ts` — F5b
- `apps/api/src/modules/shopping/routes/receipts.ts` — F4b, F9
- `apps/api/src/modules/shopping/services/receipt-confirm.ts` — F6b

## Implementation details

### F5b — UpdateReceiptLineSchema null/non-null mismatch
Replaced the single `(d.quantityBase !== undefined) === (d.unit !== undefined)` refinement
with a three-branch refinement: both absent → ok; both present → also check
`(d.quantityBase === null) === (d.unit === null)`; one present/one absent → fail.
Now rejects `{quantityBase:1, unit:null}` and `{quantityBase:null, unit:"g"}`.

### F4b — Atomic delete guard
Replaced the read-then-unconditional-delete pattern with:
1. `findFirst` (id+userId only) → 404 if not found, captures storedPath.
2. `DELETE WHERE id AND userId AND ne(status, 'confirmed') RETURNING id, storedPath`.
3. `deleted.length === 0` after existence confirmed → 409.
No concurrent confirm can slip between the existence check and DELETE — even if it does,
the DELETE predicate catches it and returns 0 rows.

### F9 — Line CRUD transactional claim
- Added `ne`, `sql` to drizzle-orm imports; added `DbOrTx` type import.
- `recomputeTotal` signature changed from `(app: FastifyInstance, receiptId)` to
  `(db: DbOrTx, receiptId)`. Added `AND ne(status, 'confirmed')` on the receipts UPDATE
  with a `.returning()` check — 0 rows throws HttpError(409).
- `loadReceiptWithLines` signature changed from `(app: FastifyInstance, ...)` to
  `(db: DbOrTx, ...)`. GET route callers pass `app.db`; transaction callers pass `tx`.
- All three line-mutation handlers (POST/PUT/DELETE lines) now wrap their logic in
  `app.db.transaction(async (tx) => {...})`.
- At the start of each transaction: `UPDATE receipts SET parsedAt = sql\`"parsed_at"\`
  WHERE id AND userId AND ne(status, 'confirmed') RETURNING id`.
  `sql\`"parsed_at"\`` is a self-referential no-op that takes an exclusive row lock
  without modifying any business column. The receipts table has no `updatedAt` column.
- 0 rows from claim: secondary `findFirst` to distinguish 404 (missing) from 409 (confirmed).
- All subsequent DB ops (line read, insert/update/delete, recomputeTotal, loadReceiptWithLines)
  use `tx`, not `app.db`, to see uncommitted writes within the transaction.
- F3 ownership checks (`assertOwnedCatalogItem`) also use `tx`.

### F6b — Mixed-unit confirm must not abort
- Changed catalog query in Step 6 to also fetch `unit` column alongside `canonicalName`.
- Declared `catalogInfoMap: Map<string, {canonicalName, unit}>` at broader scope so Step 7
  can access it.
- Kept ALL aggregates inserted as `shopping_list_items` (rate-learning observations).
- New Step 7: builds `itemsByCatalogId: Map<catalogItemId, AggregatedItem[]>` then
  `pantryChoiceMap: Map<catalogItemId, AggregatedItem>`:
    - If `catalog.unit` is set: pick only the aggregate whose `unit === catalog.unit`.
      If no matching aggregate exists, skip pantry for that item (no 400).
    - If `catalog.unit` is null: pick first aggregate (stable insertion order).
- Calls `replenishPantry` only for entries in `pantryChoiceMap`. Mixed-unit receipts
  (same catalogItemId, different units) create two shopping_list_items but only one
  pantry replenishment, preventing the unit-mismatch 400 that was aborting confirm.

## Commands run (exact)

```
npm run typecheck
npm run lint
npm run test -w packages/shared
node --test apps/api/src/modules/shopping/services/receipt-reconcile.test.ts apps/api/src/modules/shopping/services/receipt-confirm.test.ts
```

## Results

### typecheck
Exit 0. No errors across all 6 workspaces.

### lint
Exit 0. No warnings.

### test -w packages/shared
351 pass, 0 fail, 0 skip. Exit 0.

### node --test receipt-reconcile + receipt-confirm
24 pass, 0 fail, 0 skip. Exit 0.

## Assumptions
- `sql\`"parsed_at"\`` in a Drizzle `.set()` call generates `SET "parsed_at" = "parsed_at"`,
  which is a valid no-op UPDATE that acquires an exclusive row lock in Postgres (typecheck
  confirmed this is accepted by Drizzle's type system).
- The `receipts` table has no `updatedAt` column (confirmed from schema.ts lines 377–408).
- Postgres UPDATE takes an exclusive row lock even when the set value equals the existing
  value, so the no-op claim is a true lock.

## Unresolved risks
- None for these four fixes. Pre-existing: no DB in CI so no integration-level race
  condition verification (accepted per TASK.md M1).
