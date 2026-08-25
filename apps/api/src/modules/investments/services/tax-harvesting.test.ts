/**
 * tax-harvesting.test.ts — tests for task 13.12.
 *
 * Two layers, because both have bitten us:
 *   1. pure helpers (dates, benefit maths, ordering) — direct calls;
 *   2. the DB-backed plan assembler against a stub `db.query.*` object, pinning
 *      the conventions that pure tests cannot see (NAV is rupees/unit → ×100,
 *      locked lots stay in positions, realised-LTCG flooring, §112A gating,
 *      loss pools capped per §70/§74).
 * All amounts in paise unless a comment says otherwise.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import type { Db } from "../../../db/index.ts";
import {
  HARVEST_EXIT_LOAD_FREE_DAYS,
  HARVEST_LTCG_RATE_BPS,
  HARVEST_STCG_RATE_BPS,
  HARVEST_TXN_COST_BPS,
  addDaysIso,
  addMonthsClamped,
  broughtForwardAbsorbedByBucket,
  estimateNetBenefit,
  getTaxHarvestPlan,
  ltcgCrossoverDate,
  orderSuggestions,
} from "./tax-harvesting.ts";
import { LTCG_ANNUAL_EXEMPTION_PAISE } from "../../planning/services/tax-aware-rebalancing.ts";
import type { CapitalPosition, HarvestSuggestion } from "@compass/shared";

// ─── date helpers ─────────────────────────────────────────────────────────────

describe("addMonthsClamped", () => {
  it("adds calendar months across a year boundary", () => {
    assert.equal(addMonthsClamped("2025-11-15", 12), "2026-11-15");
    assert.equal(addMonthsClamped("2024-01-31", 1), "2024-02-29"); // leap year
  });

  it("clamps to month length on non-leap February", () => {
    assert.equal(addMonthsClamped("2025-01-31", 1), "2025-02-28");
    // 31-Mar + 1m clamps to 30-Apr; +13m lands back on the 31st.
    assert.equal(addMonthsClamped("2024-03-31", 1), "2024-04-30");
    assert.equal(addMonthsClamped("2024-03-31", 13), "2025-04-30");
  });
});

describe("addDaysIso", () => {
  it("shifts across month and year boundaries", () => {
    assert.equal(addDaysIso("2026-03-10", 1), "2026-03-11");
    assert.equal(addDaysIso("2026-02-28", 1), "2026-03-01"); // non-leap
    assert.equal(addDaysIso("2024-02-28", 1), "2024-02-29"); // leap
    assert.equal(addDaysIso("2025-12-31", 1), "2026-01-01");
  });
});

// ─── ltcgCrossoverDate ───────────────────────────────────────────────────────

describe("ltcgCrossoverDate", () => {
  it("equity becomes long-term the DAY AFTER the 12-month anniversary", () => {
    assert.equal(ltcgCrossoverDate("equity", "2025-03-10", "2026-08-24"), "2026-03-11");
  });

  it("month-end clamps push the crossover into the next month", () => {
    // 2024-02-29 + 12m clamps to 2025-02-28 → crossover 2025-03-01.
    assert.equal(ltcgCrossoverDate("equity", "2024-02-29", "2026-08-24"), "2025-03-01");
    // 2025-01-31 + 12m → 2026-01-31 → crossover 2026-02-01.
    assert.equal(ltcgCrossoverDate("equity", "2025-01-31", "2026-08-24"), "2026-02-01");
  });

  it("non-equity uses the post-2024 24-month line when sold after the reform", () => {
    assert.equal(ltcgCrossoverDate("other", "2024-06-01", "2026-08-24"), "2026-06-02");
  });

  it("deemed-short classes never cross over", () => {
    assert.equal(
      ltcgCrossoverDate("market_linked_debenture", "2020-01-01", "2026-08-24"),
      "9999-12-31",
    );
  });
});

// ─── estimateNetBenefit ──────────────────────────────────────────────────────

describe("estimateNetBenefit", () => {
  const HELD_LONG = HARVEST_EXIT_LOAD_FREE_DAYS; // no exit load
  const HELD_SHORT = HARVEST_EXIT_LOAD_FREE_DAYS - 1;

  it("short-term loss against STCG: ₹92,500 → tax effect ₹18,500 at 20%", () => {
    const r = estimateNetBenefit({
      unrealisedPaise: -9_250_000,
      proceedsPaise: 9_250_000,
      isLongTerm: false,
      headroomRemainingPaise: 0,
      heldDays: HELD_LONG,
    });
    assert.equal(r.grossTaxEffectPaise, 1_850_000);
    // costs price off PROCEEDS: 9_250_000 × 20bps = 18_500 p (₹185)
    assert.equal(r.estimatedCostsPaise, 18_500);
    assert.equal(r.netBenefitPaise, 1_831_500);
  });

  it("long-term loss is valued at the 12.5% LTCG rate, not 20%", () => {
    const r = estimateNetBenefit({
      unrealisedPaise: -9_250_000,
      proceedsPaise: 9_250_000,
      isLongTerm: true,
      headroomRemainingPaise: 0,
      heldDays: HELD_LONG,
    });
    assert.equal(r.grossTaxEffectPaise, Math.round((9_250_000 * HARVEST_LTCG_RATE_BPS) / 10_000));
  });

  it("an STCL's spill onto long-term gains is valued at 12.5%, blended with the 20% part", () => {
    // ₹92,500 loss: ₹42,500 absorbs long-term gains, ₹50,000 short-term.
    const r = estimateNetBenefit({
      unrealisedPaise: -9_250_000,
      offsettingLongTermPaise: 4_250_000,
      proceedsPaise: 9_250_000,
      isLongTerm: false,
      headroomRemainingPaise: 0,
      heldDays: HELD_LONG,
    });
    assert.equal(r.grossTaxEffectPaise, 1_000_000 + 531_250); // 20% + 12.5%
  });

  it("gain inside headroom banks 12.5% of it: ₹50,000 → ₹6,250 avoided", () => {
    const r = estimateNetBenefit({
      unrealisedPaise: 5_000_000,
      proceedsPaise: 20_000_000,
      isLongTerm: true,
      headroomRemainingPaise: LTCG_ANNUAL_EXEMPTION_PAISE,
      heldDays: HELD_LONG,
    });
    assert.equal(r.grossTaxEffectPaise, 625_000);
    assert.equal(r.netBenefitPaise, 585_000); // minus 40_000 costs on ₹2L proceeds
  });

  it("gain beyond headroom only banks the exempt slice", () => {
    // ₹2L gain, ₹50k headroom → only ₹50k counts as banked.
    const r = estimateNetBenefit({
      unrealisedPaise: 20_000_000,
      proceedsPaise: 20_000_000,
      isLongTerm: true,
      headroomRemainingPaise: 5_000_000,
      heldDays: HELD_LONG,
    });
    assert.equal(r.grossTaxEffectPaise, 625_000);
  });

  it("a lot held under 365 days pays exit load on top of transaction costs — on proceeds", () => {
    const r = estimateNetBenefit({
      unrealisedPaise: -5_000_000,
      proceedsPaise: 8_000_000,
      isLongTerm: false,
      headroomRemainingPaise: 0,
      heldDays: HELD_SHORT,
    });
    assert.equal(
      r.estimatedCostsPaise,
      Math.round((8_000_000 * (HARVEST_TXN_COST_BPS + 100)) / 10_000),
    );
  });

  it("zero-headroom gain has no gross effect; costs floor net at zero", () => {
    const r = estimateNetBenefit({
      unrealisedPaise: 1_000_000,
      proceedsPaise: 5_000_000,
      isLongTerm: true,
      headroomRemainingPaise: 0,
      heldDays: HELD_SHORT,
    });
    assert.equal(r.grossTaxEffectPaise, 0);
    assert.equal(r.netBenefitPaise, 0);
  });

  it("rate constants match the flat CG regime", () => {
    assert.equal(HARVEST_STCG_RATE_BPS, 2000);
    assert.equal(HARVEST_LTCG_RATE_BPS, 1250);
  });
});

// ─── orderSuggestions ────────────────────────────────────────────────────────

function s(holdingId: string, buyDate: string, net: number): HarvestSuggestion {
  return {
    holdingId,
    holdingName: holdingId,
    kind: "harvest_loss",
    buyDate,
    unitsToSell: 1,
    unrealisedPaise: -net,
    grossTaxEffectPaise: net,
    estimatedCostsPaise: 0,
    netBenefitPaise: net,
    caveats: [],
  };
}

describe("orderSuggestions", () => {
  it("orders by net benefit desc, then holdingId, then buyDate", () => {
    const ordered = orderSuggestions([
      s("b-holding", "2024-01-01", 500),
      s("c-holding", "2023-01-01", 500),
      s("a-holding", "2025-06-01", 900),
      s("b-holding", "2023-01-01", 500),
    ]);
    assert.deepEqual(
      ordered.map((x) => `${x.holdingId}@${x.buyDate}`),
      ["a-holding@2025-06-01", "b-holding@2023-01-01", "b-holding@2024-01-01", "c-holding@2023-01-01"],
    );
  });

  it("does not mutate the input array", () => {
    const input = [s("a", "2024-01-01", 1), s("b", "2024-01-01", 9)];
    orderSuggestions(input);
    assert.equal(input[0]!.holdingId, "a");
  });
});

// ─── broughtForwardAbsorbedByBucket ───────────────────────────────────────────

/** Hand-built `CapitalPosition["setoff"]` fixture — only the fields under test vary. */
function setoff(overrides: Partial<CapitalPosition["setoff"]>): CapitalPosition["setoff"] {
  return {
    netStcgPaise: 0,
    netLtcgPaise: 0,
    residualStclPaise: 0,
    residualLtclPaise: 0,
    stclAgainstStcgPaise: 0,
    stclAgainstLtcgPaise: 0,
    ltclAgainstLtcgPaise: 0,
    ...overrides,
  };
}

