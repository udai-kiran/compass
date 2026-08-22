# Implementation Report — Task 082 Codex Review-6 Fix Pass (Iteration 3)

## Files Inspected
- `apps/api/src/modules/shopping/routes/receipts.ts` (untracked, new file from Iter 1)
- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` (untracked, new file from Iter 1)
- `apps/api/src/modules/shopping/services/receipt-confirm.ts` (untracked, new file from Iter 1)
- `apps/api/src/modules/shopping/schema.ts` (tracked, modified by Iter 1)
- `packages/shared/src/schemas/shopping.ts` (tracked, modified by Iter 1)
- `apps/api/src/modules/shopping/services/ownership.ts` (read for existing patterns)
- `apps/api/src/modules/system/routes/backup.ts` (read for multipart field reading pattern)

## Files Changed
- `apps/api/src/modules/shopping/routes/receipts.ts` — F1, F3, F4
- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` — F2
- `apps/api/src/modules/shopping/services/receipt-confirm.ts` — F6, F8
- `apps/api/src/modules/shopping/schema.ts` — F7
- `packages/shared/src/schemas/shopping.ts` — F5

## Implementation Details

### F1: cartDraftId multipart field reading (receipts.ts ~line 190)
Replaced `(req.body as Record<string, unknown> | undefined)?.cartDraftId` with reading from `file.fields.cartDraftId`. Used the same pattern as `backup.ts` (`"value" in rawCartDraftIdField ? rawCartDraftIdField.value : undefined`). Added `z.uuid().safeParse()` for UUID validation with 400 error on invalid format. Added `assertOwnedDraft(app.db, userId, cartDraftId)` call when the field is present. Imported `assertOwnedDraft` and `assertOwnedCatalogItem` from `../services/ownership.ts`.

### F2: Reconciliation race condition (receipt-reconcile.ts ~line 337)
Added `ne` to drizzle-orm imports. Changed the final unconditional `UPDATE receipts SET status='reconciled'` to include `.where(... ne(receipts.status, "confirmed"))` with `.returning({ id: receipts.id })`. If `updateResult.length === 0`, throws `HttpError(409, "Receipt was confirmed while reconciling")`.

### F3: catalogItemId ownership on line CRUD (receipts.ts POST and PUT handlers)
Added `if (body.catalogItemId != null) { await assertOwnedCatalogItem(app.db, userId, body.catalogItemId); }` in both the `POST /receipts/:id/lines` handler (before the insert) and the `PUT /receipts/:id/lines/:lineId` handler (before building the updates object). Uses `assertOwnedCatalogItem` from the existing ownership service rather than inline findFirst, which is equivalent and avoids code duplication.

### F4: Confirmed receipt deletion guard (receipts.ts DELETE /receipts/:id)
Added `status: true` to the `columns` in the findFirst query. Added `if (receipt.status === 'confirmed') throw new HttpError(409, "Cannot delete a confirmed receipt");` after the not-found check.

### F5: UpdateReceiptLineSchema qty/unit pairing (packages/shared/src/schemas/shopping.ts)
Replaced the existing (broken) refine that returned `true` when only one of `quantityBase`/`unit` was in the payload, with the simpler: `.refine(d => (d.quantityBase !== undefined) === (d.unit !== undefined), { message: "quantityBase and unit must be provided together" })`. This correctly rejects `{ quantityBase: 500 }` without `unit`, `{ unit: "g" }` without `quantityBase`, and `{ quantityBase: null }` without `unit`.

### F6: Unit-safe aggregation in confirm (receipt-confirm.ts ~line 147)
Changed aggregation key from `line.catalogItemId` to `` `${line.catalogItemId}:${line.unit}` ``. Updated all `aggregateMap.get/set` calls to use `aggregateKey`. Updated comments. Same `catalogItemId` with different units (e.g. g vs ml) now produces separate `shopping_list_items`.

### F7: Schema header (apps/api/src/modules/shopping/schema.ts line 2)
Changed "11 resident tables + 8 resident enums" to "12 resident tables + 8 resident enums". (Note: the previous verified count was already 12 tables; this corrects the stale documentation comment.)

### F8: rawText → canonicalName (receipt-confirm.ts ~line 159)
After building `aggregatedItems`, added a lookup block: load `catalogItems` rows by the aggregate's `catalogItemIds` using `db.query.catalogItems.findMany`, build a `canonicalNameMap`, then update each `item.rawText` with the canonical name when found. Falls back to `normalizedName ?? rawText` if the catalog item is not found (e.g. soft-deleted). No new import needed — uses the relational query API which doesn't require the table object reference.

## Complete Diff

### receipt-reconcile.ts changes
```diff
-import { and, eq, inArray } from "drizzle-orm";
+import { and, eq, inArray, ne } from "drizzle-orm";
```

