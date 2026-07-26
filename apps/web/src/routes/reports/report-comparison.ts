import type { Report } from "@compass/shared";

export function previousPeriodKey(period: "monthly" | "annual", key: string): string {
  if (period === "annual") return String(Number(key) - 1);
  const [year, month] = key.split("-").map(Number) as [number, number];
  const previous = new Date(Date.UTC(year, month - 2, 1));
  return `${previous.getUTCFullYear()}-${String(previous.getUTCMonth() + 1).padStart(2, "0")}`;
}

export type CategoryComparison = {
  id: string;
  name: string;
  currentPaise: number;
  previousPaise: number;
};

export function compareCategories(current: Report, previous: Report): CategoryComparison[] {
  const rows = new Map<string, CategoryComparison>();
  for (const category of current.categories) {
    const id = category.categoryId ?? "uncategorized";
    rows.set(id, { id, name: category.name, currentPaise: category.spentPaise, previousPaise: 0 });
  }
  for (const category of previous.categories) {
    const id = category.categoryId ?? "uncategorized";
    const row = rows.get(id) ?? { id, name: category.name, currentPaise: 0, previousPaise: 0 };
    row.previousPaise = category.spentPaise;
    rows.set(id, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.currentPaise - a.currentPaise || b.previousPaise - a.previousPaise,
  );
}

export type MerchantComparison = {
  merchant: string;
  currentPaise: number;
  currentCount: number;
  previousPaise: number;
  previousCount: number;
};

export function compareMerchants(current: Report, previous: Report): MerchantComparison[] {
  const rows = new Map<string, MerchantComparison>();
  for (const merchant of current.topMerchants) {
    rows.set(merchant.merchant, {
      merchant: merchant.merchant,
      currentPaise: merchant.spentPaise,
      currentCount: merchant.count,
      previousPaise: 0,
      previousCount: 0,
    });
  }
  for (const merchant of previous.topMerchants) {
    const row = rows.get(merchant.merchant) ?? {
      merchant: merchant.merchant,
      currentPaise: 0,
      currentCount: 0,
      previousPaise: 0,
      previousCount: 0,
    };
    row.previousPaise = merchant.spentPaise;
    row.previousCount = merchant.count;
    rows.set(merchant.merchant, row);
  }
  return [...rows.values()].sort(
    (a, b) => b.currentPaise - a.currentPaise || b.previousPaise - a.previousPaise,
  );
}