describe("broughtForwardAbsorbedByBucket", () => {
  it("no brought-forward set-off ⇒ both buckets zero", () => {
    const r = broughtForwardAbsorbedByBucket(setoff({}));
    assert.deepEqual(r, { vsStcgPaise: 0, vsLtcgPaise: 0 });
  });

  it("brought-forward STCL absorbed against STCG only", () => {
    const r = broughtForwardAbsorbedByBucket(setoff({ stclAgainstStcgPaise: 500_000 }));
    assert.deepEqual(r, { vsStcgPaise: 500_000, vsLtcgPaise: 0 });
  });

  it("brought-forward STCL spilled onto LTCG counts toward the LTCG bucket", () => {
    const r = broughtForwardAbsorbedByBucket(setoff({ stclAgainstLtcgPaise: 300_000 }));
    assert.deepEqual(r, { vsStcgPaise: 0, vsLtcgPaise: 300_000 });
  });

  it("brought-forward LTCL absorbed against LTCG only", () => {
    const r = broughtForwardAbsorbedByBucket(setoff({ ltclAgainstLtcgPaise: 700_000 }));
    assert.deepEqual(r, { vsStcgPaise: 0, vsLtcgPaise: 700_000 });
  });

  it("STCL spill and LTCL both land on the LTCG bucket and sum", () => {
    const r = broughtForwardAbsorbedByBucket(
      setoff({ stclAgainstStcgPaise: 200_000, stclAgainstLtcgPaise: 100_000, ltclAgainstLtcgPaise: 400_000 }),
    );
    assert.deepEqual(r, { vsStcgPaise: 200_000, vsLtcgPaise: 500_000 });
  });
});

