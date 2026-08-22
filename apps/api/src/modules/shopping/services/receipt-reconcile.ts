/**
 * receipt-reconcile.ts — Reconciliation engine for receipts vs cart drafts (task 11.4).
 *
 * Pure logic in `reconcile()` (no DB, hermetically testable).
 * DB wrapper `reconcileReceipt(db, userId, receiptId)` applies the result.
 *
 * Matching algorithm (two phases, one-to-one greedy):
 *   Phase 1: exact catalogItemId match — receipt line.catalogItemId === draft item.catalogItemId.
 *   Phase 2: fuzzy normalizedName match — Levenshtein ≤ 30% of shorter string length,
 *            minimum margin of 2 chars over the second-best match.
 *
 * Classification:
 *   matched     — exact or unambiguous fuzzy match (no price diff)
 *   price_diff  — matched but |priceDiff| > 0
 *   extra       — receipt line with no match
 *   missing     — draft item with no match
 *   ambiguous   — fuzzy match exists but no clear winner
 */

import { and, eq, exists, inArray, ne } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import type { ReconciliationReport } from "@compass/shared";
import { HttpError } from "../../../lib/errors.ts";
import { receipts, receiptLines, cartDraftItems } from "../schema.ts";
import { assertOwnedDraft } from "./ownership.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ReceiptLineInput {
  id: string;
  normalizedName: string | null;
  catalogItemId: string | null;
  pricePaise: number | null;
  quantityBase: number | null;
  unit: string | null;
}

export interface DraftItemInput {
  id: string;
  catalogItemId: string | null;
  suggestedPricePaise: number | null;
  /** canonical name of the catalog item (for fuzzy match) */
  normalizedName?: string | null;
}

export interface ReconcileResult {
  matched: Array<{ receiptLineId: string; draftItemId: string; priceDiffPaise: number | null }>;
  extra: string[];      // receipt line IDs
  missing: string[];    // draft item IDs
  priceDiffs: Array<{ receiptLineId: string; draftItemId: string; priceDiffPaise: number | null }>;
  ambiguous: string[];  // receipt line IDs
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** Levenshtein distance between two strings. */
function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  // dp[i][j] = edit distance between a[0..i-1] and b[0..j-1]
  const dp: number[][] = Array.from({ length: m + 1 }, (_, i) =>
    Array.from({ length: n + 1 }, (_, j) => (i === 0 ? j : j === 0 ? i : 0)),
  );
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i]![j] = dp[i - 1]![j - 1]!;
      } else {
        dp[i]![j] = 1 + Math.min(dp[i - 1]![j]!, dp[i]![j - 1]!, dp[i - 1]![j - 1]!);
      }
    }
  }
  return dp[m]![n]!;
}

/** Normalize a string for fuzzy matching: lowercase, trim, collapse whitespace. */
export function normalizeForMatch(s: string): string {
  return s.toLowerCase().trim().replace(/\s+/g, " ");
}

/**
 * Attempt fuzzy match of one receipt line against unmatched draft items.
 * Returns the best match, or null if ambiguous / no match.
 *
 * Conditions for a "clear winner":
 *   - Levenshtein distance ≤ 30% of shorter string length
 *   - Distance is strictly less than the second-best by at least 2 chars
 */
function fuzzyMatch(
  lineName: string | null,
  draftItems: DraftItemInput[],
): { item: DraftItemInput; status: "matched" | "ambiguous" } | null {
  if (!lineName) return null;
  const normalizedLine = normalizeForMatch(lineName);

  const scored: Array<{ item: DraftItemInput; dist: number }> = [];
  for (const item of draftItems) {
    const candidateName = item.normalizedName ? normalizeForMatch(item.normalizedName) : null;
    if (!candidateName) continue;
    const shorter = Math.min(normalizedLine.length, candidateName.length);
    if (shorter === 0) continue;
    const dist = levenshtein(normalizedLine, candidateName);
    const threshold = Math.floor(shorter * 0.3);
    if (dist <= threshold) {
      scored.push({ item, dist });
    }
  }

  if (scored.length === 0) return null;
  scored.sort((a, b) => a.dist - b.dist);

  const best = scored[0]!;
  const second = scored[1];

  // Clear winner: unique best, or margin ≥ 2 over second.
  if (!second || second.dist - best.dist >= 2) {
    return { item: best.item, status: "matched" };
  }

  return { item: best.item, status: "ambiguous" };
}

