import { test } from "node:test";
import assert from "node:assert/strict";
import {
  daysBetween,
  defaultTaxClass,
  isLongTerm,
  longTermMonths,
  realizeGains,
} from "./tax-lots.ts";

const buy = (date: string, units: number, amountPaise: number) => ({ type: "buy", date, units, amountPaise });
const sell = (date: string, units: number, amountPaise: number) => ({ type: "sell", date, units, amountPaise });
const equity = { taxClass: "equity" as const, grandfatherNavPaise: null };

test("FIFO matches the oldest lot first, leaving the newer lot open", () => {
  // Two buys (older ₹100/u, newer ₹120/u), then sell exactly the first lot's
  // 100 units @ ₹150/u. FIFO must price against the ₹100 lot, not the ₹120 one.
  const g = realizeGains(
    [
      buy("2024-01-01", 100, 1_000_000), // ₹100/u
      buy("2024-06-01", 100, 1_200_000), // ₹120/u
      sell("2025-03-01", 100, 1_500_000), // ₹150/u, 15L proceeds
    ],
    equity,
  );
  assert.equal(g.slices.length, 1);
  assert.equal(g.slices[0]!.buyDate, "2024-01-01");
  assert.equal(g.slices[0]!.units, 100);
  assert.equal(g.slices[0]!.proceedsPaise, 1_500_000);
  assert.equal(g.slices[0]!.costPaise, 1_000_000);
  assert.equal(g.slices[0]!.gainPaise, 500_000);
});

test("a sell spanning two lots splits into two slices", () => {
  const g = realizeGains(
    [
      buy("2024-01-01", 60, 600_000), // ₹100/u
      buy("2024-06-01", 60, 900_000), // ₹150/u
      sell("2025-07-01", 100, 2_000_000), // ₹200/u
    ],
    equity,
  );
  assert.equal(g.slices.length, 2);
  assert.equal(g.slices[0]!.units, 60); // all of lot A
  assert.equal(g.slices[1]!.units, 40); // 40 of lot B
  assert.equal(g.slices[0]!.gainPaise, 1_200_000 - 600_000); // 60×200 − 600k
  assert.equal(g.slices[1]!.gainPaise, 800_000 - 600_000); // 40×200 − 40×150
  assert.equal(g.totalProceedsPaise, 2_000_000);
});

test("short vs long term flips at the 12-month boundary for equity", () => {
  // Bought 15-Jan-2024. Sale on 15-Jan-2025 is exactly 12 months ⇒ short.
  const short = realizeGains([buy("2024-01-15", 10, 100_000), sell("2025-01-15", 10, 150_000)], equity);
  assert.equal(short.slices[0]!.term, "short");
  assert.equal(short.shortTermGainPaise, 50_000);
  assert.equal(short.longTermGainPaise, 0);
  // One day later ⇒ long.
  const long = realizeGains([buy("2024-01-15", 10, 100_000), sell("2025-01-16", 10, 150_000)], equity);
  assert.equal(long.slices[0]!.term, "long");
  assert.equal(long.longTermGainPaise, 50_000);
  assert.equal(long.shortTermGainPaise, 0);
});

test("'other' assets sold before the 2024 reform use a 36-month boundary", () => {
  const cfg = { taxClass: "other" as const, grandfatherNavPaise: null };
  // Sold 15-Jun-2024 (pre-reform): 30 months held ⇒ short, 48 months ⇒ long.
  const twoYears = realizeGains([buy("2022-01-15", 10, 100_000), sell("2024-06-15", 10, 150_000)], cfg);
  assert.equal(twoYears.slices[0]!.term, "short");
  const fourYears = realizeGains([buy("2020-01-15", 10, 100_000), sell("2024-06-15", 10, 150_000)], cfg);
  assert.equal(fourYears.slices[0]!.term, "long");
});

test("'other' assets sold on/after 2024-07-23 use the reduced 24-month boundary", () => {
  const cfg = { taxClass: "other" as const, grandfatherNavPaise: null };
  // 26 months held: short under the old 36m rule, long under the new 24m rule.
  const preReform = realizeGains([buy("2022-05-15", 10, 100_000), sell("2024-07-22", 10, 150_000)], cfg);
  assert.equal(preReform.slices[0]!.term, "short");
  const postReform = realizeGains([buy("2022-05-15", 10, 100_000), sell("2024-07-23", 10, 150_000)], cfg);
  assert.equal(postReform.slices[0]!.term, "long");
});

