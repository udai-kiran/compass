/**
 * tax-rules.ts — Effective-dated Indian income-tax rule data.
 *
 * All monetary amounts are integer paise (1 INR = 100 paise).
 * All rates are in basis points (bps): 100 bps = 1%, 3000 bps = 30%.
 *
 * Covers FY 2023-24 through FY 2026-27 for both 'old' and 'new' regimes.
 * A lookup for an unknown FY throws — never silently defaults.
 *
 * Slab boundary convention (statute-faithful, inclusive upper):
 *   - upperPaise = exact threshold (e.g. lakh(4) = ₹4,00,000)
 *   - next slab lowerPaise = upperPaise + 1 paise
 *   This matches the statutory "up to ₹4L: nil; ₹4,00,001 onward: 5%" language.
 *
 * Overlap and duplicate-key validation runs at module load time and throws if
 * any duplicates or contiguity violations are detected.
 *
 * References:
 *  - Finance Acts 2023, 2024, 2025 (Union Budgets presented Feb 2023–2025)
 *  - Section 87A, 80C, 80CCD(1B), 80CCD(2), 80D of the Income Tax Act
 *  - Section 234B/234C: 1% per month interest on advance tax defaults
 *  - Finance Act 2024 §115BAC(1A): 14% employer NPS deduction for all employers under new regime
 */

import { parseFy } from "./financial-year.ts";

// ─── Types ────────────────────────────────────────────────────────────────────

export type Regime = "old" | "new";

/**
 * Taxpayer classification used for old-regime slab selection.
 * New regime has no taxpayer-type distinction.
 */
export type TaxpayerType = "ordinary" | "senior" | "super_senior";

/** A single income-tax slab entry. */
export interface TaxSlabEntry {
  /** Lower bound, inclusive (paise). */
  lowerPaise: number;
  /** Upper bound, inclusive (paise). null = no upper bound (top slab).
   *  Convention: upperPaise = exact statutory threshold (e.g. lakh(4) for ₹4L boundary).
   *  Next slab's lower = this upper + 1. */
  upperPaise: number | null;
  /** Tax rate in basis points (e.g. 3000 = 30%). */
  rateBps: number;
}

/** Per-regime income-tax rules for a given FY. */
export interface RegimeRules {
  regime: Regime;
  fy: string;
  taxpayerType: TaxpayerType;
  slabs: TaxSlabEntry[];
  /** Standard deduction (salary income). Paise. */
  standardDeductionPaise: number;
  /** Section 87A rebate. null if not applicable. */
  rebate87A: {
    /** Taxable income must be ≤ this for the rebate to apply (paise). */
    thresholdPaise: number;
    /** Maximum rebate amount (paise). */
    maxReliefPaise: number;
  } | null;
  /** Surcharge on tax, keyed by total income bracket.
   *  Convention: upperPaise = exact threshold (inclusive). Nil band ends at exactly ₹50L.
   *  Surcharge applies only when income EXCEEDS the threshold (next band lower = upper + 1). */
  surchargeSlabs: Array<{
    lowerPaise: number;
    upperPaise: number | null;
    rateBps: number;
  }>;
  /** Health & education cess in bps (400 = 4%). */
  cessBps: number;
  /** Whether marginal relief applies (prevents the net tax + surcharge from
   *  exceeding tax on the slab boundary plus the marginal income above it). */
  marginalRelief: boolean;
}

/** Deduction cap for a specific section, FY and regime applicability. */
export interface DeductionCap {
  /** Section identifier: "80C", "80CCD(1B)", "80CCD(2)", "80D_self", "80D_self_senior",
   *  "80D_parents", "80D_parents_senior". */
  section: string;
  fy: string;
  /** Which regime(s) this cap applies to. */
  regime: Regime | "both";
  /** Maximum deductible amount in paise. 0 = percentage-based (see employerRatesBps). */
  capPaise: number;
  /** Human-readable applicability notes. */
  conditions?: string;
  /**
   * For 80CCD(2): per-employer-type rate caps in basis points of Basic+DA.
   * Present only on 80CCD(2) entries (capPaise = 0 in those cases).
   */
  employerRatesBps?: Array<{
    employerType: "private" | "government";
    rateBpsOfBasic: number;
  }>;
}

