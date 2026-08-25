import { asc, desc, eq, inArray } from "drizzle-orm";
import type { CapitalPosition, HarvestSuggestion, OpenLotPosition, TaxHarvestPlan } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { holdingEvents, holdings, holdingValuations } from "../schema.ts";
import { daysBetween, longTermMonths, realizeGains } from "./tax-lots.ts";
import { currentFy, fyRange } from "../../../lib/financial-year.ts";
import { LTCG_ANNUAL_EXEMPTION_PAISE } from "../../planning/services/tax-aware-rebalancing.ts";
// Cross-module SERVICE import (allowed — only cross-module SCHEMA imports are
// forbidden, see CLAUDE.md). getCapitalPosition is the single source of truth
// for brought-forward capital-loss set-off (task 13.11); the harvesting
// planner (13.12) must not derive its own gain pools blind to it, or a large
// brought-forward LTCL makes the exemption headroom look artificially used
// up and the planner under-suggests legitimate gain harvests.
import { getCapitalPosition } from "../../tax/services/capital-losses.ts";

/**
 * Tax-harvesting planner (task 13.12).
 *
 * Reads the single FIFO calculator's open lots (`realizeGains` — the same
 * engine the capital-gains statement uses) and the annual equity-LTCG
 * exemption, then suggests which open lots to sell before 31 March:
 *
 * - **harvest_loss** — realise an unrealised loss; its value is capped by this
 *   year's actually realised gains (STCL eats STCG then spills into LTCG, LTCL
 *   eats LTCG only — §70/§74), valued at the matching flat rate on whatever it
 *   can absorb.
 * - **harvest_gain** — bank an unrealised LONG-TERM EQUITY gain inside the
 *   unused ₹1.25L exemption, where it is tax-free now instead of taxable later.
 *   Short-term and non-equity lots are never suggested as gain harvests.
 *
 * Everything is an estimate at guessed transaction costs. A plan with zero
 * suggestions is a valid, honest answer: nothing is worth selling.
 */

/** Flat post-2024 rates used to value a harvested loss / banked gain (bps). */
export const HARVEST_STCG_RATE_BPS = 2000;
export const HARVEST_LTCG_RATE_BPS = 1250;
/**
 * Guessed round-trip friction of selling and (for losses) rebuying: brokerage,
 * STT, stamp and spread. Deliberately conservative-ish, never presented as exact.
 */
export const HARVEST_TXN_COST_BPS = 20;
/** Typical equity-fund exit load while still inside the load window. */
export const HARVEST_EXIT_LOAD_BPS = 100;
export const HARVEST_EXIT_LOAD_FREE_DAYS = 365;

/** ELSS lock-in: units must stay invested 3 full years from acquisition. */
const ELSS_LOCKIN_MONTHS = 36;
/** Suggestion list cap — beyond this the marginal benefit noise isn't worth reading. */
const MAX_SUGGESTIONS = 25;
/** Sentinel crossover for classes that are short-term no matter how long held. */
const NEVER_LONG_TERM = "9999-12-31";

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

/** ISO date `months` calendar months after `iso`, day clamped to month length. */
export function addMonthsClamped(iso: string, months: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const total = m - 1 + months;
  const ty = y + Math.floor(total / 12);
  const tm = (total % 12) + 1;
  const lastDay = new Date(Date.UTC(ty, tm, 0)).getUTCDate();
  return `${ty}-${String(tm).padStart(2, "0")}-${String(Math.min(d, lastDay)).padStart(2, "0")}`;
}

/** ISO date shifted by whole days (UTC arithmetic, no DST in ISO land). */
export function addDaysIso(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number) as [number, number, number];
  const t = new Date(Date.UTC(y, m - 1, d));
  t.setUTCDate(t.getUTCDate() + days);
  return t.toISOString().slice(0, 10);
}