test("unlisted shares use a 24-month line, unchanged by the 2024 reform", () => {
  const cfg = { taxClass: "unlisted_shares" as const, grandfatherNavPaise: null };
  // Sold pre-reform: 20 months held ⇒ short, 32 months ⇒ long — both at 24m.
  const short = realizeGains([buy("2022-01-01", 10, 100_000), sell("2023-09-01", 10, 150_000)], cfg);
  assert.equal(short.slices[0]!.term, "short");
  const long = realizeGains([buy("2021-01-01", 10, 100_000), sell("2023-09-01", 10, 150_000)], cfg);
  assert.equal(long.slices[0]!.term, "long");
});

test("§50AA is per lot: only on/after-1-Apr-2023 units of a specified fund are deemed short", () => {
  const cfg = { taxClass: "specified_fund" as const, grandfatherNavPaise: null };
  const g = realizeGains(
    [
      buy("2022-06-01", 100, 1_000_000), // pre-§50AA: ordinary non-equity rules
      buy("2023-06-01", 100, 1_200_000), // §50AA: deemed short whatever the period
      sell("2025-08-01", 200, 3_000_000), // ₹150/u, post-reform ⇒ 24m for the old lot
    ],
    cfg,
  );
  assert.equal(g.slices.length, 2);
  // Old lot: held ~38 months > 24 ⇒ long.
  assert.equal(g.slices[0]!.buyDate, "2022-06-01");
  assert.equal(g.slices[0]!.term, "long");
  assert.equal(g.slices[0]!.gainPaise, 500_000);
  // New lot: §50AA ⇒ short regardless of the ~26 months held.
  assert.equal(g.slices[1]!.buyDate, "2023-06-01");
  assert.equal(g.slices[1]!.term, "short");
  assert.equal(g.slices[1]!.gainPaise, 300_000);
  assert.equal(g.longTermGainPaise, 500_000);
  assert.equal(g.shortTermGainPaise, 300_000);
});

test("grandfathering lifts cost to the 31-Jan-2018 FMV for old equity lots", () => {
  // Bought 2015 @ ₹50/u; FMV on 31-Jan-2018 = ₹120/u; sold 2024 @ ₹200/u.
  // Grandfathered cost = max(50, min(120, 200)) = ₹120/u. Gain = (200−120)×100.
  const g = realizeGains([buy("2015-05-01", 100, 500_000), sell("2024-05-01", 100, 2_000_000)], {
    taxClass: "equity",
    grandfatherNavPaise: 12_000,
  });
  const s = g.slices[0]!;
  assert.equal(s.grandfathered, true);
  assert.equal(s.actualCostPaise, 500_000);
  assert.equal(s.costPaise, 1_200_000);
  assert.equal(s.gainPaise, 800_000);
  assert.equal(s.term, "long");
});

test("grandfathering caps the uplift at the sale value (no artificial loss)", () => {
  // Same old lot but sold below the 2018 FMV: cost = max(50, min(120, 80)) = ₹80/u
  // = the sale price ⇒ zero gain, never a fabricated loss.
  const g = realizeGains([buy("2015-05-01", 100, 500_000), sell("2024-05-01", 100, 800_000)], {
    taxClass: "equity",
    grandfatherNavPaise: 12_000,
  });
  const s = g.slices[0]!;
  assert.equal(s.costPaise, 800_000);
  assert.equal(s.gainPaise, 0);
});

test("grandfathering leaves post-cutoff lots untouched", () => {
  const g = realizeGains([buy("2018-02-01", 100, 500_000), sell("2024-05-01", 100, 2_000_000)], {
    taxClass: "equity",
    grandfatherNavPaise: 12_000,
  });
  assert.equal(g.slices[0]!.grandfathered, false);
  assert.equal(g.slices[0]!.costPaise, 500_000);
});