// ─── DB-backed plan assembler (stubbed db.query.*) ────────────────────────────

interface FixtureRow {
  id: string;
  name: string;
  folioNumber?: string | null;
  gainsTaxClass: string;
  grandfatherNavPaise?: number | null;
  isElss?: boolean;
  createdAt?: Date;
}

/**
 * `capitalLossRows` stubs the `capital_loss_carryforward` table that
 * getTaxHarvestPlan's Fix-13.12b call to getCapitalPosition() reads via a raw
 * `db.select().from(...).where(...).orderBy(...)` chain (distinct from the
 * `db.query.*` relational API used everywhere else) — defaults to none, i.e.
 * no brought-forward losses, so existing fixtures are unaffected.
 */
function makeDb(
  holdings: FixtureRow[],
  events: unknown[],
  valuations: unknown[],
  capitalLossRows: unknown[] = [],
): Db {
  return {
    query: {
      holdings: { findMany: async () => holdings },
      holdingEvents: { findMany: async () => events },
      holdingValuations: { findMany: async () => valuations },
    },
    select: () => ({
      from: () => ({
        where: () => ({
          orderBy: async () => capitalLossRows,
        }),
      }),
    }),
  } as unknown as Db;
}

const FY = "2026-27"; // 2026-04-01 … 2027-03-31
const TODAY = "2027-03-20";

