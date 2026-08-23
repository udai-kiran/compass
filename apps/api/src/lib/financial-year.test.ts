/**
 * financial-year.test.ts — unit tests for lib/financial-year.ts
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { fyOf, fyRange, parseFy, currentFy, fyLabel } from "./financial-year.ts";

// ─── fyOf ────────────────────────────────────────────────────────────────────

test("fyOf: April 1 is the first day of the new FY", () => {
  assert.equal(fyOf("2025-04-01"), "2025-26");
});

test("fyOf: March 31 is the last day of the previous FY", () => {
  assert.equal(fyOf("2026-03-31"), "2025-26");
  assert.equal(fyOf("2025-03-31"), "2024-25");
});

test("fyOf: mid-year dates", () => {
  assert.equal(fyOf("2025-06-15"), "2025-26");
  assert.equal(fyOf("2025-12-31"), "2025-26");
  assert.equal(fyOf("2026-01-01"), "2025-26");
  assert.equal(fyOf("2026-02-15"), "2025-26");
});

test("fyOf: century rollover — FY 1999-00", () => {
  // Apr 1999 – Mar 2000
  assert.equal(fyOf("1999-04-01"), "1999-00");
  assert.equal(fyOf("2000-03-31"), "1999-00");
  assert.equal(fyOf("1999-12-31"), "1999-00");
});

test("fyOf: FY 2000-01 (year 2000 start)", () => {
  assert.equal(fyOf("2000-04-01"), "2000-01");
  assert.equal(fyOf("2001-03-31"), "2000-01");
});

test("fyOf: January before April belongs to the previous FY", () => {
  assert.equal(fyOf("2023-01-15"), "2022-23");
});

test("fyOf: throws on invalid date format", () => {
  assert.throws(() => fyOf("2025/06/15"), /invalid ISO date/);
  assert.throws(() => fyOf("20250615"), /invalid ISO date/);
  assert.throws(() => fyOf("2025-6-15"), /invalid ISO date/);
  assert.throws(() => fyOf(""), /invalid ISO date/);
});

test("fyOf: throws on impossible calendar dates (calendar round-trip validation)", () => {
  // Invalid month: 0 and 13 don't exist
  assert.throws(() => fyOf("2025-00-15"), /not a valid calendar date/);
  assert.throws(() => fyOf("2025-13-15"), /not a valid calendar date/);
  // Invalid day: day 0 doesn't exist
  assert.throws(() => fyOf("2025-06-00"), /not a valid calendar date/);
  // February 30 does not exist in any year
  assert.throws(() => fyOf("2025-02-30"), /not a valid calendar date/);
  // February 29 only exists in leap years
  assert.throws(() => fyOf("2025-02-29"), /not a valid calendar date/);  // 2025 is not a leap year
  // February 29 in a leap year should be valid
  assert.doesNotThrow(() => fyOf("2024-02-29"));  // 2024 is a leap year
  // September has only 30 days
  assert.throws(() => fyOf("2025-09-31"), /not a valid calendar date/);
});

// ─── parseFy ─────────────────────────────────────────────────────────────────

test("parseFy: returns start year for valid label", () => {
  assert.equal(parseFy("2025-26"), 2025);
  assert.equal(parseFy("2024-25"), 2024);
  assert.equal(parseFy("2023-24"), 2023);
});

test("parseFy: century rollover — 1999-00", () => {
  assert.equal(parseFy("1999-00"), 1999);
});

test("parseFy: throws on wrong format", () => {
  assert.throws(() => parseFy("2025-2026"), /invalid FY label/);
  assert.throws(() => parseFy("25-26"), /invalid FY label/);
  assert.throws(() => parseFy("2025/26"), /invalid FY label/);
  assert.throws(() => parseFy(""), /invalid FY label/);
});

test("parseFy: throws on inconsistent suffix", () => {
  // 2025 start year means end suffix must be 26
  assert.throws(() => parseFy("2025-25"), /inconsistent/);
  assert.throws(() => parseFy("2025-27"), /inconsistent/);
  assert.throws(() => parseFy("2025-00"), /inconsistent/);
});

test("parseFy: 2099-00 is a valid future century rollover label", () => {
  assert.equal(parseFy("2099-00"), 2099);
});

// ─── fyRange ─────────────────────────────────────────────────────────────────

test("fyRange: returns correct date bounds for 2025-26", () => {
  const [start, end] = fyRange("2025-26");
  assert.equal(start, "2025-04-01");
  assert.equal(end, "2026-03-31");
});

test("fyRange: century rollover 1999-00", () => {
  const [start, end] = fyRange("1999-00");
  assert.equal(start, "1999-04-01");
  assert.equal(end, "2000-03-31");
});

test("fyRange: throws on invalid FY label", () => {
  assert.throws(() => fyRange("2025-27"), /inconsistent/);
  assert.throws(() => fyRange("bad"), /invalid FY label/);
});

// ─── fyLabel ─────────────────────────────────────────────────────────────────

test("fyLabel: returns 'FY YYYY-YY' format", () => {
  assert.equal(fyLabel("2025-26"), "FY 2025-26");
  assert.equal(fyLabel("2023-24"), "FY 2023-24");
  assert.equal(fyLabel("1999-00"), "FY 1999-00");
});

test("fyLabel: throws on inconsistent FY label", () => {
  assert.throws(() => fyLabel("2025-27"), /inconsistent/);
  assert.throws(() => fyLabel("bad"), /invalid FY label/);
});

// ─── currentFy ───────────────────────────────────────────────────────────────

test("currentFy: returns a valid FY label", () => {
  const fy = currentFy();
  // Should match YYYY-YY pattern
  assert.match(fy, /^\d{4}-\d{2}$/);
  // Should be parseable without throwing
  assert.doesNotThrow(() => parseFy(fy));
});
