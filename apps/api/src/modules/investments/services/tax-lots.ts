/**
 * FIFO tax-lot realization for Indian mutual-fund / equity capital gains.
 *
 * The portfolio display keeps *average-cost* basis (see costBasis() in
 * holdings.ts) — that's what most apps show and what our unrealized/invested
 * numbers use. Tax is a different question with a legally-fixed answer: on
 * redemption the units sold are matched **First-In-First-Out**, each match is
 * classified **short- or long-term** by how long those specific units were
 * held, and equity units bought before 01-Feb-2018 get **grandfathering**
 * relief. This module computes exactly that, as a pure function over a
 * holding's buy/sell events, so it can be unit-tested to death and reused by
 * the capital-gains statement / ITR export.
 *
 * Dividends (IDCW) are deliberately ignored here: they are taxed as income at
 * slab, not as capital gains, so they never enter a gains statement.
 */

/** Units acquired strictly before this date are grandfathering-eligible. */
export const GRANDFATHER_CUTOFF = "2018-02-01";

/**
 * The Finance (No. 2) Act 2024 overhaul, effective for transfers on/after this
 * date, collapsed the holding-period thresholds: 36-month non-listed assets
 * dropped to 24. The 12-month (equity) and existing 24-month (unlisted shares)
 * lines were left unchanged.
 */
export const HOLDING_PERIOD_REFORM = "2024-07-23";

/**
 * Section 50AA bites only on "specified fund" units *acquired on or after* this
 * date; earlier units of the same fund keep their ordinary capital-asset
 * character. That's why §50AA is a per-lot test, not a per-holding one.
 */
export const SECTION_50AA_START = "2023-04-01";

/**
 * How a holding's gains are taxed. A per-holding fact the model can't infer — a
 * `mutual_fund` may be equity-oriented, a plain debt fund, or a §50AA
 * "specified" fund — so it's stored and user-settable, never guessed from the
 * asset class. The holding period, though, can still vary *within* a class by
 * acquisition/sale date, so {@link longTermMonths} takes both dates.
 *
 * §50AA has three different triggers, so the "specified" assets it covers can't
 * share one class:
 *
 * - `equity`                   listed equity / equity-oriented MF & ETF: 12-month
 *                              line, 31-Jan-2018 grandfathering applies.
 * - `unlisted_shares`          unlisted shares (and like assets): a 24-month line,
 *                              before and after the 2024 reform.
 * - `other`                    gold, non-specified debt, international funds…:
 *                              36-month line before the 2024 reform, 24 on/after.
 * - `specified_fund`           §50AA specified mutual funds: §50AA bites only on a
 *                              lot *acquired* on/after {@link SECTION_50AA_START};
 *                              older lots fall back to `other` treatment.
 * - `market_linked_debenture`  MLDs are §50AA *always*, regardless of acquisition
 *                              or sale date ⇒ every lot is short-term.
 * - `unlisted_bond`            unlisted bonds/debentures fall under §50AA when the
 *                              *transfer/redemption* is on/after the 2024 reform
 *                              ({@link HOLDING_PERIOD_REFORM}); sold before that,
 *                              ordinary non-equity rules apply.
 * - `exempt`                   the disposal is outside capital gains altogether —
 *                              an SGB redeemed at maturity with the RBI, a
 *                              tax-free bond. Not a holding period, so no
 *                              short/long line is ever tested; see
 *                              {@link longTermMonths}, which excludes it by type.
 *
 * `exempt` is a claim about the *instrument and the manner of disposal*, so it
 * is never guessed — an SGB sold on the exchange is an ordinary taxable sale,
 * and only the user knows which happened.
 *
 * KNOWN LIMITATION: the class lives on the *holding*, so it applies to every
 * disposal of that holding. An SGB partly sold on the exchange and partly
 * redeemed at maturity cannot be represented — marking it exempt would also
 * exempt the taxable exchange sale and understate liability. Until the class is
 * per-event, model such a position as two holdings. The other classes are
 * properties of the instrument alone, so only `exempt` has this mismatch.
 */
