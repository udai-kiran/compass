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
