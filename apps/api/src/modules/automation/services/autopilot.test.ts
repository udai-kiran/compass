import { test } from "node:test";
import assert from "node:assert/strict";
import { detectCashShortfall, weekKey } from "./autopilot.ts";

/** Build a forecast-shaped day series starting at 2026-01-01 (a Thursday). */
function days(balances: number[], start = "2026-01-01"): Array<{ date: string; balancePaise: number }> {
  const base = new Date(`${start}T00:00:00Z`);
  return balances.map((balancePaise, i) => {
    const d = new Date(base);
    d.setUTCDate(d.getUTCDate() + i);
    return { date: d.toISOString().slice(0, 10), balancePaise };
  });
}

test("no breach when every projected day stays above the floor", () => {
  const res = detectCashShortfall(days([100000, 90000, 80000, 70000]));
  assert.equal(res.breaches, false);
  assert.equal(res.breachDate, null);
  // trough is still reported (the lowest look-ahead day, excluding today)
  assert.equal(res.troughPaise, 70000);
});

test("breaches when the projection crosses below zero within the horizon", () => {
  // today=100, then declines to -50 on day 3
  const res = detectCashShortfall(days([100, 60, 20, -50, -80]));
  assert.equal(res.breaches, true);
  assert.equal(res.breachDate, "2026-01-04"); // first day < 0 (index 3)
  assert.equal(res.troughPaise, -80); // deepest dip (index 4)
  assert.equal(res.troughDate, "2026-01-05");
});

test("today's balance is ignored — only look-ahead days count", () => {
  // today already negative, but every future day recovers above the floor
  const res = detectCashShortfall(days([-500, 100, 200, 300]));
  assert.equal(res.breaches, false);
});

test("a breach beyond the horizon does not fire", () => {
  // 40 flat days at 1000, then -100 on day 41 — outside the 30-day window
  const series = [...Array(40).fill(1000), -100];
  const res = detectCashShortfall(days(series), { horizonDays: 30 });
  assert.equal(res.breaches, false);
});

test("respects a non-zero floor", () => {
  const res = detectCashShortfall(days([5000, 4000, 3000, 2000]), { floorPaise: 2500 });
  assert.equal(res.breaches, true);
  assert.equal(res.breachDate, "2026-01-04"); // first day < 2500 (2000)
});

test("empty / single-day forecast never breaches", () => {
  assert.equal(detectCashShortfall([]).breaches, false);
  assert.equal(detectCashShortfall(days([100])).breaches, false); // only 'today'
});

test("weekKey collapses a whole week to its Monday", () => {
  // 2026-01-01 is a Thursday → Monday of that week is 2025-12-29
  assert.equal(weekKey("2026-01-01"), "2025-12-29");
  assert.equal(weekKey("2026-01-04"), "2025-12-29"); // Sunday, same week
  assert.equal(weekKey("2026-01-05"), "2026-01-05"); // next Monday
});