describe("getTaxHarvestPlan (assembler)", () => {
  it("values NAV-priced lots in PAISE: nav ₹150 × 100 units = ₹1,500 (not ₹15)", async () => {
    // Regression pin: nav is RUPEES per unit (holdings.ts multiplies by 100).
    const db = makeDb(
      [{ id: "h1", name: "Fund A", gainsTaxClass: "equity" }],
      [{ holdingId: "h1", type: "buy", date: "2024-05-01", units: 100, amountPaise: 1_000_000 }],
      [{ holdingId: "h1", date: "2027-03-19", valuePaise: 1_500_000, nav: 150 }],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    assert.equal(plan.lots.length, 1);
    assert.equal(plan.lots[0]!.currentValuePaise, 1_500_000);
    assert.equal(plan.lots[0]!.unrealisedGainPaise, 500_000);
    assert.equal(plan.lots[0]!.isLongTerm, true);
    // Suggested gain harvest: bankable ₹5,000 @12.5% = ₹625 gross.
    const g = plan.suggestions.find((x) => x.kind === "harvest_gain");
    assert.ok(g);
    assert.equal(g!.unrealisedPaise, 500_000);
    assert.equal(g!.grossTaxEffectPaise, 62_500);
  });

  it("keeps locked ELSS lots in positions (valued) but never suggests them", async () => {
    const db = makeDb(
      [
        { id: "locked", name: "ELSS New", gainsTaxClass: "equity", isElss: true },
        { id: "free", name: "ELSS Old", gainsTaxClass: "equity", isElss: true },
      ],
      [
        { holdingId: "locked", type: "buy", date: "2026-06-01", units: 100, amountPaise: 500_000 },
        { holdingId: "free", type: "buy", date: "2022-06-01", units: 100, amountPaise: 500_000 },
      ],
      [
        { holdingId: "locked", date: "2027-03-19", valuePaise: 600_000, nav: 60 },
        { holdingId: "free", date: "2027-03-19", valuePaise: 700_000, nav: 70 },
      ],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    // BOTH lots appear as positions…
    assert.deepEqual(plan.lots.map((l) => l.holdingId).sort(), ["free", "locked"]);
    assert.equal(plan.elssLockedLotCount, 1);
    // …but only the unlocked one is actionable.
    const ids = plan.suggestions.map((x) => x.holdingId);
    assert.ok(ids.includes("free"));
    assert.ok(!ids.includes("locked"));
  });

  it("floors realised LTCG at zero: a net LTCL consumes no exemption", async () => {
    const db = makeDb(
      [{ id: "l1", name: "Losers", gainsTaxClass: "equity" }],
      [
        { holdingId: "l1", type: "buy", date: "2020-01-15", units: 100, amountPaise: 200_000 },
        { holdingId: "l1", type: "sell", date: "2026-05-10", units: 100, amountPaise: 50_000 },
      ],
      [],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    assert.equal(plan.realisedLtcgPaise, 0); // signed sum was −₹1,500
    assert.equal(plan.ltcgHeadroomPaise, LTCG_ANNUAL_EXEMPTION_PAISE);
    assert.deepEqual(plan.lots, []);
    assert.deepEqual(plan.suggestions, []);
  });

  it("offers gain harvesting ONLY on long-term equity lots", async () => {
    const db = makeDb(
      [
        { id: "shorty", name: "Still Short", gainsTaxClass: "equity" },
        { id: "qualifier", name: "LT Equity", gainsTaxClass: "equity" },
        { id: "debtish", name: "Non-equity", gainsTaxClass: "other" },
      ],
      [
        { holdingId: "shorty", type: "buy", date: "2027-01-10", units: 100, amountPaise: 100_000 },
        { holdingId: "qualifier", type: "buy", date: "2024-03-10", units: 100, amountPaise: 100_000 },
        { holdingId: "debtish", type: "buy", date: "2020-01-10", units: 100, amountPaise: 100_000 },
      ],
      [
        { holdingId: "shorty", date: "2027-03-19", valuePaise: 200_000, nav: 20 },
        { holdingId: "qualifier", date: "2027-03-19", valuePaise: 300_000, nav: 30 },
        { holdingId: "debtish", date: "2027-03-19", valuePaise: 400_000, nav: 40 },
      ],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    // All three show gains (+₹1,000 / +₹2,000 / +₹3,000); exactly one qualifies.
    assert.equal(plan.lots.length, 3);
    assert.deepEqual(plan.suggestions.map((x) => x.holdingId), ["qualifier"]);
    assert.equal(plan.suggestions[0]!.kind, "harvest_gain");
  });

  it("caps a harvested STCL at this year's realised STCG pool", async () => {
    const db = makeDb(
      [
        { id: "winner", name: "Sold High", gainsTaxClass: "equity" },
        { id: "loser", name: "Underwater", gainsTaxClass: "equity" },
      ],
      [
        // Realised ₹2,000 STCG this FY (held under 12 months).
        { holdingId: "winner", type: "buy", date: "2026-04-15", units: 100, amountPaise: 100_000 },
        { holdingId: "winner", type: "sell", date: "2026-11-01", units: 100, amountPaise: 300_000 },
        // Open lot sitting on a ₹7,000 unrealised loss.
        { holdingId: "loser", type: "buy", date: "2026-05-01", units: 100, amountPaise: 900_000 },
      ],
      [{ holdingId: "loser", date: "2027-03-19", valuePaise: 200_000, nav: 20 }],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    const losses = plan.suggestions.filter((x) => x.kind === "harvest_loss");
    assert.equal(losses.length, 1);
    const loss = losses[0]!;
    // Only the ₹2,000 that can actually be offset is suggested, not the full ₹7,000.
    assert.equal(loss.unrealisedPaise, -200_000);
    assert.equal(loss.grossTaxEffectPaise, 40_000); // ₹2,000 @ 20%
    // Proceeds scale with the units: ₹2,000 of ₹7,000 → 2/7 × ₹2,000 = ₹571.
    assert.equal(loss.unitsToSell > 0 && loss.unitsToSell < 100, true);
    const expectedCosts =
      Math.round(200_000 * (2 / 7)) * ((HARVEST_TXN_COST_BPS + 100) / 10_000);
    assert.ok(Math.abs(loss.netBenefitPaise - (40_000 - expectedCosts)) <= 1);
  });

  it("spills an STCL onto TAXABLE LTCG only — exempt-band LTCG is worthless to offset", async () => {
    const db = makeDb(
      [
        { id: "ltsale", name: "LT Sale", gainsTaxClass: "equity" },
        { id: "stclot", name: "Big Loss", gainsTaxClass: "equity" },
      ],
      [
        // Realised ₹1.4L LONG-term gain this FY: ₹1.25L is exempt, so only
        // ₹1,500 of it is actually taxed at 12.5%.
        { holdingId: "ltsale", type: "buy", date: "2024-05-01", units: 100, amountPaise: 100_000 },
        { holdingId: "ltsale", type: "sell", date: "2026-12-01", units: 100, amountPaise: 14_000_000 },
        // Open ₹5,000 short-term loss — the spill can absorb only the taxable slice.
        { holdingId: "stclot", type: "buy", date: "2026-05-01", units: 100, amountPaise: 800_000 },
      ],
      [{ holdingId: "stclot", date: "2027-03-19", valuePaise: 300_000, nav: 30 }],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    const loss = plan.suggestions.find((x) => x.kind === "harvest_loss");
    assert.ok(loss);
    assert.equal(loss!.unrealisedPaise, -500_000); // ₹5,000 loss < ₹14,000 taxable LTCG
    // Spill lands on TAXABLE long-term gains → 12.5%, NOT 20% (would be 100_000).
    assert.equal(loss!.grossTaxEffectPaise, 62_500);
  });

  it("suggests NO loss harvest when realised gains sit entirely inside the exemption", async () => {
    const db = makeDb(
      [
        { id: "ltsale", name: "LT Sale", gainsTaxClass: "equity" },
        { id: "stclot", name: "Big Loss", gainsTaxClass: "equity" },
      ],
      [
        // Realised ₹1,000 long-term gain — deep inside the ₹1.25L exemption.
        { holdingId: "ltsale", type: "buy", date: "2024-05-01", units: 100, amountPaise: 100_000 },
        { holdingId: "ltsale", type: "sell", date: "2026-12-01", units: 100, amountPaise: 200_000 },
        // A ₹5,000 short-term loss would offset that gain but save no tax.
        { holdingId: "stclot", type: "buy", date: "2026-05-01", units: 100, amountPaise: 800_000 },
      ],
      [{ holdingId: "stclot", date: "2027-03-19", valuePaise: 300_000, nav: 30 }],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);
    assert.deepEqual(
      plan.suggestions.filter((x) => x.kind === "harvest_loss"),
      [],
    );
  });

  // ── Fix 13.12b: brought-forward capital losses (Sec 74) are folded in ──────
  it("a brought-forward LTCL lowers realisedLtcgPaise/headroom and shrinks the loss-harvest pool", async () => {
    const holdingRows: FixtureRow[] = [
      { id: "gainer", name: "Realised Gain", gainsTaxClass: "equity" },
      { id: "loser", name: "Underwater Long-Term", gainsTaxClass: "equity" },
    ];
    const eventRows = [
      // Realised ₹1.6L long-term gain this FY — ₹35,000 of it is taxable
      // (above the ₹1.25L exemption) before any brought-forward loss.
      { holdingId: "gainer", type: "buy", date: "2024-05-01", units: 100, amountPaise: 1_000_000 },
      { holdingId: "gainer", type: "sell", date: "2026-12-01", units: 100, amountPaise: 17_000_000 },
      // Open long-term ₹6,000 unrealised loss.
      { holdingId: "loser", type: "buy", date: "2020-01-10", units: 100, amountPaise: 900_000 },
    ];
    const valuationRows = [{ holdingId: "loser", date: "2027-03-19", valuePaise: 300_000, nav: 30 }];
    // A prior-FY, return-filed, unexpired ₹50,000 LTCL — eligible for set-off.
    const bfLtcl = [
      {
        id: "bf1",
        userId: "u1",
        originFy: "2020-21",
        lossKind: "LTCL",
        originalPaise: 5_000_000,
        remainingPaise: 5_000_000,
        expiresFy: "2028-29",
        returnFiled: true,
        note: null,
        createdAt: new Date("2021-01-01"),
        updatedAt: new Date("2021-01-01"),
      },
    ];

    const baseline = await getTaxHarvestPlan(
      makeDb(holdingRows, eventRows, valuationRows, []),
      "u1",
      FY,
      TODAY,
    );
    // No brought-forward loss: realisedLtcgPaise is this FY's realised LTCG
    // as-is, fully outside the exemption, and the ₹6,000 loss is fully
    // suggested against the ₹35,000 taxable pool.
    assert.equal(baseline.realisedLtcgPaise, 16_000_000);
    assert.equal(baseline.ltcgHeadroomPaise, 0);
    const baselineLoss = baseline.suggestions.find((x) => x.kind === "harvest_loss");
    assert.ok(baselineLoss);
    assert.equal(baselineLoss!.unrealisedPaise, -600_000);

    const withBf = await getTaxHarvestPlan(
      makeDb(holdingRows, eventRows, valuationRows, bfLtcl),
      "u1",
      FY,
      TODAY,
    );
    // Brought-forward LTCL (₹50,000) absorbs against this FY's LTCG on top of
    // the current-year set-off: realisedLtcgPaise drops to ₹1,10,000, which is
    // now INSIDE the ₹1.25L exemption, freeing ₹15,000 of headroom that the
    // pre-fix code (blind to brought-forward losses) would have reported as 0.
    assert.equal(withBf.realisedLtcgPaise, 11_000_000);
    assert.equal(withBf.ltcgHeadroomPaise, 1_500_000);
    // The brought-forward loss already consumed the entire local taxable-LTCG
    // pool (₹35,000 pool < ₹50,000 absorbed), so the harvested loss has
    // nothing left to offset and must NOT be suggested — never double-count
    // the same gain capacity across brought-forward and harvest-suggested losses.
    assert.deepEqual(
      withBf.suggestions.filter((x) => x.kind === "harvest_loss"),
      [],
    );
  });

  // ── Fix 13.12c: non-equity LTCG must not consume §112A equity headroom ───────
  it("non-equity LTCG does not consume §112A equity exemption headroom (equity-only §112A basis)", async () => {
    // Concrete failure from the second review: a user with ₹2L of purely
    // non-equity LTCG and zero equity LTCG was getting ltcgHeadroomPaise = 0
    // because the old code used capitalPosition.setoff.netLtcgPaise (combined
    // equity+non-equity, post brought-forward absorption) directly as the §112A
    // basis. The §112A exemption applies only to equity LTCG — non-equity LTCG
    // must never consume it.
    const holdingRows: FixtureRow[] = [
      // Non-equity ("other") holding sold this FY for a ₹2L long-term gain.
      // Buy "2024-03-01" → sold "2026-10-01": 31 months held, post-2024 reform
      // threshold is 24 months for non-equity → long-term ✓
      { id: "debt", name: "Debt Fund", gainsTaxClass: "other" },
    ];
    const eventRows = [
      { holdingId: "debt", type: "buy", date: "2024-03-01", units: 100, amountPaise: 1_000_000 },
      { holdingId: "debt", type: "sell", date: "2026-10-01", units: 100, amountPaise: 21_000_000 },
    ];
    // ₹50,000 brought-forward LTCL. Under the OLD (buggy) code:
    //   netLtcgPaise = 20L − 5L = 15L > 12.5L → ltcgHeadroomPaise = 0 (WRONG)
    // Under the NEW code: equity LTCG = 0 regardless of the non-equity gain,
    //   so realisedLtcgPaise = 0 → ltcgHeadroomPaise = full ₹1.25L (CORRECT)
    const bfLtcl = [
      {
        id: "bf-ne",
        userId: "u1",
        originFy: "2021-22",
        lossKind: "LTCL",
        originalPaise: 5_000_000,
        remainingPaise: 5_000_000,
        expiresFy: "2029-30",
        returnFiled: true,
        note: null,
        createdAt: new Date("2022-01-01"),
        updatedAt: new Date("2022-01-01"),
      },
    ];

    const plan = await getTaxHarvestPlan(
      makeDb(holdingRows, eventRows, [], bfLtcl),
      "u1",
      FY,
      TODAY,
    );
    // Non-equity LTCG never consumes the §112A exemption: realisedLtcgPaise
    // must reflect EQUITY-ONLY gains, which are zero here.
    assert.equal(plan.realisedLtcgPaise, 0);
    // The full ₹1.25L exemption must remain available.
    assert.equal(plan.ltcgHeadroomPaise, LTCG_ANNUAL_EXEMPTION_PAISE);
  });

  // ── Pool-capacity leak: a REJECTED loss candidate must not drain the pools ───
  it("a loss candidate rejected at the final net-benefit check leaves the STCG pool intact for a later profitable one", async () => {
    // Realised STCG this FY is exactly ₹100 (10_000 p), so the whole plan turns
    // on who gets that single pool. Two short-term-loss lots compete for it;
    // both clear the CHEAP pre-filter, but only the second clears the final
    // (scaled) net-benefit check:
    //
    //   A "aaa-…" — |loss| 100_000 p, redemption value 1_666_500 p, held < 365d
    //     pre-filter : round(100_000×2000/10_000)=20_000 > round(1_666_500×120/10_000)=19_998 ✓
    //     allocation : vsStcg = min(100_000, 10_000) = 10_000 → scale 0.1
    //     final      : gross round(10_000×2000/10_000)=2_000
    //                  proceeds round(1_666_500×0.1)=166_650
    //                  costs round(166_650×120/10_000)=round(1999.8)=2_000
    //                  net = 2_000 − 2_000 = 0 → REJECTED (netBenefitPaise <= 0)
    //
    //   B "bbb-…" — |loss| 5_000 p, redemption value 80_000 p, held < 365d
    //     pre-filter : 1_000 > round(80_000×120/10_000)=960 ✓
    //     allocation : vsStcg = min(5_000, 10_000) = 5_000 → scale 1
    //     final      : gross 1_000 − costs 960 = net 40 → ACCEPTED
    //
    // pendingLosses sorts rateBps desc (both 2000 — short-term), then holdingId
    // asc, so A is considered FIRST. The OLD code decremented stcgPool BEFORE
    // the final check, so A's rejection still drained the pool to 0; B then saw
    // vsStcg = 0 → usable = 0 → `continue`, and the plan came back with an EMPTY
    // suggestion list. The fix defers the decrement until after acceptance.
    const db = makeDb(
      [
        { id: "winner", name: "Sold High", gainsTaxClass: "equity" },
        { id: "aaa-cost-dominated", name: "Cost Dominated", gainsTaxClass: "equity" },
        { id: "bbb-small-profitable", name: "Small But Worth It", gainsTaxClass: "equity" },
      ],
      [
        // Realised ₹100 STCG this FY → stcgPool = 10_000 p, taxableLtcgPool = 0.
        { holdingId: "winner", type: "buy", date: "2026-04-15", units: 100, amountPaise: 100_000 },
        { holdingId: "winner", type: "sell", date: "2026-11-01", units: 100, amountPaise: 110_000 },
        // A: cost 1_766_500 − value 1_666_500 = −100_000 unrealised.
        {
          holdingId: "aaa-cost-dominated",
          type: "buy",
          date: "2026-05-01",
          units: 1,
          amountPaise: 1_766_500,
        },
        // B: cost 85_000 − value 80_000 = −5_000 unrealised.
        {
          holdingId: "bbb-small-profitable",
          type: "buy",
          date: "2026-06-01",
          units: 1,
          amountPaise: 85_000,
        },
      ],
      [
        // nav is RUPEES per unit → ×units×100 paise (units = 1 here).
        { holdingId: "aaa-cost-dominated", date: "2027-03-19", valuePaise: 1_666_500, nav: 16_665 },
        { holdingId: "bbb-small-profitable", date: "2027-03-19", valuePaise: 80_000, nav: 800 },
      ],
    );
    const plan = await getTaxHarvestPlan(db, "u1", FY, TODAY);

    // Fixture sanity: both loss lots are present, short-term, and priced as computed.
    const byId = new Map(plan.lots.map((l) => [l.holdingId, l]));
    assert.equal(plan.lots.length, 2); // "winner" is fully sold — no open lot
    assert.equal(byId.get("aaa-cost-dominated")!.unrealisedGainPaise, -100_000);
    assert.equal(byId.get("aaa-cost-dominated")!.currentValuePaise, 1_666_500);
    assert.equal(byId.get("aaa-cost-dominated")!.isLongTerm, false);
    assert.equal(byId.get("bbb-small-profitable")!.unrealisedGainPaise, -5_000);
    assert.equal(byId.get("bbb-small-profitable")!.currentValuePaise, 80_000);
    assert.equal(byId.get("bbb-small-profitable")!.isLongTerm, false);

    // The payload: B survives A's rejection. Under the old code this array was [].
    assert.equal(plan.suggestions.length, 1);
    const only = plan.suggestions[0]!;
    assert.equal(only.holdingId, "bbb-small-profitable");
    assert.equal(only.kind, "harvest_loss");
    assert.equal(only.unrealisedPaise, -5_000);
    assert.equal(only.grossTaxEffectPaise, 1_000); // ₹50 @ 20%
    assert.equal(only.estimatedCostsPaise, 960); // 80_000 × 120bps
    assert.equal(only.netBenefitPaise, 40);
    // …and the cost-dominated candidate is still (correctly) not suggested.
    assert.ok(!plan.suggestions.some((x) => x.holdingId === "aaa-cost-dominated"));
  });
});
