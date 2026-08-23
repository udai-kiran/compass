/**
 * Pure (no-DB) interest accrual schedule computation for fixed-income instruments.
 *
 * Handles FD, RD, NSC, and tax-saver FD. All amounts are in integer paise;
 * rates in basis points (710 = 7.10 %). Rounding is half-up applied ONCE per
 * period to the sum of all raw interest contributions in that period.
 *
 * Exact arithmetic (R1, review-3): ALL raw interest contributions are computed
 * in BigInt rational arithmetic (numerator/denominator pairs) and accumulated
 * over a common denominator. ONE half-up round is applied at the end of each
 * period. This prevents float precision loss at large (but safe-integer) inputs.
 *
 * Common denominator for each period:
 *   Full-period term:  base × bps / (10000 × periodsPerYear)
 *   Day-count term:    base × bps × days / (10000 × 365)
 *   LCM denominator:  10000 × periodsPerYear × 365
 *   (GCD(periodsPerYear, 365) = 1 for all valid values 1, 2, 4, 12.)
 *
 * Boundary anchoring: period n starts at addMonths(startDate, n × monthsPerPeriod)
 * and ends at addMonths(startDate, (n+1) × monthsPerPeriod). This prevents
 * end-of-month drift (Jan 31 + 1M + 1M = Mar 28, not Mar 31) by always deriving
 * boundaries from the original startDate rather than chaining from a clamped date.
 *
 * RD uses quarterly compounding (standard Indian convention). Installments are
 * deposited on the 1st of each month, anchored at addMonths(startDate, k) for
 * k = 0 … totalInstallments−1. Each installment accrues interest only from its
 * own deposit date to the period end (Actual/365 Fixed). The opening balance
 * (balance carried from the prior period) earns the nominal periodic rate for
 * full periods, or Actual/365 Fixed for stub periods. All raw contributions are
 * summed in BigInt and ONE half-up round is applied for the period total. The
 * loop continues until maturityDate even after all installments are exhausted.
 *
 * Post-condition: every emitted period field and schedule total must be a safe
 * integer; otherwise an Error is thrown. This is a defensive check — accepted
 * inputs (installmentPaise × totalInstallments at normal scale) produce safe
 * integers; only absurd extremes trigger this guard.
 *
 * NSC is annual compounding with reinvested interest; taxableInterestPaise equals
 * each year's interest (taxable in the hands of the holder even though cash is
 * only received at maturity).
 */

export interface DepositTerms {
  depositKind: "fd" | "rd" | "nsc" | "tax_saver_fd";
  /** FD/NSC/tax_saver_fd: lump-sum invested. Null for RD. */
  principalPaise?: number;
  /** RD: per-installment amount. Null for FD/NSC. */
  installmentPaise?: number;
  /** RD: number of monthly installments. Null for FD/NSC. */
  totalInstallments?: number;
  /** Annual rate in basis points: 7.10 % = 710. */
  annualRateBps: number;
  compoundingFrequency: "monthly" | "quarterly" | "half_yearly" | "annually";
  interestDisposition: "reinvest" | "payout";
  /** ISO date string "YYYY-MM-DD". */
  startDate: string;
  /** ISO date string "YYYY-MM-DD". */
  maturityDate: string;
}

export interface AccrualPeriod {
  periodStart: string;
  periodEnd: string;
  /** Running balance at the start of the period, before this period's deposit. */
  openingPaise: number;
  /** New money added this period: initial principal (FD/NSC period 1), installment(s) (RD), or 0. */
  depositPaise: number;
  /** Gross interest earned this period, rounded to nearest paise (half-up). */
  interestPaise: number;
  /** Interest disbursed (payout mode); 0 in reinvest mode. */
  payoutPaise: number;
  /** Opening + deposit + interest − payout. */
  closingPaise: number;
  /** Taxable interest for income declaration; equals interestPaise for all instruments here. */
  taxableInterestPaise: number;
}

