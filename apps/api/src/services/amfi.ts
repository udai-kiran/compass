import { HttpError } from "../lib/errors.ts";

/** One scheme's latest published NAV. */
export interface SchemeNav {
  /** rupees per unit, e.g. 91.1262 */
  nav: number;
  /** ISO date the NAV is as-of, e.g. "2026-07-15" */
  date: string;
  name: string;
}

const NAVALL_URL = "https://portal.amfiindia.com/spages/NAVAll.txt";

const MONTHS: Record<string, string> = {
  jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06",
  jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12",
};

/** AMFI dates are "15-Jul-2026"; net worth and valuations speak ISO. */
export function parseAmfiDate(s: string): string | null {
  const m = /^(\d{2})-([A-Za-z]{3})-(\d{4})$/.exec(s.trim());
  if (!m) return null;
  const month = MONTHS[m[2]!.toLowerCase()];
  if (!month) return null;
  return `${m[3]}-${month}-${m[1]}`;
}

/**
 * Parses AMFI's NAVAll master. Format is `;`-delimited with a header, blank
 * lines, and scheme-category banner lines interleaved between scheme rows:
 *   Scheme Code;ISIN Div Payout/Growth;ISIN Div Reinvestment;Scheme Name;NAV;Date
 * Only lines whose first field is a number and whose NAV parses are kept, so
 * banners and blanks fall away. Later duplicate codes (shouldn't happen) win.
 */
export function parseNavAll(text: string): Map<number, SchemeNav> {
  const out = new Map<number, SchemeNav>();
  for (const line of text.split("\n")) {
    const parts = line.split(";");
    if (parts.length < 6) continue;
    const code = Number(parts[0]!.trim());
    if (!Number.isInteger(code)) continue;
    const nav = Number(parts[4]!.trim());
    if (!Number.isFinite(nav) || nav <= 0) continue; // "N.A." / suspended schemes
    const date = parseAmfiDate(parts[5]!);
    if (!date) continue;
    out.set(code, { nav, date, name: parts[3]!.trim() });
  }
  return out;
}

/** Fetches and parses the full NAV master. One request covers every scheme. */
export async function fetchNavByCode(): Promise<Map<number, SchemeNav>> {
  let res: Response;
  try {
    res = await fetch(NAVALL_URL, { signal: AbortSignal.timeout(30_000) });
  } catch (err) {
    throw new HttpError(502, `Could not reach AMFI: ${(err as Error).message}`);
  }
  if (!res.ok) throw new HttpError(502, `AMFI returned ${res.status}`);
  const map = parseNavAll(await res.text());
  if (map.size === 0) throw new HttpError(502, "AMFI response had no parseable NAVs");
  return map;
}
