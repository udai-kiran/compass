/**
 * receipt-confirm.ts — Confirm a reconciled receipt: ledger + pantry + rates (task 11.4).
 *
 * Design decisions (from TASK.md):
 *   D1: Direct ledger transaction via createTransaction() (source='import'), not inbox.
 *   D2: Shopping list items as purchase observations for learnConsumptionRate.
 *   D3: Atomic claim: UPDATE WHERE status='reconciled' — exactly one request succeeds.
 *   D5: Cart draft status → 'ordered' on confirm if linked.
 *
 * `confirmReceipt(db, userId, receiptId, body)`:
 *   1. Atomic claim (UPDATE WHERE status='reconciled').
 *   2. Load + validate confirmed line IDs (all belong to receipt).
 *   3. Validate accountId ownership.
 *   4. Compute and validate totalPaise from confirmed lines (> 0, safe integer).
 *   5. Create synthetic shopping list (name="Receipt {receiptId}", status='archived').
 *   6. Aggregate by catalogItemId → create synthetic shopping_list_items (status='bought').
 *   7. Call replenishPantry for each unique catalogItemId with quantity.
 *   8. Create ledger transaction (amountPaise = -totalPaise, source='import').
 *   9. Update receipt: shoppingListId = synthetic list id.
 *  10. If receipt.cartDraftId → update cart_drafts status → 'ordered'.
 *
 * Returns the updated receipt with its lines.
 * Caller (route handler) emits `ledger.mutated` post-commit.
 */

import { and, asc, eq, inArray } from "drizzle-orm";
import type { ConfirmReceiptBody } from "@compass/shared";
import type { DbOrTx } from "../../../db/index.ts";
import { HttpError } from "../../../lib/errors.ts";
import { assertOwnedRealAccount, assertOwnedCategory } from "../../../lib/ownership.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";
import { receipts, receiptLines, shoppingLists, shoppingListItems, cartDrafts, catalogItems, pantryItems } from "../schema.ts";
import { replenishPantry } from "./pantry-management.ts";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Aggregated receipt observation per (catalogItemId, unit) pair. */
export type AggregatedItem = {
  catalogItemId: string;
  totalQuantityBase: number;
  unit: "g" | "ml" | "piece";
  rawText: string;
};

/**
 * Choose the single aggregate to use for pantry replenishment (F6c).
 *
 * An aggregate is compatible when both constraints are satisfied:
 *   - `(catalogUnit == null || catalogUnit === item.unit)`
 *   - `(pantryUnit == null || pantryUnit === item.unit)`
 *
 * When catalog and pantry units are both set and differ, no aggregate can
 * satisfy both constraints → null (skip replenish, do not throw).
 *
 * Preference order among compatible aggregates:
 *   1. catalogUnit match (if catalogUnit is set)
 *   2. pantryUnit match (if pantryUnit is set)
 *   3. first compatible aggregate (stable: caller provides items in position order)
 *
 * Caller must NOT invoke this function when the catalog row is absent (owned
 * lookup returned nothing). That is a hard skip, not a catalogUnit=null case.
 */
export function choosePantryReplenishment(
  items: AggregatedItem[],
  catalogUnit: "g" | "ml" | "piece" | null,
  pantryUnit: "g" | "ml" | "piece" | null,
): AggregatedItem | null {
  if (items.length === 0) return null;

  const compatible = items.filter(
    (item) =>
      (catalogUnit == null || catalogUnit === item.unit) &&
      (pantryUnit == null || pantryUnit === item.unit),
  );

  if (compatible.length === 0) return null;

  // Prefer catalogUnit match if catalogUnit is set.
  if (catalogUnit !== null) {
    const match = compatible.find((item) => item.unit === catalogUnit);
    if (match) return match;
  }

  // Prefer pantryUnit match if pantryUnit is set.
  if (pantryUnit !== null) {
    const match = compatible.find((item) => item.unit === pantryUnit);
    if (match) return match;
  }

  // Fall back to first compatible aggregate.
  return compatible[0]!;
}

// ─── Service ──────────────────────────────────────────────────────────────────

/**
 * Confirm a reconciled receipt.
 *
 * Must be called inside an outer `db.transaction()` (the route wraps it).
 * Returns the confirmed receipt with its lines.
 */
