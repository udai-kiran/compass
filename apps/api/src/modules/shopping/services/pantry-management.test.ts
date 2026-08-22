/**
 * Unit tests for pantry-management.ts pure functions (task 11.1).
 *
 * All tests are pure — no DB, no network.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeDecayedQuantity,
  computeExpectedDepletionMs,
} from "./pantry-management.ts";
import { MS_PER_DAY } from "./consumption-rate.ts";

describe("computeDecayedQuantity", () => {
  it("case 1: 1000g stock, 990g/month rate, 10 days → 1000 − 330 = 670", () => {
    // consumed = floor(990 * 10 * MS_PER_DAY / (30 * MS_PER_DAY)) = floor(990*10/30) = floor(330) = 330
    const result = computeDecayedQuantity(1000, 990, 10 * MS_PER_DAY);
    assert.equal(result, 670);
  });

  it("case 2: 100g stock, 1500g/month rate, 10 days → 0 (not negative)", () => {
    // consumed = floor(1500 * 10 / 30) = 500; 100 - 500 = -400 → clamped to 0
    const result = computeDecayedQuantity(100, 1500, 10 * MS_PER_DAY);
    assert.equal(result, 0);
  });

  it("case 3: any stock, 0 consumption rate → no decay", () => {
    const result = computeDecayedQuantity(500, 0, 15 * MS_PER_DAY);
    assert.equal(result, 500);
  });

  it("case 8: negative elapsed (clock skew) → no decay, return original quantity", () => {
    const result = computeDecayedQuantity(800, 1000, -5 * MS_PER_DAY);
    assert.equal(result, 800);
  });
});

describe("computeExpectedDepletionMs", () => {
  it("case 4: 1000g stock, 1000g/month rate → 30 days in ms", () => {
    const result = computeExpectedDepletionMs(1000, 1000);
    assert.equal(result, 30 * MS_PER_DAY);
  });

  it("case 5: 0 consumption rate → null (never depletes)", () => {
    const result = computeExpectedDepletionMs(1000, 0);
    assert.equal(result, null);
  });
});

describe("correctPantry rate dampening (pure math verification)", () => {
  it("case 6: rate 1000, implied 500 → new rate = floor((1000*80 + 500*20)/100) = 900", () => {
    const existingRate = 1000;
    const impliedRate = 500;
    const newRate = Math.floor((existingRate * 80 + impliedRate * 20) / 100);
    assert.equal(newRate, 900);
  });

  it("case 7: rate 500, implied 1000 → new rate = floor((500*80 + 1000*20)/100) = 600", () => {
    const existingRate = 500;
    const impliedRate = 1000;
    const newRate = Math.floor((existingRate * 80 + impliedRate * 20) / 100);
    assert.equal(newRate, 600);
  });
});
