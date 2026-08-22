/**
 * Unit tests for isStaleCheck and SERVICEABILITY_STALE_HOURS (task 10.2).
 *
 * These are pure-function tests — no DB, no network.
 * Ownership guard (assertOwnedPriceSource) is tested indirectly via the DB
 * integration path; here we test only the pure staleness logic.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleCheck, SERVICEABILITY_STALE_HOURS } from "./serviceability.ts";

const MS_PER_HOUR = 60 * 60 * 1000;

test("SERVICEABILITY_STALE_HOURS is 24", () => {
  assert.equal(SERVICEABILITY_STALE_HOURS, 24);
});

test("isStaleCheck: exactly at boundary (24 hours) is NOT stale (strict >)", () => {
  const now = new Date("2026-01-02T00:00:00Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  // Exactly 24 hours — NOT stale (> not >=).
  assert.equal(isStaleCheck(observedAt, now), false);
});

test("isStaleCheck: 24 hours + 1 ms IS stale", () => {
  const now = new Date("2026-01-02T00:00:00.001Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(isStaleCheck(observedAt, now), true);
});

test("isStaleCheck: 23 hours old is NOT stale", () => {
  const now = new Date("2026-01-01T23:00:00Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(isStaleCheck(observedAt, now), false);
});

test("isStaleCheck: 25 hours old IS stale", () => {
  const now = new Date("2026-01-02T01:00:00Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(isStaleCheck(observedAt, now), true);
});

test("isStaleCheck: observation in the future is NOT stale", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const observedAt = new Date("2026-01-02T00:00:00Z");
  assert.equal(isStaleCheck(observedAt, now), false);
});

test("isStaleCheck: just created (0 ms old) is NOT stale", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(isStaleCheck(now, now), false);
});

test("isStaleCheck: uses injectable now (result changes over time)", () => {
  // With a fixed past observedAt and a 'now' exactly 25 hours later → stale.
  const observedAt = new Date(Date.now() - 25 * MS_PER_HOUR);
  assert.equal(isStaleCheck(observedAt), true);
});

test("isStaleCheck: 12 hours old (injectable now) is NOT stale", () => {
  const now = new Date("2026-06-10T12:00:00Z");
  const observedAt = new Date("2026-06-10T00:00:00Z");
  assert.equal(isStaleCheck(observedAt, now), false);
});
