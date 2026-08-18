import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { leverTitle, leverSummary } from "./allocation-view.ts";
import type { AdequacyLever } from "@compass/shared";

describe("leverTitle", () => {
  it('returns "Extend timeline" for extend_timeline', () => {
    const lever: AdequacyLever = { type: "extend_timeline", perGoal: [] };
    assert.equal(leverTitle(lever), "Extend timeline");
  });

  it('returns "Reduce target amount" for reduce_target', () => {
    const lever: AdequacyLever = { type: "reduce_target", perGoal: [] };
    assert.equal(leverTitle(lever), "Reduce target amount");
  });

  it('returns "Cut monthly expenses" for cut_expenses', () => {
    const lever: AdequacyLever = {
      type: "cut_expenses",
      requiredMonthlyReductionPaise: 500000,
      opportunities: [],
    };
    assert.equal(leverTitle(lever), "Cut monthly expenses");
  });

  it('returns "Increase income" for increase_income', () => {
    const lever: AdequacyLever = {
      type: "increase_income",
      requiredMonthlyIncreasePaise: 300000,
      pctOfCurrentIncome: 15,
    };
    assert.equal(leverTitle(lever), "Increase income");
  });
});

describe("leverSummary", () => {
  it('returns "on track" message when no goals have slipMonths > 0', () => {
    const lever: AdequacyLever = {
      type: "extend_timeline",
      perGoal: [
        { goalId: "g1", goalName: "Retirement", originalMonthsToTarget: 120, newMonthsToTarget: 120, slipMonths: 0 },
      ],
    };
    assert.equal(leverSummary(lever), "Goals are on track with the current timeline.");
  });

  it("returns correct plural message when 2 goals have slipMonths > 0", () => {
    const lever: AdequacyLever = {
      type: "extend_timeline",
      perGoal: [
        { goalId: "g1", goalName: "Home", originalMonthsToTarget: 60, newMonthsToTarget: 72, slipMonths: 12 },
        { goalId: "g2", goalName: "Education", originalMonthsToTarget: 48, newMonthsToTarget: 60, slipMonths: 12 },
      ],
    };
    assert.equal(leverSummary(lever), "2 goals need a later target date.");
  });

  it("returns correct singular message when 1 goal has slipMonths > 0", () => {
    const lever: AdequacyLever = {
      type: "extend_timeline",
      perGoal: [
        { goalId: "g1", goalName: "Home", originalMonthsToTarget: 60, newMonthsToTarget: 72, slipMonths: 12 },
      ],
    };
    assert.equal(leverSummary(lever), "1 goal needs a later target date.");
  });

  it("contains the pct value for increase_income lever", () => {
    const lever: AdequacyLever = {
      type: "increase_income",
      requiredMonthlyIncreasePaise: 500000,
      pctOfCurrentIncome: 20,
    };
    assert.ok(leverSummary(lever).includes("20%"));
  });

  it("returns unreachable message when 1 goal has slipMonths: null", () => {
    const lever: AdequacyLever = {
      type: "extend_timeline",
      perGoal: [
        { goalId: "g1", goalName: "Retirement", originalMonthsToTarget: 120, newMonthsToTarget: 120, slipMonths: null },
      ],
    };
    assert.ok(leverSummary(lever).includes("unreachable"));
  });

  it("returns unreachable message (priority) when 1 goal has slipMonths: null and 1 has slipMonths: 3", () => {
    const lever: AdequacyLever = {
      type: "extend_timeline",
      perGoal: [
        { goalId: "g1", goalName: "Home", originalMonthsToTarget: 60, newMonthsToTarget: 63, slipMonths: 3 },
        { goalId: "g2", goalName: "Emergency", originalMonthsToTarget: 24, newMonthsToTarget: 24, slipMonths: null },
      ],
    };
    assert.ok(leverSummary(lever).includes("unreachable"));
  });
});
