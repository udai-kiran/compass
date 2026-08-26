/**
 * prepay-vs-invest.ts — Prepay vs invest & rate-reset impact (task 15.1).
 *
 * Pure — no DB, no clock. Deterministic, integer paise throughout.
 * Uses existing amortize() from emis.ts for all amortization math.
 */

import { standardEmiPaise } from "@compass/shared";
import { amortize } from "./emis.ts";

// ── Rate-reset impact ─────────────────────────────────────────────────────────

export interface RateResetInput {
  currentRateBps: number;
  newRateBps: number;
  principalPaise: number;
  currentInstallmentPaise: number;
  currentTotalInstallments: number;
  paidInstallments: number;
}

export interface RateResetResult {
  currentRateBps: number;
  newRateBps: number;
  currentInstallmentPaise: number;
  currentTotalInstallments: number;
  remainingInstallments: number;
  outstandingPaise: number;
  sameEmi: {
    installmentPaise: number;
    newTotalInstallments: number;
    tenureChangedBy: number;
    totalInterestPaise: number;
    interestDeltaPaise: number;
  };
  sameTenure: {
    newInstallmentPaise: number;
    installmentDeltaPaise: number;
    totalInterestPaise: number;
    interestDeltaPaise: number;
  };
  baselineRemainingInterestPaise: number;
}

/**
 * Simulate N reducing-balance payments and return the remaining balance.
 * Unlike `amortize`, this always returns the balance after exactly `payments`
 * steps (0 if the loan pays off early), with no dependence on a separate
 * totalInstallments parameter.
 */
function balanceAfterPayments(
  outstandingPaise: number,
  annualRateBps: number,
  installmentPaise: number,
  payments: number,
): number {
  const r = annualRateBps / 10000 / 12;
  let balance = outstandingPaise;
  for (let i = 0; i < payments && balance > 0; i++) {
    const interest = Math.round(balance * r);
    const principalPart = Math.min(balance, installmentPaise - interest);
    balance -= Math.max(0, principalPart);
  }
  return balance;
}

/**
 * Binary search: how many installments to pay off outstandingPaise at
 * annualRateBps with a fixed installmentPaise.
 */