/**
 * First date ON WHICH a lot acquired on `buyDate` IS long-term for its tax
 * class as of `saleDate` (the non-equity line depends on the sale year) — the
 * calendar day AFTER the clamped holding-period anniversary, because on the
 * anniversary itself the lot is still short-term. The deemed-short classes
 * have no crossover, reported as {@link NEVER_LONG_TERM}.
 */
export function ltcgCrossoverDate(taxClass: string, buyDate: string, saleDate: string): string {
  if (taxClass === "exempt") return NEVER_LONG_TERM;
  const months = longTermMonths(
    taxClass as Parameters<typeof longTermMonths>[0],
    buyDate,
    saleDate,
  );
  return months === null ? NEVER_LONG_TERM : addDaysIso(addMonthsClamped(buyDate, months), 1);
}

export interface BenefitInput {
  /** Signed unrealised P&L of the suggested slice (paise). */
  unrealisedPaise: number;
  /**
   * Losses only: the portion of |unrealised| that offsets LONG-term gains
   * (all of an LTCL; the §70 spill of an STCL past the STCG pool) — valued at
   * the 12.5% LTCG rate instead of 20%. Defaults to 0 for gains.
   */
  offsettingLongTermPaise?: number;
  /** Redemption value of the suggested slice (paise) — friction prices off this. */
  proceedsPaise: number;
  isLongTerm: boolean;
  /** Unused exemption headroom left when this candidate is considered (paise). */
  headroomRemainingPaise: number;
  /** Days the lot has been held — inside the window adds exit load to costs. */
  heldDays: number;
}

export interface BenefitResult {
  grossTaxEffectPaise: number;
  estimatedCostsPaise: number;
  netBenefitPaise: number;
}

/**
 * Value one suggested harvest: tax saved (loss) or avoided-later (gain in
 * exemption headroom), minus estimated transaction costs + exit load priced
 * off the sale PROCEEDS (brokerage/STT/spread scale with what you sell, not
 * with the profit). Net is floored at zero — a harvest that costs more than it
 * saves is not a benefit, and the caller filters those out rather than
 * suggesting them.
 */
export function estimateNetBenefit(input: BenefitInput): BenefitResult {
  let costBps = HARVEST_TXN_COST_BPS;
  if (input.heldDays < HARVEST_EXIT_LOAD_FREE_DAYS) costBps += HARVEST_EXIT_LOAD_BPS;
  const estimatedCostsPaise = Math.round(
    (Math.max(0, input.proceedsPaise) * costBps) / 10_000,
  );
  const magnitude = Math.abs(input.unrealisedPaise);

  let grossTaxEffectPaise: number;
  if (input.unrealisedPaise < 0) {
    // A loss offsets gains at the rate of the GAINS it absorbs: STCG pool @20%,
    // everything landing on long-term gains @12.5%. An LTCL is entirely
    // long-term-offsetting; an STCL spills only past the STCG pool.
    const ltPortion =
      input.isLongTerm
        ? magnitude
        : Math.min(magnitude, Math.max(0, input.offsettingLongTermPaise ?? 0));
    const stPortion = magnitude - ltPortion;
    grossTaxEffectPaise =
      Math.round((stPortion * HARVEST_STCG_RATE_BPS) / 10_000) +
      Math.round((ltPortion * HARVEST_LTCG_RATE_BPS) / 10_000);
  } else {
    // Only the slice inside exemption headroom is banked tax-free; the rest is
    // deferred tax either way, so it contributes no benefit here.
    const taxable = Math.min(input.unrealisedPaise, Math.max(0, input.headroomRemainingPaise));
    grossTaxEffectPaise = Math.round((taxable * HARVEST_LTCG_RATE_BPS) / 10_000);
  }
  return {
    grossTaxEffectPaise,
    estimatedCostsPaise,
    netBenefitPaise: Math.max(0, grossTaxEffectPaise - estimatedCostsPaise),
  };
}

