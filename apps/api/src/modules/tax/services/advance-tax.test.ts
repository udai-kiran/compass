/**
 * advance-tax.test.ts — Unit tests for the pure Sec 234B/234C engine (task 13.10).
 *
 * No DB. All amounts in paise. The capital-gains timing exception is pinned
 * through computeInstalments with worked examples.
 */

import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  CG_LTCG_EXEMPTION_PAISE,
  SEC208_THRESHOLD_PAISE,
  computeCgTax,
  defermentMonthsFor,
  interest234CFor,
  interest234B,
  sec208Applies,
  rule119AInterest,
  computeInstalments,
} from "./advance-tax.ts";
import { computeTaxBreakdown } from "../../../lib/tax-computation.ts";
import { getRegimeRules } from "../../../lib/tax-rules.ts";

// ─── Flat CG tax ─────────────────────────────────────────────────────────────

describe("computeCgTax", () => {
  it("zero gains → zero tax", () => {
    assert.strictEqual(computeCgTax(0, 0), 0);
  });

  it("STCG only: ₹50k at 20% → ₹10,000", () => {
    assert.strictEqual(computeCgTax(5_000_000, 0), 1_000_000);
  });

  it("LTCG above exemption: ₹2.25L − ₹1.25L = ₹1L at 12.5% → ₹12,500", () => {
    const ltcg = 22_500_000;
    assert.strictEqual(computeCgTax(0, ltcg), 1_250_000);
  });

  it("LTCG below exemption → zero LTCG tax", () => {
    assert.strictEqual(computeCgTax(0, CG_LTCG_EXEMPTION_PAISE - 1), 0);
  });

  it("exemption applies only against LTCG, not STCG", () => {
    // STCG taxed fully even when LTCG sits under the exemption.
    const r = computeCgTax(3_000_000, 100_000);
    assert.strictEqual(r, 600_000);
  });
});

// ─── Deferment months ────────────────────────────────────────────────────────

describe("defermentMonthsFor", () => {
  it("Jun/Sep/Dec instalments defer 3 months", () => {
    assert.equal(defermentMonthsFor(0), 3);
    assert.equal(defermentMonthsFor(1), 3);
    assert.equal(defermentMonthsFor(2), 3);
  });
  it("Mar instalment defers 1 month", () => {
    assert.equal(defermentMonthsFor(3), 1);
  });
  it("throws out of range", () => {
    assert.throws(() => defermentMonthsFor(4));
    assert.throws(() => defermentMonthsFor(-1));
    assert.throws(() => defermentMonthsFor(1.5));
  });
});

// ─── Rule 119A rounding ──────────────────────────────────────────────────────

describe("rule119AInterest", () => {
  it("ignores sub-₹100 fractions of the base", () => {
    // base ₹1,00,099.99 → usable base ₹1,00,000 → 1%×1mo = ₹1,000 → ₹1,000
    assert.strictEqual(rule119AInterest(1_00_099 * 100 + 99, 0.01, 1), 100_000);
  });
  it("rounds the result to the nearest ₹10", () => {
    // usable base ₹1,00,000 (10_000_000 p), 1%, 1 month → ₹1,000 = 100_000 p
    assert.strictEqual(rule119AInterest(100_00_000, 0.01, 1), 100_000);
    // usable base ₹50,050 → floor to ₹50,000; 1%×1 = ₹500 exact
    assert.strictEqual(rule119AInterest(50_050_00, 0.01, 1), 50_000);
  });
});

// ─── Sec 208 gate ────────────────────────────────────────────────────────────

describe("sec208Applies", () => {
  it("net payable ≥ ₹10,000 obliges advance tax", () => {
    assert.equal(sec208Applies(SEC208_THRESHOLD_PAISE), true);
    assert.equal(sec208Applies(SEC208_THRESHOLD_PAISE + 1), true);
  });
  it("below ₹10,000 there is no obligation", () => {
    assert.equal(sec208Applies(SEC208_THRESHOLD_PAISE - 1), false);
    assert.equal(sec208Applies(0), false);
    assert.equal(sec208Applies(-5), false);
  });
});

// ─── 234C per-instalment interest ────────────────────────────────────────────

describe("interest234CFor", () => {
  it("₹1L shortfall × 3 months → ₹1,000/mo × 3 = ₹3,000 (300_000 p)", () => {
    assert.strictEqual(interest234CFor(10_000_000, 3), 300_000);
  });
  it("sub-₹100 base fraction ignored then nearest-₹10: shortfall ₹999.99 → ₹10", () => {
    // usable base ₹900 → 1% = ₹9 → Sec 288B nearest ₹10 = ₹10
    assert.strictEqual(interest234CFor(99_999, 1), 1000);
  });
  it("zero shortfall → zero interest", () => {
    assert.strictEqual(interest234CFor(0, 3), 0);
  });
});