/** Advance-tax instalment schedule for a given FY. */
export interface AdvanceTaxSchedule {
  fy: string;
  instalments: Array<{
    /** ISO date (due date). */
    dueDate: string;
    /** Cumulative percentage of total tax liability due by this date. */
    cumulativePct: number;
  }>;
  /** Interest rate per month in bps for 234B/234C (100 = 1%). */
  interestRateBpsPerMonth: number;
  /** Senior citizens (≥60 years, no business income) are exempt. */
  seniorCitizenExempt: boolean;
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

const PAISE_PER_RUPEE = 100;
const L = 100_000 * PAISE_PER_RUPEE;   // 1 lakh in paise
const CR = 10_000_000 * PAISE_PER_RUPEE; // 1 crore in paise

function lakh(n: number): number { return Math.round(n * L); }
function crore(n: number): number { return Math.round(n * CR); }

// ─── Slab data ───────────────────────────────────────────────────────────────

/**
 * Regime rules, keyed by "FY|regime|taxpayerType" (e.g. "2025-26|new|ordinary").
 */
const REGIME_RULES_MAP: Map<string, RegimeRules> = new Map();

function regimeKey(fy: string, regime: Regime, taxpayerType: TaxpayerType): string {
  return `${fy}|${regime}|${taxpayerType}`;
}

function addRegimeRules(rules: RegimeRules): void {
  const key = regimeKey(rules.fy, rules.regime, rules.taxpayerType);
  if (REGIME_RULES_MAP.has(key)) {
    throw new Error(`tax-rules: duplicate regime rules for key "${key}"`);
  }
  REGIME_RULES_MAP.set(key, rules);
}

// ─── Old-regime surcharge slabs (identical across FY 2023-24 → 2026-27) ──────
// Statute-faithful inclusive upper: nil band ends at exactly ₹50L (crore(0.5)).
// Surcharge applies only when income EXCEEDS the threshold, so next band lower = upper + 1.

const OLD_REGIME_SURCHARGE = [
  { lowerPaise: 0,              upperPaise: crore(0.5),     rateBps: 0 },
  { lowerPaise: crore(0.5) + 1, upperPaise: crore(1),       rateBps: 1000 },
  { lowerPaise: crore(1) + 1,   upperPaise: crore(2),       rateBps: 1500 },
  { lowerPaise: crore(2) + 1,   upperPaise: crore(5),       rateBps: 2500 },
  { lowerPaise: crore(5) + 1,   upperPaise: null,           rateBps: 3700 },
];

// New regime surcharge capped at 25% (no 37% band since Finance Act 2023).
const NEW_REGIME_SURCHARGE = [
  { lowerPaise: 0,              upperPaise: crore(0.5),     rateBps: 0 },
  { lowerPaise: crore(0.5) + 1, upperPaise: crore(1),       rateBps: 1000 },
  { lowerPaise: crore(1) + 1,   upperPaise: crore(2),       rateBps: 1500 },
  { lowerPaise: crore(2) + 1,   upperPaise: null,           rateBps: 2500 },
];

// ─── FY 2023-24 ──────────────────────────────────────────────────────────────

// Old regime FY 2023-24 — ordinary individual (₹2.5L exemption)
addRegimeRules({
  fy: "2023-24", regime: "old", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(2.5),    rateBps: 0 },
    { lowerPaise: lakh(2.5) + 1,  upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2023-24 — senior citizen (₹3L exemption, age 60–80)
addRegimeRules({
  fy: "2023-24", regime: "old", taxpayerType: "senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(3),      rateBps: 0 },
    { lowerPaise: lakh(3) + 1,    upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2023-24 — super-senior citizen (₹5L exemption, age ≥80)
// No 5% slab — the 2.5-5L band is subsumed by the ₹5L basic exemption.
addRegimeRules({
  fy: "2023-24", regime: "old", taxpayerType: "super_senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(5),      rateBps: 0 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// New regime FY 2023-24 (revised slabs from Finance Act 2023)
// New regime has no taxpayer-type distinction — all types use ordinary.
addRegimeRules({
  fy: "2023-24", regime: "new", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,             upperPaise: lakh(3),      rateBps: 0 },
    { lowerPaise: lakh(3) + 1,   upperPaise: lakh(6),      rateBps: 500 },
    { lowerPaise: lakh(6) + 1,   upperPaise: lakh(9),      rateBps: 1000 },
    { lowerPaise: lakh(9) + 1,   upperPaise: lakh(12),     rateBps: 1500 },
    { lowerPaise: lakh(12) + 1,  upperPaise: lakh(15),     rateBps: 2000 },
    { lowerPaise: lakh(15) + 1,  upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),  // ₹50,000 (from Finance Act 2023)
  rebate87A: { thresholdPaise: lakh(7), maxReliefPaise: 2_500_000 },
  surchargeSlabs: NEW_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// ─── FY 2024-25 ──────────────────────────────────────────────────────────────

// Old regime FY 2024-25 (unchanged from 2023-24) — ordinary
addRegimeRules({
  fy: "2024-25", regime: "old", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(2.5),    rateBps: 0 },
    { lowerPaise: lakh(2.5) + 1,  upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2024-25 — senior
addRegimeRules({
  fy: "2024-25", regime: "old", taxpayerType: "senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(3),      rateBps: 0 },
    { lowerPaise: lakh(3) + 1,    upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2024-25 — super-senior
addRegimeRules({
  fy: "2024-25", regime: "old", taxpayerType: "super_senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(5),      rateBps: 0 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// New regime FY 2024-25 (Finance Act 2024 — revised slabs)
addRegimeRules({
  fy: "2024-25", regime: "new", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,             upperPaise: lakh(3),      rateBps: 0 },
    { lowerPaise: lakh(3) + 1,   upperPaise: lakh(7),      rateBps: 500 },
    { lowerPaise: lakh(7) + 1,   upperPaise: lakh(10),     rateBps: 1000 },
    { lowerPaise: lakh(10) + 1,  upperPaise: lakh(12),     rateBps: 1500 },
    { lowerPaise: lakh(12) + 1,  upperPaise: lakh(15),     rateBps: 2000 },
    { lowerPaise: lakh(15) + 1,  upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.75),  // ₹75,000 (raised in Finance Act 2024)
  rebate87A: { thresholdPaise: lakh(7), maxReliefPaise: 2_500_000 },
  surchargeSlabs: NEW_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// ─── FY 2025-26 ──────────────────────────────────────────────────────────────

// Old regime FY 2025-26 (unchanged) — ordinary
addRegimeRules({
  fy: "2025-26", regime: "old", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(2.5),    rateBps: 0 },
    { lowerPaise: lakh(2.5) + 1,  upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2025-26 — senior
addRegimeRules({
  fy: "2025-26", regime: "old", taxpayerType: "senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(3),      rateBps: 0 },
    { lowerPaise: lakh(3) + 1,    upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2025-26 — super-senior
addRegimeRules({
  fy: "2025-26", regime: "old", taxpayerType: "super_senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(5),      rateBps: 0 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// New regime FY 2025-26 (Finance Act 2025 — significantly revised slabs)
// Slabs: ₹0-4L nil, ₹4-8L 5%, ₹8-12L 10%, ₹12-16L 15%, ₹16-20L 20%, ₹20-24L 25%, >₹24L 30%
// Rebate 87A: up to ₹60,000 for income ≤ ₹12L (zero tax after rebate; marginal relief up to ₹12.75L)
addRegimeRules({
  fy: "2025-26", regime: "new", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,             upperPaise: lakh(4),      rateBps: 0 },
    { lowerPaise: lakh(4) + 1,   upperPaise: lakh(8),      rateBps: 500 },
    { lowerPaise: lakh(8) + 1,   upperPaise: lakh(12),     rateBps: 1000 },
    { lowerPaise: lakh(12) + 1,  upperPaise: lakh(16),     rateBps: 1500 },
    { lowerPaise: lakh(16) + 1,  upperPaise: lakh(20),     rateBps: 2000 },
    { lowerPaise: lakh(20) + 1,  upperPaise: lakh(24),     rateBps: 2500 },
    { lowerPaise: lakh(24) + 1,  upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.75),
  rebate87A: {
    thresholdPaise: lakh(12),   // up to ₹12L (pre-cess taxable income)
    maxReliefPaise: 6_000_000,  // ₹60,000 (full tax rebate up to ₹12L)
  },
  surchargeSlabs: NEW_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// ─── FY 2026-27 ──────────────────────────────────────────────────────────────
// Finance Act 2026 was introduced in February 2026 and received presidential
// assent on 30 March 2026, confirming the same slabs as FY 2025-26. These
// entries carry those rates forward. Update if a revised Act is published.

// Old regime FY 2026-27 (carried forward from 2025-26) — ordinary
addRegimeRules({
  fy: "2026-27", regime: "old", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(2.5),    rateBps: 0 },
    { lowerPaise: lakh(2.5) + 1,  upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2026-27 — senior
addRegimeRules({
  fy: "2026-27", regime: "old", taxpayerType: "senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(3),      rateBps: 0 },
    { lowerPaise: lakh(3) + 1,    upperPaise: lakh(5),      rateBps: 500 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// Old regime FY 2026-27 — super-senior
addRegimeRules({
  fy: "2026-27", regime: "old", taxpayerType: "super_senior",
  slabs: [
    { lowerPaise: 0,              upperPaise: lakh(5),      rateBps: 0 },
    { lowerPaise: lakh(5) + 1,    upperPaise: lakh(10),     rateBps: 2000 },
    { lowerPaise: lakh(10) + 1,   upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.5),
  rebate87A: { thresholdPaise: lakh(5), maxReliefPaise: 1_250_000 },
  surchargeSlabs: OLD_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// New regime FY 2026-27 (carried forward from 2025-26)
addRegimeRules({
  fy: "2026-27", regime: "new", taxpayerType: "ordinary",
  slabs: [
    { lowerPaise: 0,             upperPaise: lakh(4),      rateBps: 0 },
    { lowerPaise: lakh(4) + 1,   upperPaise: lakh(8),      rateBps: 500 },
    { lowerPaise: lakh(8) + 1,   upperPaise: lakh(12),     rateBps: 1000 },
    { lowerPaise: lakh(12) + 1,  upperPaise: lakh(16),     rateBps: 1500 },
    { lowerPaise: lakh(16) + 1,  upperPaise: lakh(20),     rateBps: 2000 },
    { lowerPaise: lakh(20) + 1,  upperPaise: lakh(24),     rateBps: 2500 },
    { lowerPaise: lakh(24) + 1,  upperPaise: null,         rateBps: 3000 },
  ],
  standardDeductionPaise: lakh(0.75),
  rebate87A: { thresholdPaise: lakh(12), maxReliefPaise: 6_000_000 },
  surchargeSlabs: NEW_REGIME_SURCHARGE,
  cessBps: 400, marginalRelief: true,
});

// ─── Deduction caps ──────────────────────────────────────────────────────────

const DEDUCTION_CAPS: DeductionCap[] = [];
const DEDUCTION_CAP_KEYS = new Set<string>();

function addDeductionCap(cap: DeductionCap): void {
  const key = `${cap.section}|${cap.fy}|${cap.regime}`;
  if (DEDUCTION_CAP_KEYS.has(key)) {
    throw new Error(`tax-rules: duplicate deduction cap for key "${key}"`);
  }
  DEDUCTION_CAP_KEYS.add(key);
  DEDUCTION_CAPS.push(cap);
}

// 80C — available only under old regime; ₹1.5L cap for FY 2023-24 to 2026-27
for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
  addDeductionCap({
    section: "80C", fy, regime: "old",
    capPaise: lakh(1.5),
    conditions: "Aggregate of 80C + 80CCC + 80CCD(1) ≤ ₹1.5L",
  });
}

// 80CCD(1B) — NPS additional deduction; only old regime; ₹50,000 cap
for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
  addDeductionCap({
    section: "80CCD(1B)", fy, regime: "old",
    capPaise: lakh(0.5),
    conditions: "Additional NPS contribution over 80C limit",
  });
}

// 80CCD(2) — Employer NPS contribution; per-regime entries with employer-rate bps.
// Old regime all FYs: private 10% (1000 bps), government 14% (1400 bps).
// New regime FY23-24: same as old (private 10%, govt 14%).
// New regime FY24-25 onward: Finance Act 2024 §115BAC(1A) — 14% for ALL employers.
for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
  addDeductionCap({
    section: "80CCD(2)", fy, regime: "old",
    capPaise: 0,
    conditions: "Employer NPS contribution — old regime: 10% of Basic+DA (private), 14% (government). No fixed paise cap.",
    employerRatesBps: [
      { employerType: "private",    rateBpsOfBasic: 1000 },
      { employerType: "government", rateBpsOfBasic: 1400 },
    ],
  });
}

// New regime FY 2023-24: same rates as old regime
addDeductionCap({
  section: "80CCD(2)", fy: "2023-24", regime: "new",
  capPaise: 0,
  conditions: "Employer NPS contribution — new regime FY23-24: 10% (private), 14% (government). Finance Act 2024 §115BAC(1A) not yet in effect.",
  employerRatesBps: [
    { employerType: "private",    rateBpsOfBasic: 1000 },
    { employerType: "government", rateBpsOfBasic: 1400 },
  ],
});

// New regime FY 2024-25 onward: 14% for ALL employers (Finance Act 2024 §115BAC(1A))
for (const fy of ["2024-25", "2025-26", "2026-27"]) {
  addDeductionCap({
    section: "80CCD(2)", fy, regime: "new",
    capPaise: 0,
    conditions: "Employer NPS contribution — new regime FY24-25+: 14% for all employers (Finance Act 2024 §115BAC(1A)).",
    employerRatesBps: [
      { employerType: "private",    rateBpsOfBasic: 1400 },
      { employerType: "government", rateBpsOfBasic: 1400 },
    ],
  });
}

// 80D — health insurance premium; old regime only; four variants:
//   80D_self        — self + family (non-senior), ₹25,000
//   80D_self_senior — self + family (taxpayer is senior citizen), ₹50,000
//   80D_parents     — parents (non-senior), ₹25,000
//   80D_parents_senior — senior-citizen parents (aged 60+), ₹50,000
for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
  addDeductionCap({
    section: "80D_self", fy, regime: "old",
    capPaise: lakh(0.25),
    conditions: "Health insurance premium for self, spouse, children (non-senior-citizen taxpayer)",
  });
  addDeductionCap({
    section: "80D_self_senior", fy, regime: "old",
    capPaise: lakh(0.5),
    conditions: "Health insurance premium for self, spouse, children where taxpayer or spouse is a senior citizen (aged 60+)",
  });
  addDeductionCap({
    section: "80D_parents", fy, regime: "old",
    capPaise: lakh(0.25),
    conditions: "Health insurance premium for parents (non-senior-citizen parents)",
  });
  addDeductionCap({
    section: "80D_parents_senior", fy, regime: "old",
    capPaise: lakh(0.5),
    conditions: "Health insurance premium for senior-citizen parents (aged 60+)",
  });
}

// ─── Advance-tax schedule ────────────────────────────────────────────────────

const ADVANCE_TAX_MAP: Map<string, AdvanceTaxSchedule> = new Map();

function addAdvanceTaxSchedule(schedule: AdvanceTaxSchedule): void {
  if (ADVANCE_TAX_MAP.has(schedule.fy)) {
    throw new Error(`tax-rules: duplicate advance-tax schedule for FY "${schedule.fy}"`);
  }
  ADVANCE_TAX_MAP.set(schedule.fy, schedule);
}

// The advance-tax instalment due dates are fixed by statute (Section 211):
//   15 June   — 15% of tax liability
//   15 Sept   — 45% cumulative
//   15 Dec    — 75% cumulative
//   15 March  — 100% cumulative
// These are identical for all FYs in scope (no Budget changes to this schedule).
const INSTALMENT_MONTHS = [
  { month: "06", day: "15", cumulativePct: 15 },
  { month: "09", day: "15", cumulativePct: 45 },
  { month: "12", day: "15", cumulativePct: 75 },
  { month: "03", day: "15", cumulativePct: 100 },
];

for (const fy of ["2023-24", "2024-25", "2025-26", "2026-27"]) {
  const startYear = Number(fy.slice(0, 4));
  const endYear = startYear + 1;
  addAdvanceTaxSchedule({
    fy,
    instalments: [
      { dueDate: `${startYear}-${INSTALMENT_MONTHS[0]!.month}-${INSTALMENT_MONTHS[0]!.day}`, cumulativePct: 15 },
      { dueDate: `${startYear}-${INSTALMENT_MONTHS[1]!.month}-${INSTALMENT_MONTHS[1]!.day}`, cumulativePct: 45 },
      { dueDate: `${startYear}-${INSTALMENT_MONTHS[2]!.month}-${INSTALMENT_MONTHS[2]!.day}`, cumulativePct: 75 },
      { dueDate: `${endYear}-${INSTALMENT_MONTHS[3]!.month}-${INSTALMENT_MONTHS[3]!.day}`, cumulativePct: 100 },
    ],
    interestRateBpsPerMonth: 100,  // 1% per month (Sections 234B, 234C)
    seniorCitizenExempt: true,     // Senior citizens (≥60) with no business income are exempt
  });
}

// ─── Boot-time overlap validation ────────────────────────────────────────────

/**
 * Validates that slab lower bounds are strictly increasing within each
 * regime+FY+taxpayerType combination, and that each slab's lower is exactly
 * one paise above the previous slab's upper (statute-faithful contiguity).
 * Throws on any anomaly.
 */
function validateSlabCoverage(): void {
  for (const [key, rules] of REGIME_RULES_MAP.entries()) {
    const { slabs } = rules;
    for (let i = 0; i < slabs.length; i++) {
      const slab = slabs[i]!;
      if (slab.lowerPaise < 0) {
        throw new Error(`tax-rules: slab ${i} in "${key}" has negative lowerPaise`);
      }
      if (slab.upperPaise !== null && slab.upperPaise < slab.lowerPaise) {
        throw new Error(`tax-rules: slab ${i} in "${key}" has upperPaise < lowerPaise`);
      }
      if (i > 0) {
        const prev = slabs[i - 1]!;
        if (prev.upperPaise === null) {
          throw new Error(`tax-rules: slab ${i - 1} in "${key}" is not the last slab but has null upperPaise`);
        }
        const expectedLower = prev.upperPaise + 1;
        if (slab.lowerPaise !== expectedLower) {
          throw new Error(
            `tax-rules: gap or overlap in slabs for "${key}" between slab ${i - 1} ` +
              `(upper=${prev.upperPaise}) and slab ${i} (lower=${slab.lowerPaise})`,
          );
        }
      }
    }
    // Last slab must have null upperPaise
    const lastSlab = slabs[slabs.length - 1]!;
    if (lastSlab.upperPaise !== null) {
      throw new Error(`tax-rules: last slab in "${key}" must have null upperPaise (no upper bound)`);
    }
  }
}

// Run at module load — throws if data is inconsistent.
validateSlabCoverage();

// ─── Lookup functions ─────────────────────────────────────────────────────────

/**
 * Returns regime-level income-tax rules for the given FY, regime, and
 * taxpayerType. Defaults to 'ordinary' if taxpayerType is not specified.
 *
 * New regime has no taxpayer-type distinction: 'senior' and 'super_senior'
 * map to the same rules as 'ordinary'.
 *
 * @throws {Error} If the FY label is invalid or not covered.
 */
export function getRegimeRules(
  fy: string,
  regime: Regime,
  taxpayerType: TaxpayerType = "ordinary",
): RegimeRules {
  // parseFy validates the format — throws on malformed input.
  parseFy(fy);
  // New regime has no taxpayer-type distinction.
  const effectiveTaxpayerType = regime === "new" ? "ordinary" : taxpayerType;
  const key = regimeKey(fy, regime, effectiveTaxpayerType);
  const rules = REGIME_RULES_MAP.get(key);
  if (!rules) {
    const available = [...new Set([...REGIME_RULES_MAP.keys()].map((k) => k.split("|")[0]))].sort();
    throw new Error(
      `tax-rules: no rules found for FY "${fy}" regime "${regime}" taxpayerType "${taxpayerType}". ` +
        `Available FYs: ${available.join(", ")}`,
    );
  }
  return rules;
}

/**
 * Returns all deduction caps for the given section and FY.
 * Throws a descriptive error if the FY is not in coveredFys() (AC4/AC5).
 * Returns an empty array if the section is not defined for that FY (some
 * sections are simply absent for a given regime/FY).
 *
 * @throws {Error} If the FY label is invalid or the FY is not covered.
 */
export function getDeductionCap(section: string, fy: string): DeductionCap[] {
  parseFy(fy);
  const covered = coveredFys();
  if (!covered.includes(fy)) {
    throw new Error(
      `tax-rules: FY "${fy}" is not in the covered deduction-cap data set. ` +
        `Available FYs: ${covered.join(", ")}`,
    );
  }
  return DEDUCTION_CAPS.filter((c) => c.section === section && c.fy === fy);
}

/**
 * Returns the advance-tax instalment schedule for the given FY.
 * Throws if the FY is not in the data set.
 *
 * @throws {Error} If the FY label is invalid or not covered.
 */
export function getAdvanceTaxSchedule(fy: string): AdvanceTaxSchedule {
  parseFy(fy);
  const schedule = ADVANCE_TAX_MAP.get(fy);
  if (!schedule) {
    const available = [...ADVANCE_TAX_MAP.keys()].sort();
    throw new Error(
      `tax-rules: no advance-tax schedule for FY "${fy}". ` +
        `Available FYs: ${available.join(", ")}`,
    );
  }
  return schedule;
}

/**
 * Returns the list of FY labels covered by the tax-rules data, sorted.
 */
export function coveredFys(): string[] {
  return [...new Set([...REGIME_RULES_MAP.keys()].map((k) => k.split("|")[0]!))].sort();
}