test("grandfathering is ignored for non-equity classes even with an old lot and FMV", () => {
  // A pre-2018 lot with a supplied FMV but taxed as 'other' must NOT be stepped up.
  const g = realizeGains([buy("2015-05-01", 100, 500_000), sell("2024-05-01", 100, 2_000_000)], {
    taxClass: "other",
    grandfatherNavPaise: 12_000,
  });
  assert.equal(g.slices[0]!.grandfathered, false);
  assert.equal(g.slices[0]!.costPaise, 500_000);
});

test("slice proceeds reconcile to the sale amount when a sale spans lots", () => {
  // Two 1-unit lots, sold together for 1001 paise ⇒ 500.5 paise/unit. Independent
  // rounding would bill 501 + 501 = 1002; cumulative rounding must total 1001,
  // with the remainder on the last slice.
  const g = realizeGains(
    [buy("2024-01-01", 1, 100), buy("2024-01-02", 1, 100), sell("2025-06-01", 2, 1001)],
    equity,
  );
  assert.equal(g.slices.length, 2);
  const sum = g.slices.reduce((s, x) => s + x.proceedsPaise, 0);
  assert.equal(sum, 1001);
  assert.equal(g.totalProceedsPaise, 1001);
});

test("a lot's slices sum to its exact acquisition cost across partial sales", () => {
  // Buy 3 units for 1000 paise (333.33/u). Sell 1, then the remaining 2. The
  // two slices' cost must total exactly 1000, not 333 + 667-ish drift.
  const g = realizeGains(
    [buy("2024-01-01", 3, 1000), sell("2025-06-01", 1, 500), sell("2025-07-01", 2, 1200)],
    equity,
  );
  const cost = g.slices.reduce((s, x) => s + x.actualCostPaise, 0);
  assert.equal(cost, 1000);
});

test("overselling realizes only what was held and drops the excess", () => {
  const g = realizeGains([buy("2024-01-01", 100, 1_000_000), sell("2024-06-01", 150, 1_800_000)], equity);
  // Only 100 units exist; proceeds for those 100 = 100 × (18L/150) = ₹12L.
  assert.equal(g.slices.length, 1);
  assert.equal(g.slices[0]!.units, 100);
  assert.equal(g.slices[0]!.proceedsPaise, 1_200_000);
  assert.equal(g.slices[0]!.gainPaise, 200_000);
});

test("same-date buys keep a stable FIFO order via createdAt/id, not input order", () => {
  // Two ₹-different buys on one day; the cheaper was created first. A later
  // partial sale must consume the earlier-created (cheaper) lot first, whatever
  // order the rows arrive in — otherwise Postgres's tie order could swap them.
  const cheap = { type: "buy", date: "2024-01-01", units: 100, amountPaise: 1_000_000, createdAt: new Date("2024-01-01T10:00:00Z"), id: "a" };
  const dear = { type: "buy", date: "2024-01-01", units: 100, amountPaise: 1_500_000, createdAt: new Date("2024-01-01T11:00:00Z"), id: "b" };
  const s = { type: "sell", date: "2025-06-01", units: 100, amountPaise: 2_000_000, createdAt: new Date("2025-06-01T10:00:00Z"), id: "c" };
  const forward = realizeGains([cheap, dear, s], equity);
  const reversed = realizeGains([dear, cheap, s], equity);
  assert.equal(forward.slices.length, 1);
  assert.equal(forward.slices[0]!.costPaise, 1_000_000); // cheaper lot consumed first
  assert.equal(forward.slices[0]!.gainPaise, 1_000_000);
  assert.deepEqual(reversed.slices, forward.slices); // independent of input order
});

test("persisted source order (seq) outranks createdAt, fixing re-import ordering", () => {
  // The cheaper lot P1 is source-order 0 but was imported LATER (newer createdAt);
  // P2 is source-order 1, imported earlier. FIFO must consume P1 first — seq, the
  // reconciled statement order, has to beat ingestion time.
  const p1 = { type: "buy", date: "2024-01-01", units: 100, amountPaise: 1_000_000, seq: 0, createdAt: new Date("2024-06-02T00:00:00Z"), id: "p1" };
  const p2 = { type: "buy", date: "2024-01-01", units: 100, amountPaise: 1_500_000, seq: 1, createdAt: new Date("2024-06-01T00:00:00Z"), id: "p2" };
  const s = { type: "sell", date: "2025-01-01", units: 100, amountPaise: 2_000_000, seq: 9, createdAt: new Date("2025-01-02T00:00:00Z"), id: "s" };
  const g = realizeGains([p2, p1, s], equity);
  assert.equal(g.slices.length, 1);
  assert.equal(g.slices[0]!.costPaise, 1_000_000); // cheaper P1 consumed first
  assert.equal(g.slices[0]!.gainPaise, 1_000_000);
});

