import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatRate,
  rateResetSummary,
  recommendationLabel,
  tenureChangeLabel,
  riskLabel,
} from "./prepay-view.ts";

describe("formatRate", () => {
  it("formats basis points as percent", () => {
    assert.equal(formatRate(850), "8.50% p.a.");
    assert.equal(formatRate(1200), "12.00% p.a.");
    assert.equal(formatRate(725), "7.25% p.a.");
  });
});

describe("rateResetSummary", () => {
  it("describes a rate increase", () => {
    const s = rateResetSummary(850, 900, 14, 420_000_00);
    assert.ok(s.includes("8.50%"));
    assert.ok(s.includes("9.00%"));
    assert.ok(s.includes("+14 months"));
    assert.ok(s.includes("extra interest"));
  });

  it("describes a rate decrease", () => {
    const s = rateResetSummary(900, 850, -10, -300_000_00);
    assert.ok(s.includes("-10 months"));
    assert.ok(s.includes("less interest"));
  });
});

describe("recommendationLabel", () => {
  it("maps prepay to emerald", () => {
    const { label, colorClass } = recommendationLabel("prepay");
    assert.equal(label, "Prepay the loan");
    assert.ok(colorClass.includes("emerald"));
  });

  it("maps emergency_fund_first to amber", () => {
    const { label, colorClass } = recommendationLabel("emergency_fund_first");
    assert.ok(label.includes("emergency fund"));
    assert.ok(colorClass.includes("amber"));
  });

  it("maps high_interest_debt_first to red", () => {
    const { label, colorClass } = recommendationLabel("high_interest_debt_first");
    assert.ok(label.includes("high-interest"));
    assert.ok(colorClass.includes("red"));
  });

  it("maps invest to blue", () => {
    const { label, colorClass } = recommendationLabel("invest");
    assert.ok(label.includes("Invest"));
    assert.ok(colorClass.includes("blue"));
  });
});

describe("tenureChangeLabel", () => {
  it('returns "No change" for 0', () => {
    assert.equal(tenureChangeLabel(0), "No change");
  });

  it("returns saved for positive", () => {
    assert.equal(tenureChangeLabel(14), "14 months saved");
  });

  it("returns longer for negative", () => {
    assert.equal(tenureChangeLabel(-10), "10 months longer");
  });
});

describe("riskLabel", () => {
  it("returns certain for true", () => {
    assert.ok(riskLabel(true).includes("Certain"));
  });

  it("returns projected for false", () => {
    assert.ok(riskLabel(false).includes("Projected"));
  });
});
