/**
 * Unit tests for isStaleObservation and STALE_DAYS (task 10.1).
 *
 * These are pure-function tests — no DB, no network.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { isStaleObservation, STALE_DAYS } from "./price-observations.ts";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

test("STALE_DAYS is 7", () => {
  assert.equal(STALE_DAYS, 7);
});

test("isStaleObservation: exactly at boundary (7 days) is NOT stale (strict >)", () => {
  const now = new Date("2026-01-08T00:00:00Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  // Exactly 7 days — NOT stale (> not >=).
  assert.equal(isStaleObservation(observedAt, now), false);
});

test("isStaleObservation: 7 days + 1 ms IS stale", () => {
  const now = new Date("2026-01-08T00:00:00.001Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(isStaleObservation(observedAt, now), true);
});

test("isStaleObservation: 6 days old is NOT stale", () => {
  const now = new Date("2026-01-07T00:00:00Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(isStaleObservation(observedAt, now), false);
});

test("isStaleObservation: 8 days old IS stale", () => {
  const now = new Date("2026-01-09T00:00:00Z");
  const observedAt = new Date("2026-01-01T00:00:00Z");
  assert.equal(isStaleObservation(observedAt, now), true);
});

test("isStaleObservation: observation in the future is NOT stale", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  const observedAt = new Date("2026-01-10T00:00:00Z");
  assert.equal(isStaleObservation(observedAt, now), false);
});

test("isStaleObservation: just created (0 ms old) is NOT stale", () => {
  const now = new Date("2026-01-01T12:00:00Z");
  assert.equal(isStaleObservation(now, now), false);
});

test("isStaleObservation: uses injectable now (default is new Date(), result changes over time)", () => {
  // With a fixed past observedAt and a 'now' exactly 8 days later → stale.
  const observedAt = new Date(Date.now() - 8 * MS_PER_DAY);
  assert.equal(isStaleObservation(observedAt), true);
});

test("isStaleObservation: 3 days old (injectable now) is NOT stale", () => {
  const now = new Date("2026-06-10T00:00:00Z");
  const observedAt = new Date("2026-06-07T00:00:00Z");
  assert.equal(isStaleObservation(observedAt, now), false);
});
