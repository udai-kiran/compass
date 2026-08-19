export type InstrumentCategory =
  | "elss"
  | "ppf"
  | "epf_vpf"
  | "ssy"
  | "nsc"
  | "tax_saver_fd"
  | "sgb"
  | "equity_mf"
  | "debt_mf"
  | "liquid_mf"
  | "fd"
  | "rd"
  | "direct_stock"
  | "equity_etf"
  | "nps";

export type AllocationLeg = "equity" | "debt";

export interface LockInRule {
  months: number;
  perInstalment: boolean;
  /** For SGB: can exit at year 5 on coupon-payment dates */
  earlyExitWindowMonths?: number;
}

export interface TaxRule {
  /** e.g. "80C", "80CCD(1B)", null = no deduction */
  deductionSection: string | null;
  /** null = gains taxed as income (no distinct LTCG) */
  ltcgRatePct: number | null;
  /** null = gains taxed as income */
  stcgRatePct: number | null;
  /** months of holding for LTCG classification; null if gainsAsIncome */
  holdingMonthsForLtcg: number | null;
  /** annual LTCG exemption in paise; null if not applicable */
  exemptionLimitPaise: number | null;
  /** PPF, EPF (≥5y service), SSY: entire maturity is tax-free */
  maturityExempt: boolean;
  /** FD, RD, post-2023 debt MF: gains taxed as ordinary income */
  gainsAsIncome: boolean;
}

export interface LiquidityRule {
  prematureExitPermitted: boolean;
  /** human-readable description of penalty/exit load; null if no exit permitted */
  penaltyDescription: string | null;
}

export interface HorizonFit {
  /** minimum recommended holding in months */
  minMonths: number;
  /** null = no upper bound */
  maxMonths: number | null;
  allocationLeg: AllocationLeg;
}

export interface InstrumentRule {
  category: InstrumentCategory;
  /** ISO date "YYYY-MM-DD" */
  effectiveFrom: string;
  /** null = currently in effect */
  effectiveTo: string | null;
  lockIn: LockInRule | null;
  tax: TaxRule;
  liquidity: LiquidityRule;
  horizon: HorizonFit;
}