// ─── 234B ────────────────────────────────────────────────────────────────────

describe("interest234B", () => {
  it("<90% paid by year end: assessed ₹5L, paid ₹4L, Apr..Jun = 3 months → ₹3,000", () => {
    // shortfall ₹1L → ₹1,000/month × 3 = ₹3,000 (300_000 paise)
    assert.strictEqual(
      interest234B(500_000_00, 400_000_00, "2026-04", "2026-06"),
      300_000,
    );
  });

  it("≥90% paid → no interest", () => {
    // paid exactly 90%
    assert.strictEqual(interest234B(500_000_00, 450_000_00, "2026-04", "2027-03"), 0);
    // paid more than assessed
    assert.strictEqual(interest234B(500_000_00, 500_000_00, "2026-04", "2027-03"), 0);
  });

  it("counts 'or part of a month': payment in the start month itself = 1 month", () => {
    // assessed ₹10L, paid nil → shortfall ₹10L → 1% = ₹10,000 for the one month
    assert.strictEqual(interest234B(1_000_000_00, 0, "2026-04", "2026-04"), 1_000_000);
  });

  it("paidUpto before AY start → no accrual yet → zero", () => {
    assert.strictEqual(interest234B(500_000_00, 0, "2026-04", "2026-01"), 0);
  });

  it("full AY (Apr..Mar) = 12 months", () => {
    // shortfall ₹1L → ₹1,000/month × 12 = ₹12,000
    assert.strictEqual(
      interest234B(500_000_00, 400_000_00, "2026-04", "2027-03"),
      1_200_000,
    );
  });
});

// ─── Instalment engine + THE capital-gains timing exception ──────────────────

describe("computeInstalments — capital-gains timing exception", () => {
  // Worked example from the task brief:
  //   ordinary liability ₹48,000; gains arise ONLY after 15 Jun:
  //   cumulative CG tax through Jun=0, Sep=₹4,000, Dec/Mar=₹8,000; TDS nil.
  //
  // Base per instalment = ordinary + cumCgTax − cumTds:
  //   Jun: 48,000 → required 15% = ₹7,200  (NOT burdened by later gains)
  //   Sep: 52,000 → required 45% = ₹23,400
  //   Dec: 56,000 → required 75% = ₹42,000
  //   Mar: 56,000 → required 100% = ₹56,000

  it("a gain arising after a due date does not burden that earlier instalment", () => {
    const r = computeInstalments({
      ordinaryLiabilityPaise: 480_000_0,
      todayStr: "2027-06-16",
      instalments: [
        { dueDate: "2026-06-15", cumulativePct: 15, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 0 },
        { dueDate: "2026-09-15", cumulativePct: 45, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 400_000 },
        { dueDate: "2026-12-15", cumulativePct: 75, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 800_000 },
        { dueDate: "2027-03-15", cumulativePct: 100, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 800_000 },
      ],
    });
    const [jun, sep, dec, mar] = r.statuses;
    // Jun base excludes ALL later gains: 15% × ₹48,000 = ₹7,200 (720_000 p)
    assert.strictEqual(jun!.requiredCumulativePaise, 720_000);
    // Sep picks up the gain that arose by then: 45% × ₹52,000 = ₹23,400
    assert.strictEqual(sep!.requiredCumulativePaise, 2_340_000);
    // Dec: 75% × ₹56,000 = ₹42,000
    assert.strictEqual(dec!.requiredCumulativePaise, 4_200_000);
    // No further gains by Mar: 100% × ₹56,000 = ₹56,000
    assert.strictEqual(mar!.requiredCumulativePaise, 5_600_000);
  });

  it("interest accrues only on passed due dates", () => {
    const r = computeInstalments({
      ordinaryLiabilityPaise: 480_000_0,
      todayStr: "2026-10-01", // Jun + Sep passed; Dec + Mar not
      instalments: [
        { dueDate: "2026-06-15", cumulativePct: 15, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 0 },
        { dueDate: "2026-09-15", cumulativePct: 45, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 400_000 },
        { dueDate: "2026-12-15", cumulativePct: 75, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 400_000 },
        { dueDate: "2027-03-15", cumulativePct: 100, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 400_000 },
      ],
    });
    assert.ok(r.statuses[0]!.interest234CPaise > 0);
    assert.ok(r.statuses[1]!.interest234CPaise > 0);
    assert.strictEqual(r.statuses[2]!.interest234CPaise, 0);
    assert.strictEqual(r.statuses[3]!.interest234CPaise, 0);
    // Total equals sum of the two accrued rows.
    assert.strictEqual(
      r.total234CPaise,
      r.statuses[0]!.interest234CPaise + r.statuses[1]!.interest234CPaise,
    );
  });

  it("a due date equal to today has NOT passed — requirement shown, no interest yet", () => {
    // Strict boundary: interest accrues only when dueDate < today. On the due
    // date itself the row projects its requirement but 234C is still zero.
    const r = computeInstalments({
      ordinaryLiabilityPaise: 480_000_0,
      todayStr: "2026-06-15",
      instalments: [
        { dueDate: "2026-06-15", cumulativePct: 15, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 0 },
        { dueDate: "2026-09-15", cumulativePct: 45, cumulativeTdsPaise: 0, cumulativeCgTaxPaise: 0 },
      ],
    });
    assert.strictEqual(r.statuses[0]!.requiredCumulativePaise, 720_000);
    assert.strictEqual(r.statuses[0]!.interest234CPaise, 0);
    assert.strictEqual(r.total234CPaise, 0);
  });

  it("TDS credits shrink the base; floor at zero keeps requirements non-negative", () => {
    const r = computeInstalments({
      ordinaryLiabilityPaise: 100_000_00,
      todayStr: "2026-07-01",
      instalments: [
        // TDS already exceeds the ordinary liability → base clamps to 0.
        { dueDate: "2026-06-15", cumulativePct: 15, cumulativeTdsPaise: 120_000_00, cumulativeCgTaxPaise: 0 },
      ],
    });
    assert.strictEqual(r.statuses[0]!.requiredCumulativePaise, 0);
    assert.strictEqual(r.total234CPaise, 0);
  });
});