/** Deterministic order: biggest net benefit first, then holding, then lot age. */
export function orderSuggestions(list: HarvestSuggestion[]): HarvestSuggestion[] {
  return [...list].sort(
    (a, b) =>
      b.netBenefitPaise - a.netBenefitPaise ||
      (a.holdingId < b.holdingId ? -1 : a.holdingId > b.holdingId ? 1 : 0) ||
      (a.buyDate < b.buyDate ? -1 : a.buyDate > b.buyDate ? 1 : 0),
  );
}

/**
 * How much BROUGHT-FORWARD capital loss (from `capital_loss_carryforward`,
 * prior years only) was actually absorbed this FY against this-year STCG vs
 * this-year LTCG, per {@link getCapitalPosition}'s §70/§74 set-off detail.
 *
 * Pure and DB-free (takes only the `setoff` block, not a live `CapitalPosition`)
 * so it's directly unit-testable with hand-built fixtures — see
 * tax-harvesting.test.ts. Only STCL can land on STCG; both a spilled STCL and
 * an LTCL can land on LTCG (§70/§74), so `vsLtcgPaise` sums both.
 *
 * NOTE: `getCapitalPosition` computes brought-forward set-off against COMBINED
 * (equity + non-equity) LTCG — it has no concept of the §112A equity exemption
 * or of tax-class splits within LTCG. The `vsLtcgPaise` returned here is
 * therefore re-allocated by the caller (getTaxHarvestPlan) back across the
 * equity/non-equity split it computed itself, using the same non-equity-first
 * convention as the current-year set-off (absorbOther before absorbEquity). This
 * keeps `realisedLtcgPaise` equity-only so the §112A headroom is not erroneously
 * consumed by non-equity LTCG. A documented approximation (see the plan's
 * `assumptions`): there is no real per-entry equity/non-equity split of which
 * years' brought-forward losses offset which asset class; the non-equity-first
 * allocation is an asset-class-aware heuristic, not exact statutory fact.
 */
export function broughtForwardAbsorbedByBucket(
  setoff: CapitalPosition["setoff"],
): { vsStcgPaise: number; vsLtcgPaise: number } {
  return {
    vsStcgPaise: setoff.stclAgainstStcgPaise,
    vsLtcgPaise: setoff.stclAgainstLtcgPaise + setoff.ltclAgainstLtcgPaise,
  };
}

interface LotRow {
  holdingId: string;
  holdingName: string;
  folioNumber: string | null;
  gainsTaxClass: string;
  buyDate: string;
  units: number;
  costPaise: number;
}

const REBUY_CAVEATS = [
  "Rebuying the same fund within a short window does not reset the loss in India (no wash-sale rule), but it restarts the holding-period clock on the new units and forfeits grandfathering.",
  "A rebuy at a different NAV changes your average cost; the harvested loss is only 'free' if you were going to hold this exposure anyway.",
];

/**
 * Build the FY harvesting plan. `fy` defaults to the current FY; `today`
 * (ISO date) bounds which events count as posted and drives holding periods.
 */
