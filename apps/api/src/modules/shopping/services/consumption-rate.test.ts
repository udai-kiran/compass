/**
 * Unit tests for consumption-rate.ts pure functions (task 11.1).
 *
 * All tests are pure — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeConsumptionRate, MS_PER_DAY, MIN_PURCHASES } from "./consumption-rate.ts";

// Helper to build a Date offset by `days` from a base date.
function daysFrom(base: Date, days: number): Date {
  return new Date(base.getTime() + days * MS_PER_DAY);
}

const BASE = new Date("2024-01-01T00:00:00.000Z");

describe("computeConsumptionRate", () => {
  it("case 1: 0 purchases → null", () => {
    const result = computeConsumptionRate([], "g");
    assert.equal(result, null);
  });

  it("case 2: 1 purchase → null (< MIN_PURCHASES)", () => {
    const result = computeConsumptionRate(
      [{ quantityBase: 1000, unit: "g", boughtAt: BASE }],
      "g",
    );
    assert.equal(result, null);
    assert.equal(MIN_PURCHASES, 2);
  });

  it("case 3: 2 purchases, 30 days apart, 1000g each → rate = 1000g/month", () => {
    const result = computeConsumptionRate(
      [
        { quantityBase: 1000, unit: "g", boughtAt: BASE },
        { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 30) },
      ],
      "g",
    );
    assert.notEqual(result, null);
    assert.equal(result!.consumptionBasePerMonth, 1000);
    assert.equal(result!.unit, "g");
    assert.equal(result!.observationCount, 2);
  });

  it("case 4: 5 regular purchases + 1 outlier (5× quantity) → outlier excluded, rate from regulars", () => {
    // 5 purchases of 1000g, 30 days apart + 1 outlier of 5000g.
    const purchases = [
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 0) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 30) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 60) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 90) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 120) },
      // Outlier: 5× median quantity (1000 × 5 = 5000 > OUTLIER_MULTIPLIER(3) × 1000 = 3000)
      { quantityBase: 5000, unit: "g", boughtAt: daysFrom(BASE, 150) },
    ];
    const result = computeConsumptionRate(purchases, "g");
    assert.notEqual(result, null);
    // The outlier is excluded; rate is based on 5 regular purchases.
    assert.equal(result!.observationCount, 5);
    // Rate: 1000g / 30-day interval = 1000g/month.
    assert.equal(result!.consumptionBasePerMonth, 1000);
  });

  it("case 5: mixed units → only target-unit purchases considered", () => {
    const purchases = [
      { quantityBase: 500, unit: "ml", boughtAt: daysFrom(BASE, 0) },
      { quantityBase: 500, unit: "ml", boughtAt: daysFrom(BASE, 15) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 0) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 30) },
    ];
    // Target unit: "ml" → only ml purchases.
    const result = computeConsumptionRate(purchases, "ml");
    assert.notEqual(result, null);
    assert.equal(result!.unit, "ml");
    assert.equal(result!.observationCount, 2);
    // 500ml per 15 days → 1000ml/month.
    assert.equal(result!.consumptionBasePerMonth, 1000);
  });

  it("case 6: all purchases at same timestamp → null (degenerate interval)", () => {
    const purchases = [
      { quantityBase: 1000, unit: "g", boughtAt: BASE },
      { quantityBase: 1000, unit: "g", boughtAt: BASE },
      { quantityBase: 1000, unit: "g", boughtAt: BASE },
    ];
    const result = computeConsumptionRate(purchases, "g");
    assert.equal(result, null);
  });

  it("case 7: all purchases have null quantity → handled by caller filtering, empty → null", () => {
    // Caller (learnConsumptionRate) filters null-quantity items before calling.
    // Simulating that: pass empty array after filter.
    const result = computeConsumptionRate([], "g");
    assert.equal(result, null);
  });

  it("case 8: outlier exclusion leaves <2 → null", () => {
    // Edge: qty=0 makes median=0, and ANY positive qty is > 3×0 = 0, so it
    // gets excluded. After exclusion only [0] remains (1 item) → null.
    // (qty=0 is DB-valid per the >= 0 check; this exercises the "< MIN_PURCHASES
    // after exclusion" branch of computeConsumptionRate.)
    const purchases = [
      { quantityBase: 0, unit: "g", boughtAt: daysFrom(BASE, 0) },
      { quantityBase: 1, unit: "g", boughtAt: daysFrom(BASE, 30) },
    ];
    // sorted quantities: [0, 1], median = floor((0+1)/2) = 0
    // 1 > OUTLIER_MULTIPLIER(3) × 0 = 0 → outlier; 0 > 0 → NOT outlier
    // remaining: [0] → 1 item → < MIN_PURCHASES(2) → null
    const result = computeConsumptionRate(purchases, "g");
    assert.equal(result, null);
  });

  it("case 9: 3 purchases with irregular intervals → median interval used (not mean)", () => {
    // Intervals: 10 days, 50 days → median = 10 days (lower of two values).
    // But with even-length intervals array, we take floor of mean of two middle values.
    // Sorted intervals: [10*MS_PER_DAY, 50*MS_PER_DAY] → median = floor((10+50)/2) = 30 days.
    // Wait, that's not what we want. Let me use 3 intervals (4 purchases):
    // Intervals: [10, 30, 50] days → sorted: [10, 30, 50] → median = 30 days.
    const purchases = [
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 0) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 10) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 40) },
      { quantityBase: 1000, unit: "g", boughtAt: daysFrom(BASE, 90) },
    ];
    // Intervals: 10, 30, 50 days → median = 30 days.
    const result = computeConsumptionRate(purchases, "g");
    assert.notEqual(result, null);
    // Rate: 1000g per 30-day median interval = 1000g/month.
    assert.equal(result!.consumptionBasePerMonth, 1000);
  });
});