export type GainsTaxClass =
  | "equity"
  | "unlisted_shares"
  | "other"
  | "specified_fund"
  | "market_linked_debenture"
  | "unlisted_bond"
  | "exempt";

/** How a matched slice is characterised for tax. See GainTermSchema in @compass/shared. */
export type GainTerm = "short" | "long" | "exempt";

export interface TaxLotConfig {
  taxClass: GainsTaxClass;
  /**
   * NAV per unit on 31-Jan-2018 in paise, for grandfathering equity lots bought
   * before {@link GRANDFATHER_CUTOFF}. Honored only when `taxClass` is `equity`;
   * null (or any non-equity class) disables grandfathering.
   */
  grandfatherNavPaise: number | null;
}

/** Months a non-specified non-equity asset must be held to be long-term on `saleDate`. */
function nonEquityMonths(saleDate: string): number {
  return saleDate < HOLDING_PERIOD_REFORM ? 36 : 24;
}

/**
 * Months of holding *beyond* which a single lot — acquired on `buyDate`, sold on
 * `saleDate` — is long-term. "More than N months", so a sale exactly N months
 * after purchase is still short-term. null ⇒ the lot is deemed short-term
 * regardless of period (a §50AA specified-fund lot acquired on/after 1-Apr-2023).
 *
 * `exempt` is excluded from the parameter type deliberately. Its natural return
 * here would be null, which this function already uses to mean "deemed *short*
 * term" — the exact opposite of exempt, and a silent way to tax a tax-free
 * redemption at the higher rate. Callers must branch on the class first; the
 * type makes forgetting a compile error rather than a wrong tax figure.
 */
export function longTermMonths(
  taxClass: Exclude<GainsTaxClass, "exempt">,
  buyDate: string,
  saleDate: string,
): number | null {
  switch (taxClass) {
    case "equity":
      return 12;
    case "unlisted_shares":
      return 24;
    case "specified_fund":
      // §50AA deems only on/after-1-Apr-2023 units short-term; older units of the
      // same fund follow ordinary non-equity rules.
      return buyDate >= SECTION_50AA_START ? null : nonEquityMonths(saleDate);
    case "market_linked_debenture":
      // §50AA covers MLDs unconditionally — always short-term.
      return null;
    case "unlisted_bond":
      // §50AA applies to unlisted bonds/debentures transferred on/after the 2024
      // reform, whatever the acquisition date; sold earlier, ordinary rules.
      return saleDate >= HOLDING_PERIOD_REFORM ? null : nonEquityMonths(saleDate);
    case "other":
      return nonEquityMonths(saleDate);
  }
}

export type LotEvent = {
  type: string;
  date: string;
  units: number | null;
  amountPaise: number;
  /**
   * Same-day ordering keys, in priority order. `date` alone is ambiguous for
   * several events on one day, so FIFO needs a deterministic order:
   *   `seq`       — the persisted intra-day order key that *every* event carries
   *                 (imported and manual alike, 0-based within its date). This is
   *                 the authoritative same-day order, editable by the user, and it
   *                 lets a manual sale sit before an imported buy on the same day.
   *   `createdAt` — record time; a fallback only when seq ties (e.g. pure tests
   *                 that omit seq).
   *   `id`        — last-resort total order.
   * All optional so pure callers/tests can omit them; a missing seq counts as 0.
   */
  seq?: number | null;
  createdAt?: Date | string | null;
  id?: string;
};

/** Comparable string for a createdAt that may be a Date, ISO string, or absent. */
function tieKey(createdAt: Date | string | null | undefined): string {
  if (createdAt == null) return "";
  return createdAt instanceof Date ? createdAt.toISOString() : createdAt;
}

export interface RealizedSlice {
  /** When these units were redeemed. */
  sellDate: string;
  /** When these units were acquired (the matched FIFO lot). */
  buyDate: string;
  units: number;
  proceedsPaise: number;
  /** Effective acquisition cost after grandfathering. */
  costPaise: number;
  /** Un-grandfathered acquisition cost, for reference / audit. */
  actualCostPaise: number;
  /** proceeds − effective cost. */
  gainPaise: number;
  term: GainTerm;
  heldDays: number;
  /** True when grandfathering changed the cost from its actual value. */
  grandfathered: boolean;
}

