/**
 * XIRR (money-weighted annualised return) over dated, signed cash flows.
 *
 * Pure module: no database access, no imports from db/. Consumers assemble the
 * cash-flow series (see `positionCashFlows`) from whatever storage they use and
 * pass it in.
 */

/** One dated, signed cash flow: negative = money out (a buy/investment), positive = money in (a sell/dividend/valuation). */
export type CashFlow = { date: string; amountPaise: number };

const MS_PER_DAY = 24 * 60 * 60 * 1000;
const DAYS_PER_YEAR = 365;

/** Parse an ISO "YYYY-MM-DD" date as UTC midnight, so no local-timezone drift shifts the day count. */
function parseUtcDate(date: string): number {
  return Date.parse(`${date}T00:00:00Z`);
}

/**
 * Strictly validate and parse an ISO "YYYY-MM-DD" date as UTC midnight,
 * rejecting calendar-invalid dates that `Date.parse` silently normalizes.
 *
 * Empirically (Node 24), `Date.parse` does NOT reject an out-of-range day —
 * it rolls over into the next month instead of returning NaN:
 *   Date.parse("2024-02-30T00:00:00Z") -> 2024-03-01T00:00:00.000Z (not NaN)
 *   Date.parse("2023-02-29T00:00:00Z") -> 2023-03-01T00:00:00.000Z (Feb 29 in
 *     a non-leap year silently becomes March 1, not NaN)
 * whereas an out-of-range month IS rejected:
 *   Date.parse("2024-13-45T00:00:00Z") -> NaN
 * So a shape check alone is not enough; we round-trip the parsed value back
 * through getUTCFullYear/getUTCMonth/getUTCDate and compare against the
 * numbers the caller actually supplied. If they don't match, the date was
 * silently normalized and we treat it as invalid (NaN) so the existing
 * `dates.some((d) => !Number.isFinite(d))` guard in `xirrBps` rejects it.
 */
