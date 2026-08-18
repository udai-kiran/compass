/**
 * Pure split-math functions. No DB access, no side effects.
 * All amounts are integer paise.
 */

/**
 * Split totalPaise equally among memberCount people.
 * Remainder (totalPaise % memberCount) paise go to the FIRST N members.
 * Returns an array of length memberCount that sums to totalPaise.
 */
export function computeEqualShares(totalPaise: number, memberCount: number): number[] {
  if (memberCount <= 0) throw new Error("memberCount must be > 0");
  const base = Math.floor(totalPaise / memberCount);
  const remainder = totalPaise % memberCount;
  return Array.from({ length: memberCount }, (_, i) => base + (i < remainder ? 1 : 0));
}

/**
 * Split totalPaise proportionally by ratios (positive integers).
 * Uses the largest-remainder method to ensure the output sums exactly to totalPaise.
 */
export function computeProportionalShares(totalPaise: number, ratios: number[]): number[] {
  if (ratios.length === 0) throw new Error("ratios must be non-empty");
  if (ratios.some((r) => r <= 0)) throw new Error("all ratios must be > 0");
  const total = ratios.reduce((a, b) => a + b, 0);
  const exact = ratios.map((r) => (r / total) * totalPaise);
  const floors = exact.map(Math.floor);
  const remainder = totalPaise - floors.reduce((a, b) => a + b, 0);
  // Distribute remainder paise to the members with largest fractional parts
  const fractionals = exact.map((e, i) => ({ i, frac: e - floors[i]! }));
  fractionals.sort((a, b) => b.frac - a.frac || a.i - b.i);
  for (let k = 0; k < remainder; k++) {
    floors[fractionals[k]!.i]! += 1;
  }
  return floors;
}

/**
 * Validate that shares sum exactly to totalPaise.
 * Returns the shortfall (negative means overshoot).
 * Returns 0 if valid.
 */
export function validateExactShares(shares: number[], totalPaise: number): number {
  const sum = shares.reduce((a, b) => a + b, 0);
  return totalPaise - sum;
}