```diff
-  // Update receipt status → reconciled.
-  await db
-    .update(receipts)
-    .set({ status: "reconciled", reconciledAt: now })
-    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)));
+  // Update receipt status → reconciled (conditional: fail if confirmed concurrently).
+  const updateResult = await db
+    .update(receipts)
+    .set({ status: "reconciled", reconciledAt: now })
+    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId), ne(receipts.status, "confirmed")))
+    .returning({ id: receipts.id });
+
+  if (updateResult.length === 0) {
+    throw new HttpError(409, "Receipt was confirmed while reconciling");
+  }
```

### receipt-confirm.ts changes
```diff
-import { receipts, receiptLines, shoppingLists, shoppingListItems, cartDrafts } from "../schema.ts";
+import { receipts, receiptLines, shoppingLists, shoppingListItems, cartDrafts } from "../schema.ts";
 // (no import change — catalogItems not needed as an object, only via db.query.catalogItems)
```

```diff
-  // Step 6: Aggregate confirmed lines by catalogItemId (for rate learning).
+  // Step 6: Aggregate confirmed lines by (catalogItemId, unit) — unit-safe (F6).
+  // Same catalogItemId + different units → separate shopping_list_items.
   ...
-    const existing = aggregateMap.get(line.catalogItemId);
-    if (existing) {
-      existing.totalQuantityBase += line.quantityBase;
-    } else {
-      aggregateMap.set(line.catalogItemId, {
+    const aggregateKey = `${line.catalogItemId}:${line.unit}`;
+    const existing = aggregateMap.get(aggregateKey);
+    if (existing) {
+      existing.totalQuantityBase += line.quantityBase;
+    } else {
+      aggregateMap.set(aggregateKey, {
   ...
   // Step 6 (cont): Replace rawText with catalog canonicalName where available (F8).
+  const aggregatedItems = [...aggregateMap.values()];
+  if (aggregatedItems.length > 0) {
+    const catalogIds = [...new Set(aggregatedItems.map((i) => i.catalogItemId))];
+    const catRows = await db.query.catalogItems.findMany({
+      where: (ci, { inArray: inArr }) => inArr(ci.id, catalogIds),
+      columns: { id: true, canonicalName: true },
+    });
+    const canonicalNameMap = new Map<string, string>(catRows.map((ci) => [ci.id, ci.canonicalName]));
+    for (const item of aggregatedItems) {
+      const canonical = canonicalNameMap.get(item.catalogItemId);
+      if (canonical) item.rawText = canonical;
+    }
+  }
```

### receipts.ts changes
```diff
+import { assertOwnedDraft, assertOwnedCatalogItem } from "../services/ownership.ts";
```

```diff
-      const cartDraftId = (req.body as Record<string, unknown> | undefined)?.cartDraftId as string | undefined;
+      const rawCartDraftIdField = file.fields.cartDraftId;
+      const rawCartDraftIdValue =
+        rawCartDraftIdField && "value" in rawCartDraftIdField
+          ? rawCartDraftIdField.value
+          : undefined;
+      const cartDraftIdParsed = z.uuid().safeParse(rawCartDraftIdValue);
+      if (rawCartDraftIdValue !== undefined && !cartDraftIdParsed.success) {
+        throw new HttpError(400, "cartDraftId must be a valid UUID");
+      }
+      const cartDraftId = cartDraftIdParsed.success ? cartDraftIdParsed.data : undefined;
+      if (cartDraftId !== undefined) {
+        await assertOwnedDraft(app.db, userId, cartDraftId);
+      }
```

```diff
-        columns: { id: true, storedPath: true },
+        columns: { id: true, storedPath: true, status: true },
       });
       if (!receipt) throw new HttpError(404, "Receipt not found");
+      if (receipt.status === "confirmed") {
+        throw new HttpError(409, "Cannot delete a confirmed receipt");
+      }
```

POST /receipts/:id/lines — before insert:
```diff
+      if (body.catalogItemId != null) {
+        await assertOwnedCatalogItem(app.db, userId, body.catalogItemId);
+      }
```

PUT /receipts/:id/lines/:lineId — before updates build:
```diff
+      if (body.catalogItemId != null) {
+        await assertOwnedCatalogItem(app.db, userId, body.catalogItemId);
+      }
```

### shopping.ts (shared) F5
```diff
-  .refine(
-    (v) => {
-      const hasQty = v.quantityBase !== undefined ? v.quantityBase !== null : undefined;
-      const hasUnit = v.unit !== undefined ? v.unit !== null : undefined;
-      if (hasQty === undefined || hasUnit === undefined) return true;
-      return hasQty === hasUnit;
-    },
-    { message: "quantityBase and unit must both be set or both be null" },
-  );
+  .refine(
+    (d) => (d.quantityBase !== undefined) === (d.unit !== undefined),
+    { message: "quantityBase and unit must be provided together" },
+  );
```

