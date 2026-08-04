import { test } from "node:test";
import assert from "node:assert/strict";
import {
  ambShortfallPaise,
  ambStatus,
  ambWindow,
  averageBalancePaise,
  buildAverageBalance,
  sumDailyClosingPaise,
} from "./average-balance.ts";
import type { AmbInputs } from "./average-balance.ts";

// ---------- published worked examples (external ground truth) ----------

test("BankBazaar January worked example: three balance tiers over 31 days", () => {
  // https://www.bankbazaar.com (AMB explainer): ₹15,000 Jan 1–4, ₹5,000 Jan
  // 5–19, ₹15,000 Jan 20–31. Reproduced via deltas (not hand-summed) so the
  // day-walk itself is what's under test.
  const window = { from: "2026-01-01", to: "2026-01-31", days: 31, daysInMonth: 31, partialHistory: false };
  const deltas = new Map<string, number>([
    ["2026-01-05", -1_000_000], // 15,000 -> 5,000
    ["2026-01-20", 1_000_000], // 5,000 -> 15,000
  ]);
  const sum = sumDailyClosingPaise(1_500_000, deltas, window);
  assert.equal(sum, 31_500_000);
  assert.equal(averageBalancePaise(sum, window.days), 1_016_129);
});

test("Aditya Birla 30-day worked example: three equal 10-day tiers", () => {
  // ₹1,000 for 10 days, ₹500 for 10 days, ₹1,500 for 10 days over a 30-day month.
  const window = { from: "2026-04-01", to: "2026-04-30", days: 30, daysInMonth: 30, partialHistory: false };
  const deltas = new Map<string, number>([
    ["2026-04-11", -50_000], // 1,000 -> 500
    ["2026-04-21", 100_000], // 500 -> 1,500
  ]);
  const sum = sumDailyClosingPaise(100_000, deltas, window);
  assert.equal(sum, 3_000_000);
  assert.equal(averageBalancePaise(sum, window.days), 100_000);
});

// ---------- sumDailyClosingPaise ----------

test("a day with no transaction carries the previous closing balance forward", () => {
  const window = { from: "2026-05-01", to: "2026-05-03", days: 3, daysInMonth: 31, partialHistory: false };
  // no deltas at all — every day should just repeat the carried-in balance.
  const sum = sumDailyClosingPaise(10_000, new Map(), window);
  assert.equal(sum, 30_000);
});

// ---------- ambWindow ----------

test("ambWindow clips 'from' to first activity within the current month", () => {
  const w = ambWindow("2026-07-26", "2026-07-16");
  assert.deepEqual(w, {
    from: "2026-07-16",
    to: "2026-07-26",
    days: 11,
    daysInMonth: 31,
    partialHistory: true,
  });
});

test("ambWindow clips 'from' to the 1st when history predates the month", () => {
  const w = ambWindow("2026-07-26", "2026-03-02");
  assert.deepEqual(w, {
    from: "2026-07-01",
    to: "2026-07-26",
    days: 26,
    daysInMonth: 31,
    partialHistory: false,
  });
});

test("ambWindow returns null for an account with no activity at all", () => {
  assert.equal(ambWindow("2026-07-26", null), null);
});

test("ambWindow returns null when the only activity is dated after today", () => {
  // Future-dated transactions must never move the average (same rule as balances.ts).
  assert.equal(ambWindow("2026-07-26", "2026-07-27"), null);
});

test("ambWindow reports the correct days in a leap vs non-leap February", () => {
  assert.equal(ambWindow("2024-02-29", "2024-02-01")?.daysInMonth, 29);
  assert.equal(ambWindow("2026-02-28", "2026-02-01")?.daysInMonth, 28);
});

// ---------- real-data pin ----------

test("real-data pin: matches a brute-force day-by-day SQL expansion verified against production", () => {
  const window = { from: "2026-07-16", to: "2026-07-26", days: 11, daysInMonth: 31, partialHistory: true };
  const deltas = new Map<string, number>([
    ["2026-07-16", 3_577_404],
    ["2026-07-24", -35_000],
    ["2026-07-25", -18_500],
    ["2026-07-26", -8_000],
  ]);
  const sum = sumDailyClosingPaise(0, deltas, window);
  assert.equal(sum, 39_201_444);
  assert.equal(averageBalancePaise(sum, window.days), 3_563_768);
});

// ---------- ambStatus / ambShortfallPaise ----------

test("ambStatus is 'none' when no requirement is set", () => {
  assert.equal(ambStatus(500_000, 1, 0), "none");
  assert.equal(ambShortfallPaise(500_000, 1, 0), 0);
});

test("ambStatus is 'ok' at an exact-equality boundary (sumPaise === requiredPaise * days)", () => {
  // 5 days at exactly the required average: sum is exactly requiredPaise * days.
  assert.equal(ambStatus(5_000_000, 5, 1_000_000), "ok");
  assert.equal(ambShortfallPaise(5_000_000, 5, 1_000_000), 0);
});

