/** Calendar date as `YYYY-MM-DD` (no time, no timezone). */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Budget/report month key as `YYYY-MM`. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}

/**
 * Today's calendar date in India Standard Time as `YYYY-MM-DD`.
 *
 * Unlike `toISODate(new Date())` (which uses UTC), this is correct for users
 * whose local clock/timezone differs from IST — e.g. it won't roll over to
 * the next/previous day for a browser running in UTC or US timezones.
 */
export function todayInIST(now: Date = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

const MONTH_NAMES = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Human display date `DD-Mon-YYYY` from an ISO `YYYY-MM-DD` string, e.g. "2026-12-31" -> "31-Dec-2026". */
export function formatDisplayDate(isoDate: string): string {
  // Validate format: YYYY-MM-DD with digits only
  if (!/^\d{4}-\d{2}-\d{2}$/.test(isoDate)) {
    return isoDate; // passthrough on malformed input
  }

  const parts = isoDate.split("-");
  // After regex validation, we know parts has exactly 3 elements
  const yearStr = parts[0]!;
  const monthStr = parts[1]!;
  const dayStr = parts[2]!;

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate month is 01–12
  if (month < 1 || month > 12) {
    return isoDate;
  }

  // Date.UTC treats years 0–99 as 1900–1999; reject them to avoid false-negative validation
  if (year < 100) {
    return isoDate;
  }

  // Validate it's a real calendar date by round-tripping through Date
  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    return isoDate; // impossible date like 2026-02-30
  }

  // Happy path: build display string from validated parts
  const monthIndex = month - 1;
  return `${dayStr}-${MONTH_NAMES[monthIndex]}-${yearStr}`;
}
