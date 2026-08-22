/**
 * Basket Arbitrage Optimizer (task 10.3).
 *
 * Pure function — no DB access, no I/O. Takes a list of shopping-list item IDs,
 * a list of candidate sources with delivery metadata, and a pre-built priceMap,
 * and returns the cheapest assignment of items across sources.
 *
 * Algorithm: enumerate all 2^n non-empty subsets of sources (n ≤ MAX_SOURCES=15,
 * so at most 32767 iterations). For each subset:
 *   1. Assign each priced item to the cheapest source in the subset that has a
 *      price for it. If any item cannot be covered by the subset, skip it.
 *   2. Compute totalPaise = itemSubtotalPaise + deliveryFeePaise per source that
 *      has items assigned. deliveryFeePaise is always added (the caller must pay
 *      the delivery fee regardless of minCartPaise — the threshold is informational).
 *   3. grandTotal = sum of source totals.
 * Return the subset with the lowest grandTotal.
 *
 * Items with no price on any source go into unpricedItemIds — never silently
 * dropped from the result.
 *
 * Money is always integer paise — no float arithmetic.
 */

import type { ArbitrageSourcePlan, BasketArbitrageResult } from "@compass/shared";

/** Maximum number of sources before subset enumeration is rejected. 2^15 = 32768. */
export const MAX_SOURCES = 15;

export interface SourceInfo {
  sourceId: string;
  sourceName: string;
  /** Delivery fee in integer paise. 0 if not applicable or unknown. */
  deliveryFeePaise: number;
  /** Minimum cart value in integer paise to qualify for delivery — null means unknown. */
  minCartPaise: number | null;
}

type PriceEntry = {
  pricePaise: number;
  observedAt: Date;
};

/**
 * Compute the best (lowest) total achievable by buying ALL priced items from a
 * single source. Returns null if no single source covers every priced item.
 */
function computeBestSingleSource(
  pricedItemIds: string[],
  sources: SourceInfo[],
  priceMap: Map<string, PriceEntry>,
): number | null {
  if (pricedItemIds.length === 0 || sources.length === 0) return null;

  let best: number | null = null;

  for (const source of sources) {
    let total = source.deliveryFeePaise;
    let viable = true;

    for (const itemId of pricedItemIds) {
      const entry = priceMap.get(`${itemId}:${source.sourceId}`);
      if (entry === undefined) {
        viable = false;
        break;
      }
      total += entry.pricePaise;
    }

    if (viable && (best === null || total < best)) {
      best = total;
    }
  }

  return best;
}

/**
 * Optimize the basket: find the cheapest way to split priced items across sources.
 *
 * @param itemIds - All shopping list item IDs to consider (priced + unpriced).
 * @param sources - Candidate sources with delivery metadata.
 * @param priceMap - Map from `${listItemId}:${sourceId}` → {pricePaise, observedAt}.
 *
 * @throws {Error} when `sources.length > MAX_SOURCES` — caught by the route as 400.
 */