const INSTRUMENT_REGISTRY: InstrumentRule[] = [
  // ELSS - Pre Budget 2024
  {
    category: "elss",
    effectiveFrom: "1900-01-01",
    effectiveTo: "2024-07-22",
    lockIn: { months: 36, perInstalment: true },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: 10,
      stcgRatePct: 15,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_00_00_000, // ₹1L = 1,00,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: { prematureExitPermitted: false, penaltyDescription: null },
    horizon: { minMonths: 36, maxMonths: null, allocationLeg: "equity" },
  },
  // ELSS - Post Budget 2024
  {
    category: "elss",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    lockIn: { months: 36, perInstalment: true },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: 12.5,
      stcgRatePct: 20,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_25_00_000, // ₹1.25L = 1,25,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: { prematureExitPermitted: false, penaltyDescription: null },
    horizon: { minMonths: 36, maxMonths: null, allocationLeg: "equity" },
  },
  // PPF - single epoch
  {
    category: "ppf",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 180, perInstalment: false, earlyExitWindowMonths: 84 },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: true,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Partial withdrawal permitted from year 7; premature closure only under exceptional circumstances",
    },
    horizon: { minMonths: 84, maxMonths: null, allocationLeg: "debt" },
  },
  // EPF/VPF - single epoch
  {
    category: "epf_vpf",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 0, perInstalment: false },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: true,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Partial withdrawal permitted for specific purposes; TDS applies on premature withdrawal before 5 years",
    },
    horizon: { minMonths: 60, maxMonths: null, allocationLeg: "debt" },
  },
  // SSY - single epoch
  {
    category: "ssy",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 252, perInstalment: false },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: true,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "50% of balance may be withdrawn for higher education at age 18",
    },
    horizon: { minMonths: 168, maxMonths: null, allocationLeg: "debt" },
  },
  // NSC - single epoch
  {
    category: "nsc",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 60, perInstalment: false },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: true,
    },
    liquidity: { prematureExitPermitted: false, penaltyDescription: null },
    horizon: { minMonths: 60, maxMonths: 60, allocationLeg: "debt" },
  },
  // Tax Saver FD - single epoch
  {
    category: "tax_saver_fd",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 60, perInstalment: false },
    tax: {
      deductionSection: "80C",
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: true,
    },
    liquidity: { prematureExitPermitted: false, penaltyDescription: null },
    horizon: { minMonths: 60, maxMonths: 60, allocationLeg: "debt" },
  },
  // SGB - Pre Budget 2024
  {
    category: "sgb",
    effectiveFrom: "1900-01-01",
    effectiveTo: "2024-07-22",
    lockIn: { months: 96, perInstalment: false, earlyExitWindowMonths: 60 },
    tax: {
      deductionSection: null,
      ltcgRatePct: 0,
      stcgRatePct: null,
      holdingMonthsForLtcg: 36,
      exemptionLimitPaise: null,
      maturityExempt: true,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Exit available on interest payment dates from year 5 onward",
    },
    horizon: { minMonths: 60, maxMonths: 96, allocationLeg: "debt" },
  },
  // SGB - Post Budget 2024
  {
    category: "sgb",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    lockIn: { months: 96, perInstalment: false, earlyExitWindowMonths: 60 },
    tax: {
      deductionSection: null,
      ltcgRatePct: 12.5,
      stcgRatePct: null,
      holdingMonthsForLtcg: 24,
      exemptionLimitPaise: null,
      maturityExempt: true,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Exit available on interest payment dates from year 5 onward",
    },
    horizon: { minMonths: 60, maxMonths: 96, allocationLeg: "debt" },
  },
  // Equity MF - Pre Budget 2024
  {
    category: "equity_mf",
    effectiveFrom: "1900-01-01",
    effectiveTo: "2024-07-22",
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 10,
      stcgRatePct: 15,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_00_00_000, // ₹1L = 1,00,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription: "Exit load typically 1% within 1 year",
    },
    horizon: { minMonths: 36, maxMonths: null, allocationLeg: "equity" },
  },
  // Equity MF - Post Budget 2024
  {
    category: "equity_mf",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 12.5,
      stcgRatePct: 20,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_25_00_000, // ₹1.25L = 1,25,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription: "Exit load typically 1% within 1 year",
    },
    horizon: { minMonths: 36, maxMonths: null, allocationLeg: "equity" },
  },
  // Debt MF - Pre Finance Act 2023
  {
    category: "debt_mf",
    effectiveFrom: "1900-01-01",
    effectiveTo: "2023-03-31",
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 20,
      stcgRatePct: null,
      holdingMonthsForLtcg: 36,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Exit load varies by fund (typically 0.25–1% within 1 year)",
    },
    horizon: { minMonths: 12, maxMonths: null, allocationLeg: "debt" },
  },
  // Debt MF - Post Finance Act 2023
  {
    category: "debt_mf",
    effectiveFrom: "2023-04-01",
    effectiveTo: null,
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: true,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Exit load varies by fund (typically 0.25–1% within 1 year)",
    },
    horizon: { minMonths: 12, maxMonths: null, allocationLeg: "debt" },
  },
  // Liquid MF - single epoch
  {
    category: "liquid_mf",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: true,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "T+1 redemption; some funds have graded exit load within 7 days",
    },
    horizon: { minMonths: 0, maxMonths: 11, allocationLeg: "debt" },
  },
  // FD - single epoch
  {
    category: "fd",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: true,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Premature withdrawal permitted; interest rate typically reduced by 0.5–1%",
    },
    horizon: { minMonths: 1, maxMonths: 60, allocationLeg: "debt" },
  },
  // RD - single epoch
  {
    category: "rd",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 12, perInstalment: false },
    tax: {
      deductionSection: null,
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: true,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription: "Premature closure permitted with interest penalty",
    },
    horizon: { minMonths: 12, maxMonths: 60, allocationLeg: "debt" },
  },
  // Direct Stock - Pre Budget 2024
  {
    category: "direct_stock",
    effectiveFrom: "1900-01-01",
    effectiveTo: "2024-07-22",
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 10,
      stcgRatePct: 15,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_00_00_000, // ₹1L = 1,00,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: { prematureExitPermitted: true, penaltyDescription: null },
    horizon: { minMonths: 60, maxMonths: null, allocationLeg: "equity" },
  },
  // Direct Stock - Post Budget 2024
  {
    category: "direct_stock",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 12.5,
      stcgRatePct: 20,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_25_00_000, // ₹1.25L = 1,25,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: { prematureExitPermitted: true, penaltyDescription: null },
    horizon: { minMonths: 60, maxMonths: null, allocationLeg: "equity" },
  },
  // Equity ETF - Pre Budget 2024
  {
    category: "equity_etf",
    effectiveFrom: "1900-01-01",
    effectiveTo: "2024-07-22",
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 10,
      stcgRatePct: 15,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_00_00_000, // ₹1L = 1,00,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription: "Exchange-traded; brokerage/STT applies on sale",
    },
    horizon: { minMonths: 36, maxMonths: null, allocationLeg: "equity" },
  },
  // Equity ETF - Post Budget 2024
  {
    category: "equity_etf",
    effectiveFrom: "2024-07-23",
    effectiveTo: null,
    lockIn: null,
    tax: {
      deductionSection: null,
      ltcgRatePct: 12.5,
      stcgRatePct: 20,
      holdingMonthsForLtcg: 12,
      exemptionLimitPaise: 1_25_00_000, // ₹1.25L = 1,25,000 rupees × 100 paise
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription: "Exchange-traded; brokerage/STT applies on sale",
    },
    horizon: { minMonths: 36, maxMonths: null, allocationLeg: "equity" },
  },
  // NPS - single epoch
  {
    category: "nps",
    effectiveFrom: "1900-01-01",
    effectiveTo: null,
    lockIn: { months: 0, perInstalment: false },
    tax: {
      deductionSection: "80CCD(1B)",
      ltcgRatePct: null,
      stcgRatePct: null,
      holdingMonthsForLtcg: null,
      exemptionLimitPaise: null,
      maturityExempt: false,
      gainsAsIncome: false,
    },
    liquidity: {
      prematureExitPermitted: true,
      penaltyDescription:
        "Partial withdrawal for specific purposes after 3 years; premature exit (before 60) requires 80% annuitisation",
    },
    horizon: { minMonths: 180, maxMonths: null, allocationLeg: "debt" },
  },
];