test("ambStatus is 'short' below the requirement, with the correct shortfall", () => {
  assert.equal(ambStatus(400_000, 1, 500_000), "short");
  assert.equal(ambShortfallPaise(400_000, 1, 500_000), 100_000);
});

test("rounding cannot promote a short average to 'ok'", () => {
  // sumPaise=299, days=3 -> exact average is 99.666..., which is below the
  // requirement of 100. But averageBalancePaise (display rounding) rounds
  // 99.666... up to exactly 100, which would equal the requirement and read
  // as "ok" under the old rounded comparison. The exact comparison must still
  // say "short".
  assert.equal(averageBalancePaise(299, 3), 100, "sanity check: rounding lands exactly on the requirement");
  assert.equal(ambStatus(299, 3, 100), "short");
  assert.equal(ambShortfallPaise(299, 3, 100), 1);
});

// ---------- rounding ----------

test("averageBalancePaise rounds to whole paise, never leaving a fraction", () => {
  // Literal expectations, not a re-derivation of the formula: these must fail
  // if the rounding rule is ever changed to floor/ceil.
  assert.equal(averageBalancePaise(10, 3), 3); // 3.33… rounds down
  assert.equal(averageBalancePaise(11, 3), 4); // 3.66… rounds up
  assert.equal(averageBalancePaise(31_500_000, 31), 1_016_129); // 1,016,129.03…
  assert.equal(Number.isInteger(averageBalancePaise(10, 3)), true);
  assert.equal(Number.isInteger(averageBalancePaise(31_500_000, 31)), true);
});

// ---------- buildAverageBalance ----------

test("buildAverageBalance returns null when firstActivity is null", () => {
  const input: AmbInputs = {
    accountId: "acc-none",
    carriedInPaise: 100_000,
    requiredPaise: 0,
    firstActivity: null,
  };
  assert.equal(buildAverageBalance(input, new Map(), "2026-07-26"), null);
});

test("buildAverageBalance assembles the real production row", () => {
  // Same figures as the real-data pin above, verified against production with
  // a brute-force day-by-day SQL expansion.
  const input: AmbInputs = {
    accountId: "a88d7472-b623-491b-b33c-2b3f1101f83e",
    carriedInPaise: 0,
    requiredPaise: 0,
    firstActivity: "2026-07-16",
  };
  const deltas = new Map<string, number>([
    ["2026-07-16", 3_577_404],
    ["2026-07-24", -35_000],
    ["2026-07-25", -18_500],
    ["2026-07-26", -8_000],
  ]);
  const result = buildAverageBalance(input, deltas, "2026-07-26");
  assert.deepEqual(result, {
    accountId: "a88d7472-b623-491b-b33c-2b3f1101f83e",
    from: "2026-07-16",
    to: "2026-07-26",
    days: 11,
    daysInMonth: 31,
    averagePaise: 3_563_768,
    requiredPaise: 0,
    status: "none",
    shortfallPaise: 0,
    partialHistory: true,
  });
});

test("buildAverageBalance reports 'short' with the correct shortfall when the requirement exceeds the average", () => {
  // Same window/deltas as the production row above (sumPaise 39,201,444 over 11
  // days), but with a requirement above the ~35,63,768 paise average.
  const input: AmbInputs = {
    accountId: "a88d7472-b623-491b-b33c-2b3f1101f83e",
    carriedInPaise: 0,
    requiredPaise: 4_000_000,
    firstActivity: "2026-07-16",
  };
  const deltas = new Map<string, number>([
    ["2026-07-16", 3_577_404],
    ["2026-07-24", -35_000],
    ["2026-07-25", -18_500],
    ["2026-07-26", -8_000],
  ]);
  const result = buildAverageBalance(input, deltas, "2026-07-26");
  // requiredPaise * days = 44,000,000; sumPaise = 39,201,444;
  // shortfall = ceil((44,000,000 - 39,201,444) / 11) = ceil(4,798,556 / 11) = 436,233.
  assert.equal(result?.status, "short");
  assert.equal(result?.shortfallPaise, 436_233);
});

test("buildAverageBalance: partialHistory is false when history predates the month", () => {
  const input: AmbInputs = {
    accountId: "acc-predates",
    carriedInPaise: 100_000,
    requiredPaise: 0,
    firstActivity: "2026-03-02",
  };
  const result = buildAverageBalance(input, new Map(), "2026-07-26");
  assert.equal(result?.from, "2026-07-01");
  assert.equal(result?.partialHistory, false);
});

test("buildAverageBalance incorporates carriedInPaise: a steady carried-in balance with no deltas averages to itself", () => {
  const input: AmbInputs = {
    accountId: "acc-carried",
    carriedInPaise: 500_000,
    requiredPaise: 0,
    firstActivity: "2026-07-01",
  };
  const result = buildAverageBalance(input, new Map(), "2026-07-26");
  assert.equal(result?.averagePaise, 500_000);
});
