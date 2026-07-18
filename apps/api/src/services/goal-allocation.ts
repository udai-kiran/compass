import type { AccountType, AssetClass, GainsTaxClass } from "@compass/shared";

export type GoalAllocationClass = "equity" | "debt" | "other";

export function accountAllocationClass(type: AccountType): GoalAllocationClass {
  if (type === "investment") return "equity";
  if (type === "ppf" || type === "epf" || type === "ssy") return "debt";
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
