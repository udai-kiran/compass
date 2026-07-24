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

/**
 * Convert ISO `YYYY-MM-DD` to Indian date format `DD-MM-YYYY`.
 * E.g. "2026-07-24" -> "24-07-2026".
 * Returns input unchanged on malformed/invalid dates (passthrough).
 */
export function isoToDDMMYYYY(iso: string): string {
  // Validate format: YYYY-MM-DD with digits only
  if (!/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
    return iso; // passthrough on malformed input
  }

  const parts = iso.split("-");
  const yearStr = parts[0]!;
  const monthStr = parts[1]!;
  const dayStr = parts[2]!;

  const year = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);
  const day = parseInt(dayStr, 10);

  // Validate month is 01–12
  if (month < 1 || month > 12) {
    return iso;
  }

  // Date.UTC treats years 0–99 as 1900–1999; reject them to avoid false-negative validation
  if (year < 100) {
    return iso;
  }

  // Validate it's a real calendar date by round-tripping through Date
  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    return iso; // impossible date like 2026-02-30
  }

  // Happy path: build DD-MM-YYYY from validated parts
  return `${dayStr}-${monthStr}-${yearStr}`;
}

/**
 * Parse Indian date format `DD-MM-YYYY` (or `DD/MM/YYYY` or `DD.MM.YYYY`) to ISO `YYYY-MM-DD`.
 * Returns null if input is not a valid complete date.
 *
 * - Accepts separators: `-`, `/`, `.` (must be consistent between both pairs)
 * - Requires exactly 4-digit year >= 1000 (strict; no 2-digit expansion, rejects years < 1000)
 * - Day and month must be 1 or 2 digits each (rejects overlong fields like "001")
 * - Validates real calendar dates (rejects Feb 30, Apr 31, etc.)
 * - Returns null for empty/whitespace-only input
 */
export function ddmmyyyyToISO(input: string): string | null {
  const trimmed = input.trim();
  if (trimmed === "") {
    return null;
  }

  // Parse with regex enforcing: 1-2 digit day, consistent separator, 1-2 digit month, same separator, exactly 4-digit year
  const match = /^(\d{1,2})([-/.])(\d{1,2})\2(\d{4})$/.exec(trimmed);
  if (!match) {
    return null;
  }

  const dayStr = match[1]!;
  const monthStr = match[3]!;
  const yearStr = match[4]!;

  const day = parseInt(dayStr, 10);
  const month = parseInt(monthStr, 10);
  const year = parseInt(yearStr, 10);

  // Validate month is 1–12
  if (month < 1 || month > 12) {
    return null;
  }

  // Validate day is 1–31 (real bounds checked via Date.UTC below)
  if (day < 1 || day > 31) {
    return null;
  }

  // Reject years < 1000 (finance app has no pre-1000 dates, keeps YYYY-MM-DD output canonical 4-digit)
  if (year < 1000) {
    return null;
  }

  // Validate it's a real calendar date by round-tripping through Date
  const testDate = new Date(Date.UTC(year, month - 1, day));
  if (
    testDate.getUTCFullYear() !== year ||
    testDate.getUTCMonth() !== month - 1 ||
    testDate.getUTCDate() !== day
  ) {
    return null; // impossible date like 2026-02-30 or 2026-04-31
  }

  // Happy path: return canonical zero-padded ISO (year already 4 digits >= 1000)
  const paddedYear = year.toString().padStart(4, "0");
  const paddedMonth = month.toString().padStart(2, "0");
  const paddedDay = day.toString().padStart(2, "0");
  return `${paddedYear}-${paddedMonth}-${paddedDay}`;
}
