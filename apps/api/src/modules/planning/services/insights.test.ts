import { test } from "node:test";
import assert from "node:assert/strict";
import {
  coefficientOfVariation,
  computeHealthScore,
  lifestyleInflationPct,
  savingRatePct,
} from "./insights.ts";

test("savingRatePct: fraction of income saved, floored at income<=0", () => {
  assert.equal(savingRatePct(100000, 80000), 20);
  assert.equal(savingRatePct(100000, 120000), -20);
  assert.equal(savingRatePct(0, 5000), 0);
});

test("coefficientOfVariation: 0 for steady, rises with spread", () => {
  assert.equal(coefficientOfVariation([100, 100, 100]), 0);
  assert.ok(coefficientOfVariation([50, 100, 150]) > 0);
  assert.equal(coefficientOfVariation([100]), 0); // too few points
});

test("lifestyleInflationPct: recent 3-mo vs earlier baseline drift", () => {
  // baseline avg 100, recent avg 130 → +30%
  assert.equal(lifestyleInflationPct([100, 100, 100, 130, 130, 130]), 30);
  // flat → 0
  assert.equal(lifestyleInflationPct([100, 100, 100, 100, 100, 100]), 0);
  // too little history
  assert.equal(lifestyleInflationPct([100, 100, 100]), 0);
});

test("computeHealthScore: documented weighted formula, clamped components", () => {
  const strong = computeHealthScore({
    savingRatePct: 25,
    monthsBuffer: 8,
    liabilitiesPaise: 0,
    monthlyIncomePaise: 500000,
    incomeCV: 0,
  });
  assert.equal(strong.score, 100);
  assert.equal(strong.grade, "A");

  // steadiness below perfect docks only the stability component
  const steady = computeHealthScore({
    savingRatePct: 25,
    monthsBuffer: 8,
    liabilitiesPaise: 0,
    monthlyIncomePaise: 500000,
    incomeCV: 0.05,
  });
  assert.equal(steady.score, 99);

  const weak = computeHealthScore({
    savingRatePct: 0,
    monthsBuffer: 0,
    liabilitiesPaise: 6000000,
    monthlyIncomePaise: 100000,
    incomeCV: 1,
  });
  assert.equal(weak.score, 0);
  assert.equal(weak.grade, "E");

  // components carry weights summing to 100
  assert.equal(strong.components.reduce((s, c) => s + c.weightPct, 0), 100);
});
