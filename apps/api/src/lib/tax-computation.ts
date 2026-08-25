/**
 * tax-computation.ts — Pure income-tax computation engine (task 13.8).
 *
 * All amounts: integer paise. All rates: basis points (100 bps = 1%).
 * Statutory computation order:
 *   1. Slab tax on taxable income
 *   2. 87A rebate (with marginal relief at the threshold)
 *   3. Tax after rebate
 *   4. Surcharge on tax after rebate (with marginal relief at each surcharge boundary)
 *   5. Tax after surcharge = taxAfterRebate + actualSurcharge - marginalReliefPaise
 *   6. Health & education cess (cessBps / 10000 × taxAfterSurcharge)
 *   7. Total = taxAfterSurcharge + cess
 *
 * Note: 87A rebate threshold and surcharge threshold never overlap for any FY
 * in scope (max rebate threshold ₹12L < surcharge threshold ₹50L), so step
 * ordering between 2 and 4 is immaterial in practice.
 *
 * §288A (§288A of the Income Tax Act, 1961): total income is rounded to the
 * nearest ₹10 (1000 paise) before computing tax. Fractions of ₹10 under ₹5
 * round down; ₹5 and above round up — matching Math.round on paise/1000.
 * Applied inside computeTaxBreakdown before slab / rebate / surcharge / cess.
 * §288B: the final amount payable is rounded to the nearest ₹10 (1000 paise),
 * applied at the very end of computeTaxBreakdown after summing surcharge + cess.
 */

import type { Regime, RegimeRules, TaxSlabEntry } from "./tax-rules.ts";

export interface TaxBreakdown {
  taxableIncomePaise: number;
  taxOnSlabsPaise: number;
  rebate87APaise: number;
  taxAfterRebatePaise: number;
  surchargePaise: number;
  marginalReliefPaise: number;
  taxAfterSurchargePaise: number;
  cessPaise: number;
  totalLiabilityPaise: number;
}

/**
 * Progressive slab tax. The formula for income I:
 *   For each slab [lower, upper] at rateBps:
 *     prevUpper = slab.lowerPaise - 1   (= -1 for the first slab where lower=0)
 *     taxable_in_band = min(I, upper ?? I) - prevUpper
 *     tax += floor(taxable_in_band * rateBps / 10000)
 *
 * The first slab (lower=0) overcounts by 1 paise but is always at 0% so has no effect.
 * Skips slabs where I ≤ prevUpper (income does not reach this slab).
 */
export function computeSlabTax(taxableIncomePaise: number, slabs: TaxSlabEntry[]): number {
  let tax = 0;
  for (const slab of slabs) {
    const prevUpper = slab.lowerPaise - 1;
    if (taxableIncomePaise <= prevUpper) break;
    const slabUpper = slab.upperPaise ?? taxableIncomePaise;
    const taxableInBand = Math.min(taxableIncomePaise, slabUpper) - prevUpper;
    tax += Math.floor((taxableInBand * slab.rateBps) / 10000);
  }
  return tax;
}

/**
 * 87A rebate with regime-specific threshold behaviour.
 *
 * Standard rebate: if income ≤ threshold, rebate = min(slabTax, maxRelief).
 *
 * Old regime (§115BAC does NOT apply): the §87A rebate is a hard cliff.
 * If income exceeds the threshold by even 1 paise, the ENTIRE rebate is lost —
 * there is no marginal-relief proviso. Return 0 for any income above the threshold.
 *
 * New regime (§115BAC): a statutory marginal-relief proviso ensures that the net
 * tax after rebate cannot exceed (net_at_threshold + excess):
 *   net_at_threshold = slabTax(threshold) - rebate(slabTax(threshold))  [= 0 for FY 2025-26]
 *   excess = income - threshold
 *   relief = max(0, slabTax - (net_at_threshold + excess))
 *
 * Returns the rebate amount (≥ 0). Returns 0 if rebate is null.
 *
 * The `RegimeRules` `marginalRelief` field governs surcharge relief only (see
 * `computeSurcharge`); it has no bearing on the §87A threshold treatment above.
 */
export function compute87ARebate(
  slabTax: number,
  taxableIncomePaise: number,
  rebate: RegimeRules["rebate87A"],
  slabs: TaxSlabEntry[],
  regime: Regime,
): number {
  if (!rebate) return 0;

  if (taxableIncomePaise <= rebate.thresholdPaise) {
    return Math.min(slabTax, rebate.maxReliefPaise);
  }

  // Old regime: hard cliff — income even 1 paise above threshold loses the entire rebate.
  if (regime === "old") return 0;

  // New regime: statutory marginal relief keeps net tax from exceeding tax-at-threshold + excess.
  const taxAtThreshold = computeSlabTax(rebate.thresholdPaise, slabs);
  const rebateAtThreshold = Math.min(taxAtThreshold, rebate.maxReliefPaise);
  const netAtThreshold = taxAtThreshold - rebateAtThreshold;
  const excess = taxableIncomePaise - rebate.thresholdPaise;
  const relief = Math.max(0, slabTax - (netAtThreshold + excess));
  return relief;
}