test("events are read in date order regardless of input order", () => {
  const g = realizeGains([sell("2025-03-01", 100, 1_500_000), buy("2024-01-01", 100, 1_000_000)], equity);
  assert.equal(g.slices.length, 1);
  assert.equal(g.slices[0]!.gainPaise, 500_000);
});

test("dividends are ignored — they are income, not capital gains", () => {
  const g = realizeGains(
    [
      buy("2024-01-01", 100, 1_000_000),
      { type: "dividend", date: "2024-03-01", units: null, amountPaise: 5_000 },
      sell("2025-06-01", 100, 1_500_000),
    ],
    equity,
  );
  assert.equal(g.slices.length, 1);
  assert.equal(g.totalGainPaise, 500_000);
});

test("a still-fully-held holding realizes nothing", () => {
  const g = realizeGains([buy("2024-01-01", 100, 1_000_000)], equity);
  assert.deepEqual(g.slices, []);
  assert.equal(g.totalGainPaise, 0);
});

test("isLongTerm clamps month-end days", () => {
  // 31-Jan + 1 month ⇒ 28-Feb threshold (2025 not leap). Sale 28-Feb not long.
  assert.equal(isLongTerm("2025-01-31", "2025-02-28", 1), false);
  assert.equal(isLongTerm("2025-01-31", "2025-03-01", 1), true);
});

test("daysBetween counts whole calendar days across a leap year", () => {
  assert.equal(daysBetween("2024-01-01", "2024-01-02"), 1);
  assert.equal(daysBetween("2024-02-28", "2024-03-01"), 2); // 2024 is a leap year
});

test("longTermMonths reflects class, lot date, and sale date", () => {
  assert.equal(longTermMonths("equity", "2020-01-01", "2025-01-01"), 12);
  assert.equal(longTermMonths("unlisted_shares", "2020-01-01", "2025-01-01"), 24);
  // 'other' turns on the sale date (36 before the 2024 reform, 24 on/after).
  assert.equal(longTermMonths("other", "2020-01-01", "2024-07-22"), 36);
  assert.equal(longTermMonths("other", "2020-01-01", "2024-07-23"), 24);
  // Specified fund keys on the acquisition date: on/after 1-Apr-2023 ⇒ deemed
  // short (null); earlier lots fall back to ordinary non-equity thresholds.
  assert.equal(longTermMonths("specified_fund", "2023-04-01", "2025-01-01"), null);
  assert.equal(longTermMonths("specified_fund", "2023-03-31", "2024-07-22"), 36);
  assert.equal(longTermMonths("specified_fund", "2023-03-31", "2024-07-23"), 24);
  // MLDs: §50AA always ⇒ never long-term, whatever the dates.
  assert.equal(longTermMonths("market_linked_debenture", "2010-01-01", "2025-01-01"), null);
  // Unlisted bonds: key on the *sale* date — §50AA (null) from the 2024 reform,
  // ordinary 36-month treatment before it, regardless of acquisition date.
  assert.equal(longTermMonths("unlisted_bond", "2015-01-01", "2024-07-22"), 36);
  assert.equal(longTermMonths("unlisted_bond", "2015-01-01", "2024-07-23"), null);
});

test("MLDs are always short-term even when held for many years", () => {
  const cfg = { taxClass: "market_linked_debenture" as const, grandfatherNavPaise: null };
  const g = realizeGains([buy("2012-01-01", 100, 1_000_000), sell("2024-01-01", 100, 1_800_000)], cfg);
  assert.equal(g.slices[0]!.term, "short");
  assert.equal(g.shortTermGainPaise, 800_000);
  assert.equal(g.longTermGainPaise, 0);
});

