/**
 * Multi-goal allocation engine: splits the available monthly surplus across
 * competing goals in one pass, respecting priority order and horizon urgency,
 * and reports which goals slip when the surplus is insufficient.
 *
 * Pure — no DB, no clock. The DB-backed route layer loads goals and calls here.
 */

/**
 * One goal's data as passed in by the caller (DB-loaded, stripped to what
 * the allocation math needs).
 */
export interface GoalAllocationEntry {
  id: string;
  goalType: string; // "emergency_fund" | "retirement" | "home" | ...
  monthsToTarget: number | null; // null = undated
  /** Required monthly inflow to hit target on time (from goal-projection) */
  requiredMonthlyPaise: number | null; // null = undated, no requirement
  /** Current corpus mapped to this goal (paise) */
  fundedPaise: number;
  /** Target corpus (paise); null = undated / no target */
  targetPaise: number | null;
  /** Blended return BPS of the goal's mapped assets — used for slip estimate */
  blendedReturnBps: number;
  /** User-defined priority: lower = higher priority (from goals.sortOrder) */
  sortOrder: number;
}

export interface GoalAllocationResult {
  goalId: string;
  /** Monthly amount allocated to this goal out of the surplus (≥ 0) */
  allocatedMonthlyPaise: number;
  /** True when the full requiredMonthlyPaise is covered */
  fullyCovered: boolean;
  /**
   * Estimated months by which the goal's completion slips vs its original
   * monthsToTarget, given only allocatedMonthlyPaise instead of required.
   * 0 = fully covered or goal has no target date.
   * null = the goal cannot be reached at the allocated rate (e.g. funded=0, allocated=0).
   */
  slipMonths: number | null;
}

export interface MultiGoalAllocationPlan {
  /** Ordered same as the sorted input (emergency fund first, then by urgency/priority) */
  perGoal: GoalAllocationResult[];
  /** Sum of all allocatedMonthlyPaise */
  totalAllocatedPaise: number;
  /**
   * Remainder of surplus after all allocations.
   * Positive when the surplus exceeds every goal's requirement.
   */
  freeCashPaise: number;
}

/** Effective monthly rate from an annual rate in basis points. */
function monthlyRate(annualBps: number): number {
  return (1 + annualBps / 10_000) ** (1 / 12) - 1;
}

/**
 * Binary search (max 64 iterations, tolerance 0.5 month) for the number of
 * months T at which:
 *   fundedPaise × (1+rm)^T + allocatedPaise × ((1+rm)^T − 1) / rm >= targetPaise
 *
 * Returns 0 if already funded, null if unreachable within 12000 months.
 */
function estimateMonthsToTarget(
  fundedPaise: number,
  targetPaise: number,
  allocatedPaise: number,
  rm: number,
): number | null {
  if (fundedPaise >= targetPaise) return 0;

  const fvAt = (T: number): number => {
    const compound = (1 + rm) ** T;
    const corpusFV = fundedPaise * compound;
    const annuityFV =
      Math.abs(rm) < 1e-9
        ? allocatedPaise * T
        : (allocatedPaise * (compound - 1)) / rm;
    return corpusFV + annuityFV;
  };

  const hi = 12000;
  if (fvAt(hi) < targetPaise) return null;

  let lo = 0;
  let hiSearch = hi;

  for (let i = 0; i < 64; i++) {
    const mid = (lo + hiSearch) / 2;
    if (fvAt(mid) >= targetPaise) {
      hiSearch = mid;
    } else {
      lo = mid;
    }
    if (hiSearch - lo < 0.5) break;
  }

  return hiSearch;
}

/**
 * Estimate how many months the goal slips beyond its target date when only
 * allocatedPaise (instead of the full required amount) is invested each month.
 * Returns 0 for goals with no target date or already-funded goals.
 * Returns null when the goal is unreachable at the allocated rate.
 */
function computeSlipMonths(
  entry: GoalAllocationEntry,
  allocatedPaise: number,
): number | null {
  if (entry.monthsToTarget === null || entry.targetPaise === null) return 0;

  const rm = monthlyRate(entry.blendedReturnBps);
  const T = estimateMonthsToTarget(
    entry.fundedPaise,
    entry.targetPaise,
    allocatedPaise,
    rm,
  );

  if (T === null) return null;
  return Math.max(0, Math.round(T - entry.monthsToTarget));
}

/**
 * Sort entries per the allocation priority rule:
 * 1. emergency_fund first
 * 2. monthsToTarget ASC, nulls last
 * 3. sortOrder ASC (tie-break)
 */
function sortEntries(entries: GoalAllocationEntry[]): GoalAllocationEntry[] {
  return [...entries].sort((a, b) => {
    const aEmergency = a.goalType === "emergency_fund" ? 0 : 1;
    const bEmergency = b.goalType === "emergency_fund" ? 0 : 1;
    if (aEmergency !== bEmergency) return aEmergency - bEmergency;

    const aMonths = a.monthsToTarget;
    const bMonths = b.monthsToTarget;
    if (aMonths !== null && bMonths !== null) {
      if (aMonths !== bMonths) return aMonths - bMonths;
    } else if (aMonths !== null) {
      return -1; // dated before undated
    } else if (bMonths !== null) {
      return 1;
    }

    return a.sortOrder - b.sortOrder;
  });
}

export function allocateAcrossGoals(
  entries: GoalAllocationEntry[],
  availableSurplusPaise: number,
): MultiGoalAllocationPlan {
  const sorted = sortEntries(entries);
  let remainingSurplus = Math.max(0, availableSurplusPaise);

  const perGoal: GoalAllocationResult[] = [];

  for (const entry of sorted) {
    const required = entry.requiredMonthlyPaise;

    if (required === null || required <= 0) {
      perGoal.push({
        goalId: entry.id,
        allocatedMonthlyPaise: 0,
        fullyCovered: true,
        slipMonths: 0,
      });
      continue;
    }

    const allocated = Math.min(required, remainingSurplus);
    remainingSurplus -= allocated;
    const fullyCovered = allocated >= required;

    const slipMonths = fullyCovered ? 0 : computeSlipMonths(entry, allocated);

    perGoal.push({
      goalId: entry.id,
      allocatedMonthlyPaise: allocated,
      fullyCovered,
      slipMonths,
    });
  }

  const totalAllocatedPaise = perGoal.reduce(
    (sum, g) => sum + g.allocatedMonthlyPaise,
    0,
  );

  return {
    perGoal,
    totalAllocatedPaise,
    freeCashPaise: remainingSurplus,
  };
}
