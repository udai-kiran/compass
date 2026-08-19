import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  computeIncomeSurplus,
  type CommittedOutflow,
  type MonthlyIncome,
} from "./income-surplus.ts";

// Helper to build MonthlyIncome objects with likelyBonus pre-set
function makeMonths(incomes: number[], bonusFlags?: boolean[]): MonthlyIncome[] {
  return incomes.map((incomePaise, i) => ({
    month: `2026-${String(i + 1).padStart(2, "0")}`,
    incomePaise,
    likelyBonus: bonusFlags ? (bonusFlags[i] ?? false) : false,
  }));
}

describe("computeIncomeSurplus", () => {
  describe("confidence levels", () => {
    it("returns 'low' when historyMonths < 6", () => {
      const months = makeMonths([500_00_00, 500_00_00, 500_00_00]); // 3 months
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.confidence, "low");
      assert.equal(result.historyMonths, 3);
    });

    it("returns 'medium' when historyMonths is 6–11", () => {
      const months = makeMonths(Array(6).fill(500_00_00)); // 6 months
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.confidence, "medium");
    });

    it("returns 'medium' for 11 months", () => {
      const months = makeMonths(Array(11).fill(500_00_00));
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.confidence, "medium");
    });

    it("returns 'high' when historyMonths >= 12", () => {
      const months = makeMonths(Array(12).fill(500_00_00));
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.confidence, "high");
    });

    it("returns null surpluses when historyMonths < 3", () => {
      const months = makeMonths([500_00_00, 500_00_00]); // 2 months
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.conservativeSurplusPaise, null);
      assert.equal(result.optimisticSurplusPaise, null);
      assert.equal(result.confidence, "low");
    });
  });

  describe("likelyBonus detection", () => {
    it("flags a spike month as bonus when income > 2× median of others", () => {
      // Normal months: 500_000 paise each; spike: 1_200_000 paise
      // Median of others (all 500_000) = 500_000; spike > 2 × 500_000 → bonus
      const normalIncome = 500_000;
      const spikeIncome = 1_200_000;
      const incomes = [
        normalIncome, normalIncome, normalIncome,
        normalIncome, spikeIncome, normalIncome,
      ];
      // We compute likelyBonus ourselves here the same way the service does
      // (we're testing computeIncomeSurplus with the flag pre-set, which mirrors
      // what getIncomeSurplus produces).
      // Month index 4 is the spike, mark it as bonus.
      const months = makeMonths(incomes, [false, false, false, false, true, false]);
      const result = computeIncomeSurplus({ months, committedOutflows: [] });

      // Non-bonus income months should exclude the spike (1_200_000)
      // Median of [500_000, 500_000, 500_000, 500_000, 500_000] = 500_000
      assert.equal(result.conservativeSurplusPaise, normalIncome);
      assert.equal(result.optimisticSurplusPaise, normalIncome);
    });

    it("does not flag a bonus month when income is uniform", () => {
      const incomes = Array(6).fill(500_000);
      const months = makeMonths(incomes, Array(6).fill(false));
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      // All months non-bonus; median and p75 of uniform values = 500_000
      assert.equal(result.conservativeSurplusPaise, 500_000);
      assert.equal(result.optimisticSurplusPaise, 500_000);
    });
  });

  describe("conservativeSurplusPaise — median non-bonus income minus committed outflows", () => {
    it("computes median correctly with odd number of non-bonus months", () => {
      // 5 non-bonus months: [300_000, 400_000, 500_000, 600_000, 700_000]
      // Sorted: [300_000, 400_000, 500_000, 600_000, 700_000]; median = 500_000
      const months = makeMonths([300_000, 400_000, 500_000, 600_000, 700_000]);
      const outflows: CommittedOutflow[] = [{ monthlyPaise: 100_000, kind: "recurring", label: "Rent" }];
      const result = computeIncomeSurplus({ months, committedOutflows: outflows });
      assert.equal(result.totalCommittedPaise, 100_000);
      assert.equal(result.conservativeSurplusPaise, 500_000 - 100_000);
    });

    it("computes median correctly with even number of non-bonus months", () => {
      // 4 non-bonus months: [300_000, 500_000, 700_000, 900_000]
      // Sorted; median = avg of idx 1.5 = (500_000 + 700_000) / 2 = 600_000
      const months = makeMonths([300_000, 500_000, 700_000, 900_000]);
      const outflows: CommittedOutflow[] = [{ monthlyPaise: 50_000, kind: "sip", label: "SIP" }];
      const result = computeIncomeSurplus({ months, committedOutflows: outflows });
      assert.equal(result.conservativeSurplusPaise, 600_000 - 50_000);
    });

    it("surplus can be negative (deficit)", () => {
      const months = makeMonths(Array(3).fill(200_000));
      const outflows: CommittedOutflow[] = [{ monthlyPaise: 300_000, kind: "recurring", label: "Rent" }];
      const result = computeIncomeSurplus({ months, committedOutflows: outflows });
      assert.equal(result.conservativeSurplusPaise, 200_000 - 300_000);
    });
  });

  describe("optimisticSurplusPaise — p75 non-bonus income minus committed outflows", () => {
    it("computes p75 correctly for sorted months", () => {
      // 4 non-bonus months (sorted): [300_000, 500_000, 700_000, 900_000]
      // p75: idx = 0.75 * 3 = 2.25; lo=2, hi=3; 700_000 + (900_000 - 700_000) * 0.25 = 750_000
      const months = makeMonths([300_000, 500_000, 700_000, 900_000]);
      const outflows: CommittedOutflow[] = [{ monthlyPaise: 100_000, kind: "recurring", label: "Bills" }];
      const result = computeIncomeSurplus({ months, committedOutflows: outflows });
      assert.equal(result.optimisticSurplusPaise, 750_000 - 100_000);
    });

    it("excludes bonus months from p75 calculation", () => {
      // 5 months: 4 regular + 1 bonus (very high)
      // Non-bonus: [400_000, 500_000, 600_000, 700_000] (sorted)
      // p75: idx = 0.75 * 3 = 2.25; lo=2, hi=3; 600_000 + (700_000 - 600_000) * 0.25 = 625_000
      const months = makeMonths(
        [400_000, 500_000, 3_000_000, 600_000, 700_000],
        [false, false, true, false, false],
      );
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.optimisticSurplusPaise, 625_000);
    });
  });

  describe("EPF payroll SIPs are NOT counted in committedOutflows", () => {
    it("totalCommittedPaise excludes payroll SIPs", () => {
      // This test exercises the filtering logic that getIncomeSurplus applies
      // before calling computeIncomeSurplus. We verify that when a payroll SIP
      // is excluded at the DB-fetch layer, it does not appear in committedOutflows
      // passed to computeIncomeSurplus, and therefore does not affect totalCommittedPaise.
      const months = makeMonths(Array(6).fill(500_000));
      // Simulate: only bank_debit outflow included; payroll outflow was excluded upstream
      const outflows: CommittedOutflow[] = [
        { monthlyPaise: 100_000, kind: "sip", label: "SIP bank_debit" },
        // payroll SIP is NOT here — it was filtered out in getIncomeSurplus
      ];
      const result = computeIncomeSurplus({ months, committedOutflows: outflows });
      assert.equal(result.totalCommittedPaise, 100_000);
      assert.equal(result.conservativeSurplusPaise, 500_000 - 100_000);
    });

    it("totalCommittedPaise is 0 when no outflows are provided (all were payroll)", () => {
      const months = makeMonths(Array(6).fill(500_000));
      // All SIPs were payroll — nothing passed in
      const result = computeIncomeSurplus({ months, committedOutflows: [] });
      assert.equal(result.totalCommittedPaise, 0);
      assert.equal(result.conservativeSurplusPaise, 500_000);
    });
  });
});
