/**
 * Unit tests for getEffectiveEarnPoints and getPointValue — pure functions
 * with no DB dependency.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { getEffectiveEarnPoints, getPointValue } from "./reward-rules.ts";
import type { RewardRule } from "@compass/shared";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

function makeRule(overrides: Partial<RewardRule> = {}): RewardRule {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    cardProductName: "Test Card",
    network: null,
    baseEarnPer100: 4,
    mccExclusions: [],
    accelEarnMultiplier: null,
    accelEarnCapPaise: null,
    accelEarnCapPeriod: null,
    redemptionValues: {},
    milestoneSpendPaise: null,
    milestoneBenefitDesc: null,
    annualFeeWaiverSpendPaise: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// getEffectiveEarnPoints tests
// ---------------------------------------------------------------------------

test("getEffectiveEarnPoints: zero spend earns zero points", () => {
  const rule = makeRule({ baseEarnPer100: 4 });
  assert.equal(getEffectiveEarnPoints(rule, 0, null, 0), 0);
});

test("getEffectiveEarnPoints: MCC in exclusions → 0 points regardless of spend", () => {
  const rule = makeRule({ baseEarnPer100: 4, mccExclusions: ["5411"] });
  assert.equal(getEffectiveEarnPoints(rule, 100000, "5411", 0), 0);
});

test("getEffectiveEarnPoints: no accel config → base rate only", () => {
  const rule = makeRule({ baseEarnPer100: 4 });
  // 10000 paise = ₹100 → 4 points
  assert.equal(getEffectiveEarnPoints(rule, 10000, null, 0), 4);
  // 25000 paise = ₹250 → 10 points (floor(25000 * 4 / 10000) = floor(10) = 10)
  assert.equal(getEffectiveEarnPoints(rule, 25000, null, 0), 10);
});

test("getEffectiveEarnPoints: within accel cap → accelerated rate", () => {
  // 10x multiplier, cap at ₹100,000 (10,000,000 paise)
  const rule = makeRule({
    baseEarnPer100: 4,
    accelEarnMultiplier: 10,
    accelEarnCapPaise: 10_000_000, // ₹1,00,000
    accelEarnCapPeriod: "monthly",
  });
  // Spend ₹100 (10,000 paise), no prior spend
  // Expected: floor(10000 * 10 * 4 / 10000) = floor(40) = 40
  assert.equal(getEffectiveEarnPoints(rule, 10000, null, 0), 40);
});

test("getEffectiveEarnPoints: prior spend exactly at cap → base rate only (cap exhausted)", () => {
  const cap = 10_000_000; // ₹1,00,000
  const rule = makeRule({
    baseEarnPer100: 4,
    accelEarnMultiplier: 10,
    accelEarnCapPaise: cap,
    accelEarnCapPeriod: "monthly",
  });
  // Prior spend = cap → remaining = 0 → all spend at base rate
  // Spend 10000 paise: floor(10000 * 4 / 10000) = 4
  assert.equal(getEffectiveEarnPoints(rule, 10000, null, cap), 4);
});

test("getEffectiveEarnPoints: spend spanning cap boundary → split accel + base", () => {
  // Cap at 50,000 paise, prior spend 40,000 → 10,000 remaining at accel
  const rule = makeRule({
    baseEarnPer100: 4,
    accelEarnMultiplier: 5,
    accelEarnCapPaise: 50_000,
    accelEarnCapPeriod: "statement_cycle",
  });
  const prior = 40_000;
  // Spend 20,000 paise total:
  //   eligibleAtAccel = min(20000, max(0, 50000 - 40000)) = min(20000, 10000) = 10000
  //   eligibleAtBase = 20000 - 10000 = 10000
  //   accel points = floor(10000 * 5 * 4 / 10000) = floor(20) = 20
  //   base points  = floor(10000 * 4 / 10000) = floor(4) = 4
  //   total = 24
  assert.equal(getEffectiveEarnPoints(rule, 20_000, null, prior), 24);
});

// ---------------------------------------------------------------------------
// getPointValue tests
// ---------------------------------------------------------------------------

test("getPointValue: returns null for unconfigured route", () => {
  const rule = makeRule({ redemptionValues: {} });
  assert.equal(getPointValue(rule, "cashback"), null);
});

test("getPointValue: returns configured paise value for configured route", () => {
  const rule = makeRule({ redemptionValues: { cashback: 50 } });
  assert.equal(getPointValue(rule, "cashback"), 50);
});
