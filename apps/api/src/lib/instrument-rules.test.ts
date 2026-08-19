import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  getInstrumentRule,
  listSuitableCategories,
  type InstrumentCategory,
} from "./instrument-rules.ts";

describe("getInstrumentRule", () => {
  it("elss on 2024-07-22 → ltcgRatePct 10 (pre-Budget 2024 epoch)", () => {
    const rule = getInstrumentRule("elss", new Date("2024-07-22"));
    assert.equal(rule.tax.ltcgRatePct, 10);
  });

  it("elss on 2024-07-23 → ltcgRatePct 12.5 (post-Budget 2024 epoch)", () => {
    const rule = getInstrumentRule("elss", new Date("2024-07-23"));
    assert.equal(rule.tax.ltcgRatePct, 12.5);
  });

  it("debt_mf on 2023-03-31 → gainsAsIncome false (pre-Finance Act 2023)", () => {
    const rule = getInstrumentRule("debt_mf", new Date("2023-03-31"));
    assert.equal(rule.tax.gainsAsIncome, false);
  });

  it("debt_mf on 2023-04-01 → gainsAsIncome true (post-Finance Act 2023)", () => {
    const rule = getInstrumentRule("debt_mf", new Date("2023-04-01"));
    assert.equal(rule.tax.gainsAsIncome, true);
  });

  it("ppf on 2025-01-01 → maturityExempt true", () => {
    const rule = getInstrumentRule("ppf", new Date("2025-01-01"));
    assert.equal(rule.tax.maturityExempt, true);
  });

  it("throws when no epoch matches (liquid_mf before 1900-01-01)", () => {
    assert.throws(
      () =>
        getInstrumentRule(
          "liquid_mf" as InstrumentCategory,
          new Date("1800-01-01"),
        ),
      (err: unknown) => {
        assert.ok(err instanceof Error);
        assert.ok(err.message.includes("liquid_mf"));
        return true;
      },
    );
  });
});

describe("listSuitableCategories", () => {
  it("equity horizon 24 months on 2025-01-01 → elss excluded (lockIn 36 > 24)", () => {
    const result = listSuitableCategories("equity", 24, new Date("2025-01-01"));
    assert.ok(!result.includes("elss"), `elss should not be in [${result.join(", ")}]`);
    // equity instruments with no lockIn should still be present
    assert.ok(result.includes("equity_mf"), "equity_mf should be included");
  });

  it("equity horizon 48 months on 2025-01-01 → elss included (lockIn 36 ≤ 48)", () => {
    const result = listSuitableCategories("equity", 48, new Date("2025-01-01"));
    assert.ok(result.includes("elss"), `elss should be in [${result.join(", ")}]`);
  });

  it("debt horizon 6 months on 2025-01-01 → liquid_mf included; ppf excluded (lockIn 180 > 6)", () => {
    const result = listSuitableCategories("debt", 6, new Date("2025-01-01"));
    assert.ok(result.includes("liquid_mf"), `liquid_mf should be in [${result.join(", ")}]`);
    assert.ok(!result.includes("ppf"), `ppf should not be in [${result.join(", ")}]`);
  });

  it("each category appears at most once (no duplicates from two epochs)", () => {
    const result = listSuitableCategories("equity", 120, new Date("2025-01-01"));
    const unique = new Set(result);
    assert.equal(
      result.length,
      unique.size,
      `duplicates found: [${result.join(", ")}]`,
    );
  });
});