### schema.ts F7
```diff
-* shopping module — 11 resident tables + 8 resident enums
+* shopping module — 12 resident tables + 8 resident enums
```

## Commands Run and Literal Output

### 1. `npm run typecheck`
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
Exit code: 0

### 2. `npm run lint`
```
> compass@0.1.0 lint
> eslint .
```
Exit code: 0

### 3. `npm run test -w apps/api`
Summary counts:
```
ℹ tests 1056
ℹ pass 1022
ℹ fail 33
ℹ skipped 1
```
Exit code: 1 (pre-existing DB-requiring failures only — see below)

All 33 failures require `DATABASE_URL` and are pre-existing (unchanged from before this fix pass). The receipt-specific tests pass:
- `reconcile: empty receipt and empty draft → all empty` ✔
- `reconcile: empty receipt, non-empty draft → all missing` ✔
- `reconcile: non-empty receipt, empty draft → all extra` ✔
- `reconcile: exact catalogItemId match — 1:1` ✔
- `reconcile: exact match with price diff → goes to priceDiffs` ✔
- `reconcile: fuzzy name match with clear winner` ✔
- `reconcile: fuzzy match — typo within 30% threshold` ✔
- `reconcile: fuzzy match beyond threshold → extra + missing` ✔
- `reconcile: ambiguous fuzzy match → ambiguous status` ✔
- `reconcile: one-to-one constraint — same catalogItem only matched once` ✔
- `reconcile: null price → priceDiffPaise is null (no diff computed)` ✔
- `reconcile: multiple exact matches — each paired one-to-one` ✔
- `deduplication of confirmedLineIds: Set removes duplicates` ✔
- `double-confirm prevention: status check rejects non-reconciled` ✔

Pre-existing failures (all need DATABASE_URL):
- `src/app.test.ts`
- `src/modules/automation/routes/automation.route.test.ts`
- `src/modules/credit/routes/revolving-debt.route.test.ts`
- `src/modules/credit/services/card-due-tasks.test.ts`
- `src/modules/credit/services/emis.test.ts`
- `src/modules/credit/services/reconciliation-writes.test.ts`
- `src/modules/credit/services/rewards.test.ts`
- `src/modules/ingest/routes/ingest.route.test.ts`
- `src/modules/ingest/services/inbox.test.ts`
- `src/modules/investments/routes/networth.route.test.ts`
- `src/modules/investments/services/sip-installments.test.ts`
- `src/modules/ledger/routes/ledger-events.route.test.ts`
- `src/modules/ledger/routes/user-tasks.route.test.ts`
- `src/modules/ledger/services/epf-contributions.test.ts`
- `src/modules/ledger/services/postings-balance-parity.test.ts`
- `src/modules/ledger/services/postings-pr-e-parity.test.ts`
- `src/modules/ledger/services/reconcile-postings.test.ts`
- `src/modules/ledger/services/recurring.test.ts`
- `src/modules/ledger/services/user-tasks.test.ts`
- `src/modules/planning/routes/planning-analysis.route.test.ts`
- `src/modules/planning/routes/planning.route.test.ts`
- `src/modules/planning/routes/projection-settings.route.test.ts`
- `src/modules/planning/services/postings-planning-parity.test.ts`
- `src/modules/planning/services/projection-settings.test.ts`
- `src/modules/protection/routes/protection.route.test.ts`
- `src/modules/shopping/routes/capture-image.route.test.ts`
- `src/modules/shopping/routes/capture.route.test.ts`
- `src/modules/shopping/routes/catalog.route.test.ts`
- `src/modules/shopping/routes/lists.route.test.ts`
- `src/modules/shopping/routes/price-observations.route.test.ts`
- `src/modules/shopping/routes/price-sources.route.test.ts`
- `src/modules/system/routes/system.route.test.ts`
- `src/modules/system/services/backup.test.ts`

### 4. `npm run test -w packages/shared`
```
ℹ tests 351
ℹ pass 351
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 320.248072
```
Exit code: 0

## Assumptions
- `assertOwnedCatalogItem` from `ownership.ts` is used for F3 instead of the inline `findFirst` pattern shown in the plan — they are semantically identical, and reusing the existing function avoids code duplication.
- For F8, the `catalogItems` table is not imported as an object (no `eq(catalogItems.id, ...)` expressions) — `db.query.catalogItems.findMany` with callback where is used, consistent with the existing pattern in `receipt-reconcile.ts`.
- The schema header fix in F7 changed "11 → 12" as specified. The Iter 2 verification report noted the count was already 12 in the actual table definitions; F7 was purely a comment correction.

## Unresolved Risks
- None from the F1-F8 scope.
- The 33 pre-existing test failures (all DATABASE_URL-gated) are unchanged from before this pass.
