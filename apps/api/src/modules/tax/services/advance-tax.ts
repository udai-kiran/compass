/**
 * advance-tax.ts — Advance tax position with Sec 234B/234C interest (task 13.10).
 *
 * Assembles the user's assessed tax from accepted income events (salary, interest,
 * dividend, rent, other) plus net capital gains after brought-forward set-off
 * (13.11), and computes:
 *   - the statutory instalment schedule (Sec 211: 15/45/75/100% by 15 Jun/Sep/Dec/Mar)
 *   - Sec 234C interest for deferment of each instalment — honouring the
 *     capital-gains timing exception: a gain arising late in the year is NOT
 *     retrospectively loaded onto earlier instalments; it enters the base only
 *     from the quarter in which it arose.
 *   - Sec 234B interest where less than 90% of the assessed tax is paid by the
 *     year end. Advance-tax PAYMENTS are not tracked in Compass yet, so TDS
 *     credits stand in for "paid" and shortfalls are worst-case.
 *
 * Senior citizens (≥60 on FY end) without business income are exempt entirely
 * (Sec 207) when the schedule marks seniorCitizenExempt.
 *
 * Everything here is an ESTIMATE that informs a payment decision; it is not a
 * filed return. All amounts are integer paise.
 */

import { and, eq, lte, sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import { incomeEvents } from "../schema.ts";
import { userProfiles } from "../../system/schema.ts";
import { getRegimePreference } from "./regime-preference.ts";
import { getDeductionBasket, isSeniorCitizenOnDate } from "./deductions.ts";
import { getCapitalPosition } from "./capital-losses.ts";
import {
  getRegimeRules,
  getAdvanceTaxSchedule,
  coveredFys,
  resolveEmployerNpsRateBps,
} from "../../../lib/tax-rules.ts";
import { computeTaxBreakdown } from "../../../lib/tax-computation.ts";
import { parseFy, fyOf, fyRange } from "../../../lib/financial-year.ts";
import { HttpError } from "../../../lib/errors.ts";
import type {
  AdvanceTaxInstalmentStatus,
  AdvanceTaxPosition,
} from "@compass/shared";

// ─── Instalment engine (pure — the CG timing exception lives here) ───────────

export interface InstalmentInput {
  /** Statutory due date (ISO). */
  dueDate: string;
  /** Cumulative percentage of assessed tax due by this date (15/45/75/100). */
  cumulativePct: number;
  /** Cumulative TDS credited through this due date. */
  cumulativeTdsPaise: number;
  /** Cumulative flat-tax on gains realised through this due date. */
  cumulativeCgTaxPaise: number;
}

export interface InstalmentComputationInput {
  instalments: InstalmentInput[];
  /** Tax on ordinary (non-CG) income for the full year. */
  ordinaryLiabilityPaise: number;
  /** Today (ISO) — interest accrues only on instalments whose date has passed. */
  todayStr: string;
}

/**
 * Per-instalment requirement + Sec 234C interest.
 *
 * The capital-gains TIMING EXCEPTION (the thing this task exists to get right):
 * each instalment's base includes only the CG tax attributable through THAT due
 * date, so a gain arising late in the year never burdens earlier instalments.
 * TDS is likewise credited as it accrues. Base floor is 0.
 */
export function computeInstalments(
  input: InstalmentComputationInput,
): { statuses: AdvanceTaxInstalmentStatus[]; total234CPaise: number } {
  const statuses: AdvanceTaxInstalmentStatus[] = [];
  let total234CPaise = 0;

  input.instalments.forEach((instalment, i) => {
    // Interest accrues only once the due date has fully passed (strict <) —
    // on the due date itself the instalment is still "upcoming".
    const duePassed = instalment.dueDate < input.todayStr;
    const base = Math.max(
      0,
      input.ordinaryLiabilityPaise +
        instalment.cumulativeCgTaxPaise -
        instalment.cumulativeTdsPaise,
    );
    const requiredCumulative = Math.floor((instalment.cumulativePct * base) / 100);
    // v1: advance-tax payments untracked → shortfall equals the requirement.
    const shortfall = requiredCumulative;
    const defermentMonths = defermentMonthsFor(i);
    const interest = duePassed ? interest234CFor(shortfall, defermentMonths) : 0;
    total234CPaise += interest;

    statuses.push({
      dueDate: instalment.dueDate,
      cumulativePct: instalment.cumulativePct,
      cumulativeTdsPaise: instalment.cumulativeTdsPaise,
      cumulativeCgTaxPaise: instalment.cumulativeCgTaxPaise,
      requiredCumulativePaise: requiredCumulative,
      shortfallPaise: shortfall,
      defermentMonths,
      interest234CPaise: interest,
    });
  });

  return { statuses, total234CPaise };
}

// ─── Flat capital-gains rates ────────────────────────────────────────────────

/**
 * Current-law flat CG rates (post-23 Jul 2024 regime): equity STCG 20%,
 * LTCG 12.5% over the ₹1.25L annual exemption. Pre-reform rates for older
 * disposals inside a split FY are deliberately ignored — see assumptions.
 */
export const CG_STCG_RATE_BPS = 2000;
export const CG_LTCG_RATE_BPS = 1250;
export const CG_LTCG_EXEMPTION_PAISE = 1_25_00_000;

/** Flat-rate tax on net gains; the LTCG exemption applies only against LTCG. */
export function computeCgTax(netStcgPaise: number, netLtcgPaise: number): number {
  const stcgTax = Math.floor((Math.max(0, netStcgPaise) * CG_STCG_RATE_BPS) / 10000);
  const taxableLtcg = Math.max(0, Math.max(0, netLtcgPaise) - CG_LTCG_EXEMPTION_PAISE);
  const ltcgTax = Math.floor((taxableLtcg * CG_LTCG_RATE_BPS) / 10000);
  return stcgTax + ltcgTax;
}

// ─── Sec 234C / 234B pure helpers ────────────────────────────────────────────

/** Months of deferment per statutory instalment index (0=Jun,1=Sep,2=Dec,3=Mar). */
export function defermentMonthsFor(instalmentIndex: number): number {
  if (!Number.isInteger(instalmentIndex) || instalmentIndex < 0 || instalmentIndex > 3) {
    throw new Error(`defermentMonthsFor: index ${instalmentIndex} out of range 0..3`);
  }
  return instalmentIndex === 3 ? 1 : 3;
}

/**
 * Sec 208 threshold: advance tax is payable only when the net amount is ≥ ₹10,000.
 * Below it there is NO obligation, hence no 234B/234C interest either.
 */
export const SEC208_THRESHOLD_PAISE = 10_00_000;

/** True when the net advance-tax payable crosses the Sec 208 obligation threshold. */
export function sec208Applies(netAdvanceTaxPayablePaise: number): boolean {
  return Number.isFinite(netAdvanceTaxPayablePaise) &&
    netAdvanceTaxPayablePaise >= SEC208_THRESHOLD_PAISE;
}

/**
 * Rule 119A rounding, expressed in paise:
 *   1. ignore any fraction of ₹100 in the INTEREST BASE (the shortfall), and
 *   2. round the resulting interest to the nearest ₹10 (Sec 288B rounding).
 */
export function rule119AInterest(basePaise: number, ratePerMonthFraction: number, months: number): number {
  if (!Number.isFinite(basePaise) || basePaise <= 0 || months <= 0) return 0;
  const roundedBase = Math.floor(basePaise / 100_00) * 100_00; // drop sub-₹100 fraction
  if (roundedBase <= 0) return 0;
  const raw = roundedBase * ratePerMonthFraction * months; // paise
  return Math.round(raw / 1000) * 1000; // nearest ₹10 (1000 paise)
}

/**
 * Sec 234C interest for one instalment: 1% per month of deferment on the
 * shortfall, with Rule 119A rounding (sub-₹100 base fractions ignored; result
 * to the nearest ₹10).
 */
export function interest234CFor(shortfallPaise: number, defermentMonths: number): number {
  if (shortfallPaise <= 0 || defermentMonths <= 0) return 0;
  return rule119AInterest(shortfallPaise, 0.01, defermentMonths);
}

/**
 * Sec 234B: 1% per month (or part) when <90% of the assessed tax is not paid by
 * the year end. Statutory "assessed tax" is tax on total income AFTER deducting
 * TDS credits, so callers pass the POST-TDS balance as `assessedTaxPaise` and
 * actual advance-tax payments as `totalPaidPaise` (TDS is already netted out).
 * Months run from `ayStartMonth` ("YYYY-MM", April of the assessment year)
 * through `paidUptoMonth`, counting every month or part thereof in between —
 * but never before the AY begins: during the financial year itself no 234B has
 * accrued yet.
 */
export function interest234B(
  assessedTaxPaise: number,
  totalPaidPaise: number,
  ayStartMonth: string,
  paidUptoMonth: string,
): number {
  if (assessedTaxPaise <= 0) return 0;
  // Paid ≥90% of the (post-TDS) assessed tax → no 234B.
  if (totalPaidPaise >= Math.floor(assessedTaxPaise * 0.9)) return 0;
  const shortfall = assessedTaxPaise - totalPaidPaise;
  if (shortfall <= 0) return 0;

  const [sy, sm] = ayStartMonth.split("-").map(Number) as [number, number];
  const [uy, um] = paidUptoMonth.split("-").map(Number) as [number, number];
  if (![sy, sm, uy, um].every(Number.isFinite)) return 0;
  const monthsElapsed = (uy - sy) * 12 + (um - sm);
  // Before April of the AY nothing has accrued yet.
  if (monthsElapsed < 0) return 0;
  // "Or part of a month" — the month in which payment happens counts too.
  const months = monthsElapsed + 1;
  return rule119AInterest(shortfall, 0.01, months);
}

// ─── Income aggregation ──────────────────────────────────────────────────────

const INCOME_KINDS = ["salary", "interest", "dividend", "rent", "other"] as const;

interface IncomeAggregate {
  grossByKind: Record<string, number>;
  totalGrossPaise: number;
  totalTdsPaise: number;
}

async function aggregateIncome(
  db: Db,
  userId: string,
  fy: string,
  accrualCutoff?: string,
): Promise<IncomeAggregate> {
  const conditions = [
    eq(incomeEvents.userId, userId),
    eq(incomeEvents.fy, fy),
    eq(incomeEvents.status, "accepted"),
  ];
  if (accrualCutoff !== undefined) {
    conditions.push(lte(incomeEvents.accrualDate, accrualCutoff));
  }

  const rows = await db
    .select({
      incomeKind: incomeEvents.incomeKind,
      totalGross: sql<number>`coalesce(sum(${incomeEvents.grossPaise}), 0)`,
      totalTds: sql<number>`coalesce(sum(${incomeEvents.tdsPaise}), 0)`,
    })
    .from(incomeEvents)
    .where(and(...conditions))
    .groupBy(incomeEvents.incomeKind);

  const grossByKind: Record<string, number> = {};
  for (const k of INCOME_KINDS) grossByKind[k] = 0;
  let totalGrossPaise = 0;
  let totalTdsPaise = 0;

  for (const row of rows) {
    const gross = Number(row.totalGross ?? 0);
    const tds = Number(row.totalTds ?? 0);
    if (!Number.isSafeInteger(gross) || !Number.isSafeInteger(tds)) {
      throw new HttpError(500, "Income aggregate exceeded a safe integer — refusing to lose paise");
    }
    grossByKind[row.incomeKind] = (grossByKind[row.incomeKind] ?? 0) + gross;
    totalGrossPaise += gross;
    totalTdsPaise += tds;
  }

  return { grossByKind, totalGrossPaise, totalTdsPaise };
}

// ─── Ordinary liability (mirrors regime-comparison effective-regime path) ────

/**
 * Tax on ordinary (non-CG) income under the user's effective regime.
 * Deliberately mirrors compareRegimes()'s old/new paths (regime-comparison.ts)
 * with HRA and home-loan-24(b) manual inputs at zero; kept local to avoid
 * coupling 13.8's reviewed surface to this estimate. Taxpayer type defaults to
 * "ordinary" — the preference store does not carry it.
 */
async function ordinaryLiabilityFor(
  db: Db,
  userId: string,
  fy: string,
  grossByKind: Record<string, number>,
): Promise<number> {
  const regimePref = await getRegimePreference(db, userId, fy);
  const effective = regimePref.effective;
  const basket = await getDeductionBasket(db, userId, fy);
  const rules = getRegimeRules(fy, effective, "ordinary");

  // Sec 16(ia): the standard deduction belongs to SALARY income only — an
  // interest/rent-only taxpayer gets none of it. Capped at the salary head.
  let deductions = Math.min(rules.standardDeductionPaise, grossByKind["salary"] ?? 0);
  if (effective === "old") {
    deductions +=
      basket.eightyC.eligiblePaise +
      basket.eightyCcd1b.eligiblePaise +
      basket.eightyD.selfFamily.eligiblePaise +
      basket.eightyD.parents.eligiblePaise;
  }
  // 80CCD(2): per-regime employer-rate re-derivation (see regime-comparison.ts).
  let ccd2Eligible: number;
  if (effective === "new") {
    ccd2Eligible = basket.eightyCcd2.eligiblePaise;
  } else {
    ccd2Eligible = basket.eightyCcd2.entries.reduce((sum, entry) => {
      const oldRateBps = resolveEmployerNpsRateBps(fy, "old", entry.employerType);
      const oldCap = Math.floor((entry.salaryBasePaise * oldRateBps) / 10000);
      return sum + Math.min(entry.contributedPaise, oldCap);
    }, 0);
  }
  deductions += ccd2Eligible;

  // §24(a): income from house property gets a flat 30% standard deduction before
  // entering taxable income — applies under BOTH old and new regime (same as in
  // regime-comparison.ts; this keeps advance-tax consistent with the comparison).
  const section24aDeductionPaise = Math.floor((grossByKind["rent"] ?? 0) * 30 / 100);
  const totalGrossPaise = Object.values(grossByKind).reduce((s, v) => s + v, 0);
  const taxableIncome = Math.max(0, totalGrossPaise - deductions - section24aDeductionPaise);
  return computeTaxBreakdown(taxableIncome, rules).totalLiabilityPaise;
}

// ─── Position assembler ──────────────────────────────────────────────────────

export async function getAdvanceTaxPosition(
  db: Db,
  userId: string,
  fy?: string,
): Promise<AdvanceTaxPosition> {
  const todayStr = new Date().toISOString().slice(0, 10);
  const resolvedFy = fy ?? fyOf(todayStr);
  try {
    parseFy(resolvedFy);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : `Invalid FY: "${resolvedFy}"`);
  }
  if (!coveredFys().includes(resolvedFy)) {
    throw new HttpError(400, `Advance tax is not available for FY "${resolvedFy}"`);
  }
  const [, fyEnd] = fyRange(resolvedFy);

  const schedule = getAdvanceTaxSchedule(resolvedFy);

  // ── Senior-citizen exemption (Sec 207) ─────────────────────────────────────
  if (schedule.seniorCitizenExempt) {
    const [profile] = await db
      .select({ dateOfBirth: userProfiles.dateOfBirth })
      .from(userProfiles)
      .where(eq(userProfiles.userId, userId));
    if (isSeniorCitizenOnDate(profile?.dateOfBirth, fyEnd)) {
      return {
        fy: resolvedFy,
        seniorCitizenExempt: true,
        income: {
          grossByKind: { salary: 0, interest: 0, dividend: 0, rent: 0, other: 0 },
          totalGrossPaise: 0,
          totalTdsPaise: 0,
        },
        netStcgPaise: 0,
        netLtcgPaise: 0,
        cgTaxFullYearPaise: 0,
        ordinaryLiabilityPaise: 0,
        assessedTaxPaise: 0,
        instalments: [],
        interest234CTotalPaise: 0,
        interest234BPaise: 0,
        interestTotalPaise: 0,
        assumptions: [
          "Senior citizen (age ≥60 at FY end) without business income — exempt from advance tax under Sec 207.",
          "Estimate only; not a filed return.",
          `FY: ${resolvedFy}.`,
        ],
        isEstimate: true,
        generatedAt: new Date().toISOString(),
      };
    }
  }

  // ── Full-year income + gains ──────────────────────────────────────────────
  const fullYear = await aggregateIncome(db, userId, resolvedFy);
  const pos = await getCapitalPosition(db, userId, resolvedFy);
  const netStcg = pos.setoff.netStcgPaise;
  const netLtcg = pos.setoff.netLtcgPaise;
  const cgTaxFullYear = computeCgTax(netStcg, netLtcg);
  const ordinaryLiability = await ordinaryLiabilityFor(
    db,
    userId,
    resolvedFy,
    fullYear.grossByKind,
  );
  // §288B: re-round the combined total to the nearest ₹10 (1000 paise).
  // ordinaryLiability is already §288B-rounded by computeTaxBreakdown, but
  // cgTaxFullYear is not independently rounded; their sum must be re-rounded
  // so the final assessedTaxPaise is a clean §288B figure.
  const assessedTax = Math.round((ordinaryLiability + cgTaxFullYear) / 1000) * 1000;
  if (!Number.isSafeInteger(assessedTax)) {
    throw new HttpError(500, "Assessed-tax aggregate exceeded a safe integer — refusing to lose paise");
  }

  // ── Instalments with the CG timing exception ──────────────────────────────
  // Attribution cutoff per instalment: the statutory due date once it has passed
  // (gains/TDS accrued by then count toward THAT instalment onward), otherwise
  // today — nothing can be counted before it happens. Quarterly CG tax runs the
  // SAME full set-off as the full year — current-year losses first, then
  // brought-forward — replayed cumulatively at each cutoff via getCapitalPosition.
  const instalmentInputs: InstalmentInput[] = [];
  for (const instalment of schedule.instalments) {
    // Interest accrues only AFTER the due date has fully passed (strict <).
    const duePassed = instalment.dueDate < todayStr;
    const cutoff = duePassed || instalment.dueDate === todayStr ? instalment.dueDate : todayStr;

    const agg = await aggregateIncome(db, userId, resolvedFy, cutoff);
    const posAtCut = await getCapitalPosition(db, userId, resolvedFy, cutoff);
    instalmentInputs.push({
      dueDate: instalment.dueDate,
      cumulativePct: instalment.cumulativePct,
      cumulativeTdsPaise: agg.totalTdsPaise,
      cumulativeCgTaxPaise: computeCgTax(posAtCut.setoff.netStcgPaise, posAtCut.setoff.netLtcgPaise),
    });
  }
  // ── Sec 208 gate ──────────────────────────────────────────────────────────
  // Advance tax is obligatory only when net payable ≥ ₹10,000 (assessed tax minus
  // TDS credits). Below it, neither 234B nor 234C applies at all.
  const netPayable = assessedTax - fullYear.totalTdsPaise;
  const thresholdMet = sec208Applies(netPayable);

  const computed = computeInstalments({
    instalments: instalmentInputs,
    ordinaryLiabilityPaise: ordinaryLiability,
    todayStr,
  });
  // Sec 208 gate applied to 234C as well.
  const instalments = thresholdMet
    ? computed.statuses
    : computed.statuses.map((s) => ({ ...s, interest234CPaise: 0 }));
  const interest234CTotal = thresholdMet ? computed.total234CPaise : 0;

  // ── Sec 234B ──────────────────────────────────────────────────────────────
  // Statutory "assessed tax" ALREADY excludes TDS (it is tax on total income
  // after credits), so the base is assessedTax − TDS. Advance-tax PAYMENTS are
  // untracked, so the worst case assumes none were made: the whole post-TDS
  // balance accrues 1%/month once the assessment year begins. Pass `nowMonth`
  // through UNCLAMPED — interest234B itself returns zero before April of the AY,
  // and clamping would fabricate a month of interest during the FY.
  const fyStartYear = parseFy(resolvedFy);
  const ayStartMonth = `${fyStartYear + 1}-04`;
  const ayEndMonth = `${fyStartYear + 2}-03`;
  const nowMonth = todayStr.slice(0, 7);
  const paidUptoMonth = nowMonth > ayEndMonth ? ayEndMonth : nowMonth;
  const interest234BPaise = thresholdMet
    ? interest234B(Math.max(0, assessedTax - fullYear.totalTdsPaise), 0, ayStartMonth, paidUptoMonth)
    : 0;

  const assumptions: string[] = [
    "Flat capital-gains rates approximate Sec 111A STCG (20%) and Sec 112A LTCG (12.5% over the ₹1.25L annual exemption); gains of non-equity tax classes and pre-23-Jul-2024 disposals inside a split FY use the same flat rates rather than slab/old rates.",
    "Surcharge and cess are not layered onto the flat CG component; the ordinary-income component already includes cess via the standard engine.",
    "HRA exemption and home-loan interest 24(b) are not inputs here and count as zero.",
    "Rent income is reduced by 30% under §24(a) before entering the ordinary taxable income base (applies under both old and new regime); municipal taxes paid and any other house-property adjustments are not modelled.",
    "Advance-tax PAYMENTS are not tracked yet — every instalment shows its full requirement as shortfall (worst case), and Sec 234B assumes NO advance tax was paid: the entire post-TDS balance accrues 1%/month once the assessment year begins (TDS is already netted out of the statutory assessed-tax base). Statutorily the CG timing relief also assumes the attributable tax IS paid through remaining instalments or by 31 Mar; unpaid amounts can raise actual 234C beyond this estimate.",
    "Sec 208: advance tax (and therefore 234B/234C) applies only when net payable after TDS is ≥ ₹10,000.",
    "Sec 234C interest is shown only for instalments whose due date has fully passed; future rows project the requirement but accrue no interest.",
    "The capital-gains timing exception is honoured: each instalment's base includes only gains (and their tax) realised by that due date. Dividend/lottery first-accrual exceptions and business-income rules are NOT modelled.",
    "Senior-citizen exemption checks age only — Compass holds no residence or business-income flags, so a senior user with business income must ignore this exemption manually.",
    "Interest rounding follows Rule 119A (sub-₹100 base fractions ignored) with Sec 288B rounding to the nearest ₹10.",
    "Dates are UTC-derived (repo convention); Indian statutory dates may differ by a day around midnight.",
    "Sec 234B is capped at March of the assessment year here; statutorily it continues until return filing/processing.",
    "TDS is assumed credited continuously on each event's accrual date.",
    "Labelled an estimate — informs a payment decision; it is not a filed return.",
    `FY: ${resolvedFy}.`,
  ];

  return {
    fy: resolvedFy,
    seniorCitizenExempt: false,
    income: {
      grossByKind: fullYear.grossByKind,
      totalGrossPaise: fullYear.totalGrossPaise,
      totalTdsPaise: fullYear.totalTdsPaise,
    },
    netStcgPaise: netStcg,
    netLtcgPaise: netLtcg,
    cgTaxFullYearPaise: cgTaxFullYear,
    ordinaryLiabilityPaise: ordinaryLiability,
    assessedTaxPaise: assessedTax,
    instalments,
    interest234CTotalPaise: interest234CTotal,
    interest234BPaise,
    interestTotalPaise: interest234CTotal + interest234BPaise,
    assumptions,
    isEstimate: true,
    generatedAt: new Date().toISOString(),
  };
}
