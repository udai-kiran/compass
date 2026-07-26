import { formatINR, type AccountAverageBalance } from "@compass/shared";

/** "16–26 Jul" — `from` and `to` always fall in the same calendar month (see ambWindow). */
function formatDateRange(from: string, to: string): string {
  const fromDay = Number(from.slice(8, 10));
  const toDay = Number(to.slice(8, 10));
  const month = new Date(`${to}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${fromDay}–${toDay} ${month}`;
}

/** "16 Jul" — the day and month of a single date, used for the `since` caveat. */
function formatSinceDate(date: string): string {
  const day = Number(date.slice(8, 10));
  const month = new Date(`${date}T00:00:00Z`).toLocaleString("en-US", {
    month: "short",
    timeZone: "UTC",
  });
  return `${day} ${month}`;
}

/**
 * The muted one-line explanation of what window an AMB covers. First picks
 * the base sentence from two distinct cases, then — independently of which
 * base was picked — appends the same "month isn't over" caveat whenever
 * `to` falls before the last day of its calendar month, since either kind of
 * partial window is still month-to-date and a currently-satisfactory average
 * can still deteriorate:
 *  - `partialHistory`: the window starts after the 1st because there's no
 *    recorded balance earlier in the month — this must not read like "so far
 *    this month" (that implies the month started there), and must warn that
 *    the bank's own figure can differ.
 *  - not partial: the window starts on the 1st. If `to` is the month's last
 *    day the month is complete; otherwise it's genuine month-to-date.
 */
export function ambWindowNote(amb: AccountAverageBalance): string {
  const dayWord = amb.days === 1 ? "day" : "days";
  const unfinishedMonth = " The month isn't over, so this can still change.";
  // The month is still in progress exactly when `to` is before the month's last
  // day. Deliberately NOT `days < daysInMonth`: for a partial-history window
  // `days` is short because earlier history is missing, not because the month is
  // unfinished, so that test would wrongly claim "the month isn't over" when
  // viewed on the 31st.
  const monthInProgress = Number(amb.to.slice(8, 10)) < amb.daysInMonth;
  if (amb.partialHistory) {
    const since = formatSinceDate(amb.from);
    const base = `Average of daily closing balances from ${since} (${amb.days} ${dayWord}). No balance is recorded earlier in the month, so your bank's figure may differ.`;
    return monthInProgress ? `${base}${unfinishedMonth}` : base;
  }
  const range = formatDateRange(amb.from, amb.to);
  if (monthInProgress) {
    return `Average of daily closing balances, ${range} (${amb.days} ${dayWord} so far this month).${unfinishedMonth}`;
  }
  return `Average of daily closing balances, ${range} (${amb.days} ${dayWord}, full month)`;
}

/**
 * The status line shown under the balance. Built from segments joined with
 * " · " so every caveat that applies is visible on the page itself — not
 * hidden behind a hover-only tooltip, which is undiscoverable and unavailable
 * on touch devices.
 */
export function ambSummary(amb: AccountAverageBalance): { text: string; short: boolean } {
  const segments = [`AMB ${formatINR(amb.averagePaise)}`];
  if (amb.status === "short") {
    // "below required average", not "short" alone — the value is the gap
    // between two averages, not an amount to deposit, and must read that way.
    segments.push(`${formatINR(amb.shortfallPaise)} below required average`);
  }
  if (amb.partialHistory) {
    segments.push(`since ${formatSinceDate(amb.from)}`);
  }
  return { text: segments.join(" · "), short: amb.status === "short" };
}