function parseStrictUtcDate(date: string): number {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  if (!match) return NaN;
  const [, yearStr, monthStr, dayStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const parsed = parseUtcDate(date);
  if (!Number.isFinite(parsed)) return NaN;
  const d = new Date(parsed);
  if (d.getUTCFullYear() !== year || d.getUTCMonth() + 1 !== month || d.getUTCDate() !== day) {
    return NaN;
  }
  return parsed;
}

/**
 * f(r) = Σ cf_i / (1+r)^(t_i) — the net present value of the series at rate r,
 * where t_i is years (Actual/365 fixed) from the earliest flow's date.
 */
function npv(rate: number, flows: Array<{ years: number; amountPaise: number }>): number {
  let sum = 0;
  for (const f of flows) sum += f.amountPaise / Math.pow(1 + rate, f.years);
  return sum;
}

/** f'(r) = Σ −t_i · cf_i / (1+r)^(t_i + 1) — analytic derivative of npv w.r.t. rate. */
function npvDerivative(rate: number, flows: Array<{ years: number; amountPaise: number }>): number {
  let sum = 0;
  for (const f of flows) sum += (-f.years * f.amountPaise) / Math.pow(1 + rate, f.years + 1);
  return sum;
}

/**
 * Bisection fallback over [-0.9999, 10.0]. Returns null if f() doesn't change
 * sign across the bracket (no root in the domain we're willing to trust), or
 * if it fails to converge to 1e-9 on r within 200 iterations.
 */
function bisect(flows: Array<{ years: number; amountPaise: number }>): number | null {
  let lo = -0.9999;
  let hi = 10.0;
  let fLo = npv(lo, flows);
  const fHi = npv(hi, flows);
  if (!Number.isFinite(fLo) || !Number.isFinite(fHi)) return null;
  if (fLo === 0) return lo;
  if (fHi === 0) return hi;
  if ((fLo < 0 && fHi < 0) || (fLo > 0 && fHi > 0)) return null; // no sign change: no bracketed root

  for (let i = 0; i < 200; i++) {
    const mid = (lo + hi) / 2;
    const fMid = npv(mid, flows);
    // A NaN comparison (`fMid < 0`, `fMid > 0`) is always false, so a NaN
    // fMid would take the `else` branch every iteration, collapsing `hi`
    // onto `lo` and returning the bracket's lower bound (~-9999 bps) as a
    // fabricated result instead of the "no result" this function promises.
    if (!Number.isFinite(fMid)) return null;
    if (fMid === 0 || hi - lo < 1e-9) return mid;
    // Keep the half that still brackets a sign change with fLo.
    if ((fLo < 0 && fMid < 0) || (fLo > 0 && fMid > 0)) {
      lo = mid;
      fLo = fMid;
    } else {
      hi = mid;
    }
  }
  return hi - lo < 1e-9 ? (lo + hi) / 2 : null;
}

/**
 * Money-weighted annualised return over dated, signed cash flows, as integer
 * basis points (1423 = 14.23%). Actual/365 fixed day count; Newton–Raphson
 * from an initial guess of r=0.1, analytic derivative, max 100 iterations,
 * falling back to bisection over [-0.9999, 10.0] when Newton doesn't converge
 * or would step outside the valid domain (r > -1).
 *
 * Convergence tolerance: |f(r)| < 1e-7, OR |f(r)| < 1e-6 * (total absolute
 * flow magnitude in paise) — whichever is looser. The second form matters
 * because these are paise amounts (often in the millions), so an absolute
 * 1e-7 tolerance on an NPV of, say, 10,000,000 paise is unreasonably tight;
 * scaling by the flow magnitude keeps the check meaningful across position sizes.
 *
 * Returns `null` — never 0, never NaN, never a thrown error — whenever the
 * rate isn't a trustworthy, well-posed answer:
 *  - fewer than 2 flows: nothing to solve for.
 *  - all flows the same sign: mathematically unsolvable (there's no rate that
 *    discounts an all-outflow or all-inflow series to zero); returning 0
 *    would silently claim "no return" for data that has no return to compute.
 *  - the span from earliest to latest flow is under 30 days: annualising a
 *    sub-month holding period massively amplifies noise (a 2% gain over 3
 *    days would annualise to an absurd rate) — the honest answer is "we don't
 *    know", not a number.
 *  - both Newton and bisection fail to converge: we do not guess.
 *  - the solved rate is <= -1 (below -100%): outside the valid domain (money
 *    can't be worth less than nothing).
 *  - the solved rate exceeds 100.0 (>10000%): such a figure is numerical
 *    noise from a degenerate series, not a plausible investment return.
 *  - any input is non-finite (an unparseable date, or a NaN/Infinity
 *    amount): a NaN date/amount propagates through npv() as NaN, which
 *    fails every comparison in bisect()'s loop and would otherwise
 *    collapse hi/lo onto the bisection bracket's lower bound rather than
 *    being caught as "no result" — returning a fabricated ~-9999 bps
 *    instead of null.
 *
 * Known limitation: a series whose signs alternate (for example inflows
 * followed by later buys) can have more than one mathematically valid IRR.
 * This function returns whichever root Newton–Raphson converges to from the
 * r=0.1 starting guess — the same convention Excel's XIRR uses — and does
 * not attempt to detect or disambiguate multiple roots.
 */
export function xirrBps(flows: CashFlow[]): number | null {
  if (flows.length < 2) return null;

  const hasNegative = flows.some((f) => f.amountPaise < 0);
  const hasPositive = flows.some((f) => f.amountPaise > 0);
  if (!hasNegative || !hasPositive) return null;

  if (flows.some((f) => !Number.isFinite(f.amountPaise))) return null;

  const dates = flows.map((f) => parseStrictUtcDate(f.date));
  if (dates.some((d) => !Number.isFinite(d))) return null;

  const earliest = Math.min(...dates);
  const latest = Math.max(...dates);
  if ((latest - earliest) / MS_PER_DAY < 30) return null;

  const dated = flows.map((f, i) => ({
    years: (dates[i]! - earliest) / MS_PER_DAY / DAYS_PER_YEAR,
    amountPaise: f.amountPaise,
  }));

  const totalMagnitude = dated.reduce((s, f) => s + Math.abs(f.amountPaise), 0);
  // Individual amounts can each be finite yet SUM to Infinity. If that
  // happens, `tolerance` below becomes Infinity, so the very first
  // `Math.abs(f) < tolerance` check in the Newton loop would pass
  // immediately and "converge" at the initial guess r=0.1 — returning a
  // confident 1000 bps that is pure fiction. Reject before it can happen.
  if (!Number.isFinite(totalMagnitude)) return null;
  const tolerance = Math.max(1e-7, 1e-6 * totalMagnitude);

  let rate = 0.1;
  let converged = false;
  for (let i = 0; i < 100; i++) {
    const f = npv(rate, dated);
    if (!Number.isFinite(f)) break; // can't evaluate; fall through to bisection
    if (Math.abs(f) < tolerance) {
      converged = true;
      break;
    }
    const fPrime = npvDerivative(rate, dated);
    if (fPrime === 0 || !Number.isFinite(fPrime)) break; // can't step; fall through to bisection
    const next = rate - f / fPrime;
    // `next <= -1` does NOT catch NaN — `NaN <= -1` is false — so a
    // non-finite step must be checked explicitly or Newton would silently
    // carry a NaN rate into the next iteration (and eventually npv() would
    // fail every comparison downstream).
    if (!Number.isFinite(next) || next <= -1) break; // would leave the valid domain; fall back to bisection
    rate = next;
  }
  if (converged) {
    const f = npv(rate, dated);
    if (Math.abs(f) < tolerance) {
      if (!Number.isFinite(rate)) return null;
      if (rate <= -1 || rate > 100.0) return null;
      return Math.round(rate * 10000);
    }
  }

  // Newton didn't converge (or stepped out of domain) — fall back to bisection.
  const bisected = bisect(dated);
  if (bisected === null) return null;
  if (!Number.isFinite(bisected)) return null;
  if (bisected <= -1 || bisected > 100.0) return null;
  return Math.round(bisected * 10000);
}

/**
 * Builds the dated cash-flow series for one holding: buys are money out
 * (negated), sells and dividends are money in, and — only when units are
 * still held — the latest known valuation stands in for "what you'd get if
 * you sold today".
 *
 * Returns `null` (never a fabricated series) when:
 *  - `events` is empty: nothing to compute a return over.
 *  - units are still held (`unitsHeldNow >= 1e-6`) and no `terminal` valuation
 *    is available: without a current value there is no way to know what the
 *    still-held units are worth, and substituting cost basis would fabricate
 *    a ~0% return (the position would look like it neither gained nor lost,
 *    which is not knowledge we have).
 *  - units are still held and `terminal.date` is strictly earlier than the
 *    most recent `"buy"` or `"sell"` event: a valuation that predates the
 *    latest unit-changing event prices fewer (or more) units than are
 *    actually held now, so the terminal inflow would misstate the position.
 *    Dividends are deliberately excluded from this check — they are cash
 *    paid out and do not change the units the valuation is pricing.
 *
 * When the position is fully exited (`unitsHeldNow` effectively zero, i.e.
 * `Math.abs(unitsHeldNow) < 1e-6`), no terminal flow is added — the sell
 * events already are the terminal cash-in event for the position, so
 * appending a valuation on top would double-count the exit. `terminal` may be
 * null in this case, and the resulting series is still fully computable by
 * `xirrBps`.
 */
export function positionCashFlows(
  events: Array<{ type: string; date: string; amountPaise: number; units: number | null }>,
  terminal: { date: string; valuePaise: number } | null,
  unitsHeldNow: number,
): CashFlow[] | null {
  if (events.length === 0) return null;

  const fullyExited = Math.abs(unitsHeldNow) < 1e-6;
  if (!fullyExited && terminal === null) return null;

  if (!fullyExited && terminal !== null) {
    const unitChangingDates = events
      .filter((e) => e.type === "buy" || e.type === "sell")
      .map((e) => e.date);
    if (unitChangingDates.length > 0) {
      const latestUnitChangeDate = unitChangingDates.reduce((a, b) => (a > b ? a : b));
      if (terminal.date < latestUnitChangeDate) return null;
    }
  }

  const flows: CashFlow[] = events.map((e) => {
    if (e.type === "buy") return { date: e.date, amountPaise: -e.amountPaise };
    // sell and dividend are both cash returned to the investor.
    return { date: e.date, amountPaise: e.amountPaise };
  });

  if (!fullyExited && terminal !== null) {
    flows.push({ date: terminal.date, amountPaise: terminal.valuePaise });
  }

  return flows;
}