export async function getTaxHarvestPlan(
  db: Db,
  userId: string,
  fy?: string,
  today?: string,
): Promise<TaxHarvestPlan> {
  const ref = today ?? isoToday();
  const targetFy = fy ?? currentFy();
  const [fyStart, fyEnd] = fyRange(targetFy);

  // Brought-forward capital losses (Sec 74) — same single source of truth
  // advance-tax.ts uses. Independent of the holdings/events query below, so
  // it runs concurrently rather than serially.
  const capitalPositionPromise = getCapitalPosition(db, userId, targetFy, ref);

  const rows = await db.query.holdings.findMany({
    where: eq(holdings.userId, userId),
    orderBy: (h, { asc }) => [asc(h.createdAt)],
  });
  const ids = rows.map((r) => r.id);
  const events = ids.length
    ? await db.query.holdingEvents.findMany({
        where: inArray(holdingEvents.holdingId, ids),
        orderBy: [
          desc(holdingEvents.date),
          asc(holdingEvents.seq),
          asc(holdingEvents.createdAt),
          asc(holdingEvents.id),
        ],
      })
    : [];
  // Latest valuation per holding (unique index on holdingId+date keeps one/day).
  const valuations = ids.length
    ? await db.query.holdingValuations.findMany({
        where: inArray(holdingValuations.holdingId, ids),
        orderBy: [asc(holdingValuations.holdingId), desc(holdingValuations.date)],
      })
    : [];
  const latestValue = new Map<string, { date: string; valuePaise: number; nav: number | null }>();
  for (const v of valuations) {
    if (!latestValue.has(v.holdingId)) {
      latestValue.set(v.holdingId, { date: v.date, valuePaise: v.valuePaise, nav: v.nav });
    }
  }

  const lots: LotRow[] = [];
  // Locked ELSS lots STAY in the position list (they still own part of the
  // holding's value, so excluding them would misallocate manual valuations);
  // they are excluded from suggestions only.
  const lockedLotIds = new Set<string>();
  let elssLockedLotCount = 0;
  // This FY's realised slices, kept as SIGNED sums per bucket so current-year
  // §70 netting can run BEFORE any pool or exemption headroom is derived.
  let shortSumPaise = 0; // all classes, term short
  let eqLongSumPaise = 0; // equity, term long
  let otherLongSumPaise = 0; // non-equity, term long

  for (const h of rows) {
    const evts = events.filter((e) => e.holdingId === h.id && e.date <= ref);
    if (evts.length === 0) continue;
    const gains = realizeGains(evts, {
      taxClass: h.gainsTaxClass,
      grandfatherNavPaise: h.grandfatherNavPaise,
    });

    for (const s of gains.slices) {
      if (s.sellDate < fyStart || s.sellDate > fyEnd) continue;
      if (s.term === "long") {
        if (h.gainsTaxClass === "equity") eqLongSumPaise += s.gainPaise;
        else otherLongSumPaise += s.gainPaise;
      } else if (s.term === "short") {
        shortSumPaise += s.gainPaise;
      } else {
        // "exempt" (e.g. a tax-free bond redemption, an SGB redeemed at
        // maturity): outside capital gains altogether, so it contributes to
        // neither the short nor the long pool. Written as an explicit
        // if/else-if/else (not a catch-all else) so a future new GainTerm
        // value can't silently fall into the wrong bucket again.
      }
    }

    for (const lot of gains.openLots) {
      // ELSS lock-in: units bought within the last 3 years cannot be sold yet.
      const locked = h.isElss && ref < addMonthsClamped(lot.buyDate, ELSS_LOCKIN_MONTHS);
      if (locked) {
        elssLockedLotCount += 1;
        lockedLotIds.add(`${h.id}:${lot.buyDate}`);
      }
      lots.push({
        holdingId: h.id,
        holdingName: h.name,
        folioNumber: h.folioNumber,
        gainsTaxClass: h.gainsTaxClass,
        buyDate: lot.buyDate,
        units: lot.units,
        costPaise: lot.costPaise,
      });
    }
  }

  // ── Current-year set-off FIRST (§70/§74), then derive pools & headroom ────
  // Intra-term netting is the signed sum itself. Long losses (LTCL) then offset
  // long GAINS of either class (deterministic order: non-equity first), and any
  // residual STCL spills onto what remains of those same pools.
  const stcgPool0 = Math.max(0, shortSumPaise);
  let lossPool = Math.max(0, -otherLongSumPaise) + Math.max(0, -eqLongSumPaise);
  let poolOtherLong = Math.max(0, otherLongSumPaise);
  let poolEquityLong = Math.max(0, eqLongSumPaise);
  const absorbOther = Math.min(lossPool, poolOtherLong);
  lossPool -= absorbOther;
  poolOtherLong -= absorbOther;
  const absorbEquity = Math.min(lossPool, poolEquityLong);
  poolEquityLong -= absorbEquity;

  let stclResidual = Math.max(0, -shortSumPaise);
  const spillOther = Math.min(stclResidual, poolOtherLong);
  stclResidual -= spillOther;
  poolOtherLong -= spillOther;
  const spillEquity = Math.min(stclResidual, poolEquityLong);
  poolEquityLong -= spillEquity;

  // Brought-forward losses (Sec 74, prior years) apply on TOP of the
  // current-year set-off above — same ordering advance-tax.ts uses via
  // getCapitalPosition. bfAbsorbed.vsLtcgPaise is a COMBINED equity+non-equity
  // figure (getCapitalPosition has no tax-class split); it is re-allocated back
  // across the equity/non-equity split using the same non-equity-first convention
  // as the current-year netting above (absorbOther before absorbEquity) so that
  // realisedLtcgPaise is EQUITY-ONLY — non-equity LTCG never consumes the §112A
  // exemption. A harvested loss cannot double-claim gain capacity that
  // brought-forward losses already consumed.
  const capitalPosition = await capitalPositionPromise;
  const bfAbsorbed = broughtForwardAbsorbedByBucket(capitalPosition.setoff);
  // Non-equity first, then equity — mirrors absorbOther/absorbEquity above.
  const bfVsOtherLong = Math.min(bfAbsorbed.vsLtcgPaise, poolOtherLong);
  const bfVsEquityLong = Math.min(bfAbsorbed.vsLtcgPaise - bfVsOtherLong, poolEquityLong);
  const equityLongAfterBf = poolEquityLong - bfVsEquityLong;
  const otherLongAfterBf = poolOtherLong - bfVsOtherLong;
  // §112A basis: equity LTCG only, post brought-forward set-off.
  const realisedLtcgPaise = Math.max(0, equityLongAfterBf);
  let stcgPool = Math.max(0, stcgPool0 - bfAbsorbed.vsStcgPaise);
  // Only TAXABLE LTCG gives a harvested loss its 12.5% value: non-equity LTCG
  // is always taxed; equity LTCG only beyond the ₹1.25L annual exemption.
  let taxableLtcgPool = Math.max(
    0,
    otherLongAfterBf + Math.max(0, equityLongAfterBf - LTCG_ANNUAL_EXEMPTION_PAISE),
  );

  // Position rows for every tradable open lot (valued or not).
  const lotPositions: OpenLotPosition[] = lots.map((lot) => {
    const valuation = latestValue.get(lot.holdingId);
    let currentValuePaise: number | null = null;
    if (valuation) {
      if (valuation.nav != null) {
        // nav is RUPEES per unit (see holdings.ts valuation roll-up): ×100 to paise.
        currentValuePaise = Math.round(valuation.nav * lot.units * 100);
      } else {
        // Manual valuation with no NAV: spread it pro-rata over the currently
        // open units of that holding (disclosed assumption).
        const totalOpenUnits = lots
          .filter((l) => l.holdingId === lot.holdingId)
          .reduce((u, l) => u + l.units, 0);
        currentValuePaise =
          totalOpenUnits > 0 ? Math.round((valuation.valuePaise * lot.units) / totalOpenUnits) : 0;
      }
    }
    const held = daysBetween(lot.buyDate, ref);
    const crossover =
      lot.gainsTaxClass === "exempt"
        ? NEVER_LONG_TERM
        : ltcgCrossoverDate(lot.gainsTaxClass, lot.buyDate, ref);
    return {
      holdingId: lot.holdingId,
      holdingName: lot.holdingName,
      folioNumber: lot.folioNumber,
      gainsTaxClass: lot.gainsTaxClass,
      buyDate: lot.buyDate,
      units: lot.units,
      costPaise: lot.costPaise,
      currentValuePaise,
      unrealisedGainPaise:
        currentValuePaise == null ? null : currentValuePaise - lot.costPaise,
      holdingPeriodDays: Math.max(0, held),
      isLongTerm: crossover !== NEVER_LONG_TERM && ref >= crossover,
      ltcgCrossoverDate: crossover,
    };
  });

  // ── Suggestions ────────────────────────────────────────────────────────────
  // Losses are allocated against this year's realised-gain pools best-first
  // (bigger statutory rate = bigger saving per rupee of loss); §70 order:
  // STCL eats STCG then spills into LTCG, LTCL eats LTCG only. Gains are
  // banked only inside remaining §112A headroom and only on long-term EQUITY
  // lots — nothing else may use that exemption.
  interface PendingLoss {
    pos: OpenLotPosition;
    rateBps: number;
    magnitude: number;
    caveats: string[];
  }
  const pendingLosses: PendingLoss[] = [];
  const pendingGains: OpenLotPosition[] = [];
  let headroomRemaining = Math.max(0, LTCG_ANNUAL_EXEMPTION_PAISE - realisedLtcgPaise);
  const candidates: HarvestSuggestion[] = [];

  for (const pos of lotPositions) {
    if (lockedLotIds.has(`${pos.holdingId}:${pos.buyDate}`)) continue;
    if (pos.unrealisedGainPaise == null || pos.unrealisedGainPaise === 0) continue;
    if (pos.currentValuePaise == null) continue;

    if (pos.unrealisedGainPaise < 0) {
      // Exempt-class disposals create no taxable loss — never suggested.
      if (pos.gainsTaxClass === "exempt") continue;
      pendingLosses.push({
        pos,
        rateBps: pos.isLongTerm ? HARVEST_LTCG_RATE_BPS : HARVEST_STCG_RATE_BPS,
        magnitude: -pos.unrealisedGainPaise,
        caveats: [
          pos.isLongTerm
            ? "Long-term loss offsets only long-term gains."
            : "Short-term loss offsets short-term gains first, then long-term.",
          ...(pos.gainsTaxClass !== "equity"
            ? [
                "Non-equity losses usually offset gains taxed at slab rates — the value shown is an approximation.",
              ]
            : []),
          ...REBUY_CAVEATS,
        ],
      });
    } else if (pos.gainsTaxClass === "equity" && pos.isLongTerm) {
      pendingGains.push(pos);
    }
    // Everything else — short-term gains, non-equity gains (slab/deemed-short
    // classes), unvalued lots — is deliberately NOT suggested as a harvest.
  }

  // ── Phase A: rank ALL candidates before any capacity is consumed ──────────
  // A cost-dominated lot must not eat exemption headroom (or pool value) that a
  // profitable later lot could have used.
  const gainPlan = pendingGains
    .map((pos) => {
      const r = estimateNetBenefit({
        unrealisedPaise: pos.unrealisedGainPaise!,
        proceedsPaise: pos.currentValuePaise!,
        isLongTerm: true,
        headroomRemainingPaise: headroomRemaining,
        heldDays: pos.holdingPeriodDays,
      });
      return { pos, net: r.netBenefitPaise };
    })
    .filter((p) => p.net > 0)
    .sort(
      (a, b) =>
        b.net - a.net ||
        (a.pos.holdingId < b.pos.holdingId ? -1 : a.pos.holdingId > b.pos.holdingId ? 1 : 0) ||
        (a.pos.buyDate < b.pos.buyDate ? -1 : a.pos.buyDate > b.pos.buyDate ? 1 : 0),
    );

  for (const { pos } of gainPlan) {
    if (headroomRemaining <= 0) break;
    // Gain harvest: only a long-term equity lot may use the §112A exemption.
    const bankableGain = Math.min(pos.unrealisedGainPaise!, headroomRemaining);
    const scale = bankableGain / pos.unrealisedGainPaise!;
    const proceeds =
      scale === 1 ? pos.currentValuePaise! : Math.round(pos.currentValuePaise! * scale);
    const r = estimateNetBenefit({
      unrealisedPaise: bankableGain,
      proceedsPaise: proceeds,
      isLongTerm: true,
      headroomRemainingPaise: headroomRemaining,
      heldDays: pos.holdingPeriodDays,
    });
    if (r.netBenefitPaise <= 0) continue; // scaled slice not worth it; capacity intact
    candidates.push({
      holdingId: pos.holdingId,
      holdingName: pos.holdingName,
      kind: "harvest_gain",
      buyDate: pos.buyDate,
      unitsToSell: scale === 1 ? pos.units : Math.max(1e-6, pos.units * scale),
      unrealisedPaise: bankableGain,
      grossTaxEffectPaise: r.grossTaxEffectPaise,
      estimatedCostsPaise: r.estimatedCostsPaise,
      netBenefitPaise: r.netBenefitPaise,
      caveats: [...REBUY_CAVEATS],
    });
    headroomRemaining -= bankableGain;
  }

  // Highest-value losses claim the pools first; deterministic tie-breaks.
  pendingLosses.sort(
    (a, b) =>
      b.rateBps - a.rateBps ||
      (a.pos.holdingId < b.pos.holdingId ? -1 : a.pos.holdingId > b.pos.holdingId ? 1 : 0) ||
      (a.pos.buyDate < b.pos.buyDate ? -1 : a.pos.buyDate > b.pos.buyDate ? 1 : 0),
  );
  for (const { pos, caveats, magnitude, rateBps } of pendingLosses) {
    // Cheap pre-filter: a loss whose FULL magnitude cannot clear its own costs
    // at full proceeds never justifies consuming pool capacity.
    const fullCosts = Math.round(
      (pos.currentValuePaise! *
        ((pos.holdingPeriodDays < HARVEST_EXIT_LOAD_FREE_DAYS
          ? HARVEST_TXN_COST_BPS + HARVEST_EXIT_LOAD_BPS
          : HARVEST_TXN_COST_BPS))) / 10_000,
    );
    if (Math.round((magnitude * rateBps) / 10_000) <= fullCosts) continue;

    // §70/§74 allocation across what's actually left in the pools. Only
    // TAXABLE LTCG gives a loss its 12.5% value — LTCG inside the ₹1.25L
    // exemption costs nothing to offset.
    //
    // Pool decrements are DEFERRED until after the final net-benefit check: a
    // candidate rejected at that check must not drain capacity that a later,
    // genuinely profitable candidate could use. vsStcgConsumed /
    // taxableLtcgConsumed record the intended reservation; the pools are only
    // written once we know the candidate will be accepted.
    let usable: number;
    let offsettingLongTerm: number;
    let vsStcgConsumed = 0; // long-term losses never touch the STCG pool
    let taxableLtcgConsumed: number; // assigned by BOTH branches below
    if (!pos.isLongTerm) {
      const vsStcg = Math.min(magnitude, stcgPool);
      const spill = Math.min(magnitude - vsStcg, taxableLtcgPool);
      usable = vsStcg + spill;
      offsettingLongTerm = spill; // spill absorbs LONG-term gains → 12.5% value
      vsStcgConsumed = vsStcg;
      taxableLtcgConsumed = spill;
    } else {
      usable = Math.min(magnitude, taxableLtcgPool);
      offsettingLongTerm = usable; // LTCL offsets long-term gains only
      taxableLtcgConsumed = usable;
    }
    if (usable <= 0) continue; // nothing left to offset ⇒ no benefit to suggest

    const scale = usable / magnitude;
    const unitsToSell = scale === 1 ? pos.units : Math.max(1e-6, pos.units * scale);
    const proceeds =
      scale === 1 ? pos.currentValuePaise! : Math.round(pos.currentValuePaise! * scale);
    const r = estimateNetBenefit({
      unrealisedPaise: -usable,
      offsettingLongTermPaise: offsettingLongTerm,
      proceedsPaise: proceeds,
      isLongTerm: pos.isLongTerm,
      headroomRemainingPaise: 0,
      heldDays: pos.holdingPeriodDays,
    });
    if (r.netBenefitPaise <= 0) continue; // rejected — pools not yet decremented, nothing to restore
    // Candidate accepted: commit the pool reservation so later candidates see
    // accurate remaining capacity.
    stcgPool -= vsStcgConsumed;
    taxableLtcgPool -= taxableLtcgConsumed;
    candidates.push({
      holdingId: pos.holdingId,
      holdingName: pos.holdingName,
      kind: "harvest_loss",
      buyDate: pos.buyDate,
      unitsToSell,
      unrealisedPaise: -usable,
      grossTaxEffectPaise: r.grossTaxEffectPaise,
      estimatedCostsPaise: r.estimatedCostsPaise,
      netBenefitPaise: r.netBenefitPaise,
      caveats: [...caveats],
    });
  }

  // Not worthwhile ⇒ not suggested. An empty list is a valid plan.
  const suggestions = orderSuggestions(candidates.filter((c) => c.netBenefitPaise > 0)).slice(
    0,
    MAX_SUGGESTIONS,
  );

  return {
    fy: targetFy,
    ltcgHeadroomPaise: Math.max(0, LTCG_ANNUAL_EXEMPTION_PAISE - realisedLtcgPaise),
    realisedLtcgPaise,
    lots: lotPositions,
    suggestions,
    elssLockedLotCount,
    rebuyCaveats: REBUY_CAVEATS,
    assumptions: [
      "Flat post-July-2024 rates are used throughout: equity STCG 20%, equity LTCG 12.5% above the ₹1.25L annual exemption.",
      "The ₹1.25L exemption headroom is based on EQUITY-ONLY realised LTCG (this plan's FIFO pass) after both current-year set-off and brought-forward capital-loss set-off (Sec 74, via getCapitalPosition). Non-equity LTCG never consumes the §112A exemption and is excluded from this basis. getCapitalPosition returns brought-forward absorption as a combined equity+non-equity figure; this plan re-allocates it across asset classes using the same non-equity-first convention as the current-year netting — an approximation (no per-entry equity/non-equity split exists for which years' brought-forward losses covered which asset class) but asset-class-aware rather than blindly combined. Other income heads are out of scope.",
      "Transaction costs are a guessed 0.2% round trip; an exit-load guess of 1% is added for lots held under 365 days.",
      "Lots valued without a NAV split their holding's latest manual valuation pro-rata across currently open units.",
      "Grandfathering (31-Jan-2018 FMV) is ignored for unrealised lots — it can change realised amounts at sale time.",
      "Loss value is capped against this year's actually realised gains AFTER current-year set-off (STCL eats STCG then LTCG, LTCL only LTCG) AND after brought-forward capital losses (Sec 74) have already claimed their share of the same gain pools, and LTCG inside the ₹1.25L exemption is treated as worthless to offset because it incurs no tax. A loss with nothing taxable to offset is not suggested; carry-forward value beyond the year is not modelled. Brought-forward losses rank AHEAD of a suggested (not-yet-realised) harvest loss for absorbing this year's gains, mirroring the statutory order; the amount of brought-forward loss absorbed is taken from getCapitalPosition (a combined equity+non-equity figure) and re-allocated to the equity/non-equity pools this plan derives itself using the same non-equity-first convention, so a harvested loss cannot double-claim gain capacity that brought-forward losses already consumed.",
      "Gain harvesting is offered only on long-term equity lots (the §112A exemption has no other users); short-term and non-equity gains are never suggested.",
      "No surcharge or cess is included; figures are estimates, not tax advice.",
      `At most ${MAX_SUGGESTIONS} suggestions are listed, best net benefit first.`,
      "An empty suggestion list means nothing cleared the cost/benefit bar — doing nothing is a valid answer.",
    ],
    isEstimate: true,
    generatedAt: new Date().toISOString(),
  };
}
