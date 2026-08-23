/**
 * scheme-limits.ts — pure statutory limit data for PPF / SSY / NPS Tier I
 * (task 13.6).
 *
 * Pure library: no DB, no I/O, no clock. Every amount is INTEGER PAISE.
 *   ₹250   =    25_000 paise
 *   ₹500   =    50_000 paise
 *   ₹1,000 =   100_000 paise
 *   ₹1.5L  = 15_000_000 paise
 *
 * The rule set is looked up per FY (`schemeRulesFor(kind, fy)`) so a future
 * Budget amendment can be expressed as a new FY entry instead of a code change
 * at every call site. The current values have not changed across the FYs Compass
 * models, so one base table serves every FY — the FY argument is still validated
 * (an unparseable label throws) so a caller cannot silently ask for limits with a
 * malformed FY.
 */

import { fyOf, parseFy } from "./financial-year.ts";

/** The three scheme flavours this task draws conclusions about. */
export type SchemeKind = "ppf" | "ssy" | "nps_tier1";

export interface SchemeRules {
  /** Minimum credit per FY to keep the account in good standing. */
  minAnnualPaise: number;
  /** Statutory ceiling per FY; null = no statutory max (NPS Tier I). */
  maxAnnualPaise: number | null;
  /** Deposits must be whole multiples of this amount. */
  minDepositMultiple: number;
  /** True when falling short of minAnnualPaise makes the account discontinued. */
  discontinuedBelowMin: boolean;
  /**
   * Cost of reviving one defaulted year: ₹50 revival fee + ₹500 arrears
   * = 55_000 paise. Reported in notes only — never computed into a total here.
   */
  revivalPenaltyPerYear: number;
  /** Deduction section this scheme's contributions fall under; null for NPS. */
  deductionSection: "80C" | null;
}

/** ₹1.5L 80C ceiling, in paise. */
export const SECTION_80C_CAP_PAISE = 15_000_000;

/** ₹50 revival fee + ₹500 arrears per defaulted year, in paise. */
export const PPF_REVIVAL_PENALTY_PER_YEAR_PAISE = 55_000;

/** Years from the END of the opening FY until a PPF account matures. */
export const PPF_MATURITY_YEARS = 15;

/** Years from the opening date during which SSY deposits are accepted. */
export const SSY_DEPOSIT_WINDOW_YEARS = 15;

/** Maximum age (in completed years) of the girl child on the SSY opening date. */
export const SSY_MAX_HOLDER_AGE_YEARS = 10;

const BASE_RULES: Record<SchemeKind, SchemeRules> = {
  ppf: {
    minAnnualPaise: 50_000, // ₹500
    maxAnnualPaise: 15_000_000, // ₹1.5L
    minDepositMultiple: 5_000, // ₹50
    discontinuedBelowMin: true,
    revivalPenaltyPerYear: PPF_REVIVAL_PENALTY_PER_YEAR_PAISE,
    deductionSection: "80C",
  },
  ssy: {
    minAnnualPaise: 25_000, // ₹250
    maxAnnualPaise: 15_000_000, // ₹1.5L
    minDepositMultiple: 5_000, // ₹50
    discontinuedBelowMin: true,
    revivalPenaltyPerYear: PPF_REVIVAL_PENALTY_PER_YEAR_PAISE,
    deductionSection: "80C",
  },
  nps_tier1: {
    minAnnualPaise: 100_000, // ₹1,000
    // No statutory ceiling. The 80CCD(1) salary-based cap is deferred to 13.8,
    // so this task exposes the raw contribution and no allocation at all.
    maxAnnualPaise: null,
    minDepositMultiple: 50_000, // ₹500
    discontinuedBelowMin: false,
    revivalPenaltyPerYear: 0,
    deductionSection: null,
  },
};

/**
 * Statutory rules for a scheme in a given FY.
 *
 * Returns a fresh object each call, so a caller cannot mutate the shared table.
 * Throws on a malformed FY label (delegated to parseFy).
 */
export function schemeRulesFor(kind: SchemeKind, fy: string): SchemeRules {
  parseFy(fy); // validate the label — throws on anything but "YYYY-YY"
  return { ...BASE_RULES[kind] };
}

/**
 * Adds whole years to an ISO date, clamping Feb 29 → Feb 28 in a non-leap
 * target year (Date.UTC would otherwise roll it forward to Mar 1 and silently
 * move a maturity/eligibility boundary by a day).
 */
export function addYearsIso(iso: string, years: number): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    throw new Error(`addYearsIso: invalid ISO date string "${iso}" — expected YYYY-MM-DD`);
  }
  const [yStr, mStr, dStr] = iso.split("-") as [string, string, string];
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  const target = new Date(Date.UTC(y + years, m - 1, d));
  // Overflowed into the next month (only possible for Feb 29 → non-leap year).
  if (target.getUTCMonth() !== m - 1) {
    target.setUTCDate(0); // last day of the intended month
  }
  return target.toISOString().slice(0, 10);
}

/**
 * PPF maturity date: 15 years from the END of the opening FY — NOT 15 years
 * from the opening date.
 *
 * @example ppfMaturityDate("2010-06-15") → "2026-03-31"
 *   (opened Jun 2010 → opening FY 2010-11, which ends 2011-03-31; +15 years)
 */
export function ppfMaturityDate(openedDate: string): string {
  const openingFyStartYear = parseFy(fyOf(openedDate));
  // End of opening FY = (startYear + 1)-03-31; +15 years → (startYear + 16)-03-31.
  return `${openingFyStartYear + 1 + PPF_MATURITY_YEARS}-03-31`;
}

/**
 * Last date an SSY deposit is accepted: 15 years from the opening date
 * (inclusive).
 *
 * @example ssyDepositWindowEnd("2015-08-10") → "2030-08-10"
 */
export function ssyDepositWindowEnd(openedDate: string): string {
  return addYearsIso(openedDate, SSY_DEPOSIT_WINDOW_YEARS);
}

/**
 * Completed years between two ISO dates (i.e. age on `onDate`). The anniversary
 * itself counts as the full year: someone born 2015-04-01 is exactly 10 on
 * 2025-04-01.
 *
 * Returns a negative-free result only for onDate >= from; a caller passing an
 * earlier `onDate` gets a negative number, which the caller must interpret.
 */
export function completedYearsBetween(from: string, onDate: string): number {
  const [fy, fm, fd] = from.split("-").map(Number) as [number, number, number];
  const [ty, tm, td] = onDate.split("-").map(Number) as [number, number, number];
  let years = ty - fy;
  if (tm < fm || (tm === fm && td < fd)) years -= 1;
  return years;
}
