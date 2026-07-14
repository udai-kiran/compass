/** Calendar date as `YYYY-MM-DD` (no time, no timezone). */
export function toISODate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Budget/report month key as `YYYY-MM`. */
export function monthKey(d: Date): string {
  return d.toISOString().slice(0, 7);
}