// ─── Pure reconciliation ──────────────────────────────────────────────────────

/**
 * Pure reconciliation of receipt lines against draft items.
 *
 * One-to-one matching: once a draft item is matched, it cannot match another
 * receipt line. Same for receipt lines.
 *
 * Returns a `ReconcileResult` describing the classification.
 */
export function reconcile(
  receiptLineInputs: ReceiptLineInput[],
  draftItemInputs: DraftItemInput[],
): ReconcileResult {
  const result: ReconcileResult = {
    matched: [],
    extra: [],
    missing: [],
    priceDiffs: [],
    ambiguous: [],
  };

  const unmatchedDraftIds = new Set(draftItemInputs.map((d) => d.id));
  const unmatchedLineIds = new Set(receiptLineInputs.map((l) => l.id));

  // Phase 1: exact catalogItemId match (greedy, order of receipt lines).
  for (const line of receiptLineInputs) {
    if (!line.catalogItemId) continue;
    // Find a draft item with the same catalogItemId that's still unmatched.
    const draftMatch = draftItemInputs.find(
      (d) => d.catalogItemId === line.catalogItemId && unmatchedDraftIds.has(d.id),
    );
    if (!draftMatch) continue;

    unmatchedDraftIds.delete(draftMatch.id);
    unmatchedLineIds.delete(line.id);

    const priceDiffPaise =
      line.pricePaise !== null && draftMatch.suggestedPricePaise !== null
        ? line.pricePaise - draftMatch.suggestedPricePaise
        : null;

    const pair = { receiptLineId: line.id, draftItemId: draftMatch.id, priceDiffPaise };

    if (priceDiffPaise !== null && priceDiffPaise !== 0) {
      result.priceDiffs.push(pair);
    } else {
      result.matched.push(pair);
    }
  }

  // Phase 2: fuzzy normalizedName match.
  const remainingLines = receiptLineInputs.filter((l) => unmatchedLineIds.has(l.id));
  const remainingDrafts = draftItemInputs.filter((d) => unmatchedDraftIds.has(d.id));

  for (const line of remainingLines) {
    const match = fuzzyMatch(line.normalizedName, remainingDrafts.filter((d) => unmatchedDraftIds.has(d.id)));
    if (!match) continue;

    if (match.status === "ambiguous") {
      result.ambiguous.push(line.id);
      unmatchedLineIds.delete(line.id);
      // Don't remove the draft item — it might still match another line.
      continue;
    }

    // Clear winner.
    unmatchedDraftIds.delete(match.item.id);
    unmatchedLineIds.delete(line.id);

    const priceDiffPaise =
      line.pricePaise !== null && match.item.suggestedPricePaise !== null
        ? line.pricePaise - match.item.suggestedPricePaise
        : null;

    const pair = { receiptLineId: line.id, draftItemId: match.item.id, priceDiffPaise };

    if (priceDiffPaise !== null && priceDiffPaise !== 0) {
      result.priceDiffs.push(pair);
    } else {
      result.matched.push(pair);
    }
  }

  // Remaining lines = extra (on receipt but not in draft).
  for (const id of unmatchedLineIds) {
    result.extra.push(id);
  }

  // Remaining drafts = missing (in draft but not on receipt).
  for (const id of unmatchedDraftIds) {
    result.missing.push(id);
  }

  return result;
}

// ─── DB wrapper ───────────────────────────────────────────────────────────────

/**
 * Reconcile a receipt against its linked cart draft.
 *
 * Loads the receipt + its lines, loads the draft items (if draft is linked),
 * runs the pure reconcile(), persists the result to receipt_lines and the
 * receipt status, and returns the reconciliation report.
 *
 * Status guard: throws 409 if receipt is already confirmed.
 */