export function findTenureForEmi(
  outstandingPaise: number,
  annualRateBps: number,
  installmentPaise: number,
  maxInstallments: number = 1200,
): number {
  if (outstandingPaise <= 0) return 0;
  if (installmentPaise <= 0) return maxInstallments;

  const monthlyRate = annualRateBps / 10000 / 12;
  const firstMonthInterest = Math.round(outstandingPaise * monthlyRate);
  if (installmentPaise <= firstMonthInterest) return maxInstallments;

  let lo = 1;
  let hi = maxInstallments;
  while (lo < hi) {
    const mid = Math.floor((lo + hi) / 2);
    const rem = balanceAfterPayments(outstandingPaise, annualRateBps, installmentPaise, mid);
    if (rem <= 0) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

/** Total interest on remaining loan from current outstanding. */
function computeRemainingInterest(
  outstandingPaise: number,
  annualRateBps: number,
  installmentPaise: number,
  remainingInstallments: number,
): number {
  const { totalInterestPaise } = amortize(outstandingPaise, annualRateBps, installmentPaise, remainingInstallments, 0);
  return totalInterestPaise;
}

export function computeRateResetImpact(input: RateResetInput): RateResetResult {
  const remaining = input.currentTotalInstallments - input.paidInstallments;

  const { outstandingPaise } = amortize(
    input.principalPaise, input.currentRateBps,
    input.currentInstallmentPaise, input.currentTotalInstallments,
    input.paidInstallments,
  );

  const baselineInterest = computeRemainingInterest(
    outstandingPaise, input.currentRateBps, input.currentInstallmentPaise, remaining,
  );

  // Option 1: Same EMI, tenure changes
  const newTenure = findTenureForEmi(outstandingPaise, input.newRateBps, input.currentInstallmentPaise);
  const sameEmiInterest = computeRemainingInterest(
    outstandingPaise, input.newRateBps, input.currentInstallmentPaise, newTenure,
  );

  // Option 2: Same tenure, EMI changes
  const newEmi = remaining > 0 ? standardEmiPaise(outstandingPaise, input.newRateBps, remaining) : 0;
  const sameTenureInterest = computeRemainingInterest(outstandingPaise, input.newRateBps, newEmi, remaining);

  return {
    currentRateBps: input.currentRateBps,
    newRateBps: input.newRateBps,
    currentInstallmentPaise: input.currentInstallmentPaise,
    currentTotalInstallments: input.currentTotalInstallments,
    remainingInstallments: remaining,
    outstandingPaise,
    sameEmi: {
      installmentPaise: input.currentInstallmentPaise,
      newTotalInstallments: newTenure,
      tenureChangedBy: newTenure - remaining,
      totalInterestPaise: sameEmiInterest,
      interestDeltaPaise: sameEmiInterest - baselineInterest,
    },
    sameTenure: {
      newInstallmentPaise: newEmi,
      installmentDeltaPaise: newEmi - input.currentInstallmentPaise,
      totalInterestPaise: sameTenureInterest,
      interestDeltaPaise: sameTenureInterest - baselineInterest,
    },
    baselineRemainingInterestPaise: baselineInterest,
  };
}

// ── Prepay vs invest ──────────────────────────────────────────────────────────

export interface PrepayVsInvestInput {
  outstandingPaise: number;
  annualRateBps: number;
  installmentPaise: number;
  remainingInstallments: number;
  lumpSumPaise: number;
  prepaymentChargesPaise: number;
  regime: "old" | "new";
  investReturnBps: number;
  isHomeLoan: boolean;
  emergencyFundedPaise: number;
  emergencyTargetPaise: number | null;
  highInterestDebtPaise: number;
}

export interface PrepayOption {
  strategy: "tenure_reduction" | "emi_reduction";
  lumpSumPaise: number;
  newOutstandingPaise: number;
  newRemainingInstallments: number | null;
  tenureSavedInstallments: number | null;
  newInstallmentPaise: number | null;
  installmentReductionPaise: number | null;
  totalRemainingInterestPaise: number;
  interestSavedPaise: number;
}

export interface InvestAlternative {
  lumpSumPaise: number;
  assumedReturnBps: number;
  horizonMonths: number;
  projectedValuePaise: number;
  projectedGainPaise: number;
  postTaxGainPaise: number;
  riskNote: string;
}

export interface PrepayVsInvestResult {
  outstandingPaise: number;
  annualRateBps: number;
  remainingInstallments: number;
  lumpSumPaise: number;
  prepaymentChargesPaise: number;
  effectiveLumpSumPaise: number;
  tenureReduction: PrepayOption;
  emiReduction: PrepayOption;
  investAlternative: InvestAlternative;
  effectiveLoanRateBps: number;
  section24bApplied: boolean;
  recommendation: "prepay" | "invest" | "emergency_fund_first" | "high_interest_debt_first";
  recommendationReason: string;
  assumptions: string[];
}

const SECTION_24B_CAP_PAISE = 20_000_000; // Rs 2,00,000
const LTCG_EXEMPTION_PAISE = 12_500_000;  // Rs 1,25,000
const LTCG_TAX_BPS = 1250;               // 12.5%
const MARGINAL_TAX_RATE_BPS = 3000;      // 30% assumed for old-regime high bracket

function computePrepayOption(
  strategy: "tenure_reduction" | "emi_reduction",
  outstandingPaise: number,
  annualRateBps: number,
  installmentPaise: number,
  remainingInstallments: number,
  effectiveLumpSum: number,
  baselineInterest: number,
): PrepayOption {
  const newOutstanding = Math.max(0, outstandingPaise - effectiveLumpSum);

  if (newOutstanding === 0) {
    return {
      strategy, lumpSumPaise: effectiveLumpSum,
      newOutstandingPaise: 0, newRemainingInstallments: 0,
      tenureSavedInstallments: remainingInstallments,
      newInstallmentPaise: 0, installmentReductionPaise: installmentPaise,
      totalRemainingInterestPaise: 0, interestSavedPaise: baselineInterest,
    };
  }

  if (strategy === "tenure_reduction") {
    const newTenure = findTenureForEmi(newOutstanding, annualRateBps, installmentPaise);
    const newInterest = computeRemainingInterest(newOutstanding, annualRateBps, installmentPaise, newTenure);
    return {
      strategy, lumpSumPaise: effectiveLumpSum,
      newOutstandingPaise: newOutstanding,
      newRemainingInstallments: newTenure,
      tenureSavedInstallments: remainingInstallments - newTenure,
      newInstallmentPaise: null, installmentReductionPaise: null,
      totalRemainingInterestPaise: newInterest,
      interestSavedPaise: baselineInterest - newInterest,
    };
  }

  // emi_reduction
  const newEmi = remainingInstallments > 0
    ? standardEmiPaise(newOutstanding, annualRateBps, remainingInstallments)
    : 0;
  const newInterest = computeRemainingInterest(newOutstanding, annualRateBps, newEmi, remainingInstallments);
  return {
    strategy, lumpSumPaise: effectiveLumpSum,
    newOutstandingPaise: newOutstanding,
    newRemainingInstallments: null, tenureSavedInstallments: null,
    newInstallmentPaise: newEmi,
    installmentReductionPaise: installmentPaise - newEmi,
    totalRemainingInterestPaise: newInterest,
    interestSavedPaise: baselineInterest - newInterest,
  };
}

function computeInvestAlternative(
  lumpSumPaise: number,
  investReturnBps: number,
  horizonMonths: number,
): InvestAlternative {
  const annualRate = investReturnBps / 10000;
  const projectedValue = Math.round(lumpSumPaise * (1 + annualRate) ** (horizonMonths / 12));
  const gain = projectedValue - lumpSumPaise;
  const taxableGain = Math.max(0, gain - LTCG_EXEMPTION_PAISE);
  const tax = Math.round((taxableGain * LTCG_TAX_BPS) / 10000);
  const postTaxGain = gain - tax;

  return {
    lumpSumPaise, assumedReturnBps: investReturnBps, horizonMonths,
    projectedValuePaise: projectedValue, projectedGainPaise: gain,
    postTaxGainPaise: postTaxGain,
    riskNote: "Investment returns are market-linked and not guaranteed. " +
      "The projected gain assumes a constant annual return, which is unlikely in practice. " +
      "Interest saved by prepaying is certain and risk-free.",
  };
}

function effectiveRateAfter24b(
  annualRateBps: number,
  outstandingPaise: number,
  regime: "old" | "new",
  isHomeLoan: boolean,
): { effectiveRateBps: number; applied: boolean } {
  if (regime !== "old" || !isHomeLoan) {
    return { effectiveRateBps: annualRateBps, applied: false };
  }
  const monthlyRate = annualRateBps / 10000 / 12;
  const annualInterestEstimate = Math.round(outstandingPaise * monthlyRate * 12);
  if (annualInterestEstimate <= 0) return { effectiveRateBps: annualRateBps, applied: true };
  const deductibleInterest = Math.min(annualInterestEstimate, SECTION_24B_CAP_PAISE);
  const taxSaved = Math.round((deductibleInterest * MARGINAL_TAX_RATE_BPS) / 10000);
  const reductionFraction = taxSaved / annualInterestEstimate;
  const effectiveRateBps = Math.round(annualRateBps * (1 - reductionFraction));
  return { effectiveRateBps, applied: true };
}

export function computePrepayVsInvest(input: PrepayVsInvestInput): PrepayVsInvestResult {
  const {
    outstandingPaise, annualRateBps, installmentPaise, remainingInstallments,
    lumpSumPaise, prepaymentChargesPaise, regime, investReturnBps, isHomeLoan,
    emergencyFundedPaise, emergencyTargetPaise, highInterestDebtPaise,
  } = input;

  const effectiveLumpSum = Math.max(0, lumpSumPaise - prepaymentChargesPaise);

  const baselineInterest = computeRemainingInterest(
    outstandingPaise, annualRateBps, installmentPaise, remainingInstallments,
  );

  const tenureReduction = computePrepayOption(
    "tenure_reduction", outstandingPaise, annualRateBps,
    installmentPaise, remainingInstallments, effectiveLumpSum, baselineInterest,
  );
  const emiReduction = computePrepayOption(
    "emi_reduction", outstandingPaise, annualRateBps,
    installmentPaise, remainingInstallments, effectiveLumpSum, baselineInterest,
  );

  const investAlternative = computeInvestAlternative(lumpSumPaise, investReturnBps, remainingInstallments);

  const { effectiveRateBps, applied: section24bApplied } = effectiveRateAfter24b(
    annualRateBps, outstandingPaise, regime, isHomeLoan,
  );

  let recommendation: PrepayVsInvestResult["recommendation"];
  let recommendationReason: string;
  const assumptions: string[] = [];

  if (emergencyTargetPaise !== null && emergencyFundedPaise < emergencyTargetPaise) {
    recommendation = "emergency_fund_first";
    const shortfall = emergencyTargetPaise - emergencyFundedPaise;
    recommendationReason =
      `Your emergency fund is short by ${shortfall} paise. ` +
      "Before prepaying or investing, consider topping up the emergency fund — " +
      "it protects against income disruptions that could make both loan payments " +
      "and investments harder to sustain.";
  } else if (highInterestDebtPaise > 0) {
    recommendation = "high_interest_debt_first";
    recommendationReason =
      `You have ${highInterestDebtPaise} paise in high-interest revolving debt ` +
      "(typically 36–42% p.a. on credit cards). Clearing this first saves more " +
      "than either prepaying a lower-rate loan or investing.";
  } else {
    const interestSaved = tenureReduction.interestSavedPaise;
    const investGain = investAlternative.postTaxGainPaise;
    if (investGain > interestSaved && investReturnBps > effectiveRateBps + 200) {
      recommendation = "invest";
      recommendationReason =
        "The projected post-tax investment return exceeds the interest saved by prepaying, " +
        "with a margin that accounts for market risk. However, this assumes returns that are " +
        "not guaranteed — prepaying offers a certain saving.";
    } else {
      recommendation = "prepay";
      recommendationReason =
        "Prepaying saves a guaranteed amount of interest. The projected investment return " +
        (investGain <= interestSaved
          ? "does not exceed the certain interest saving."
          : "exceeds it by a narrow margin that does not adequately compensate for market risk.");
    }
  }

  assumptions.push(
    "Interest saved by prepaying is certain and risk-free.",
    `Investment return assumed at ${(investReturnBps / 100).toFixed(1)}% p.a. — this is not guaranteed.`,
    "LTCG exemption of ₹1,25,000 and tax at 12.5% applied to investment gains.",
  );
  if (section24bApplied) {
    assumptions.push(
      "Section 24(b) home-loan interest deduction (up to ₹2,00,000) applied under old regime, " +
      "assuming a 30% marginal tax rate.",
    );
  }
  if (prepaymentChargesPaise > 0) {
    assumptions.push(`Prepayment charges of ${prepaymentChargesPaise} paise deducted from the lump sum.`);
  }

  return {
    outstandingPaise, annualRateBps, remainingInstallments,
    lumpSumPaise, prepaymentChargesPaise, effectiveLumpSumPaise: effectiveLumpSum,
    tenureReduction, emiReduction, investAlternative,
    effectiveLoanRateBps: effectiveRateBps, section24bApplied,
    recommendation, recommendationReason, assumptions,
  };
}