export function optimizeBasket(
  itemIds: string[],
  sources: SourceInfo[],
  priceMap: Map<string, PriceEntry>,
): BasketArbitrageResult {
  // Guard: reject before enumeration to prevent combinatorial explosion.
  if (sources.length > MAX_SOURCES) {
    throw new Error(`Too many sources: ${sources.length}`);
  }

  // Partition items: priced (at least one source has a price) vs unpriced.
  const pricedItemIds: string[] = [];
  const unpricedItemIds: string[] = [];

  for (const itemId of itemIds) {
    const hasAnyPrice = sources.some((s) => priceMap.has(`${itemId}:${s.sourceId}`));
    if (hasAnyPrice) {
      pricedItemIds.push(itemId);
    } else {
      unpricedItemIds.push(itemId);
    }
  }

  const bestSingleSourceTotalPaise = computeBestSingleSource(pricedItemIds, sources, priceMap);
  const tooFewSources =
    sources.length === 0 || (sources.length === 1 && bestSingleSourceTotalPaise === null);

  // Nothing to optimize: no sources or no priced items.
  if (sources.length === 0 || pricedItemIds.length === 0) {
    return {
      splits: [],
      grandTotalPaise: 0,
      bestSingleSourceTotalPaise: null,
      savingPaise: 0,
      unpricedItemIds,
      tooFewSources,
    };
  }

  const n = sources.length;
  let bestGrandTotal = Infinity;
  let bestSplits: ArbitrageSourcePlan[] = [];

  // Enumerate all 2^n − 1 non-empty subsets using bitmask.
  for (let mask = 1; mask < (1 << n); mask++) {
    const subsetSources = sources.filter((_, i) => (mask >> i) & 1);

    // Assign each priced item to the cheapest source in this subset.
    const assignmentMap = new Map<string, { source: SourceInfo; entry: PriceEntry }>();
    let viable = true;

    for (const itemId of pricedItemIds) {
      let bestPrice = Infinity;
      let bestSource: SourceInfo | null = null;
      let bestEntry: PriceEntry | null = null;

      for (const source of subsetSources) {
        const entry = priceMap.get(`${itemId}:${source.sourceId}`);
        if (entry !== undefined && entry.pricePaise < bestPrice) {
          bestPrice = entry.pricePaise;
          bestSource = source;
          bestEntry = entry;
        }
      }

      if (!bestSource) {
        // No source in this subset has a price for this item — subset is unviable.
        viable = false;
        break;
      }

      assignmentMap.set(itemId, { source: bestSource, entry: bestEntry! });
    }

    if (!viable) continue;

    // Aggregate per-source: items, evidence, and subtotal.
    const sourcePlanMap = new Map<
      string,
      {
        source: SourceInfo;
        assignedItemIds: string[];
        priceEvidence: Record<string, { pricePaise: number; observedAt: Date }>;
        itemSubtotalPaise: number;
      }
    >();

    for (const [itemId, { source, entry }] of assignmentMap) {
      let plan = sourcePlanMap.get(source.sourceId);
      if (!plan) {
        plan = { source, assignedItemIds: [], priceEvidence: {}, itemSubtotalPaise: 0 };
        sourcePlanMap.set(source.sourceId, plan);
      }
      plan.assignedItemIds.push(itemId);
      plan.priceEvidence[itemId] = { pricePaise: entry.pricePaise, observedAt: entry.observedAt };
      plan.itemSubtotalPaise += entry.pricePaise;
    }

    // Grand total = sum of (itemSubtotal + deliveryFee) for each source with items.
    let grandTotal = 0;
    for (const plan of sourcePlanMap.values()) {
      grandTotal += plan.itemSubtotalPaise + plan.source.deliveryFeePaise;
    }

    if (grandTotal < bestGrandTotal) {
      bestGrandTotal = grandTotal;
      bestSplits = [...sourcePlanMap.values()].map((plan) => ({
        sourceId: plan.source.sourceId,
        sourceName: plan.source.sourceName,
        itemSubtotalPaise: plan.itemSubtotalPaise,
        deliveryFeePaise: plan.source.deliveryFeePaise,
        minCartPaise: plan.source.minCartPaise,
        totalPaise: plan.itemSubtotalPaise + plan.source.deliveryFeePaise,
        assignedItemIds: plan.assignedItemIds,
        priceEvidenceByItemId: plan.priceEvidence,
      }));
    }
  }

  const grandTotalPaise = bestGrandTotal === Infinity ? 0 : bestGrandTotal;
  const savingPaise =
    bestSingleSourceTotalPaise !== null ? bestSingleSourceTotalPaise - grandTotalPaise : 0;

  return {
    splits: bestSplits,
    grandTotalPaise,
    bestSingleSourceTotalPaise,
    savingPaise,
    unpricedItemIds,
    tooFewSources,
  };
}
