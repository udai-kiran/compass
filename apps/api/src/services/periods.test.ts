import { test } from "node:test";
import assert from "node:assert/strict";
import { currentPeriodKey, periodRange, prevPeriodKey } from "./periods.ts";
import { advanceDate } from "../modules/ledger/services/recurring.ts";

test("periodRange handles month lengths and years", () => {
  assert.deepEqual(periodRange("monthly", "2026-07"), { from: "2026-07-01", to: "2026-07-31" });
  assert.deepEqual(periodRange("monthly", "2026-02"), { from: "2026-02-01", to: "2026-02-28" });
  assert.deepEqual(periodRange("monthly", "2028-02"), { from: "2028-02-01", to: "2028-02-29" });
  assert.deepEqual(periodRange("annual", "2026"), { from: "2026-01-01", to: "2026-12-31" });
});

test("prevPeriodKey crosses year boundaries", () => {
  assert.equal(prevPeriodKey("monthly", "2026-01"), "2025-12");
  assert.equal(prevPeriodKey("monthly", "2026-07"), "2026-06");
  assert.equal(prevPeriodKey("annual", "2026"), "2025");
});

test("currentPeriodKey formats today", () => {
  assert.match(currentPeriodKey("monthly"), /^\d{4}-\d{2}$/);
  assert.match(currentPeriodKey("annual"), /^\d{4}$/);
});

test("advanceDate steps and clamps day-of-month", () => {
  assert.equal(advanceDate("2026-07-13", "daily", 1), "2026-07-14");
  assert.equal(advanceDate("2026-07-13", "weekly", 2), "2026-07-27");
  assert.equal(advanceDate("2026-01-31", "monthly", 1), "2026-02-28");
  assert.equal(advanceDate("2026-11-30", "monthly", 3), "2027-02-28");
  assert.equal(advanceDate("2028-02-29", "yearly", 1), "2029-02-28");
  assert.equal(advanceDate("2026-12-15", "monthly", 1), "2027-01-15");
});
