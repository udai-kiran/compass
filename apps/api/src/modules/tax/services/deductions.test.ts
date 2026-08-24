/**
 * deductions.test.ts — Unit tests for pure helper functions in deductions.ts.
 *
 * These tests cover only the stateless pure functions exported from deductions.ts;
 * they require no DB or network connection.
 *
 * Integration tests (getDeductionBasket, CRUD) would require a live Postgres
 * connection; they are documented as a non-goal for this unit test file.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  computeNpsSplit,
  computeCcd2Cap,
  computePreventiveCheckupCap,
  isSeniorCitizenOnDate,
  computeHeadroom,
} from "./deductions.ts";

// ─── computeNpsSplit ──────────────────────────────────────────────────────────

describe("computeNpsSplit", () => {
  const NPS_CCD1B_CAP = 5_000_000; // ₹50,000

  it("returns full amount as ccd1b when contribution <= cap", () => {
    const { ccd1bContributed, npsRemainderPaise } = computeNpsSplit(3_000_000);
    assert.equal(ccd1bContributed, 3_000_000);
    assert.equal(npsRemainderPaise, 0);
  });

  it("returns cap as ccd1b and remainder when contribution > cap", () => {
    const { ccd1bContributed, npsRemainderPaise } = computeNpsSplit(8_000_000);
    assert.equal(ccd1bContributed, NPS_CCD1B_CAP);
    assert.equal(npsRemainderPaise, 3_000_000);
  });

  it("returns exactly cap when contribution equals cap", () => {
    const { ccd1bContributed, npsRemainderPaise } = computeNpsSplit(NPS_CCD1B_CAP);
    assert.equal(ccd1bContributed, NPS_CCD1B_CAP);
    assert.equal(npsRemainderPaise, 0);
  });

  it("returns zero for zero contribution", () => {
    const { ccd1bContributed, npsRemainderPaise } = computeNpsSplit(0);
    assert.equal(ccd1bContributed, 0);
    assert.equal(npsRemainderPaise, 0);
  });

  it("ccd1bContributed + npsRemainderPaise always equals input", () => {
    const inputs = [0, 1_000_000, 5_000_000, 5_000_001, 10_000_000];
    for (const input of inputs) {
      const { ccd1bContributed, npsRemainderPaise } = computeNpsSplit(input);
      assert.equal(
        ccd1bContributed + npsRemainderPaise,
        input,
        `invariant failed for input ${input}`,
      );
    }
  });
});

// ─── computeCcd2Cap ──────────────────────────────────────────────────────────

describe("computeCcd2Cap", () => {
  it("caps eligible at statutory cap when contribution exceeds cap", () => {
    // salary=₹1L (10,000,000 paise), rate=1000bps (10%), cap=₹10k (1,000,000 paise)
    // contributed=₹1.2L (12,000,000 paise) > cap → eligible = cap, capExceeded = true
    const result = computeCcd2Cap(12_000_000, 10_000_000, 1000);
    assert.equal(result.capPaise, 1_000_000);
    assert.equal(result.eligiblePaise, 1_000_000);
    assert.equal(result.capExceeded, true);
  });

  it("eligible equals contributed when within cap", () => {
    // salary=₹10L (100,000,000 paise), rate=1000bps (10%), cap=₹1L (10,000,000 paise)
    // contributed=₹50k (5,000,000 paise) < cap, so eligible = contributed
    const result = computeCcd2Cap(5_000_000, 100_000_000, 1000);
    assert.equal(result.capPaise, 10_000_000);
    assert.equal(result.eligiblePaise, 5_000_000);
    assert.equal(result.capExceeded, false);
  });

  it("capPaise = floor(salary * rate / 10000)", () => {
    // salary = 3,333,333 paise, rate = 1000bps → cap = floor(333333.3) = 333333
    const result = computeCcd2Cap(300_000, 3_333_333, 1000);
    assert.equal(result.capPaise, 333_333);
  });

  it("uses government rate (14%) vs private rate", () => {
    // salary=₹10L = 100,000,000 paise, government rate=1400bps
    // cap = floor(100,000,000 × 1400 / 10000) = 14,000,000 paise = ₹1.4L
    // contributed = 20,000,000 paise = ₹2L > cap → capExceeded = true
    const result = computeCcd2Cap(20_000_000, 100_000_000, 1400);
    assert.equal(result.capPaise, 14_000_000);
    assert.equal(result.eligiblePaise, 14_000_000);
    assert.equal(result.capExceeded, true);
  });
});

// ─── computePreventiveCheckupCap ─────────────────────────────────────────────

describe("computePreventiveCheckupCap", () => {
  const SUB_LIMIT = 500_000; // ₹5,000

  it("caps at 500,000 paise when amount exceeds limit", () => {
    assert.equal(computePreventiveCheckupCap(600_000), SUB_LIMIT);
  });

  it("returns amount as-is when at or below limit", () => {
    assert.equal(computePreventiveCheckupCap(500_000), SUB_LIMIT);
    assert.equal(computePreventiveCheckupCap(300_000), 300_000);
  });

  it("returns 0 for 0 input", () => {
    assert.equal(computePreventiveCheckupCap(0), 0);
  });
});

// ─── isSeniorCitizenOnDate ────────────────────────────────────────────────────

describe("isSeniorCitizenOnDate", () => {
  it("returns false for null DOB", () => {
    assert.equal(isSeniorCitizenOnDate(null, "2024-03-31"), false);
  });

  it("returns false for undefined DOB", () => {
    assert.equal(isSeniorCitizenOnDate(undefined, "2024-03-31"), false);
  });

  it("returns true for age exactly 60", () => {
    // DOB: 1964-03-31, reference date: 2024-03-31 → exactly 60 years
    assert.equal(isSeniorCitizenOnDate("1964-03-31", "2024-03-31"), true);
  });

  it("returns false for age 59 years and 364 days", () => {
    // DOB: 1964-04-01, reference date: 2024-03-31 → 59 completed years
    assert.equal(isSeniorCitizenOnDate("1964-04-01", "2024-03-31"), false);
  });

  it("returns true for age 61", () => {
    assert.equal(isSeniorCitizenOnDate("1963-01-01", "2024-03-31"), true);
  });

  it("returns false for age 59", () => {
    assert.equal(isSeniorCitizenOnDate("1965-01-01", "2024-03-31"), false);
  });
});

// ─── computeHeadroom ─────────────────────────────────────────────────────────

describe("computeHeadroom", () => {
  it("returns null for new regime", () => {
    assert.equal(computeHeadroom("new", 15_000_000, 12_000_000), null);
  });

  it("returns positive headroom for old regime when under cap", () => {
    assert.equal(computeHeadroom("old", 15_000_000, 12_000_000), 3_000_000);
  });

  it("returns 0 headroom when eligible equals cap", () => {
    assert.equal(computeHeadroom("old", 15_000_000, 15_000_000), 0);
  });

  it("returns 0 headroom when eligible exceeds cap (clamped)", () => {
    // eligible > cap should not happen, but guard against negative headroom
    assert.equal(computeHeadroom("old", 15_000_000, 16_000_000), 0);
  });
});
