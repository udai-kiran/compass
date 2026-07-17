/**
 * Pure goal projection: grow the assets mapped to a goal — plus the ongoing
 * monthly inflow into them — forward to the target date, and compare against the
 * target. Each asset compounds at its own assumed rate (see goal-returns.ts), so
 * a PPF folio and an equity fund in the same goal don't get averaged into one
 * blurry number; the reported `blendedReturnBps` is only a headline.
 *
 * No DB, no clock: `monthsToTarget` is passed in and the caller turns
 * `projectedMonths` into a date. Kept pure so the math is unit-testable, matching
 * the goal-networth grouping helper.
 */

export interface ProjectionAsset {
  valuePaise: number;
  /** assumed annual return, basis points (1200 = 12%) */
  annualReturnBps: number;
}

export interface ProjectionInput {
  assets: ProjectionAsset[];
  /** resolved target amount, paise (>= 0) */
  targetPaise: number;
  /** whole/fractional months from now to the target date; null when the goal has no date */
  monthsToTarget: number | null;
  /** ongoing monthly addition into the mapped accounts, paise (>= 0) */
  monthlyInflowPaise: number;
}

export interface ProjectionResult {
  fundedPaise: number;
  blendedReturnBps: number;
  /** projected value at the target date; null without a target date */
  projectedValuePaise: number | null;
  /** target − projected (positive = behind); null without a target date */
  shortfallPaise: number | null;
  /** months to reach the target at this pace; 0 if already met, null if unreachable */
  projectedMonths: number | null;
  /** monthly inflow needed to hit the target by the date; null without a target date */
  requiredMonthlyPaise: number | null;
  onTrack: boolean | null;
}

/** Effective monthly rate from an annual rate in basis points. */
function monthlyRate(annualBps: number): number {
  return (1 + annualBps / 10_000) ** (1 / 12) - 1;
}

/** Future value of the corpus at `months`: each asset compounds at its own rate. */
function corpusFutureValue(assets: ProjectionAsset[], months: number): number {
  const years = months / 12;
  return assets.reduce((sum, a) => sum + a.valuePaise * (1 + a.annualReturnBps / 10_000) ** years, 0);
}

/** Future value of `months` of `monthly` contributions, each growing at rate `rm`. */
function annuityFutureValue(monthly: number, months: number, rm: number): number {
  if (monthly <= 0 || months <= 0) return 0;
  if (Math.abs(rm) < 1e-9) return monthly * months;
  return monthly * (((1 + rm) ** months - 1) / rm);
}

/** How many months until corpus + inflow reaches `target`, growing at blended `rm`. */
function monthsToReach(funded: number, target: number, monthly: number, rm: number): number | null {
  if (funded >= target) return 0;
  if (Math.abs(rm) < 1e-9) {
    if (monthly <= 0) return null;
    return (target - funded) / monthly;
  }
  // funded·(1+rm)^k + monthly·((1+rm)^k − 1)/rm = target  ⇒  solve (1+rm)^k = x
  const c = monthly / rm;
  const denom = funded + c;
  if (denom <= 0) return null; // net liabilities and no inflow — never reached
  const x = (target + c) / denom;
  if (x <= 1) return null;
  const k = Math.log(x) / Math.log(1 + rm);
  return Number.isFinite(k) && k > 0 ? k : null;
}

export function projectGoal(input: ProjectionInput): ProjectionResult {
  const { assets, targetPaise, monthsToTarget, monthlyInflowPaise } = input;

  const fundedPaise = Math.round(assets.reduce((s, a) => s + a.valuePaise, 0));

  // Headline blended return: value-weighted over the earning (positive) assets.
  // Liabilities don't grow the goal, so they don't drag the assumed rate.
  const posWeight = assets.reduce((s, a) => s + Math.max(0, a.valuePaise), 0);
  const blendedReturnBps =
    posWeight > 0
      ? Math.round(assets.reduce((s, a) => s + Math.max(0, a.valuePaise) * a.annualReturnBps, 0) / posWeight)
      : 0;
  const rm = monthlyRate(blendedReturnBps);

  const projectedMonthsRaw = monthsToReach(fundedPaise, targetPaise, monthlyInflowPaise, rm);
  // Cap at 100 years so an unrealistically slow pace reads as "unreachable".
  const projectedMonths =
    projectedMonthsRaw === null ? null : projectedMonthsRaw > 1200 ? null : projectedMonthsRaw;

  if (monthsToTarget === null) {
    return {
      fundedPaise,
      blendedReturnBps,
      projectedValuePaise: null,
      shortfallPaise: null,
      projectedMonths,
      requiredMonthlyPaise: null,
      onTrack: null,
    };
  }

  const n = Math.max(0, monthsToTarget);
  const corpusFV = corpusFutureValue(assets, n);
  const projectedValuePaise = Math.round(corpusFV + annuityFutureValue(monthlyInflowPaise, n, rm));
  const shortfallPaise = Math.round(targetPaise - projectedValuePaise);
  const onTrack = projectedValuePaise >= targetPaise;

  // Monthly inflow needed to close the gap the corpus alone won't cover.
  let requiredMonthlyPaise: number;
  if (corpusFV >= targetPaise || n <= 0) {
    requiredMonthlyPaise = 0;
  } else {
    const factor = Math.abs(rm) < 1e-9 ? n : ((1 + rm) ** n - 1) / rm;
    requiredMonthlyPaise = Math.max(0, Math.ceil((targetPaise - corpusFV) / factor));
  }

  return {
    fundedPaise,
    blendedReturnBps,
    projectedValuePaise,
    shortfallPaise,
    projectedMonths,
    requiredMonthlyPaise,
    onTrack,
  };
}
