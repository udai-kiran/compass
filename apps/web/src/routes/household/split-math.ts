/**
 * Client-side split math (mirrors the API-side pure functions).
 * Used in the split modal for live share preview before submitting.
 */

export function computeEqualShares(totalPaise: number, memberCount: number): number[] {
  if (memberCount <= 0) throw new Error("memberCount must be > 0");
  const base = Math.floor(totalPaise / memberCount);
  const remainder = totalPaise % memberCount;
  return Array.from({ length: memberCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

export function computeProportionalShares(totalPaise: number, ratios: number[]): number[] {
  if (ratios.length === 0) throw new Error("ratios must be non-empty");
  if (ratios.some((r) => r <= 0)) throw new Error("all ratios must be > 0");
  const total = ratios.reduce((a, b) => a + b, 0);
  const exact = ratios.map((r) => (r / total) * totalPaise);
  const floors = exact.map(Math.floor);
  const remainder = totalPaise - floors.reduce((a, b) => a + b, 0);
  const fractionals = exact.map((e, i) => ({ i, frac: e - Math.floor(e) }));
  fractionals.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) floors[fractionals[k]!.i]! += 1;
  return floors;
}

export function validateExactShares(shares: number[], totalPaise: number): number {
  return totalPaise - shares.reduce((a, b) => a + b, 0);
}
