/**
 * Cycle-boundary date math for credit cards — pure functions, no DB access.
 * Split out of the former `services/cards.ts` (task 1.2/`tasks/008-migrate-credit`)
 * as its own seam: every function here is already independently reasoned
 * about in its own doc comment, and none of it needs a database handle.
 */

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

/** Latest date with the given day-of-month (1–28) on or before `ref`. */
export function lastOccurrence(ref: string, day: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  if (d >= day) return `${y}-${pad(m)}-${pad(day)}`;
  const pm = m === 1 ? 12 : m - 1;
  const py = m === 1 ? y - 1 : y;
  return `${py}-${pad(pm)}-${pad(day)}`;
}

/** First date with the given day-of-month (1–28) strictly after `ref`. */
export function nextOccurrence(ref: string, day: number): string {
  const [y, m, d] = ref.split("-").map(Number) as [number, number, number];
  if (d < day) return `${y}-${pad(m)}-${pad(day)}`;
  const nm = m === 12 ? 1 : m + 1;
  const ny = m === 12 ? y + 1 : y;
  return `${ny}-${pad(nm)}-${pad(day)}`;
}

function dayBefore(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Days after a cycle closes before the issuer actually generates that bill. */
const STATEMENT_GEN_LAG_DAYS = 4;

/**
 * Close date of the last *generated* statement as of `ref`. A cycle that closed
 * only a day or two ago hasn't been billed yet — until it is, the last statement
 * is still the prior cycle's, and the just-closed period's spends stay "recent".
 */
function lastStatementClose(ref: string, cycleDay: number): string {
  const close = lastOccurrence(ref, cycleDay);
  const daysSince = (Date.parse(`${ref}T00:00:00Z`) - Date.parse(`${close}T00:00:00Z`)) / 86_400_000;
  return daysSince >= STATEMENT_GEN_LAG_DAYS ? close : lastOccurrence(dayBefore(close), cycleDay);
}

/** The statement cycle in force as of a reference date. */
export interface CardCycle {
  /** first day this statement bills — the previous cycle's close day */
  start: string;
  /** last day this statement bills (the day before `close`) */
  end: string;
  /** this statement's close/generation date, and the first day of the next cycle */
  close: string;
}

/**
 * The cycle a card closing on `cycleDay` is billing as of `ref`.
 *
 * A cycle runs `[start, close)` — the close day itself opens the *next* cycle.
 * That is what issuers actually bill: an HDFC statement dated 20 Jul lists spends
 * from 20 Jun through 19 Jul, so a charge dated on the close day lands on the
 * following statement, never the one closing that day. Treating the window as
 * `(start, close]` instead silently drops every charge dated on the start day.
 *
 * Consecutive cycles therefore partition the calendar exactly: each date is
 * billed by exactly one statement, with no gap and no double-count.
 */
export function cardCycle(ref: string, cycleDay: number): CardCycle {
  const close = lastStatementClose(ref, cycleDay);
  return { start: lastOccurrence(dayBefore(close), cycleDay), end: dayBefore(close), close };
}

/** Whether a transaction date is billed by this cycle — `[start, close)`. */
export function isBilledIn(date: string, cycle: CardCycle): boolean {
  return date >= cycle.start && date < cycle.close;
}

/** The date window a card's activity view covers, as half-open bounds. */
export interface ActivityWindow {
  /** first date to list — inclusive, so a charge dated on it is not dropped */
  fromInclusive: string;
  /** exclusive upper bound of "already billed": the close day bills next cycle */
  billedBefore: string;
}

/** Days-shifted ISO date (e.g. 45 days before `iso`). */
function shiftDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * The bounds both card views query with. Kept in one place because the two
 * halves have to agree: `fromInclusive` is the cycle's first billed day, so the
 * SQL that loads rows must be inclusive of it (`>=`, never `>`) or the billed
 * split silently loses every charge dated on the start day.
 *
 * With no cycle configured there is no statement window: list the last ~45 days
 * and treat everything up to and including today as billed, hence `ref + 1`.
 */
export function activityWindow(cycle: CardCycle | null, ref: string): ActivityWindow {
  return {
    fromInclusive: cycle?.start ?? shiftDays(ref, -45),
    billedBefore: cycle ? cycle.close : shiftDays(ref, 1),
  };
}

/**
 * Partition rows into the statement that bills them and what is still unbilled.
 * Every row lands in exactly one bucket: `[start, close)` bills, `close` onward
 * does not. With no cycle nothing is billed yet, so it is all unbilled.
 */
export function splitByCycle<T extends { date: string }>(
  rows: T[],
  cycle: CardCycle | null,
): { billed: T[]; unbilled: T[] } {
  const billed: T[] = [];
  const unbilled: T[] = [];
  for (const row of rows) {
    if (cycle && isBilledIn(row.date, cycle)) billed.push(row);
    else unbilled.push(row);
  }
  return { billed, unbilled };
}
