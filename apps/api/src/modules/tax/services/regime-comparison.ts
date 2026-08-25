/**
 * regime-comparison.ts — Old vs new regime tax comparison service (task 13.8).
 *
 * Pulls income from income_events (all accepted rows for the FY, sum of gross_paise).
 * Pulls deduction basket from getDeductionBasket().
 * Computes old and new regime liabilities using computeTaxBreakdown().
 * Computes crossover via binary search.
 *
 * HRA exemption and home-loan interest 24(b) are caller-supplied optional paise values.
 * 24(b) is capped at ₹2,00,000 (20_000_000 paise) for self-occupied property.
 *
 * All amounts: integer paise.
 */

import { eq, and, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import type { TaxpayerType, RegimeComparison } from "@compass/shared";
import { getRegimeRules } from "../../../lib/tax-rules.ts";
import { computeTaxBreakdown } from "../../../lib/tax-computation.ts";
import { getDeductionBasket } from "./deductions.ts";
import { incomeEvents } from "../schema.ts";
import { parseFy } from "../../../lib/financial-year.ts";
import { HttpError } from "../../../lib/errors.ts";
import { coveredFys, resolveEmployerNpsRateBps } from "../../../lib/tax-rules.ts";

const HOME_LOAN_24B_CAP_PAISE = 20_000_000; // ₹2,00,000

function effectiveRateBps(liability: number, gross: number): number {
  if (gross === 0) return 0;
  return Math.round((liability * 10000) / gross);
}

export async function compareRegimes(
  db: Db,
  userId: string,
  fy: string,
  opts: {
    taxpayerType?: TaxpayerType;
    hraExemptionPaise?: number;
    homeLoanInterestPaise?: number;
  } = {},
): Promise<RegimeComparison> {
  // Validate FY
  try { parseFy(fy); } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : `Invalid FY: "${fy}"`);
  }
  if (!coveredFys().includes(fy)) {
    throw new HttpError(400, `Regime comparison is not available for FY "${fy}"`);
  }

  const taxpayerType = opts.taxpayerType ?? "ordinary";
  const hraExemption = opts.hraExemptionPaise ?? 0;
  const homeLoan24b = Math.min(opts.homeLoanInterestPaise ?? 0, HOME_LOAN_24B_CAP_PAISE);

  // ── Income: per-kind sums from accepted income_events for the FY ─────────────
  // Grouped by incomeKind so we can cap the standard deduction at salary income
  // only (§16(ia): the standard deduction belongs to salary/pension, not to
  // interest, rent, or other income heads).
  const incomeRows = await db
    .select({
      incomeKind: incomeEvents.incomeKind,
      totalGross: sql<number>`coalesce(sum(${incomeEvents.grossPaise}), 0)`,
    })
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.fy, fy),
        eq(incomeEvents.status, "accepted"),
      ),
    )
    .groupBy(incomeEvents.incomeKind);

  let grossIncomePaise = 0;
  let salaryGrossPaise = 0;

  for (const row of incomeRows) {
    const gross = Number(row.totalGross ?? 0);
    if (!Number.isSafeInteger(gross)) {
      throw new HttpError(500, "Income aggregate exceeded a safe integer — refusing to lose paise");
    }
    grossIncomePaise += gross;
    if (row.incomeKind === "salary") {
      salaryGrossPaise = gross;
    }
  }

  // ── Deduction basket ─────────────────────────────────────────────────────────
  const basket = await getDeductionBasket(db, userId, fy);

  const eightyCEligible = basket.eightyC.eligiblePaise;
  const ccd1bEligible = basket.eightyCcd1b.eligiblePaise;
  // 80CCD(2) eligible must be computed per-regime: the employer NPS cap differs
  // by regime for FY2024-25+ (private employer: 10% old vs 14% new). Re-derive
  // BOTH regimes' CCD2 by re-applying per-regime rates to each basket entry —
  // basket.eightyCcd2.eligiblePaise is computed under the user's CURRENT effective
  // regime preference and must not be used for the comparison's other column.
  const ccd2EligibleNew = basket.eightyCcd2.entries.reduce((sum, entry) => {
    const newRateBps = resolveEmployerNpsRateBps(fy, "new", entry.employerType);
    const newCap = Math.floor((entry.salaryBasePaise * newRateBps) / 10000);
    return sum + Math.min(entry.contributedPaise, newCap);
  }, 0);
  const ccd2EligibleOld = basket.eightyCcd2.entries.reduce((sum, entry) => {
    const oldRateBps = resolveEmployerNpsRateBps(fy, "old", entry.employerType);
    const oldCap = Math.floor((entry.salaryBasePaise * oldRateBps) / 10000);
    return sum + Math.min(entry.contributedPaise, oldCap);
  }, 0);
  const eightyDEligible =
    basket.eightyD.selfFamily.eligiblePaise + basket.eightyD.parents.eligiblePaise;

  // ── Regime rules ─────────────────────────────────────────────────────────────
  const oldRules = getRegimeRules(fy, "old", taxpayerType);
  const newRules = getRegimeRules(fy, "new", "ordinary"); // new regime: no taxpayer-type distinction

  // ── Old regime ───────────────────────────────────────────────────────────────
  // §16(ia): standard deduction is capped at salary income — a taxpayer with no
  // salary (e.g. interest/rent-only) gets no standard deduction at all.
  const oldStdDeduction = Math.min(oldRules.standardDeductionPaise, salaryGrossPaise);
  const oldTotalDeductions =
    oldStdDeduction +
    hraExemption +
    eightyCEligible +
    ccd1bEligible +
    ccd2EligibleOld +
    eightyDEligible +
    homeLoan24b;
  const oldTaxableIncome = Math.max(0, grossIncomePaise - oldTotalDeductions);
  const oldBreakdown = computeTaxBreakdown(oldTaxableIncome, oldRules);

  const oldLiability: RegimeComparison["old"] = {
    regime: "old",
    deductions: {
      standardDeductionPaise: oldStdDeduction,
      hraExemptionPaise: hraExemption,
      eightyCEligiblePaise: eightyCEligible,
      eightyCcd1bEligiblePaise: ccd1bEligible,
      eightyCcd2EligiblePaise: ccd2EligibleOld,
      eightyDEligiblePaise: eightyDEligible,
      homeLoanInterest24bPaise: homeLoan24b,
      totalDeductionsPaise: oldTotalDeductions,
    },
    ...oldBreakdown,
    effectiveRateBps: effectiveRateBps(oldBreakdown.totalLiabilityPaise, grossIncomePaise),
  };

  // ── New regime ───────────────────────────────────────────────────────────────
  const newStdDeduction = Math.min(newRules.standardDeductionPaise, salaryGrossPaise);
  const newTotalDeductions = newStdDeduction + ccd2EligibleNew;
  const newTaxableIncome = Math.max(0, grossIncomePaise - newTotalDeductions);
  const newBreakdown = computeTaxBreakdown(newTaxableIncome, newRules);

  const newLiability: RegimeComparison["new"] = {
    regime: "new",
    deductions: {
      standardDeductionPaise: newStdDeduction,
      hraExemptionPaise: 0,
      eightyCEligiblePaise: 0,
      eightyCcd1bEligiblePaise: 0,
      eightyCcd2EligiblePaise: ccd2EligibleNew,
      eightyDEligiblePaise: 0,
      homeLoanInterest24bPaise: 0,
      totalDeductionsPaise: newTotalDeductions,
    },
    ...newBreakdown,
    effectiveRateBps: effectiveRateBps(newBreakdown.totalLiabilityPaise, grossIncomePaise),
  };

  // ── Crossover ────────────────────────────────────────────────────────────────
  // Binary search for total old-regime deduction D* such that
  // computeTaxBreakdown(max(0, gross - D*), oldRules).totalLiabilityPaise
  //   = newLiability.totalLiabilityPaise
  //
  // Monotone: old_tax decreases as D increases.
  // If old_tax(D=oldStdDeduction) ≤ new_tax → crossover already crossed; crossover = oldStdDeduction.
  // If old_tax(D=gross) ≥ new_tax → old regime never wins; return null.
  const newLiabilityTotal = newLiability.totalLiabilityPaise;

  let crossoverDeductionPaise: number | null = null;

  if (grossIncomePaise > 0) {
    const taxAtMinD = computeTaxBreakdown(
      Math.max(0, grossIncomePaise - oldStdDeduction),
      oldRules,
    ).totalLiabilityPaise;

    const taxAtMaxD = computeTaxBreakdown(0, oldRules).totalLiabilityPaise; // = 0

    if (taxAtMinD <= newLiabilityTotal) {
      // Old regime wins even without additional deductions
      crossoverDeductionPaise = oldStdDeduction;
    } else if (taxAtMaxD > newLiabilityTotal) {
      // Old regime never beats new (shouldn't happen since tax(0) = 0 ≤ any new_tax)
      crossoverDeductionPaise = null;
    } else {
      // Binary search: lo = oldStdDeduction, hi = grossIncomePaise
      let lo = oldStdDeduction;
      let hi = grossIncomePaise;
      for (let iter = 0; iter < 64; iter++) {
        const mid = Math.floor((lo + hi) / 2);
        const midTax = computeTaxBreakdown(
          Math.max(0, grossIncomePaise - mid),
          oldRules,
        ).totalLiabilityPaise;
        if (midTax <= newLiabilityTotal) {
          hi = mid;
        } else {
          lo = mid + 1;
        }
      }
      crossoverDeductionPaise = hi;
    }
  }

  // ── Recommendation ───────────────────────────────────────────────────────────
  const diff = oldLiability.totalLiabilityPaise - newLiability.totalLiabilityPaise;
  const INDIFFERENCE_THRESHOLD = 100_000; // ₹1,000 in paise
  let recommendation: RegimeComparison["recommendation"];
  let savingRegime: RegimeComparison["savingRegime"];
  if (Math.abs(diff) <= INDIFFERENCE_THRESHOLD) {
    recommendation = "indifferent";
    savingRegime = "new";
  } else if (diff < 0) {
    recommendation = "old";
    savingRegime = "old";
  } else {
    recommendation = "new";
    savingRegime = "new";
  }

  // ── Assumptions ─────────────────────────────────────────────────────────────
  const assumptions: string[] = [
    ...basket.eightyC.assumptions,
    "Income from income_events (accepted rows only); estimates and pending entries excluded.",
    "Labelled an estimate: pending income events, uncollected deductions, and manual adjustments may affect the final liability.",
    `FY: ${fy}. Slabs, rebates and cess as per tax-rules.ts data.`,
  ];
  if (homeLoan24b < (opts.homeLoanInterestPaise ?? 0)) {
    assumptions.push(
      `Home-loan interest capped at ₹2,00,000 (24(b) limit for self-occupied property).`,
    );
  }

  return {
    fy,
    taxpayerType,
    grossIncomePaise,
    old: oldLiability,
    new: newLiability,
    crossoverDeductionPaise,
    recommendation,
    savingPaise: Math.abs(diff),
    savingRegime,
    assumptions,
    isEstimate: true,
    generatedAt: new Date().toISOString(),
  };
}
