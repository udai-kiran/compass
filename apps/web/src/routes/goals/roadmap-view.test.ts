import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatGlideStep, hasAllocationShift } from "./roadmap-view.ts";
import type { GlideStep } from "@compass/shared";

function makeStep(overrides: Partial<GlideStep> = {}): GlideStep {
  return {
    fromDate: "2026-06-01",
    toDate: "2027-12-01",
    equityPct: 80,
    debtPct: 20,
    monthsRemaining: 18,
    requiredMonthlyPaise: null,
    projectedCorpusPaise: 0,
    ...overrides,
  };
}

describe("formatGlideStep", () => {
  it("produces correct string for a typical step", () => {
    const step = makeStep();
    assert.equal(formatGlideStep(step), "Jun 2026 – Dec 2027 · 80% equity / 20% debt");
  });

  it("handles December correctly (month '12')", () => {
    const step = makeStep({ fromDate: "2025-12-01", toDate: "2026-12-01", equityPct: 60, debtPct: 40 });
    assert.equal(formatGlideStep(step), "Dec 2025 – Dec 2026 · 60% equity / 40% debt");
  });
});

describe("hasAllocationShift", () => {
  it("returns true when equity changes between steps", () => {
    const steps = [makeStep({ equityPct: 80 }), makeStep({ equityPct: 60 })];
    assert.equal(hasAllocationShift(steps), true);
  });

  it("returns false when equity is the same across all steps", () => {
    const steps = [makeStep({ equityPct: 70 }), makeStep({ equityPct: 70 }), makeStep({ equityPct: 70 })];
    assert.equal(hasAllocationShift(steps), false);
  });

  it("returns false for an empty array", () => {
    assert.equal(hasAllocationShift([]), false);
  });

  it("returns false for a single step", () => {
    assert.equal(hasAllocationShift([makeStep()]), false);
  });
});
