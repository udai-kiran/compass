/**
 * capital-losses.test.ts — Unit tests for pure capital loss helpers (task 13.11).
 *
 * No DB, no I/O. Tests computeExpiresFy and applyLossSetoff.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { computeExpiresFy, applyLossSetoff } from "./capital-losses.ts";

describe("computeExpiresFy", () => {
  it("2022-23 + 8 → 2030-31", () => {
    assert.strictEqual(computeExpiresFy("2022-23"), "2030-31");
  });
  it("2016-17 + 8 → 2024-25", () => {
    assert.strictEqual(computeExpiresFy("2016-17"), "2024-25");
  });
  it("handles century boundary: 1994-95 + 8 → 2002-03", () => {
    assert.strictEqual(computeExpiresFy("1994-95"), "2002-03");
  });
});

describe("applyLossSetoff — statutory ordering", () => {
  it("no losses → net equals gross", () => {
    const r = applyLossSetoff(100_000, 200_000, 0, 0);
    assert.strictEqual(r.netStcgPaise, 100_000);
    assert.strictEqual(r.netLtcgPaise, 200_000);
    assert.strictEqual(r.residualStclPaise, 0);
    assert.strictEqual(r.residualLtclPaise, 0);
  });

  it("STCL fully absorbed by STCG", () => {
    const r = applyLossSetoff(500_000, 300_000, 200_000, 0);
    assert.strictEqual(r.stclAgainstStcgPaise, 200_000);
    assert.strictEqual(r.stclAgainstLtcgPaise, 0);
    assert.strictEqual(r.netStcgPaise, 300_000);
    assert.strictEqual(r.netLtcgPaise, 300_000);
    assert.strictEqual(r.residualStclPaise, 0);
  });

  it("STCL spills over into LTCG after exhausting STCG", () => {
    // STCG=100k, STCL=300k: 100k offsets STCG, 200k offsets LTCG
    const r = applyLossSetoff(100_000, 500_000, 300_000, 0);
    assert.strictEqual(r.stclAgainstStcgPaise, 100_000);
    assert.strictEqual(r.stclAgainstLtcgPaise, 200_000);
    assert.strictEqual(r.netStcgPaise, 0);
    assert.strictEqual(r.netLtcgPaise, 300_000);
    assert.strictEqual(r.residualStclPaise, 0);
  });

  it("LTCL does NOT offset STCG", () => {
    const r = applyLossSetoff(400_000, 100_000, 0, 300_000);
    assert.strictEqual(r.ltclAgainstLtcgPaise, 100_000);
    assert.strictEqual(r.netStcgPaise, 400_000); // STCG unaffected by LTCL
    assert.strictEqual(r.netLtcgPaise, 0);
    assert.strictEqual(r.residualLtclPaise, 200_000);
  });

  it("STCL + LTCL combined: STCL goes first, LTCL picks up remainder", () => {
    // STCG=200k, LTCG=500k, STCL=300k, LTCL=100k
    // STCL: 200k against STCG, 100k against LTCG → LTCG now 400k
    // LTCL: 100k against LTCG → LTCG now 300k
    const r = applyLossSetoff(200_000, 500_000, 300_000, 100_000);
    assert.strictEqual(r.stclAgainstStcgPaise, 200_000);
    assert.strictEqual(r.stclAgainstLtcgPaise, 100_000);
    assert.strictEqual(r.ltclAgainstLtcgPaise, 100_000);
    assert.strictEqual(r.netStcgPaise, 0);
    assert.strictEqual(r.netLtcgPaise, 300_000);
    assert.strictEqual(r.residualStclPaise, 0);
    assert.strictEqual(r.residualLtclPaise, 0);
  });

  it("losses exceed gains — residuals carry forward", () => {
    // STCG=50k, LTCG=50k, STCL=200k, LTCL=150k
    // STCL: 50k against STCG, 50k against LTCG, 100k residual
    // LTCL: nothing left for LTCG, 150k residual
    const r = applyLossSetoff(50_000, 50_000, 200_000, 150_000);
    assert.strictEqual(r.netStcgPaise, 0);
    assert.strictEqual(r.netLtcgPaise, 0);
    assert.strictEqual(r.residualStclPaise, 100_000);
    assert.strictEqual(r.residualLtclPaise, 150_000);
  });

  it("zero gains: all losses are residual", () => {
    const r = applyLossSetoff(0, 0, 100_000, 80_000);
    assert.strictEqual(r.netStcgPaise, 0);
    assert.strictEqual(r.netLtcgPaise, 0);
    assert.strictEqual(r.residualStclPaise, 100_000);
    assert.strictEqual(r.residualLtclPaise, 80_000);
  });
});