export interface RealizedGains {
  slices: RealizedSlice[];
  shortTermGainPaise: number;
  longTermGainPaise: number;
  /** Realized on exempt disposals; deliberately outside `totalGainPaise`. */
  exemptGainPaise: number;
  /** Taxable total: short + long only. */
  totalGainPaise: number;
  totalProceedsPaise: number;
  totalCostPaise: number;
}

function parseIso(d: string): { y: number; m: number; day: number } {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  return { y, m, day };
}

/** Whole days between two ISO dates (b − a), UTC, calendar-accurate. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * True when `sellDate` is more than `months` calendar months after `buyDate` —
 * the legal long-term test. Uses a calendar shift (add months to the buy date)
 * rather than a day count, so it lands on the right side of month-length and
 * leap-year edges. Example: buy 15-Jan-2024, +12m ⇒ threshold 15-Jan-2025; a
 * sale on 15-Jan-2025 is *not* long-term, 16-Jan-2025 is.
 */
export function isLongTerm(buyDate: string, sellDate: string, months: number): boolean {
  const b = parseIso(buyDate);
  const totalMonths = b.m - 1 + months;
  const ty = b.y + Math.floor(totalMonths / 12);
  const tm = (totalMonths % 12) + 1;
  // Clamp the day to the target month's length (e.g. 31-Jan + 1m ⇒ 28/29-Feb).
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  const td = Math.min(b.day, lastDay);
  const threshold = `${ty}-${String(tm).padStart(2, "0")}-${String(td).padStart(2, "0")}`;
  return sellDate > threshold;
}

type OpenLot = { date: string; units: number; costPaise: number };

/**
 * Match a holding's sells against its buys FIFO and classify each matched slice.
 *
 * Events are processed in date order, and *within a day* by the intra-day order
 * key `seq` that every event carries — imported and manual alike — then record
 * time (`createdAt`) as a fallback, then a buy-before-sell convention, then `id`.
 * Because seq is a single order shared by both sources, a manual sale can be
 * placed before a same-day imported buy; and because a re-imported fuller
 * statement rewrites seq (per-date, see reconcileEvents), same-day order stays
 * reconcilable regardless of ingestion time. A sell ordered before a later
 * same-day buy is processed first (and simply oversells if nothing is held yet,
 * rather than consuming units acquired later that day). An oversell — more units
 * sold than ever held — realizes only against the units that existed; the excess
 * is dropped, mirroring costBasis()'s cap.
 */