export async function reconcileReceipt(
  db: Db,
  userId: string,
  receiptId: string,
): Promise<ReconciliationReport> {
  // Load receipt (with ownership check).
  const receipt = await db.query.receipts.findFirst({
    where: and(eq(receipts.id, receiptId), eq(receipts.userId, userId)),
  });
  if (!receipt) throw new HttpError(404, "Receipt not found");
  if (receipt.status === "confirmed") {
    throw new HttpError(409, "Receipt is already confirmed and cannot be re-reconciled");
  }

  // Load receipt lines.
  const lines = await db.query.receiptLines.findMany({
    where: eq(receiptLines.receiptId, receiptId),
    orderBy: (l, { asc }) => [asc(l.position)],
  });

  let draftItems: DraftItemInput[] = [];

  if (receipt.cartDraftId) {
    // Verify draft ownership (throws 404 if not found).
    await assertOwnedDraft(db, userId, receipt.cartDraftId);

    // Load non-removed draft items.
    const rawDraftItems = await db.query.cartDraftItems.findMany({
      where: and(
        eq(cartDraftItems.cartDraftId, receipt.cartDraftId),
        eq(cartDraftItems.isRemoved, false),
      ),
    });

    // Load catalog item names for those that have a catalogItemId.
    const catalogIds = rawDraftItems
      .map((d) => d.catalogItemId)
      .filter((id): id is string => id !== null);

    const catalogNameMap = new Map<string, string>();
    if (catalogIds.length > 0) {
      const catItems = await db.query.catalogItems.findMany({
        where: (ci, { inArray: inArr }) => inArr(ci.id, catalogIds),
        columns: { id: true, canonicalName: true },
      });
      for (const ci of catItems) {
        catalogNameMap.set(ci.id, ci.canonicalName);
      }
    }

    draftItems = rawDraftItems.map((d) => ({
      id: d.id,
      catalogItemId: d.catalogItemId ?? null,
      suggestedPricePaise: d.suggestedPricePaise ?? null,
      normalizedName: d.catalogItemId ? (catalogNameMap.get(d.catalogItemId) ?? null) : null,
    }));
  }

  const lineInputs: ReceiptLineInput[] = lines.map((l) => ({
    id: l.id,
    normalizedName: l.normalizedName ?? null,
    catalogItemId: l.catalogItemId ?? null,
    pricePaise: l.pricePaise ?? null,
    quantityBase: l.quantityBase ?? null,
    unit: l.unit ?? null,
  }));

  // Run pure reconciliation.
  const result = reconcile(lineInputs, draftItems);

  const now = new Date();

  // Persist match results atomically. Wrapping in a transaction ensures that
  // a concurrent confirm cannot leave a half-applied reconcile visible: if the
  // race is lost the entire block rolls back.
  await db.transaction(async (tx) => {
    // Subquery guard: every receiptLines UPDATE includes this EXISTS predicate
    // so writes are silently skipped if the receipt was confirmed in the window
    // between the initial status read and the first persist write.
    const notConfirmedGuard = exists(
      tx
        .select({ id: receipts.id })
        .from(receipts)
        .where(
          and(
            eq(receipts.id, receiptId),
            eq(receipts.userId, userId),
            ne(receipts.status, "confirmed"),
          ),
        ),
    );

    // Update matched lines.
    for (const match of result.matched) {
      const rows = await tx
        .update(receiptLines)
        .set({ matchStatus: "matched", matchedDraftItemId: match.draftItemId })
        .where(
          and(
            eq(receiptLines.id, match.receiptLineId),
            eq(receiptLines.receiptId, receiptId),
            notConfirmedGuard,
          ),
        )
        .returning({ id: receiptLines.id });
      if (rows.length === 0) {
        throw new HttpError(409, "Receipt was confirmed while reconciling");
      }
    }

    // Update price_diff lines.
    for (const match of result.priceDiffs) {
      const rows = await tx
        .update(receiptLines)
        .set({ matchStatus: "price_diff", matchedDraftItemId: match.draftItemId })
        .where(
          and(
            eq(receiptLines.id, match.receiptLineId),
            eq(receiptLines.receiptId, receiptId),
            notConfirmedGuard,
          ),
        )
        .returning({ id: receiptLines.id });
      if (rows.length === 0) {
        throw new HttpError(409, "Receipt was confirmed while reconciling");
      }
    }

    // Update extra lines.
    if (result.extra.length > 0) {
      const rows = await tx
        .update(receiptLines)
        .set({ matchStatus: "extra", matchedDraftItemId: null })
        .where(
          and(
            inArray(receiptLines.id, result.extra),
            eq(receiptLines.receiptId, receiptId),
            notConfirmedGuard,
          ),
        )
        .returning({ id: receiptLines.id });
      if (rows.length === 0) {
        throw new HttpError(409, "Receipt was confirmed while reconciling");
      }
    }

    // Update ambiguous lines.
    if (result.ambiguous.length > 0) {
      const rows = await tx
        .update(receiptLines)
        .set({ matchStatus: "ambiguous", matchedDraftItemId: null })
        .where(
          and(
            inArray(receiptLines.id, result.ambiguous),
            eq(receiptLines.receiptId, receiptId),
            notConfirmedGuard,
          ),
        )
        .returning({ id: receiptLines.id });
      if (rows.length === 0) {
        throw new HttpError(409, "Receipt was confirmed while reconciling");
      }
    }

    // Update receipt status → reconciled (conditional: fail if confirmed concurrently).
    // This is the authoritative race-condition check: if 0 rows → receipt was confirmed.
    const updateResult = await tx
      .update(receipts)
      .set({ status: "reconciled", reconciledAt: now })
      .where(
        and(
          eq(receipts.id, receiptId),
          eq(receipts.userId, userId),
          ne(receipts.status, "confirmed"),
        ),
      )
      .returning({ id: receipts.id });

    if (updateResult.length === 0) {
      throw new HttpError(409, "Receipt was confirmed while reconciling");
    }
  });

  // Build response (re-read the lines to get fresh state).
  const updatedLines = await db.query.receiptLines.findMany({
    where: eq(receiptLines.receiptId, receiptId),
    orderBy: (l, { asc }) => [asc(l.position)],
  });
  const updatedReceipt = await db.query.receipts.findFirst({
    where: eq(receipts.id, receiptId),
  });

  const receiptWithLines = {
    id: updatedReceipt!.id,
    cartDraftId: updatedReceipt!.cartDraftId ?? null,
    shoppingListId: updatedReceipt!.shoppingListId ?? null,
    status: updatedReceipt!.status,
    merchantName: updatedReceipt!.merchantName ?? null,
    purchaseDate: updatedReceipt!.purchaseDate ?? null,
    totalPaise: updatedReceipt!.totalPaise ?? null,
    storedPath: updatedReceipt!.storedPath,
    mimeType: updatedReceipt!.mimeType,
    parsedAt: updatedReceipt!.parsedAt ?? null,
    reconciledAt: updatedReceipt!.reconciledAt ?? null,
    confirmedAt: updatedReceipt!.confirmedAt ?? null,
    createdAt: updatedReceipt!.createdAt,
    lines: updatedLines.map((l) => ({
      id: l.id,
      receiptId: l.receiptId,
      position: l.position,
      rawText: l.rawText,
      normalizedName: l.normalizedName ?? null,
      catalogItemId: l.catalogItemId ?? null,
      quantityBase: l.quantityBase ?? null,
      unit: l.unit ?? null,
      pricePaise: l.pricePaise ?? null,
      matchedDraftItemId: l.matchedDraftItemId ?? null,
      matchStatus: l.matchStatus,
      createdAt: l.createdAt,
    })),
  };

  return {
    matched: result.matched,
    extra: result.extra,
    missing: result.missing,
    priceDiffs: result.priceDiffs,
    ambiguous: result.ambiguous,
    receipt: receiptWithLines,
  };
}
