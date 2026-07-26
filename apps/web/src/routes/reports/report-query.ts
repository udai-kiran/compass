import {
  inclusiveDayCount,
  isRealIsoDate,
  MAX_REPORT_RANGE_DAYS,
  MONTH_KEY_RE,
  YEAR_KEY_RE,
} from "@compass/shared";
import { previousPeriodKey } from "./report-comparison.ts";

export type ReportSelection =
  | { period: "monthly"; key: string }
  | { period: "annual"; key: string }
  | { period: "custom"; from: string; to: string };

/**
 * The same rules `ReportQuerySchema` applies on the server, so the page can
 * reject a selection before issuing a request the API would only answer with a
 * 400.
 *
 * The bounds that could otherwise drift are imported rather than restated:
 * `MONTH_KEY_RE`, `YEAR_KEY_RE`, `MAX_REPORT_RANGE_DAYS` and
 * `inclusiveDayCount` are literally the same values the schema uses. Date
 * validity is the one predicate that differs in form: the schema delegates it
 * to Zod's `z.iso.date()`, while this uses the shared `isRealIsoDate`. They
 * reject the same set (both refuse `2026-02-30`), but they are two
 * implementations — change one and you must check the other.
 *
 * This models only the three selections the UI can produce, not every query
 * shape the server accepts.
 *
 * Returns `null` when the selection is usable; otherwise the reason, for
 * display.
 */
export function selectionError(sel: ReportSelection): string | null {
  if (sel.period === "monthly") {
    return MONTH_KEY_RE.test(sel.key) ? null : "Choose a valid reporting period.";
  }
  if (sel.period === "annual") {
    return YEAR_KEY_RE.test(sel.key) ? null : "Choose a valid reporting period.";
  }
  if (!isRealIsoDate(sel.from) || !isRealIsoDate(sel.to)) {
    return "Choose a start and end date.";
  }
  if (sel.from > sel.to) {
    return "The end date must not be before the start date.";
  }
  if (inclusiveDayCount(sel.from, sel.to) > MAX_REPORT_RANGE_DAYS) {
    return `Choose a range of ${MAX_REPORT_RANGE_DAYS} days or fewer.`;
  }
  return null;
}

/** Boolean form of {@link selectionError}. */
export function isSelectionValid(sel: ReportSelection): boolean {
  return selectionError(sel) === null;
}

export function reportQueryString(sel: ReportSelection): string {
  const params = new URLSearchParams();
  if (sel.period === "custom") {
    params.set("period", "custom");
    params.set("from", sel.from);
    params.set("to", sel.to);
  } else {
    params.set("period", sel.period);
    params.set("key", sel.key);
  }
  return params.toString();
}

/** ISO date shifted by `days` (may be negative), via UTC epoch arithmetic. */
function shiftIsoDate(iso: string, days: number): string {
  const ms = Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000;
  return new Date(ms).toISOString().slice(0, 10);
}

/**
 * The window immediately preceding `sel`. `null` when `sel` isn't valid.
 *
 * A custom range has no natural calendar predecessor the way a month or year
 * does, so "previous" is defined as the same number of days immediately
 * before the current range: `length` = inclusive days from..to, `prevTo` =
 * `from` - 1 day, `prevFrom` = `from` - `length` days.
 */
export function previousSelection(sel: ReportSelection): ReportSelection | null {
  if (!isSelectionValid(sel)) return null;
  if (sel.period === "custom") {
    const length = inclusiveDayCount(sel.from, sel.to);
    const prevTo = shiftIsoDate(sel.from, -1);
    const prevFrom = shiftIsoDate(sel.from, -length);
    return { period: "custom", from: prevFrom, to: prevTo };
  }
  return { period: sel.period, key: previousPeriodKey(sel.period, sel.key) };
}