export function realizeGains(events: LotEvent[], config: TaxLotConfig): RealizedGains {
  const ordered = [...events]
    .filter((e) => (e.type === "buy" || e.type === "sell") && e.units !== null && e.units > 0)
    .sort((a, b) => {
      if (a.date !== b.date) return a.date < b.date ? -1 : 1;
      // Same day: the shared intra-day order key wins (missing seq counts as 0).
      const sa = a.seq ?? 0;
      const sb = b.seq ?? 0;
      if (sa !== sb) return sa - sb;
      const ka = tieKey(a.createdAt);
      const kb = tieKey(b.createdAt);
      if (ka !== kb) return ka < kb ? -1 : 1;
      // Genuinely indistinguishable: fall back to a documented convention.
      if (a.type !== b.type) return a.type === "buy" ? -1 : 1;
      return (a.id ?? "") < (b.id ?? "") ? -1 : (a.id ?? "") > (b.id ?? "") ? 1 : 0;
    });

  const lots: OpenLot[] = [];
  const slices: RealizedSlice[] = [];

  for (const e of ordered) {
    const units = e.units!;
    if (e.type === "buy") {
      lots.push({ date: e.date, units, costPaise: e.amountPaise });
      continue;
    }
    // sell
    const proceedsPerUnit = e.amountPaise / units;
    let remaining = units;
    let matchedUnits = 0; // units of this sale matched to lots so far
    let allocatedProceeds = 0; // proceeds handed out so far, for cumulative rounding
    while (remaining > 1e-9 && lots.length > 0) {
      const lot = lots[0]!;
      const take = Math.min(remaining, lot.units);
      const consumesLot = take >= lot.units - 1e-9;
      const costPerUnit = lot.costPaise / lot.units;
      // A lot's final slice takes its entire remaining cost, so the slices carved
      // from one lot sum to its exact acquisition cost (no per-slice drift).
      const actualCost = consumesLot ? lot.costPaise : Math.round(costPerUnit * take);
      // Cumulative rounding of proceeds: each slice gets the difference between the
      // running rounded total and what was handed out, so the slices of one sale
      // sum to the sale amount exactly (the remainder lands on the last slice).
      matchedUnits += take;
      const runningProceeds = Math.round(proceedsPerUnit * matchedUnits);
      const proceeds = runningProceeds - allocatedProceeds;
      allocatedProceeds = runningProceeds;

      let cost = actualCost;
      let grandfathered = false;
      if (config.taxClass === "equity" && config.grandfatherNavPaise !== null && lot.date < GRANDFATHER_CUTOFF) {
        // Cost of acquisition = higher of (actual cost) and
        // (lower of FMV-on-31-Jan-2018 and full sale value). §55(2)(ac).
        const fmvOrSale = Math.min(config.grandfatherNavPaise, proceedsPerUnit);
        const effPerUnit = Math.max(costPerUnit, fmvOrSale);
        const gfCost = Math.round(effPerUnit * take);
        if (gfCost !== actualCost) {
          cost = gfCost;
          grandfathered = true;
        }
      }

      const heldDays = daysBetween(lot.date, e.date);
      // Exempt short-circuits before any holding-period test: there is no line
      // to be on the right side of. Narrowing here is also what lets the
      // `longTermMonths` call below typecheck.
      let term: GainTerm;
      if (config.taxClass === "exempt") {
        term = "exempt";
      } else {
        const ltMonths = longTermMonths(config.taxClass, lot.date, e.date);
        term = ltMonths !== null && isLongTerm(lot.date, e.date, ltMonths) ? "long" : "short";
      }
      slices.push({
        sellDate: e.date,
        buyDate: lot.date,
        units: take,
        proceedsPaise: proceeds,
        costPaise: cost,
        actualCostPaise: actualCost,
        gainPaise: proceeds - cost,
        term,
        heldDays,
        grandfathered,
      });

      // Consume the lot by its *actual* cost, so remaining basis stays honest.
      lot.units -= take;
      lot.costPaise -= actualCost;
      remaining -= take;
      if (lot.units <= 1e-9) lots.shift();
    }
  }

  let shortTermGainPaise = 0;
  let longTermGainPaise = 0;
  let exemptGainPaise = 0;
  let totalProceedsPaise = 0;
  let totalCostPaise = 0;
  for (const s of slices) {
    if (s.term === "exempt") exemptGainPaise += s.gainPaise;
    else if (s.term === "short") shortTermGainPaise += s.gainPaise;
    else longTermGainPaise += s.gainPaise;
    totalProceedsPaise += s.proceedsPaise;
    totalCostPaise += s.costPaise;
  }

  return {
    slices,
    shortTermGainPaise,
    longTermGainPaise,
    exemptGainPaise,
    // Taxable only. Folding the exempt gain in here is what would make the
    // statement overstate liability, so it stays a separate line throughout.
    totalGainPaise: shortTermGainPaise + longTermGainPaise,
    totalProceedsPaise,
    totalCostPaise,
  };
}

/**
 * A *starting guess* at a new holding's tax class from its asset class, used only
 * as the create-time default — the user can and should correct it (a debt or
 * §50AA fund also lands under `mutual_fund`). Equity-ish classes guess `equity`;
 * everything else guesses `other`. Never used to override a stored value.
 */
export function defaultTaxClass(assetClass: string): GainsTaxClass {
  return assetClass === "stock" || assetClass === "mutual_fund" || assetClass === "etf"
    ? "equity"
    : "other";
}
