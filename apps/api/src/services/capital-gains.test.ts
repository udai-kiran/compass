import { test } from "node:test";
import assert from "node:assert/strict";
import { fyOf, fyRange } from "./capital-gains.ts";

test("fyOf: April starts a new Indian FY, March ends the old one", () => {
  assert.equal(fyOf("2025-04-01"), "2025-26");
  assert.equal(fyOf("2025-12-31"), "2025-26");
  assert.equal(fyOf("2026-03-31"), "2025-26");
  assert.equal(fyOf("2026-04-01"), "2026-27");
  assert.equal(fyOf("2025-01-15"), "2024-25");
});

test("fyRange: Apr 1 to Mar 31 spanning two calendar years", () => {
  assert.deepEqual(fyRange("2025-26"), ["2025-04-01", "2026-03-31"]);
  assert.deepEqual(fyRange("1999-00"), ["1999-04-01", "2000-03-31"]);
});

test("fyOf and fyRange round-trip", () => {
  for (const d of ["2023-04-01", "2024-03-31", "2024-08-15"]) {
    const [start, end] = fyRange(fyOf(d));
    assert.ok(d >= start && d <= end, `${d} inside ${start}..${end}`);
  }
});