/**
 * Surcharge with optional marginal relief.
 *
 * Marginal relief at each surcharge band boundary T (the upper of the previous band):
 *   boundary = prevBand.upperPaise
 *   slabTaxAtBoundary = computeSlabTax(boundary, slabs)
 *   surchargeAtBoundary = floor(slabTaxAtBoundary * prevBand.rateBps / 10000)
 *   netAtBoundary = slabTaxAtBoundary + surchargeAtBoundary
 *   excess = totalIncomePaise - boundary
 *   maxNet = netAtBoundary + excess
 *   if (slabTax + prescribed_surcharge) > maxNet:
 *     actual_surcharge = maxNet - slabTax (or 0 if negative)
 *     marginalReliefPaise = prescribed_surcharge - actual_surcharge
 *
 * Note: `taxAfterRebate` is passed as the tax base for surcharge (= slabTax since
 * rebate and surcharge never overlap in scope FYs). This keeps the computation general.
 */
export function computeSurcharge(
  taxAfterRebate: number,
  totalIncomePaise: number,
  rules: RegimeRules,
): { surchargePaise: number; marginalReliefPaise: number } {
  const { surchargeSlabs, slabs, marginalRelief } = rules;

  // Find the current surcharge band
  let bandIndex = -1;
  for (let i = 0; i < surchargeSlabs.length; i++) {
    const s = surchargeSlabs[i]!;
    if (
      totalIncomePaise >= s.lowerPaise &&
      (s.upperPaise === null || totalIncomePaise <= s.upperPaise)
    ) {
      bandIndex = i;
      break;
    }
  }

  if (bandIndex < 0 || surchargeSlabs[bandIndex]!.rateBps === 0) {
    return { surchargePaise: 0, marginalReliefPaise: 0 };
  }

  const band = surchargeSlabs[bandIndex]!;
  const prescribedSurcharge = Math.floor((taxAfterRebate * band.rateBps) / 10000);

  if (!marginalRelief || bandIndex === 0) {
    return { surchargePaise: prescribedSurcharge, marginalReliefPaise: 0 };
  }

  const prevBand = surchargeSlabs[bandIndex - 1]!;
  const boundary = prevBand.upperPaise!; // always non-null for non-last bands
  const slabTaxAtBoundary = computeSlabTax(boundary, slabs);
  const surchargeAtBoundary = Math.floor((slabTaxAtBoundary * prevBand.rateBps) / 10000);
  const netAtBoundary = slabTaxAtBoundary + surchargeAtBoundary;
  const excess = totalIncomePaise - boundary;
  const maxNet = netAtBoundary + excess;
  const currentNet = taxAfterRebate + prescribedSurcharge;

  if (currentNet <= maxNet) {
    return { surchargePaise: prescribedSurcharge, marginalReliefPaise: 0 };
  }

  const actualSurcharge = Math.max(0, maxNet - taxAfterRebate);
  const marginalReliefAmount = prescribedSurcharge - actualSurcharge;
  return { surchargePaise: actualSurcharge, marginalReliefPaise: marginalReliefAmount };
}

/**
 * Full tax breakdown for a given taxable income and regime rules.
 * taxableIncomePaise must be >= 0; negative values are clamped to 0.
 *
 * §288A rounding is applied to total income before any computation.
 * §288B rounding is applied to the final total liability before returning.
 */
export function computeTaxBreakdown(
  taxableIncomePaise: number,
  rules: RegimeRules,
): TaxBreakdown {
  const taxable = Math.max(0, taxableIncomePaise);
  // §288A: round total income to the nearest ₹10 (1000 paise) before computing tax
  const taxableRounded = Math.round(taxable / 1000) * 1000;

  const taxOnSlabs = computeSlabTax(taxableRounded, rules.slabs);
  const rebate87A = compute87ARebate(taxOnSlabs, taxableRounded, rules.rebate87A, rules.slabs, rules.regime);
  const taxAfterRebate = Math.max(0, taxOnSlabs - rebate87A);

  const { surchargePaise, marginalReliefPaise } = computeSurcharge(
    taxAfterRebate,
    taxableRounded,
    rules,
  );

  const taxAfterSurcharge = taxAfterRebate + surchargePaise;
  const cess = Math.floor((taxAfterSurcharge * rules.cessBps) / 10000);
  const totalLiability = taxAfterSurcharge + cess;
  // §288B: round the final amount payable to the nearest ₹10 (1000 paise)
  const totalLiabilityRounded = Math.round(totalLiability / 1000) * 1000;

  return {
    taxableIncomePaise: taxableRounded,
    taxOnSlabsPaise: taxOnSlabs,
    rebate87APaise: rebate87A,
    taxAfterRebatePaise: taxAfterRebate,
    surchargePaise,
    marginalReliefPaise,
    taxAfterSurchargePaise: taxAfterSurcharge,
    cessPaise: cess,
    totalLiabilityPaise: totalLiabilityRounded,
  };
}