test("unlisted bonds flip to §50AA short-term by sale date, not acquisition", () => {
  const cfg = { taxClass: "unlisted_bond" as const, grandfatherNavPaise: null };
  // Same old lot (held ~9 years): long-term if sold just before the reform...
  const before = realizeGains([buy("2015-01-01", 100, 1_000_000), sell("2024-07-22", 100, 1_800_000)], cfg);
  assert.equal(before.slices[0]!.term, "long");
  // ...but §50AA short-term if sold on/after 23-Jul-2024.
  const after = realizeGains([buy("2015-01-01", 100, 1_000_000), sell("2024-07-23", 100, 1_800_000)], cfg);
  assert.equal(after.slices[0]!.term, "short");
});

test("defaultTaxClass guesses equity for equity-ish classes, else other", () => {
  assert.equal(defaultTaxClass("stock"), "equity");
  assert.equal(defaultTaxClass("mutual_fund"), "equity");
  assert.equal(defaultTaxClass("etf"), "equity");
  assert.equal(defaultTaxClass("gold"), "other");
  assert.equal(defaultTaxClass("fd"), "other");
  assert.equal(defaultTaxClass("other"), "other");
});

// ---------- exempt treatment ----------

const exempt = { taxClass: "exempt" as const, grandfatherNavPaise: null };

test("an exempt disposal is realized but never taxable", () => {
  // An SGB redeemed at maturity: 8 years held, a real ₹5L gain, zero tax.
  const g = realizeGains(
    [buy("2017-08-05", 100, 1_000_000), sell("2025-08-05", 100, 1_500_000)],
    exempt,
  );
  assert.equal(g.exemptGainPaise, 500_000);
  assert.equal(g.shortTermGainPaise, 0);
  assert.equal(g.longTermGainPaise, 0);
  // The taxable total must exclude it — this is the whole point of the class.
  assert.equal(g.totalGainPaise, 0);
});

test("an exempt disposal still reports proceeds, cost and the slice", () => {
  // Hiding the disposal entirely would be a worse reporting bug than showing
  // zero tax: the money did move and belongs in the statement.
  const g = realizeGains(
    [buy("2017-08-05", 100, 1_000_000), sell("2025-08-05", 100, 1_500_000)],
    exempt,
  );
  assert.equal(g.totalProceedsPaise, 1_500_000);
  assert.equal(g.totalCostPaise, 1_000_000);
  assert.equal(g.slices.length, 1);
  assert.equal(g.slices[0]!.term, "exempt");
  assert.equal(g.slices[0]!.gainPaise, 500_000);
});

test("exempt overrides the holding period, long or short", () => {
  // Held 8 years (would be long) and held 3 months (would be short) — both are
  // exempt. A period-based fallback here would tax a tax-free redemption.
  const long = realizeGains(
    [buy("2017-08-05", 10, 100_000), sell("2025-08-05", 10, 150_000)],
    exempt,
  );
  const short = realizeGains(
    [buy("2025-01-05", 10, 100_000), sell("2025-04-05", 10, 150_000)],
    exempt,
  );
  assert.equal(long.slices[0]!.term, "exempt");
  assert.equal(short.slices[0]!.term, "exempt");
  assert.equal(long.shortTermGainPaise + short.shortTermGainPaise, 0);
  assert.equal(long.longTermGainPaise + short.longTermGainPaise, 0);
});

test("an exempt loss is not smuggled into a taxable set-off", () => {
  // Exempt cuts both ways: a loss on an exempt asset can't offset taxable gain.
  const g = realizeGains(
    [buy("2020-01-01", 100, 1_500_000), sell("2025-01-01", 100, 1_000_000)],
    exempt,
  );
  assert.equal(g.exemptGainPaise, -500_000);
  assert.equal(g.totalGainPaise, 0);
});

test("exempt is never guessed from an asset class", () => {
  // Only the user knows an SGB was redeemed at maturity rather than sold on the
  // exchange, so no asset class may default to it.
  for (const c of ["gold", "silver", "stock", "mutual_fund", "etf", "fd", "real_estate", "other"]) {
    assert.notEqual(defaultTaxClass(c), "exempt");
  }
});