export async function confirmReceipt(
  db: DbOrTx,
  userId: string,
  receiptId: string,
  body: ConfirmReceiptBody,
): Promise<{
  receiptId: string;
  transactionId: string;
  totalPaise: number;
}> {
  // Step 1: Atomic claim — only one request can transition 'reconciled' → 'confirmed'.
  const claimResult = await db
    .update(receipts)
    .set({ status: "confirmed", confirmedAt: new Date() })
    .where(
      and(
        eq(receipts.id, receiptId),
        eq(receipts.userId, userId),
        eq(receipts.status, "reconciled"),
      ),
    )
    .returning({
      id: receipts.id,
      cartDraftId: receipts.cartDraftId,
      merchantName: receipts.merchantName,
      purchaseDate: receipts.purchaseDate,
      totalPaise: receipts.totalPaise,
    });

  if (claimResult.length === 0) {
    // Either not found, wrong user, or already confirmed.
    const existing = await db.query.receipts.findFirst({
      where: and(eq(receipts.id, receiptId), eq(receipts.userId, userId)),
      columns: { status: true },
    });
    if (!existing) throw new HttpError(404, "Receipt not found");
    if (existing.status === "confirmed") throw new HttpError(409, "Receipt is already confirmed");
    throw new HttpError(409, "Receipt is not in reconciled status");
  }

  const receipt = claimResult[0]!;

  // Step 2: Load + validate confirmed line IDs.
  if (body.confirmedLineIds.length === 0) {
    throw new HttpError(400, "confirmedLineIds must not be empty");
  }

  // Deduplicate.
  const uniqueLineIds = [...new Set(body.confirmedLineIds)];

  const confirmedLines = await db.query.receiptLines.findMany({
    where: and(
      inArray(receiptLines.id, uniqueLineIds),
      eq(receiptLines.receiptId, receiptId),
    ),
    orderBy: [asc(receiptLines.position), asc(receiptLines.id)],
  });

  if (confirmedLines.length !== uniqueLineIds.length) {
    throw new HttpError(400, "Some confirmedLineIds do not belong to this receipt");
  }

  // Step 3: Validate accountId and categoryId ownership.
  await assertOwnedRealAccount(db, userId, body.accountId);
  await assertOwnedCategory(db, userId, body.categoryId);

  // Step 4: Compute and validate totalPaise from confirmed lines.
  let totalPaise = 0;
  for (const line of confirmedLines) {
    totalPaise += line.pricePaise ?? 0;
  }

  if (totalPaise <= 0) {
    throw new HttpError(400, "Total paise of confirmed lines must be greater than 0");
  }
  if (!Number.isSafeInteger(totalPaise)) {
    throw new HttpError(400, "Total paise of confirmed lines exceeds safe integer range");
  }

  // Step 5: Create synthetic shopping list for rate learning.
  const [syntheticList] = await db
    .insert(shoppingLists)
    .values({
      userId,
      name: `Receipt ${receiptId}`,
      status: "archived",
    })
    .returning({ id: shoppingLists.id });

  const syntheticListId = syntheticList!.id;

  // Step 6: Aggregate confirmed lines by (catalogItemId, unit) — unit-safe (F6).
  // Same catalogItemId + different units → separate shopping_list_items.
  // Only lines with both catalogItemId and quantityBase + unit are aggregated.
  const aggregateMap = new Map<string, AggregatedItem>();
  for (const line of confirmedLines) {
    if (!line.catalogItemId || line.quantityBase === null || !line.unit) continue;
    // Key on both catalogItemId and unit to prevent cross-unit mixing (e.g. g vs ml).
    const aggregateKey = `${line.catalogItemId}:${line.unit}`;
    const existing = aggregateMap.get(aggregateKey);
    if (existing) {
      existing.totalQuantityBase += line.quantityBase;
    } else {
      aggregateMap.set(aggregateKey, {
        catalogItemId: line.catalogItemId,
        totalQuantityBase: line.quantityBase,
        unit: line.unit as "g" | "ml" | "piece",
        rawText: line.normalizedName ?? line.rawText,
      });
    }
  }

  // Step 6 (cont): Replace rawText with catalog canonicalName (F8) and load catalog
  // unit for F6c pantry-replenishment unit selection.
  // P2: Both queries are scoped by userId so only owned rows appear in the maps.
  const aggregatedItems = [...aggregateMap.values()];
  type CatalogInfo = { canonicalName: string; unit: "g" | "ml" | "piece" | null };
  const catalogInfoMap = new Map<string, CatalogInfo>();
  // P2: pantryMap is keyed by catalogItemId, only populated for owned catalog ids.
  const pantryMap = new Map<string, "g" | "ml" | "piece" | null>();
  if (aggregatedItems.length > 0) {
    const catalogIds = [...new Set(aggregatedItems.map((i) => i.catalogItemId))];
    // P2: userId filter — absent catalog row means not owned → skip replenish.
    const catRows = await db.query.catalogItems.findMany({
      where: and(inArray(catalogItems.id, catalogIds), eq(catalogItems.userId, userId)),
      columns: { id: true, canonicalName: true, unit: true },
    });
    for (const ci of catRows) {
      catalogInfoMap.set(ci.id, { canonicalName: ci.canonicalName, unit: ci.unit ?? null });
    }
    for (const item of aggregatedItems) {
      const catInfo = catalogInfoMap.get(item.catalogItemId);
      if (catInfo) item.rawText = catInfo.canonicalName;
    }

    // P2: Batch-load pantry units for owned catalog ids only.
    const ownedCatalogIds = [...catalogInfoMap.keys()];
    if (ownedCatalogIds.length > 0) {
      const pantryRows = await db.query.pantryItems.findMany({
        where: and(
          inArray(pantryItems.catalogItemId, ownedCatalogIds),
          eq(pantryItems.userId, userId),
        ),
        columns: { catalogItemId: true, unit: true },
      });
      for (const pr of pantryRows) {
        pantryMap.set(pr.catalogItemId, pr.unit ?? null);
      }
    }
  }

  // Insert ALL aggregated items as shopping_list_items — all (catalogItemId, unit) pairs
  // become rate-learning observations regardless of whether they get a pantry update (F6/F6b).
  if (aggregatedItems.length > 0) {
    await db.insert(shoppingListItems).values(
      aggregatedItems.map((item) => ({
        listId: syntheticListId,
        catalogItemId: item.catalogItemId,
        rawText: item.rawText,
        quantityBase: item.totalQuantityBase,
        unit: item.unit,
        status: "bought" as const,
      })),
    );
  }

  // Step 7: Replenish pantry using choosePantryReplenishment (F6c).
  // Shopping_list_items were already inserted for ALL aggregates above.
  // Group aggregates by catalogItemId so the chooser sees all unit variants.
  const itemsByCatalogId = new Map<string, AggregatedItem[]>();
  for (const item of aggregatedItems) {
    const arr = itemsByCatalogId.get(item.catalogItemId);
    if (arr) {
      arr.push(item);
    } else {
      itemsByCatalogId.set(item.catalogItemId, [item]);
    }
  }
  for (const [catalogItemId, items] of itemsByCatalogId) {
    // P2: Missing owned catalog row → skip pantry entirely (not catalogUnit=null).
    const catInfo = catalogInfoMap.get(catalogItemId);
    if (!catInfo) continue;

    const pantryUnit = pantryMap.get(catalogItemId) ?? null;
    const chosen = choosePantryReplenishment(items, catInfo.unit, pantryUnit);
    if (chosen !== null) {
      await replenishPantry(db, userId, catalogItemId, chosen.totalQuantityBase, chosen.unit);
    }
  }

  // Step 8: Create ledger transaction (one aggregate, source='import').
  const merchantName = receipt.merchantName ?? "Receipt purchase";
  const txDate = body.date;

  const transaction = await createTransaction(db, userId, {
    accountId: body.accountId,
    date: txDate,
    amountPaise: -totalPaise,
    merchant: merchantName,
    categoryId: body.categoryId,
    notes: `From receipt`,
    source: "import",
  });

  // Step 9: Update receipt with syntheticListId and totalPaise.
  await db
    .update(receipts)
    .set({
      shoppingListId: syntheticListId,
      totalPaise,
    })
    .where(and(eq(receipts.id, receiptId), eq(receipts.userId, userId)));

  // Step 10: Update cart draft status → 'ordered' if linked.
  if (receipt.cartDraftId) {
    await db
      .update(cartDrafts)
      .set({ status: "ordered", updatedAt: new Date() })
      .where(and(eq(cartDrafts.id, receipt.cartDraftId), eq(cartDrafts.userId, userId)));
  }

  return {
    receiptId,
    transactionId: transaction.id,
    totalPaise,
  };
}
