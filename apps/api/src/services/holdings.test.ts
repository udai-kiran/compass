import { test } from "node:test";
import assert from "node:assert/strict";
import { costBasis, unitsHeld } from "./holdings.ts";

const buy = (date: string, units: number, amountPaise: number) => ({ type: "buy", date, units, amountPaise });
const sell = (date: string, units: number, amountPaise: number) => ({ type: "sell", date, units, amountPaise });
const dividend = (date: string, amountPaise: number) => ({ type: "dividend", date, units: null, amountPaise });

test("cost basis after a profitable sale stays positive, not negative", () => {
  // Buy 100 units @ ₹100 = ₹10,000; sell 40 @ ₹150 = ₹6,000 proceeds.
  // Raw buy-minus-sell cash flow would be 10,000 − 6,000 = ₹4,000 and could go
  // negative on a bigger gain. Remaining cost basis is 60 units × ₹100 = ₹6,000.
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), sell("2026-06-01", 40, 600_000)]);
  assert.equal(cb.remainingCostPaise, 600_000);
  assert.equal(cb.units, 60);
  // Realized = proceeds − average cost of units sold = 6,000 − (40 × ₹100) = ₹2,000.
  assert.equal(cb.realizedPaise, 200_000);
});

test("selling everything zeroes the cost basis and books the full gain", () => {
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), sell("2026-06-01", 100, 1_500_000)]);
  assert.equal(cb.remainingCostPaise, 0);
  assert.equal(cb.units, 0);
  assert.equal(cb.realizedPaise, 500_000);
});

test("events are ordered by date, not input order", () => {
  // A sell handed in before its buy must still price against the buy.
  const cb = costBasis([sell("2026-06-01", 40, 600_000), buy("2026-01-01", 100, 1_000_000)]);
  assert.equal(cb.remainingCostPaise, 600_000);
  assert.equal(cb.units, 60);
});

test("dividends never touch cost basis or units", () => {
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), dividend("2026-03-01", 5_000)]);
  assert.equal(cb.remainingCostPaise, 1_000_000);
  assert.equal(cb.units, 100);
  assert.equal(cb.realizedPaise, 0);
});

test("a sell larger than units held cannot drive cost basis or units negative", () => {
  const cb = costBasis([buy("2026-01-01", 100, 1_000_000), sell("2026-06-01", 150, 900_000)]);
  assert.equal(cb.units, 0);
  assert.equal(cb.remainingCostPaise, 0);
});

test("units held still tallies buys, sells, and cash dividends", () => {
  assert.equal(unitsHeld([buy("2026-01-01", 100, 1), sell("2026-02-01", 30, 1), dividend("2026-03-01", 1)]), 70);
});
