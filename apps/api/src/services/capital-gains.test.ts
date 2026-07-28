import { test } from "node:test";
import assert from "node:assert/strict";
import { fyOf, fyRange, sumSlices } from "./capital-gains.ts";

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

// ---------- statement rollup ----------

const slice = (
  term: "short" | "long" | "exempt",
  gainPaise: number,
  proceedsPaise = 0,
  costPaise = 0,
) => ({ term, gainPaise, proceedsPaise, costPaise });

test("the statement rollup keeps an exempt gain out of both taxable buckets", () => {
  const r = sumSlices([slice("short", 10_000), slice("long", 20_000), slice("exempt", 500_000)]);
  assert.equal(r.shortTermGainPaise, 10_000);
  assert.equal(r.longTermGainPaise, 20_000);
  assert.equal(r.exemptGainPaise, 500_000);
  // The statement's taxable total is built from short + long only. Folding the
  // exempt gain in would overstate liability by ₹5,000.
  assert.equal(r.shortTermGainPaise + r.longTermGainPaise, 30_000);
});

test("an exempt slice still contributes its proceeds and cost", () => {
  // The disposal must remain visible in the statement even though it is untaxed.
  const r = sumSlices([slice("exempt", 500_000, 1_500_000, 1_000_000)]);
  assert.equal(r.proceedsPaise, 1_500_000);
  assert.equal(r.costPaise, 1_000_000);
  assert.equal(r.shortTermGainPaise, 0);
  assert.equal(r.longTermGainPaise, 0);
});

test("an exempt loss cannot offset a taxable gain at the statement level", () => {
  const r = sumSlices([slice("short", 100_000), slice("exempt", -400_000)]);
  assert.equal(r.shortTermGainPaise, 100_000);
  assert.equal(r.exemptGainPaise, -400_000);
  assert.equal(r.longTermGainPaise, 0);
});

test("a statement with no exempt slices is unchanged", () => {
  const r = sumSlices([slice("short", 10_000, 50_000, 40_000), slice("long", 20_000, 90_000, 70_000)]);
  assert.equal(r.exemptGainPaise, 0);
  assert.equal(r.shortTermGainPaise, 10_000);
  assert.equal(r.longTermGainPaise, 20_000);
  assert.equal(r.proceedsPaise, 140_000);
  assert.equal(r.costPaise, 110_000);
});