/**
 * Returns the rule applicable to `category` on `onDate`.
 * Throws if no entry matches — never silently defaults.
 */
export function getInstrumentRule(
  category: InstrumentCategory,
  onDate: Date,
): InstrumentRule {
  const iso = onDate.toISOString().slice(0, 10);
  const rule = INSTRUMENT_REGISTRY.find(
    (r) =>
      r.category === category &&
      r.effectiveFrom <= iso &&
      (r.effectiveTo === null || r.effectiveTo >= iso),
  );
  if (!rule) {
    throw new Error(
      `No instrument rule found for category "${category}" as of ${iso}`,
    );
  }
  return rule;
}

/**
 * Returns all instrument categories whose horizon fits the given leg and
 * minimum horizon, using rules effective on `onDate` (defaults to today).
 * A category is included when:
 *  - Its allocationLeg matches `leg`
 *  - Its lockIn (if present) does not exceed `horizonMonths`
 *  - The rule is effective on `onDate`
 * Uniquified — each category appears at most once.
 */
export function listSuitableCategories(
  leg: AllocationLeg,
  horizonMonths: number,
  onDate: Date = new Date(),
): InstrumentCategory[] {
  const iso = onDate.toISOString().slice(0, 10);
  const seen = new Set<InstrumentCategory>();
  const result: InstrumentCategory[] = [];
  for (const rule of INSTRUMENT_REGISTRY) {
    if (
      rule.horizon.allocationLeg !== leg ||
      rule.effectiveFrom > iso ||
      (rule.effectiveTo !== null && rule.effectiveTo < iso)
    ) {
      continue;
    }
    if (rule.lockIn && rule.lockIn.months > horizonMonths) continue;
    if (!seen.has(rule.category)) {
      seen.add(rule.category);
      result.push(rule.category);
    }
  }
  return result;
}
