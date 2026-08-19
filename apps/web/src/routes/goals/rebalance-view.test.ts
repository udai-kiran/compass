import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { actionLabel, driftSeverity } from "./rebalance-view.ts";
import type { RebalancingAction, DriftAnalysis } from "@compass/shared";

describe("actionLabel", () => {
  it('contains "Redirect" and the paise amount for redirect_contributions', () => {
    const action: RebalancingAction = {
      type: "redirect_contributions",
      fromLeg: "equity",
      toLeg: "debt",
      monthlyAmountPaise: 500000,
      estimatedClosureMonths: 6,
    };
    const label = actionLabel(action);
    assert.ok(label.includes("Redirect"));
    // formatINR(500000) = ₹5,000
    assert.ok(label.includes("5,000"));
  });

  it('contains "Switch" and the paise amount for switch_corpus', () => {
    const action: RebalancingAction = {
      type: "switch_corpus",
      fromLeg: "equity",
      toLeg: "debt",
      amountPaise: 1000000,
    };
    const label = actionLabel(action);
    assert.ok(label.includes("Switch"));
    // formatINR(1000000) = ₹10,000
    assert.ok(label.includes("10,000"));
  });
});

describe("driftSeverity", () => {
  it('returns "high" when drift > 10% of corpus', () => {
    const drift: DriftAnalysis = {
      equityCurrentPaise: 800000,
      equityTargetPaise: 700000,
      debtCurrentPaise: 200000,
      debtTargetPaise: 300000,
      overweightLeg: "equity",
      driftPaise: 150000, // 15% of 1000000
    };
    assert.equal(driftSeverity(drift), "high");
  });

  it('returns "low" when drift <= 10% of corpus', () => {
    const drift: DriftAnalysis = {
      equityCurrentPaise: 800000,
      equityTargetPaise: 790000,
      debtCurrentPaise: 200000,
      debtTargetPaise: 210000,
      overweightLeg: "equity",
      driftPaise: 50000, // 5% of 1000000
    };
    assert.equal(driftSeverity(drift), "low");
  });

  it('returns "low" when total corpus is 0', () => {
    const drift: DriftAnalysis = {
      equityCurrentPaise: 0,
      equityTargetPaise: 0,
      debtCurrentPaise: 0,
      debtTargetPaise: 0,
      overweightLeg: "none",
      driftPaise: 0,
    };
    assert.equal(driftSeverity(drift), "low");
  });
});
