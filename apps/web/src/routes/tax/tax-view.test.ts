import { test } from "node:test";
import assert from "node:assert/strict";
import {
  bucketPct,
  currentFyLabel,
  fyChoices,
  fyOfDate,
  instalmentState,
  regimeVerdict,
} from "./tax-view.ts";

test("fyOfDate: April starts the new FY; March belongs to the previous one", () => {
  assert.equal(fyOfDate("2026-04-01"), "2026-27");
  assert.equal(fyOfDate("2026-03-31"), "2025-26");
});

test("currentFyLabel honours a pinned today", () => {
  assert.equal(currentFyLabel("2025-12-15"), "2025-26");
});

test("fyChoices: two previous years plus current, newest first", () => {
  assert.deepEqual(fyChoices("2026-08-24"), ["2026-27", "2025-26", "2024-25"]);
});

test("bucketPct: contributed over cap, zero cap safe, over-cap allowed past 100", () => {
  assert.equal(bucketPct(7_500_000, 15_000_000), 50);
  assert.equal(bucketPct(1_000_000, 0), 0);
  assert.ok(bucketPct(16_000_000, 15_000_000) > 100);
});

test("regimeVerdict: new-regime users are told deductions do not apply; saving stays structured", () => {
  const v = regimeVerdict({ recommendation: "new", savingPaise: 250_000_00, crossoverDeductionPaise: null });
  assert.equal(v.recommendation, "new");
  assert.equal(v.savingPaise, 250_000_00); // the page formats this via formatINR
  assert.match(v.deductionNote ?? "", /do not apply/);
});

test("regimeVerdict: old-regime win names the crossover when present", () => {
  const v = regimeVerdict({
    recommendation: "old",
    savingPaise: -120_000_00,
    crossoverDeductionPaise: 450_000_00,
  });
  assert.equal(v.recommendation, "old");
  assert.equal(v.savingPaise, -120_000_00);
  assert.match(v.deductionNote ?? "", /crossover/);
});

test("regimeVerdict: indifferent carries no note and zeroes the saving", () => {
  const v = regimeVerdict({ recommendation: "indifferent", savingPaise: 0, crossoverDeductionPaise: null });
  assert.equal(v.recommendation, "indifferent");
  assert.equal(v.savingPaise, 0);
  assert.equal(v.deductionNote, null);
});

test("instalmentState: due date strictly before today is past; same day is upcoming", () => {
  assert.equal(instalmentState("2026-06-14", "2026-06-15"), "past");
  assert.equal(instalmentState("2026-06-15", "2026-06-15"), "upcoming");
});
