/**
 * Pure view-model helpers for the Cart Review screen (task 12.2).
 *
 * No React, no hooks, no side-effects — all pure functions so they can be
 * tested with node:test without a renderer.
 */

import { formatINR } from "@compass/shared";
import type {
  CartDraftItem,
  CartDraftWithItems,
  CatalogItem,
  FinancialGuardsResponse,
  GoalImpactItem,
  PriceSource,
} from "@compass/shared";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SourceGroup {
  /** null means the item has no suggestedSourceId or the source was not found. */
  sourceId: string | null;
  sourceName: string;
  deliveryFeePaise: number | null;
  minCartPaise: number | null;
  deliveryEtaBand: string | null;
  isActive: boolean;
  items: CartDraftItem[];
  /** Active (non-removed) items only. */
  subtotalPaise: number;
}

export interface DraftSummary {
  totalItems: number;
  activeItems: number;
  removedCount: number;
  /** Items where suggestedPricePaise is null. */
  unpricedCount: number;
  /** Sum of suggestedPricePaise for active priced items. */
  totalPaise: number;
  hasSubstitutions: boolean;
}

export interface GuardSummaryText {
  budgetLine: string | null;
  goalLines: string[];
  hasOverage: boolean;
}

export interface PriceLine {
  priceText: string;
  sourceText: string;
  caveat: string;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

/**
 * Group draft items by their suggestedSourceId.
 *
 * - Items with a null/unknown sourceId go into an "Unknown source" group.
 * - Removed items are included in the group but excluded from the subtotal.
 * - Groups are ordered by first occurrence (preserving draft item order).
 */
export function groupItemsBySource(
  items: CartDraftItem[],
  sourcesMap: Map<string, PriceSource>,
): SourceGroup[] {
  const groups = new Map<string | null, SourceGroup>();

  for (const item of items) {
    const key = item.suggestedSourceId ?? null;
    const resolvedKey = key !== null && sourcesMap.has(key) ? key : null;
    if (!groups.has(resolvedKey)) {
      const source = resolvedKey !== null ? sourcesMap.get(resolvedKey) : undefined;
      groups.set(resolvedKey, {
        sourceId: resolvedKey,
        sourceName: source?.name ?? "Unknown source",
        deliveryFeePaise: source?.deliveryFeePaise ?? null,
        minCartPaise: source?.minCartPaise ?? null,
        deliveryEtaBand: source?.deliveryEtaBand ?? null,
        isActive: source?.isActive ?? false,
        items: [],
        subtotalPaise: 0,
      });
    }
    const group = groups.get(resolvedKey)!;
    group.items.push(item);
    if (!item.isRemoved && item.suggestedPricePaise !== null) {
      group.subtotalPaise += item.suggestedPricePaise;
    }
  }

  return Array.from(groups.values());
}

/**
 * Summarise a draft for the summary bar.
 *
 * - totalPaise: sum of suggestedPricePaise for active + priced items.
 * - unpricedCount: active items where suggestedPricePaise is null.
 */
export function draftSummary(draft: CartDraftWithItems): DraftSummary {
  const { items } = draft;
  const activeItems = items.filter((i) => !i.isRemoved);
  const removedCount = items.length - activeItems.length;
  const unpricedCount = activeItems.filter((i) => i.suggestedPricePaise === null).length;
  const totalPaise = activeItems.reduce((acc, i) => acc + (i.suggestedPricePaise ?? 0), 0);
  const hasSubstitutions = items.some((i) => i.substitutionForItemId !== null);

  return {
    totalItems: items.length,
    activeItems: activeItems.length,
    removedCount,
    unpricedCount,
    totalPaise,
    hasSubstitutions,
  };
}

/**
 * Derive human-readable text for the financial guard banner.
 *
 * Uses formatINR for all currency values. Returns null budgetLine when the
 * budget guard is null (no category/budget configured).
 */
export function guardSummaryText(guards: FinancialGuardsResponse): GuardSummaryText {
  let budgetLine: string | null = null;
  let hasOverage = false;

  if (guards.budget !== null) {
    const { overBudgetPaise, remainingPaise } = guards.budget;
    if (overBudgetPaise > 0) {
      budgetLine = `${formatINR(overBudgetPaise)} over budget`;
      hasOverage = true;
    } else {
      budgetLine = `${formatINR(remainingPaise)} remaining in budget`;
    }
  }

  const goalLines: string[] = [];
  if (guards.goals !== null) {
    for (const impact of guards.goals.impacts) {
      const line = formatGoalImpactLine(impact);
      if (line) goalLines.push(line);
    }
  }

  return { budgetLine, goalLines, hasOverage };
}

function formatGoalImpactLine(impact: GoalImpactItem): string | null {
  switch (impact.status) {
    case "delayed":
      return `${impact.goalName}: delayed by ~${impact.delayMonths ?? "?"} month(s)`;
    case "unreachable":
      return `${impact.goalName}: may become unreachable`;
    case "already_behind":
      return `${impact.goalName}: already behind schedule`;
    case "undated":
      return null;
    case "no_impact":
      return null;
    case "completed":
      return null;
    default:
      return null;
  }
}

/**
 * Resolve a catalog item name for a draft item.
 *
 * - If catalogItemId is null/undefined → "Unknown item"
 * - If not found in catalogMap → "Unknown item"
 * - Otherwise → catalogMap entry's canonicalName
 */
export function itemDisplayName(
  item: Pick<CartDraftItem, "catalogItemId">,
  catalogMap: Map<string, CatalogItem>,
): string {
  if (!item.catalogItemId) return "Unknown item";
  return catalogMap.get(item.catalogItemId)?.canonicalName ?? "Unknown item";
}

/**
 * Derive the price and source provenance display for a draft item.
 *
 * All currency via formatINR. The caveat is always "from draft generation"
 * because CartDraftItemSchema has no observedAt timestamp.
 */
export function priceLine(
  item: Pick<CartDraftItem, "suggestedPricePaise" | "suggestedSourceId">,
  sourcesMap: Map<string, PriceSource>,
): PriceLine {
  const priceText =
    item.suggestedPricePaise !== null ? formatINR(item.suggestedPricePaise) : "—";

  const source =
    item.suggestedSourceId !== null ? sourcesMap.get(item.suggestedSourceId) : undefined;
  const sourceText = source?.name ?? "Unknown source";

  return {
    priceText,
    sourceText,
    caveat: "from draft generation",
  };
}