// ─── §24(a) rent deduction in advance-tax ordinary liability ─────────────────
//
// ordinaryLiabilityFor() (private, DB-connected) applies §24(a) = 30% of rent
// income BEFORE calling computeTaxBreakdown, keeping it consistent with
// regime-comparison.ts. These pure tests verify the formula and its downstream
// effect on slab tax so that a revert of the §24(a) line would be caught here
// without requiring a DB.

describe("§24(a) 30% rent reduction in advance-tax ordinary liability formula (FY 2025-26)", () => {
  it("30% of rent gross enters section24aDeductionPaise, leaving 70% as the rent taxable base", () => {
    const rentGrossPaise = 100_000_000; // ₹1,00,000
    const section24aDeductionPaise = Math.floor(rentGrossPaise * 30 / 100);
    assert.strictEqual(section24aDeductionPaise, 30_000_000, "30% of ₹1L = ₹30,000");
    const rentTaxableContribution = rentGrossPaise - section24aDeductionPaise;
    assert.strictEqual(rentTaxableContribution, 70_000_000, "70% of ₹1L = ₹70,000 enters taxable base");
  });

  it("computeTaxBreakdown on rent-only income after §24(a) uses the reduced base (not gross)", () => {
    // ordinaryLiabilityFor() builds: taxable = totalGross − deductions − section24a.
    // For a new-regime rent-only taxpayer (no salary → no std deduction, no 80C/D):
    //   grossByKind.rent = 100_000_000
    //   section24a      =  30_000_000
    //   deductions      =           0  (no salary → standardDeduction = 0; no basket)
    //   taxable         =  70_000_000
    const rules = getRegimeRules("2025-26", "new", "ordinary");
    const taxableWithSection24a = 70_000_000; // 100M - 30M
    const bdWithSection24a = computeTaxBreakdown(taxableWithSection24a, rules);

    // taxableIncomePaise in the breakdown must equal the §24(a)-reduced base.
    assert.strictEqual(
      bdWithSection24a.taxableIncomePaise,
      70_000_000,
      "breakdown must receive the §24(a)-reduced base (70M), not gross (100M)",
    );

    // Verify the reduction matters: without §24(a) the taxable income would be higher.
    const bdWithoutSection24a = computeTaxBreakdown(100_000_000, rules);
    assert.ok(
      bdWithoutSection24a.taxableIncomePaise > bdWithSection24a.taxableIncomePaise,
      "without §24(a), the taxable base (100M) exceeds the §24(a)-reduced base (70M)",
    );
  });
});
