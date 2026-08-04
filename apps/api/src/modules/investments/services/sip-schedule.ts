import type { SipFrequency, SipFundingSource } from "@compass/shared";

// ---------- Next-occurrence / cash-flow ----------

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Number of months between occurrences at each cadence. */
const FREQUENCY_STEP_MONTHS: Record<SipFrequency, number> = { monthly: 1, quarterly: 3, yearly: 12 };

/** Whole-month index (year*12 + zero-based month) — lets month arithmetic be plain integer math. */
function monthIndex(iso: string): number {
  const [y, m] = iso.split("-").map(Number) as [number, number];
  return y * 12 + (m - 1);
}

function dateFromMonthIndex(idx: number, day: number): string {
  const y = Math.floor(idx / 12);
  const m = (idx % 12) + 1;
  return `${y}-${pad(m)}-${pad(day)}`;
}

/**
 * First date with the given day-of-month (1–28) on or after `ref` (inclusive)
 * whose month falls on the SIP's cadence — monthly (every month), quarterly
 * (every 3rd month) or yearly (every 12th month) — **anchored to
 * `anchorDate`'s month** (typically the SIP's `startDate`): a quarterly SIP
 * started in March occurs in March/June/September/December, not
 * January/April/July/October. `frequency`/`anchorDate` default to a plain
 * monthly occurrence, so existing 2-arg callers are unaffected.
 */
export function firstOccurrenceOnOrAfter(
  ref: string,
  day: number,
  frequency: SipFrequency = "monthly",
  anchorDate: string = ref,
): string {
  const step = FREQUENCY_STEP_MONTHS[frequency];
  const [, , d] = ref.split("-").map(Number) as [number, number, number];
  let candidateIdx = monthIndex(ref);
  if (d > day) candidateIdx += 1; // day-of-month already passed this month
  if (step > 1) {
    const anchorIdx = monthIndex(anchorDate);
    let offset = (candidateIdx - anchorIdx) % step;
    if (offset < 0) offset += step;
    if (offset !== 0) candidateIdx += step - offset;
  }
  return dateFromMonthIndex(candidateIdx, day);
}

/**
 * The mirror image of `firstOccurrenceOnOrAfter`: the most recent date with
 * the given day-of-month on or before `ref` (inclusive), on the SIP's cadence,
 * anchored the same way to `startDate`'s month. Used to answer "what
 * installment is due by now" rather than "what's coming up next". The
 * reference date is clamped to `endDate` when `today` is past it — once a SIP
 * has ended, its last occurrence is bounded by when it stopped, not by
 * whatever `today` happens to be (otherwise a long-ended SIP would keep
 * reporting today's own day-of-month as "due" forever).
 */
export function lastOccurrenceOnOrBefore(
  sip: { dayOfMonth: number; startDate: string; endDate: string | null; frequency?: SipFrequency },
  today: string,
): string | null {
  const ref = sip.endDate !== null && today > sip.endDate ? sip.endDate : today;
  const step = FREQUENCY_STEP_MONTHS[sip.frequency ?? "monthly"];
  const [, , d] = ref.split("-").map(Number) as [number, number, number];
  let candidateIdx = monthIndex(ref);
  if (d < sip.dayOfMonth) candidateIdx -= 1; // this month's occurrence hasn't happened yet
  if (step > 1) {
    const anchorIdx = monthIndex(sip.startDate);
    const offset = (((candidateIdx - anchorIdx) % step) + step) % step;
    candidateIdx -= offset;
  }
  const date = dateFromMonthIndex(candidateIdx, sip.dayOfMonth);
  if (date < sip.startDate) return null; // the SIP hadn't started yet
  return date;
}

/**
 * The first calendar day of the occurrence month that produced `due` (a
 * return value of lastOccurrenceOnOrBefore). due's own day is always
 * sip.dayOfMonth, but the cadence cycle it represents is the half-open
 * interval from the 1st of this month through the day before the next
 * aligned occurrence — lastOccurrenceOnOrBefore's step-alignment already
 * guarantees due's month is the first month of that interval for every
 * cadence, so no frequency/anchor input is needed here, only due's month.
 */
