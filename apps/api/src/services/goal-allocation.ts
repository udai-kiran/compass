import type { AccountType, AssetClass, GainsTaxClass } from "@compass/shared";

export type GoalAllocationClass = "equity" | "debt" | "other";

export function accountAllocationClass(type: AccountType): GoalAllocationClass {
  if (type === "investment") return "equity";
  if (type === "ppf" || type === "epf" || type === "ssy") return "debt";
  // An NPS account can span E/C/G; until goal assets support split buckets,
  // keep the blend visible as "other" rather than mislabelling the whole corpus.
  if (type === "nps") return "other";
  return "other";
}

export function holdingAllocationClass(
  assetClass: AssetClass,
  taxClass: GainsTaxClass,
): GoalAllocationClass {
  if (taxClass === "equity" || taxClass === "unlisted_shares") return "equity";
  if (
    taxClass === "specified_fund" ||
    taxClass === "market_linked_debenture" ||
    taxClass === "unlisted_bond" ||
    assetClass === "fd"
  ) {
    return "debt";
  }
  // A non-equity MF/ETF is debt-like for this high-level allocation view.
  if ((assetClass === "mutual_fund" || assetClass === "etf") && taxClass === "other") {
    return "debt";
  }
  return "other";
}

export function allocationPercentages(
  assets: Array<{ valuePaise: number; allocationClass: GoalAllocationClass }>,
): { equityPct: number; debtPct: number; otherPct: number } {
  const totals = { equity: 0, debt: 0, other: 0 };
  for (const asset of assets) {
    totals[asset.allocationClass] += Math.max(0, asset.valuePaise);
  }
  const total = totals.equity + totals.debt + totals.other;
  if (total === 0) return { equityPct: 0, debtPct: 0, otherPct: 0 };
  const equityPct = Math.round((totals.equity / total) * 1000) / 10;
  const debtPct = Math.round((totals.debt / total) * 1000) / 10;
  // Derive the final bucket so rounding always reconciles to exactly 100%.
  return { equityPct, debtPct, otherPct: Math.round((100 - equityPct - debtPct) * 10) / 10 };
}

/**
 * Display order for the allocation buckets. Equity first, matching the order
 * of the allocation pills already shown on the goal card (Equity, then Debt),
 * with `other` last as the residual bucket.
 */
const ALLOCATION_ORDER: Record<GoalAllocationClass, number> = {
  equity: 0,
  debt: 1,
  other: 2,
};

/**
 * Groups a goal's mapped assets by allocation class, largest holding first
 * within each group.
 *
 * Returns a new array rather than sorting in place: the caller also feeds this
 * list to `allocationPercentages` and `projectGoal`, and while both are
 * order-independent sums today, mutating a shared array to achieve a display
 * concern is the kind of coupling that breaks quietly later.
 *
 * Ties on value fall back to name then id so the order is fully deterministic
 * — two folios of the same fund holding identical amounts must not swap
 * position between requests just because the underlying query order changed.
 */
export function sortAssetsByAllocation<
  T extends { id: string; name: string; valuePaise: number; allocationClass: GoalAllocationClass },
>(assets: readonly T[]): T[] {
  return [...assets].sort((a, b) => {
    const byClass = ALLOCATION_ORDER[a.allocationClass] - ALLOCATION_ORDER[b.allocationClass];
    if (byClass !== 0) return byClass;
    if (b.valuePaise !== a.valuePaise) return b.valuePaise - a.valuePaise;
    const byName = a.name.localeCompare(b.name);
    if (byName !== 0) return byName;
    return a.id.localeCompare(b.id);
  });
}