export interface AccrualSchedule {
  periods: AccrualPeriod[];
  totalInterestPaise: number;
  totalDepositPaise: number;
  maturityValuePaise: number;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const MONTHS_PER_PERIOD: Record<string, number> = {
  monthly: 1,
  quarterly: 3,
  half_yearly: 6,
  annually: 12,
};

const PERIODS_PER_YEAR: Record<string, number> = {
  monthly: 12,
  quarterly: 4,
  half_yearly: 2,
  annually: 1,
};

/**
 * Add `months` to an ISO date string. Clamps the day to the last day of the
 * resulting month (e.g., Jan 31 + 1 month → Feb 28/29).
 */
export function addMonths(isoDate: string, months: number): string {
  const [y, m, d] = isoDate.split("-").map(Number) as [number, number, number];
  const totalMonths = y * 12 + (m - 1) + months;
  const newYear = Math.floor(totalMonths / 12);
  const newMonth = (totalMonths % 12) + 1;
  const lastDay = new Date(Date.UTC(newYear, newMonth, 0)).getUTCDate();
  const newDay = Math.min(d, lastDay);
  return `${newYear}-${String(newMonth).padStart(2, "0")}-${String(newDay).padStart(2, "0")}`;
}

/** Calendar day count between two ISO date strings (Actual/365 Fixed day-count). */
function daysDiff(from: string, to: string): number {
  const d1 = new Date(`${from}T00:00:00Z`);
  const d2 = new Date(`${to}T00:00:00Z`);
  return Math.round((d2.getTime() - d1.getTime()) / 86_400_000);
}

/**
 * Half-up round of the rational num/den (num ≥ 0, den > 0) to the nearest integer.
 * Returns a JavaScript Number. Caller is responsible for the post-condition check.
 */
function halfUp(num: bigint, den: bigint): number {
  const q = num / den;
  const r = num % den;
  return Number(r * 2n >= den ? q + 1n : q);
}

/**
 * Interest for one FD/NSC period using exact BigInt arithmetic.
 * Full period: nominal periodic rate (base × bps / (10000 × periodsPerYear)).
 * Stub period: Actual/365 Fixed (base × bps × days / (10000 × 365)).
 * ONE half-up round applied to the single term.
 */
function periodInterest(
  basePaise: bigint,
  annualRateBps: number,
  isFullPeriod: boolean,
  periodsPerYear: number,
  periodStart: string,
  periodEnd: string,
): number {
  if (basePaise === 0n) return 0;
  const bps = BigInt(annualRateBps);
  if (isFullPeriod) {
    return halfUp(basePaise * bps, 10000n * BigInt(periodsPerYear));
  }
  const days = BigInt(daysDiff(periodStart, periodEnd));
  return halfUp(basePaise * bps * days, 10000n * 365n);
}

/**
 * RD period interest using exact BigInt rational accumulation over a common
 * denominator (10000 × periodsPerYear × 365).
 *
 * Opening contribution:
 *   Full period:  opening × bps × 365  [over common_den]
 *   Stub period:  opening × bps × days × periodsPerYear  [over common_den]
 *
 * Each in-window installment:
 *   installment × bps × days_i × periodsPerYear  [over common_den]
 *
 * All numerators summed exactly; ONE half-up round of the period total.
 */
function rdPeriodInterest(
  opening: bigint,
  isFullPeriod: boolean,
  periodsPerYear: number,
  periodStart: string,
  periodEnd: string,
  installment: bigint,
  annualRateBps: number,
  installmentDates: string[],
): number {
  const bps = BigInt(annualRateBps);
  const ppy = BigInt(periodsPerYear);
  // Common denominator: LCM(10000×ppy, 10000×365) = 10000×ppy×365 (GCD=1)
  const den = 10000n * ppy * 365n;

  let totalNum = 0n;

  // Opening balance contribution
  if (opening !== 0n) {
    if (isFullPeriod) {
      // opening×bps / (10000×ppy)  ≡  opening×bps×365 / den
      totalNum += opening * bps * 365n;
    } else {
      // opening×bps×days / (10000×365)  ≡  opening×bps×days×ppy / den
      const days = BigInt(daysDiff(periodStart, periodEnd));
      totalNum += opening * bps * days * ppy;
    }
  }

  // Each installment contribution (always day-count, regardless of full/stub)
  if (installment !== 0n) {
    for (const iDate of installmentDates) {
      if (iDate >= periodStart && iDate < periodEnd) {
        // installment×bps×days / (10000×365)  ≡  installment×bps×days×ppy / den
        const days = BigInt(daysDiff(iDate, periodEnd));
        totalNum += installment * bps * days * ppy;
      }
    }
  }

  return halfUp(totalNum, den);
}

// ── Post-condition ────────────────────────────────────────────────────────────

/**
 * Asserts every emitted period field and schedule total is a safe integer.
 * Throws a descriptive Error otherwise. This guards against pathological inputs
 * that produce balances exceeding Number.MAX_SAFE_INTEGER.
 */
function assertSafeIntegers(schedule: AccrualSchedule): void {
  function check(value: number, field: string): void {
    if (!Number.isSafeInteger(value)) {
      throw new Error(`deposit accrual: value exceeds safe integer range: ${field}=${value}`);
    }
  }
  for (let i = 0; i < schedule.periods.length; i++) {
    const p = schedule.periods[i]!;
    const pfx = `period[${i}]`;
    check(p.openingPaise, `${pfx}.openingPaise`);
    check(p.depositPaise, `${pfx}.depositPaise`);
    check(p.interestPaise, `${pfx}.interestPaise`);
    check(p.payoutPaise, `${pfx}.payoutPaise`);
    check(p.closingPaise, `${pfx}.closingPaise`);
    check(p.taxableInterestPaise, `${pfx}.taxableInterestPaise`);
  }
  check(schedule.totalInterestPaise, "totalInterestPaise");
  check(schedule.totalDepositPaise, "totalDepositPaise");
  check(schedule.maturityValuePaise, "maturityValuePaise");
}

// ── FD / NSC / Tax-saver FD ──────────────────────────────────────────────────

function computeFdNscSchedule(terms: DepositTerms): AccrualSchedule {
  const monthsPerPeriod = MONTHS_PER_PERIOD[terms.compoundingFrequency]!;
  const periodsPerYear = PERIODS_PER_YEAR[terms.compoundingFrequency]!;
  const principal = BigInt(terms.principalPaise ?? 0);

  const periods: AccrualPeriod[] = [];
  let runningBalance = 0n;
  let n = 0;

  while (true) {
    // Anchored boundary: period n starts at startDate + n×monthsPerPeriod.
    const periodStart = addMonths(terms.startDate, n * monthsPerPeriod);
    if (periodStart >= terms.maturityDate) break;
    const standardEnd = addMonths(terms.startDate, (n + 1) * monthsPerPeriod);
    const isLastPeriod = standardEnd >= terms.maturityDate;
    const periodEnd = isLastPeriod ? terms.maturityDate : standardEnd;
    const isFullPeriod = !isLastPeriod || standardEnd === terms.maturityDate;

    const opening = runningBalance;
    const deposit = n === 0 ? principal : 0n;
    const base = opening + deposit;

    const interestPaise = periodInterest(
      base,
      terms.annualRateBps,
      isFullPeriod,
      periodsPerYear,
      periodStart,
      periodEnd,
    );

    const payoutPaise = terms.interestDisposition === "payout" ? BigInt(interestPaise) : 0n;
    const closingPaise = base + BigInt(interestPaise) - payoutPaise;

    periods.push({
      periodStart,
      periodEnd,
      openingPaise: Number(opening),
      depositPaise: Number(deposit),
      interestPaise,
      payoutPaise: Number(payoutPaise),
      closingPaise: Number(closingPaise),
      taxableInterestPaise: interestPaise,
    });

    runningBalance = closingPaise;
    n++;
  }

  const totalInterestPaise = periods.reduce(
    (sum, period) => sum + BigInt(period.interestPaise),
    0n,
  );
  const totalDepositPaise = periods.reduce((sum, period) => sum + BigInt(period.depositPaise), 0n);

  const schedule: AccrualSchedule = {
    periods,
    totalInterestPaise: Number(totalInterestPaise),
    totalDepositPaise: Number(totalDepositPaise),
    maturityValuePaise: Number(runningBalance),
  };
  assertSafeIntegers(schedule);
  return schedule;
}

// ── RD ───────────────────────────────────────────────────────────────────────

/**
 * Recurring deposit schedule. Indian convention: monthly installments with
 * quarterly compounding. Installment k is deposited on addMonths(startDate, k).
 *
 * Per period:
 *   - Opening balance earns the nominal periodic rate for full periods (exact BigInt).
 *     For stub periods (final period shorter than one standard compounding
 *     interval), opening balance is pro-rated using Actual/365 Fixed day-count.
 *   - Each installment deposited within [periodStart, periodEnd) accrues from
 *     its own deposit date to periodEnd using Actual/365 Fixed day-count.
 *   - All contributions are accumulated in BigInt, then ONE half-up round for
 *     the period total.
 *
 * The loop runs until maturityDate even after all installments are consumed.
 */
function computeRdSchedule(terms: DepositTerms): AccrualSchedule {
  const monthsPerPeriod = MONTHS_PER_PERIOD[terms.compoundingFrequency]!;
  const periodsPerYear = PERIODS_PER_YEAR[terms.compoundingFrequency]!;
  const installment = BigInt(terms.installmentPaise ?? 0);
  const total = terms.totalInstallments ?? 0;

  // Pre-compute all installment dates anchored at startDate.
  const installmentDates: string[] = [];
  for (let k = 0; k < total; k++) {
    installmentDates.push(addMonths(terms.startDate, k));
  }

  const periods: AccrualPeriod[] = [];
  let runningBalance = 0n;
  let n = 0;

  while (true) {
    // Anchored boundary: period n starts at startDate + n×monthsPerPeriod.
    const periodStart = addMonths(terms.startDate, n * monthsPerPeriod);
    if (periodStart >= terms.maturityDate) break;
    const standardEnd = addMonths(terms.startDate, (n + 1) * monthsPerPeriod);
    const isLastPeriod = standardEnd >= terms.maturityDate;
    const periodEnd = isLastPeriod ? terms.maturityDate : standardEnd;

    // isFullPeriod: true when the period spans a full standard interval,
    // OR when the period boundary exactly coincides with maturity.
    const isFullPeriod = !isLastPeriod || standardEnd === terms.maturityDate;

    const opening = runningBalance;

    // Collect deposit for this period using exact BigInt addition of counted installments.
    let depositPaise = 0n;
    for (const iDate of installmentDates) {
      if (iDate >= periodStart && iDate < periodEnd) {
        depositPaise += installment;
      }
    }

    // Exact BigInt interest accumulation for this period.
    const interestPaise = rdPeriodInterest(
      opening,
      isFullPeriod,
      periodsPerYear,
      periodStart,
      periodEnd,
      installment,
      terms.annualRateBps,
      installmentDates,
    );

    const payoutPaise = terms.interestDisposition === "payout" ? BigInt(interestPaise) : 0n;
    const closingPaise = opening + depositPaise + BigInt(interestPaise) - payoutPaise;

    periods.push({
      periodStart,
      periodEnd,
      openingPaise: Number(opening),
      depositPaise: Number(depositPaise),
      interestPaise,
      payoutPaise: Number(payoutPaise),
      closingPaise: Number(closingPaise),
      taxableInterestPaise: interestPaise,
    });

    runningBalance = closingPaise;
    n++;
  }

  const totalInterestPaise = periods.reduce(
    (sum, period) => sum + BigInt(period.interestPaise),
    0n,
  );
  const totalDepositPaise = periods.reduce((sum, period) => sum + BigInt(period.depositPaise), 0n);

  const schedule: AccrualSchedule = {
    periods,
    totalInterestPaise: Number(totalInterestPaise),
    totalDepositPaise: Number(totalDepositPaise),
    maturityValuePaise: Number(runningBalance),
  };
  assertSafeIntegers(schedule);
  return schedule;
}

// ── Public API ───────────────────────────────────────────────────────────────

/**
 * Compute the full interest accrual schedule for a deposit. Pure function —
 * no DB access. Call from the route handler for GET /holdings/:id/deposit/schedule.
 */
export function computeAccrualSchedule(terms: DepositTerms): AccrualSchedule {
  if (terms.depositKind === "rd") {
    return computeRdSchedule(terms);
  }
  // fd, nsc, tax_saver_fd all use the lump-sum compound-interest model.
  return computeFdNscSchedule(terms);
}