function occurrenceMonthStart(due: string): string {
  return dateFromMonthIndex(monthIndex(due), 1);
}

/**
 * The installment a user still owes a record for: the most recent due
 * occurrence, unless one has already been recorded anywhere in that
 * occurrence's cadence cycle. Null when nothing is outstanding. Paused SIPs
 * never prompt — but the user can still backfill one by hand.
 *
 * Tolerates an early deposit: the cycle a `due` occurrence belongs to is the
 * half-open interval from the 1st of `due`'s own month through the day
 * before the next aligned occurrence (one calendar month for monthly, the
 * full 3-/12-month block for quarterly/yearly). Any `lastInstallmentDate`
 * within that interval satisfies it, not only one on or after `due`'s exact
 * day-of-month — e.g. a PPF SIP with `dayOfMonth: 5` that the user always
 * actually funds on the 1st clears its due flag on the 1st, rather than
 * prompting again the moment `today` reaches the 5th. An installment from a
 * strictly earlier cycle does not satisfy it — the due occurrence is still
 * reported.
 *
 * Gated on `fundingSource`, not `targetKind`: an account-target SIP (PPF/SSY)
 * *does* prompt, because it can now record by linking the ledger transaction
 * that funded it (see `linkSipInstallment`). What must never prompt is a
 * `payroll` SIP — its contribution is recorded directly to the retirement
 * account from the payslip, with no bank leg, and stamps no `sip_id`, so it
 * would otherwise report the same installment as due forever.
 */
export function dueInstallmentDate(
  sip: {
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    status: "active" | "paused";
    frequency?: SipFrequency;
    fundingSource: SipFundingSource;
  },
  lastInstallmentDate: string | null,
  today: string,
): string | null {
  if (sip.status !== "active") return null;
  if (sip.fundingSource === "payroll") return null;
  const due = lastOccurrenceOnOrBefore(sip, today);
  if (due === null) return null;
  if (lastInstallmentDate !== null && lastInstallmentDate >= occurrenceMonthStart(due)) return null;
  return due;
}

/**
 * Next debit date for an active SIP on or after `today` — the first
 * cadence-aligned occurrence of `dayOfMonth` (anchored to `startDate`'s month)
 * no earlier than both `today` and `startDate`, or null if the SIP is paused
 * or has already ended by then.
 */
export function nextSipDate(
  sip: {
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    status: "active" | "paused";
    frequency?: SipFrequency;
  },
  today: string,
): string | null {
  if (sip.status !== "active") return null;
  const base = sip.startDate > today ? sip.startDate : today;
  const due = firstOccurrenceOnOrAfter(base, sip.dayOfMonth, sip.frequency ?? "monthly", sip.startDate);
  if (sip.endDate !== null && due > sip.endDate) return null;
  return due;
}

function dayAfter(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

/**
 * Every SIP occurrence from `today` through `horizon` (inclusive), stepping at
 * the SIP's cadence from the first due date (a quarterly/yearly SIP whose next
 * anchored month falls outside a 90-day window contributes zero occurrences).
 * Mirrors how getForecast walks a recurring template's occurrences into its
 * obligations window.
 */
export function sipOccurrencesInWindow(
  sip: {
    dayOfMonth: number;
    startDate: string;
    endDate: string | null;
    status: "active" | "paused";
    frequency?: SipFrequency;
  },
  today: string,
  horizon: string,
): string[] {
  const dates: string[] = [];
  let due = nextSipDate(sip, today);
  while (due !== null && due <= horizon) {
    dates.push(due);
    // Step to the next occurrence: the first cadence-aligned day-of-month strictly after this one.
    const next = firstOccurrenceOnOrAfter(dayAfter(due), sip.dayOfMonth, sip.frequency ?? "monthly", sip.startDate);
    due = sip.endDate !== null && next > sip.endDate ? null : next > horizon ? null : next;
  }
  return dates;
}
