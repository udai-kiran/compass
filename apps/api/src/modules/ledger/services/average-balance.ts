import { sql } from "drizzle-orm";
import { todayInIST } from "@compass/shared";
import type { AccountAverageBalance, AmbStatus } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { HttpError } from "../../../lib/errors.ts";

export interface AmbWindow {
  from: string;
  to: string;
  days: number;
  daysInMonth: number;
  /**
   * True when the ledger's first entry falls after the 1st, so the days earlier
   * in the month have no known balance and were not averaged. The result can
   * therefore be OVERSTATED relative to the bank's own figure — if the real
   * balance was lower in those unseen days, a genuine breach can be hidden.
   */
  partialHistory: boolean;
}

function toUTCDate(iso: string): Date {
  return new Date(`${iso}T00:00:00Z`);
}

function daysBetweenInclusive(from: string, to: string): number {
  const a = toUTCDate(from).getTime();
  const b = toUTCDate(to).getTime();
  return Math.round((b - a) / 86_400_000) + 1;
}

function startOfMonthISO(iso: string): string {
  return `${iso.slice(0, 8)}01`;
}

function daysInMonthOf(iso: string): number {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/**
 * The window AMB is averaged over: the current calendar month, clipped to days
 * we actually have data for.
 *
 * `to` is today — a month in progress can only be averaged over the days that
 * have happened, and future-dated transactions must never move it (same rule as
 * balances.ts). For any completed month this yields the full month, which is the
 * banking definition: sum of daily closing balances / days in the month.
 *
 * Dividing by the full month's day count while the month is still in progress
 * would assume a balance of zero for every remaining day, which would
 * understate every account and fire false "short" warnings. Dividing by the
 * days elapsed so far instead reports the average the account has actually
 * maintained up to today — the divisor (days in the month) is known in
 * advance either way; it's the future daily balances that aren't.
 *
 * `from` is clipped to the account's earliest posted activity, because before
 * that Compass has no balance for the account — averaging in zeros would invent
 * data and understate AMB badly enough to raise a false "not maintained" alarm.
 *
 * Returns null when the account has no posted activity at or before `today`
 * (nothing to average, and it protects the caller from dividing by zero).
 */
export function ambWindow(today: string, firstActivity: string | null): AmbWindow | null {
  if (firstActivity === null) return null;
  if (firstActivity > today) return null;

  const monthStart = startOfMonthISO(today);
  const from = firstActivity > monthStart ? firstActivity : monthStart;
  const to = today;
  const days = daysBetweenInclusive(from, to);
  const daysInMonth = daysInMonthOf(today);
  const partialHistory = from > monthStart;
  return { from, to, days, daysInMonth, partialHistory };
}

/**
 * Sum of the end-of-day closing balance for every day in the window — literally
 * the definition, walked one day at a time so a day with no transaction carries
 * the previous close forward. `deltas` maps YYYY-MM-DD to that day's net change.
 */
export function sumDailyClosingPaise(
  carriedInPaise: number,
  deltas: ReadonlyMap<string, number>,
  window: AmbWindow,
): number {
  let running = carriedInPaise;
  let sum = 0;
  let cursor = toUTCDate(window.from);
  const end = toUTCDate(window.to).getTime();
  while (cursor.getTime() <= end) {
    const dateStr = cursor.toISOString().slice(0, 10);
    running += deltas.get(dateStr) ?? 0;
    if (!Number.isSafeInteger(running)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    sum += running;
    if (!Number.isSafeInteger(sum)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    cursor = new Date(cursor.getTime() + 86_400_000);
  }
  return sum;
}

/** AMB = sum of daily closing balances / days, rounded to whole paise. */
export function averageBalancePaise(sumPaise: number, days: number): number {
  return Math.round(sumPaise / days);
}

/**
 * Whether the average meets the requirement, decided EXACTLY on the unrounded
 * sum: `sum / days >= required` is the same as `sum >= required * days` in
 * integers, so an average that falls short by a fraction of a paisa can never
 * be rounded up into "ok". Rounding is for display only.
 */
export function ambStatus(sumPaise: number, days: number, requiredPaise: number): AmbStatus {
  if (requiredPaise <= 0) return "none";
  return sumPaise >= requiredPaise * days ? "ok" : "short";
}

/**
 * How far the average falls below the requirement, in paise. Rounded UP so a
 * shortfall of less than a paisa still reports as at least 1 paisa instead of a
 * misleading zero.
 */
export function ambShortfallPaise(sumPaise: number, days: number, requiredPaise: number): number {
  if (ambStatus(sumPaise, days, requiredPaise) !== "short") return 0;
  return Math.ceil((requiredPaise * days - sumPaise) / days);
}

interface AccountRow {
  account_id: string;
  required_paise: string;
  first_activity: string | null;
  carried_in_delta: string;
}

interface DeltaRow {
  account_id: string;
  date: string;
  delta: string;
}

export interface AmbInputs {
  accountId: string;
  /** balance carried into the month: sum of all postings before the 1st */
  carriedInPaise: number;
  requiredPaise: number;
  /**
   * Earliest posted transaction date, or null when the account has none.
   *
   * This looks only at `transactions`, so an account whose opening balance
   * sits on `accounts.opening_balance_paise` with no ledger rows at all gets
   * no AMB — the column carries no effective date, so there is no honest day
   * to start averaging from, and inventing one could either overstate or
   * understate the result. (Bank/cash accounts normally hold their opening
   * balance as a real `is_opening` transaction — see `createAccount` — so this
   * only affects accounts that became bank-type through a later type change.)
   */
  firstActivity: string | null;
}

/**
 * Assembles one account's AMB result; null when there is nothing to average
 * (see `AmbInputs.firstActivity` for why that can happen even with a nonzero
 * carried-in balance).
 */
export function buildAverageBalance(
  input: AmbInputs,
  deltas: ReadonlyMap<string, number>,
  today: string,
): AccountAverageBalance | null {
  const window = ambWindow(today, input.firstActivity);
  if (!window) return null;

  const sumPaise = sumDailyClosingPaise(input.carriedInPaise, deltas, window);
  const averagePaise = averageBalancePaise(sumPaise, window.days);
  const status = ambStatus(sumPaise, window.days, input.requiredPaise);
  const shortfallPaise = ambShortfallPaise(sumPaise, window.days, input.requiredPaise);

  return {
    accountId: input.accountId,
    from: window.from,
    to: window.to,
    days: window.days,
    daysInMonth: window.daysInMonth,
    averagePaise,
    requiredPaise: input.requiredPaise,
    status,
    shortfallPaise,
    partialHistory: window.partialHistory,
  };
}

/**
 * Per-account month-to-date Average Monthly Balance against each bank account's
 * requirement (if any). Bank-only: AMB is a bank-account concept, cash and loans
 * have none.
 */
export async function accountAverageBalances(
  db: Db,
  userId: string,
  // IST, not UTC: AMB is an India-specific banking concept, and the UTC date
  // would end the window on the wrong day for up to 5.5 hours after UTC
  // midnight (e.g. showing last month's AMB for the first hours of the 1st).
  today: string = todayInIST(),
): Promise<AccountAverageBalance[]> {
  const monthStart = startOfMonthISO(today);

  const accountRes = await db.execute(sql`
    select
      a.id as account_id,
      coalesce(bd.required_amb_paise, 0) as required_paise,
      (
        select min(t.date)
        from postings po
        join transactions t on t.id = po.transaction_id
        where po.account_id = a.id and t.user_id = ${userId} and t.deleted_at is null and t.date <= ${today}
      ) as first_activity,
      (
        select coalesce(sum(po.amount_paise), 0)
        from postings po
        join transactions t on t.id = po.transaction_id
        where po.account_id = a.id and t.user_id = ${userId} and t.deleted_at is null and t.date < ${monthStart}
      ) as carried_in_delta
    from accounts a
    left join bank_details bd on bd.account_id = a.id and bd.user_id = ${userId}
    where a.user_id = ${userId} and a.archived_at is null and a.type = 'bank'
  `);
  const accountRows = accountRes.rows as unknown as AccountRow[];

  const deltaRes = await db.execute(sql`
    select po.account_id, t.date, sum(po.amount_paise) as delta
    from postings po
    join transactions t on t.id = po.transaction_id
    where t.user_id = ${userId} and t.deleted_at is null and t.date >= ${monthStart} and t.date <= ${today}
      and po.account_id in (
        select id from accounts where user_id = ${userId} and archived_at is null and type = 'bank'
      )
    group by po.account_id, t.date
  `);
  const deltaRows = deltaRes.rows as unknown as DeltaRow[];

  const deltasByAccount = new Map<string, Map<string, number>>();
  for (const row of deltaRows) {
    let m = deltasByAccount.get(row.account_id);
    if (!m) {
      m = new Map();
      deltasByAccount.set(row.account_id, m);
    }
    const delta = Number(row.delta);
    if (!Number.isSafeInteger(delta)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    m.set(row.date, delta);
  }

  const results: AccountAverageBalance[] = [];
  for (const row of accountRows) {
    const carriedInPaise = Number(row.carried_in_delta);
    if (!Number.isSafeInteger(carriedInPaise)) {
      throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
    }
    const input: AmbInputs = {
      accountId: row.account_id,
      carriedInPaise,
      requiredPaise: Number(row.required_paise),
      firstActivity: row.first_activity,
    };
    const deltas = deltasByAccount.get(row.account_id) ?? new Map<string, number>();
    const result = buildAverageBalance(input, deltas, today);
    if (result) {
      if (!Number.isSafeInteger(result.averagePaise)) {
        throw new HttpError(500, "Balance aggregate exceeded a safe integer — refusing to lose paise");
      }
      results.push(result);
    }
  }

  return results;
}
