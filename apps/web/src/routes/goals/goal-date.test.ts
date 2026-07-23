import assert from "node:assert/strict";
import test from "node:test";
import { formatGoalDeadlineDistance } from "./goal-date.ts";

const now = new Date(2026, 6, 23);

test("formats remaining years and months beside a future goal deadline", () => {
  assert.equal(formatGoalDeadlineDistance("2033-01-01", now), "6 years 5 months left");
});

test("uses singular units and omits zero-value units", () => {
  assert.equal(formatGoalDeadlineDistance("2027-08-23", now), "1 year 1 month left");
  assert.equal(formatGoalDeadlineDistance("2026-09-23", now), "2 months left");
});

test("handles near, current, and overdue deadlines", () => {
  assert.equal(formatGoalDeadlineDistance("2026-08-01", now), "less than 1 month left");
  assert.equal(formatGoalDeadlineDistance("2026-07-23", now), "due today");
  assert.equal(formatGoalDeadlineDistance("2025-01-23", now), "1 year 6 months overdue");
});
