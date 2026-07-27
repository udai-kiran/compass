/**
 * Presentation helpers for XIRR (money-weighted annualised return), which the
 * API sends as integer basis points (1423 = 14.23%) or `null`.
 *
 * `null` is a first-class answer here, not an error or a zero: the API
 * deliberately returns it rather than a fabricated 0% whenever a return isn't
 * well-posed — no valuation to price the remaining units, under 30 days of
 * history (annualising a sub-month period amplifies noise absurdly), a
 * valuation predating the latest buy/sell, or a series with no solvable rate.
 * The UI must therefore never render a null as "0%": that would assert "this
 * investment went nowhere" about data we don't have.
 */

/** Shown in place of a rate we don't have. A dash, never a zero. */
export const XIRR_UNKNOWN = "—";

/** basis points → a signed percent string, e.g. 1423 → "+14.23%", -810 → "-8.10%". */
export function formatXirrBps(bps: number | null): string {
  if (bps === null) return XIRR_UNKNOWN;
  // toFixed already renders the minus sign for negatives; only "+" needs adding.
  return `${bps > 0 ? "+" : ""}${(bps / 100).toFixed(2)}%`;
}

export type XirrTone = "unknown" | "positive" | "negative" | "flat";

/**
 * Which visual treatment a rate deserves. "flat" (exactly 0 bps) is kept
 * distinct from "unknown" (null) precisely because a genuine, computed 0.00%
 * return is a real fact, whereas null is the absence of one.
 */
export function xirrTone(bps: number | null): XirrTone {
  if (bps === null) return "unknown";
  if (bps > 0) return "positive";
  if (bps < 0) return "negative";
  return "flat";
}

/** The explanation shown for a rate we do have. */
const XIRR_AVAILABLE_HINT = "XIRR — money-weighted annualised return";

/**
 * The explanation shown for a rate we don't have.
 *
 * Deliberately cause-neutral. The API returns `null` for several distinct
 * reasons — no valuation for still-held units, a valuation predating the
 * latest buy/sell, under 30 days of history, fewer than two cash flows, all
 * flows the same sign, or no solvable rate — and it does not say which one
 * applied. Naming a cause would be a guess, and suggesting a fix that may not
 * apply is worse than saying nothing: an earlier version of this file told the
 * user to "add a current value", which provably does nothing for a holding
 * whose events carry no unit counts (`unitsHeld` reads `units ?? 0`, so such a
 * position looks fully exited and its valuation is ignored entirely). Stating
 * only what we actually know beats inventing an action that fails silently.
 */
const XIRR_UNAVAILABLE_HINT = "XIRR isn't available for this cash-flow history yet";

/** Tooltip text for one holding's rate, or its absence. */
export function xirrHint(bps: number | null): string {
  return bps === null ? XIRR_UNAVAILABLE_HINT : XIRR_AVAILABLE_HINT;
}

/**
 * Tooltip text for the portfolio-wide rate.
 *
 * Kept separate from `xirrHint` so the aggregate wording can diverge from the
 * per-holding wording without one silently inheriting the other's claims.
 */
export function portfolioXirrHint(bps: number | null): string {
  return bps === null
    ? "Portfolio XIRR isn't available for the current cash-flow history yet"
    : XIRR_AVAILABLE_HINT;
}

/**
 * The screen-reader text for a rate. A bare "—" reads as "dash", conveying
 * nothing, and a `title` is mouse-hover only, so non-pointer users would
 * otherwise get no explanation at all. This spells out both the value and its
 * meaning.
 *
 * Rendered as real text inside an `sr-only` span rather than passed as an
 * `aria-label`: an accessible name set via `aria-label` on a generic
 * non-interactive element (a `<p>` or `<span>` with no role) is not reliably
 * exposed by assistive technology, so it could have been silently ignored.
 */
export function xirrAriaLabel(bps: number | null, hint: string): string {
  if (bps === null) return `XIRR unavailable. ${hint}`;
  return `XIRR ${formatXirrBps(bps)} per year`;
}
