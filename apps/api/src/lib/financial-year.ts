/**
 * financial-year.ts — Indian financial-year utilities.
 *
 * An Indian FY runs from 1 April to 31 March. The canonical label format is
 * "YYYY-YY" where the first part is the April-start year and the second is
 * the last two digits of the following year (e.g. "2025-26" for Apr 2025 –
 * Mar 2026). A two-digit suffix is used even at century boundaries
 * (FY 1999-2000 → "1999-00").
 */

/**
 * Returns the Indian FY label for a given ISO date string ("YYYY-MM-DD").
 * April 1 and later → that year is the start year; before April → previous year.
 *
 * Validates the date is a real calendar date via a Date.UTC round-trip — rejects
 * impossible dates such as month 0/13, February 30, etc.
 *
 * @example fyOf("2025-06-15") → "2025-26"
 * @example fyOf("2026-03-31") → "2025-26"
 * @example fyOf("2025-04-01") → "2025-26"
 * @example fyOf("2025-03-31") → "2024-25"
 */
export function fyOf(date: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`fyOf: invalid ISO date string "${date}" — expected YYYY-MM-DD`);
  }
  const [yStr, mStr, dStr] = date.split("-") as [string, string, string];
  const y = Number(yStr), m = Number(mStr), d = Number(dStr);
  // Calendar round-trip: Date.UTC normalises invalid dates (e.g. Feb 30 → Mar 2),
  // so if the components do not match, the input is not a real calendar date.
  const utcMs = Date.UTC(y, m - 1, d);
  const rtDate = new Date(utcMs);
  if (
    rtDate.getUTCFullYear() !== y ||
    rtDate.getUTCMonth() + 1 !== m ||
    rtDate.getUTCDate() !== d
  ) {
    throw new Error(`fyOf: "${date}" is not a valid calendar date`);
  }
  const startYear = m >= 4 ? y : y - 1;
  const endYY = (startYear + 1) % 100;
  return `${startYear}-${String(endYY).padStart(2, "0")}`;
}

/**
 * Parses a canonical FY label ("YYYY-YY") and validates it strictly.
 * Returns the start year (the April year) as a number.
 * Throws on any malformed or inconsistent label.
 *
 * @example parseFy("2025-26") → 2025
 * @example parseFy("1999-00") → 1999
 */
export function parseFy(fy: string): number {
  if (!/^\d{4}-\d{2}$/.test(fy)) {
    throw new Error(`parseFy: invalid FY label "${fy}" — expected YYYY-YY format`);
  }
  const startYear = Number(fy.slice(0, 4));
  const expectedEndYY = (startYear + 1) % 100;
  const actualEndYY = Number(fy.slice(5, 7));
  if (actualEndYY !== expectedEndYY) {
    throw new Error(
      `parseFy: FY label "${fy}" is inconsistent — start year ${startYear} implies end suffix ` +
        `"${String(expectedEndYY).padStart(2, "0")}" but got "${fy.slice(5, 7)}"`,
    );
  }
  return startYear;
}

/**
 * Returns the [startInclusive, endInclusive] ISO date strings for a canonical
 * FY label like "2025-26". Throws on malformed labels.
 *
 * @example fyRange("2025-26") → ["2025-04-01", "2026-03-31"]
 */
export function fyRange(fy: string): [string, string] {
  const startYear = parseFy(fy);
  return [`${startYear}-04-01`, `${startYear + 1}-03-31`];
}

/**
 * Returns the current FY label based on today's date (UTC wall clock).
 */
export function currentFy(): string {
  return fyOf(new Date().toISOString().slice(0, 10));
}

/**
 * Returns a human-readable FY label, e.g. "FY 2025-26".
 * Validates the input via parseFy and throws on invalid labels.
 *
 * @example fyLabel("2025-26") → "FY 2025-26"
 * @example fyLabel("1999-00") → "FY 1999-00"
 */
export function fyLabel(fy: string): string {
  parseFy(fy); // validate — throws on malformed or inconsistent input
  return `FY ${fy}`;
}
