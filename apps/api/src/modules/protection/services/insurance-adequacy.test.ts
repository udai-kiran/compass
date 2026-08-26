/**
 * Tests for the insurance adequacy pure computation (task 14.2).
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeInsuranceAdequacy } from "./insurance-adequacy.ts";
import type { AdequacyInput } from "./insurance-adequacy.ts";

const TODAY = "2026-08-26";

/** Build a minimal valid input, overrideable per test. */
function baseInput(overrides: Partial<AdequacyInput> = {}): AdequacyInput {
  return {
    annualIncomePaise: 120_000_00, // ₹12 lakh/year
    dependents: [],
    outstandingLiabilitiesPaise: 0,
    liquidAssetsPaise: 0,
    lifePolicies: [],
    healthPolicies: [],
    today: TODAY,
    assumptions: {
      incomeReplacementYears: 15,
      medicalInflationBps: 1200,
      healthProjectionYears: 10,
    },
    ...overrides,
  };
}

describe("computeInsuranceAdequacy", () => {
  describe("term-life gap computation", () => {
    it("computes gap correctly with income, liabilities, existing cover", () => {
      // Annual income: ₹10L = 10,00,000 rupees = 100_000_000 paise
      // Liabilities: ₹50L = 50,00,000 rupees = 500_000_000 paise
      // Liquid assets: ₹10L = 10,00,000 rupees = 100_000_000 paise
      // Existing cover: ₹1Cr = 1,00,00,000 rupees = 1_000_000_000 paise
      const input = baseInput({
        annualIncomePaise: 100_000_000, // ₹10L/year
        outstandingLiabilitiesPaise: 500_000_000, // ₹50L loan
        liquidAssetsPaise: 100_000_000, // ₹10L liquid
        lifePolicies: [
          { sumAssuredPaise: 1_000_000_000, ownership: "personal", archived: false }, // ₹1Cr personal
        ],
        assumptions: { incomeReplacementYears: 15, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const report = computeInsuranceAdequacy(input);
      const { termLife } = report;

      // income replacement = 10L × 15 = 1.5Cr = 1_500_000_000
      assert.equal(termLife.incomeReplacementNeedPaise, 100_000_000 * 15);
      // total need = 1.5Cr + 50L - 10L = 1.9Cr = 1_900_000_000 (floored at 0)
      const expectedNeed = 100_000_000 * 15 + 500_000_000 - 100_000_000;
      assert.equal(termLife.totalNeedPaise, expectedNeed);
      // gap = 1.9Cr - 1Cr = 0.9Cr = 900_000_000 (positive means underinsured)
      assert.equal(termLife.gapPaise, expectedNeed - 1_000_000_000);
      assert.equal(termLife.verdict, "underinsured");
    });

    it("reports adequate when cover exceeds need", () => {
      // Annual income: ₹5L = 5,00,000 rupees = 50_000_000 paise (5×10^7)
      // Cover: ₹1Cr = 1,00,00,000 rupees = 1_000_000_000 paise
      const input = baseInput({
        annualIncomePaise: 50_000_000, // ₹5L/year
        outstandingLiabilitiesPaise: 0,
        liquidAssetsPaise: 0,
        lifePolicies: [
          { sumAssuredPaise: 1_000_000_000, ownership: "personal", archived: false }, // ₹1Cr
        ],
        assumptions: { incomeReplacementYears: 15, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const report = computeInsuranceAdequacy(input);
      // total need = 5L × 15 = 75L = 750_000_000 < 1Cr cover → adequate
      assert.equal(report.termLife.verdict, "adequate");
      assert.equal(report.termLife.gapPaise, 0);
    });

    it("shows workings: annualIncome, dependents, liabilities, liquidAssets, existingCover", () => {
      const input = baseInput({
        annualIncomePaise: 80_000_000, // ₹8L/year
        outstandingLiabilitiesPaise: 300_000_000, // ₹30L
        liquidAssetsPaise: 50_000_000, // ₹5L
        lifePolicies: [
          { sumAssuredPaise: 500_000_000, ownership: "personal", archived: false }, // ₹50L
        ],
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.annualIncomePaise, 80_000_000);
      assert.equal(termLife.outstandingLiabilitiesPaise, 300_000_000);
      assert.equal(termLife.liquidAssetsPaise, 50_000_000);
      assert.equal(termLife.existingCoverPaise, 500_000_000);
    });

    it("excludes archived life policies from existing cover", () => {
      const input = baseInput({
        lifePolicies: [
          { sumAssuredPaise: 1_000_000_000, ownership: "personal", archived: true }, // archived ₹1Cr
          { sumAssuredPaise: 250_000_000, ownership: "personal", archived: false }, // ₹25L
        ],
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.existingCoverPaise, 250_000_000); // only non-archived
    });

    it("separates employer life cover from personal cover", () => {
      const input = baseInput({
        lifePolicies: [
          { sumAssuredPaise: 500_000_000, ownership: "personal", archived: false }, // ₹50L
          { sumAssuredPaise: 300_000_000, ownership: "employer", archived: false }, // ₹30L
        ],
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.existingCoverPaise, 500_000_000);
      assert.equal(termLife.employerCoverPaise, 300_000_000);
    });

    it("floors totalNeed at 0 when liquid assets exceed replacement need + liabilities", () => {
      const input = baseInput({
        annualIncomePaise: 10_000_000, // ₹1L/year
        outstandingLiabilitiesPaise: 0,
        liquidAssetsPaise: 500_000_000, // ₹50L — vastly more than need
        lifePolicies: [],
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.totalNeedPaise, 0);
      assert.equal(termLife.gapPaise, 0);
      assert.equal(termLife.verdict, "adequate");
    });
  });

  describe("dependents and dependency years", () => {
    it("uses child's age from DOB to compute years until 25", () => {
      // Child born 2010-08-26 → age 16 today (2026-08-26) → 25-16 = 9 years remaining
      const input = baseInput({
        dependents: [
          {
            id: "d1",
            name: "Child",
            relationship: "child",
            dateOfBirth: "2010-08-26",
            educationStage: null,
          },
        ],
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.dependents.length, 1);
      assert.equal(termLife.dependents[0]!.age, 16);
      assert.equal(termLife.dependents[0]!.dependencyYearsRemaining, 9);
    });

    it("uses education stage for child without DOB", () => {
      const testCases: Array<{ stage: string; expected: number }> = [
        { stage: "preschool", expected: 18 },
        { stage: "primary", expected: 18 },
        { stage: "secondary", expected: 10 },
        { stage: "senior_secondary", expected: 6 },
        { stage: "undergraduate", expected: 4 },
        { stage: "postgraduate", expected: 2 },
        { stage: "doctorate", expected: 2 },
        { stage: "other", expected: 5 },
      ];

      for (const { stage, expected } of testCases) {
        const input = baseInput({
          dependents: [
            {
              id: "d1",
              name: "Child",
              relationship: "child",
              dateOfBirth: null,
              educationStage: stage,
            },
          ],
        });
        const { termLife } = computeInsuranceAdequacy(input);
        assert.equal(
          termLife.dependents[0]!.dependencyYearsRemaining,
          expected,
          `Education stage '${stage}' should give ${expected} dependency years`,
        );
      }
    });

    it("gives spouse incomeReplacementYears dependency", () => {
      const input = baseInput({
        dependents: [
          {
            id: "d1",
            name: "Spouse",
            relationship: "spouse",
            dateOfBirth: null,
            educationStage: null,
          },
        ],
        assumptions: { incomeReplacementYears: 20, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.dependents[0]!.dependencyYearsRemaining, 20);
    });

    it("gives parent 15 dependency years", () => {
      const input = baseInput({
        dependents: [
          {
            id: "d1",
            name: "Father",
            relationship: "parent",
            dateOfBirth: null,
            educationStage: null,
          },
        ],
      });

      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.dependents[0]!.dependencyYearsRemaining, 15);
    });

    it("uses the maximum dependency years across all dependents", () => {
      // Spouse → 15 years, Child born 2021 → age 5 → 20 years remaining
      // Max = 20 > default 15
      const input = baseInput({
        annualIncomePaise: 100_000_00,
        dependents: [
          { id: "d1", name: "Spouse", relationship: "spouse", dateOfBirth: null, educationStage: null },
          { id: "d2", name: "Child", relationship: "child", dateOfBirth: "2021-08-26", educationStage: null },
        ],
        assumptions: { incomeReplacementYears: 15, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const { termLife } = computeInsuranceAdequacy(input);
      // Child is 5 → 20 years remaining → max(15 spouse, 20 child) = 20
      assert.equal(termLife.assumptions.incomeReplacementYears, 20);
      assert.equal(termLife.incomeReplacementNeedPaise, 100_000_00 * 20);
    });
  });

  describe("health cover assessment", () => {
    it("computes total cover from active indemnity/top_up policies only", () => {
      // ₹5L each indemnity and top_up; ₹20L critical illness (not counted)
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 500_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 500_000_00, ownership: "personal", healthType: "top_up", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          // critical illness shouldn't be counted in total cover
          { sumAssuredPaise: 2_000_000_00, ownership: "personal", healthType: "critical_illness", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { health } = computeInsuranceAdequacy(input);
      assert.equal(health.totalCoverPaise, 1_000_000_00); // ₹5L + ₹5L = ₹10L
    });

    it("applies medical inflation to project future cover value", () => {
      // ₹10L cover at 12% inflation over 10 years
      // projected = 10L / (1.12)^10
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 10_00_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          // add these to avoid gap-detection noise in verdict
          { sumAssuredPaise: 1_00_000_00, ownership: "personal", healthType: "personal_accident", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 1_00_000_00, ownership: "personal", healthType: "critical_illness", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
        assumptions: { incomeReplacementYears: 15, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const { health } = computeInsuranceAdequacy(input);
      const expected = Math.round(10_00_000_00 / Math.pow(1.12, 10));
      assert.equal(health.projectedCoverPaise, expected);
    });

    it("flags employer-only health cover as a continuity risk", () => {
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 5_00_000_00, ownership: "employer", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { health } = computeInsuranceAdequacy(input);
      assert.equal(health.employerOnlyCoverPaise, 5_00_000_00);
      const employerGap = health.gaps.find((g) => g.type === "employer_only_health");
      assert.ok(employerGap, "Should flag employer-only health cover as a gap");
    });

    it("reduces usable cover by deductible and co-pay", () => {
      // ₹10L sum insured, ₹50K deductible, 20% co-pay
      // usable = (10L - 50K) * (1 - 0.20) = 9.5L * 0.8 = 7.6L
      const input = baseInput({
        healthPolicies: [
          {
            sumAssuredPaise: 10_00_000_00,
            ownership: "personal",
            healthType: "indemnity",
            deductiblePaise: 50_000_00,
            coPayBps: 2000, // 20%
            roomRentLimitPaise: null,
            roomRentLimitBps: null,
            archived: false,
          },
          // suppress other gaps
          { sumAssuredPaise: 1_00_000_00, ownership: "personal", healthType: "personal_accident", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 1_00_000_00, ownership: "personal", healthType: "critical_illness", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { health } = computeInsuranceAdequacy(input);
      const afterDeductible = 10_00_000_00 - 50_000_00;
      const expected = Math.round(afterDeductible * (1 - 2000 / 10000));
      assert.equal(health.usableCoverPaise, expected);
    });

    it("applies 20% room-rent reduction when a cap exists", () => {
      const input = baseInput({
        healthPolicies: [
          {
            sumAssuredPaise: 10_00_000_00,
            ownership: "personal",
            healthType: "indemnity",
            deductiblePaise: null,
            coPayBps: null,
            roomRentLimitPaise: null,
            roomRentLimitBps: 100, // 1%/day cap
            archived: false,
          },
        ],
      });

      const { health } = computeInsuranceAdequacy(input);
      assert.equal(health.usableCoverPaise, Math.round(10_00_000_00 * 0.8));
    });

    it("reports adequate when cover is sufficient and all types present", () => {
      // ₹25L cover, no employer-only, both CI and PA present
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 25_00_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 5_00_000_00, ownership: "personal", healthType: "personal_accident", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 5_00_000_00, ownership: "personal", healthType: "critical_illness", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
        assumptions: { incomeReplacementYears: 15, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const { health } = computeInsuranceAdequacy(input);
      // projected = 25L / (1.12)^10 — still above 5L min → should be adequate with no gaps
      assert.equal(health.gaps.length, 0, `Expected no gaps, got: ${JSON.stringify(health.gaps)}`);
      assert.equal(health.verdict, "adequate");
    });

    it("returns insufficient_data when no health policies exist", () => {
      const input = baseInput({ healthPolicies: [] });
      const { health } = computeInsuranceAdequacy(input);
      assert.equal(health.verdict, "insufficient_data");
      assert.equal(health.totalCoverPaise, 0);
    });
  });

  describe("suggestions", () => {
    it("suggests term life cover for the gap amount", () => {
      const input = baseInput({
        annualIncomePaise: 100_000_00,
        outstandingLiabilitiesPaise: 0,
        liquidAssetsPaise: 0,
        lifePolicies: [], // no existing cover
        healthPolicies: [
          { sumAssuredPaise: 10_00_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 1_00_000_00, ownership: "personal", healthType: "personal_accident", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 1_00_000_00, ownership: "personal", healthType: "critical_illness", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { suggestions, termLife } = computeInsuranceAdequacy(input);
      const termSuggestion = suggestions.find((s) => s.coverType === "Term life insurance");
      assert.ok(termSuggestion, "Should suggest term life insurance");
      assert.equal(termSuggestion!.suggestedAmountPaise, termLife.gapPaise);
      // Must not mention an insurer or product name
      assert.ok(
        !termSuggestion!.rationale.match(/\b(LIC|HDFC|Max Life|ICICI|Bajaj|SBI Life|Kotak)\b/i),
        "Suggestion must not name an insurer",
      );
    });

    it("suggests personal accident cover when missing", () => {
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 10_00_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          // no personal_accident
          { sumAssuredPaise: 5_00_000_00, ownership: "personal", healthType: "critical_illness", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { suggestions } = computeInsuranceAdequacy(input);
      const paSuggestion = suggestions.find((s) => s.coverType === "Personal accident cover");
      assert.ok(paSuggestion, "Should suggest personal accident cover");
    });

    it("suggests critical illness cover when missing", () => {
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 10_00_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 5_00_000_00, ownership: "personal", healthType: "personal_accident", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          // no critical_illness
        ],
      });

      const { suggestions } = computeInsuranceAdequacy(input);
      const ciSuggestion = suggestions.find((s) => s.coverType === "Critical illness cover");
      assert.ok(ciSuggestion, "Should suggest critical illness cover");
    });

    it("suggests personal health insurance when only employer health exists", () => {
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 5_00_000_00, ownership: "employer", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { suggestions } = computeInsuranceAdequacy(input);
      const healthSuggestion = suggestions.find((s) => s.coverType === "Personal health insurance");
      assert.ok(healthSuggestion, "Should suggest personal health insurance to replace employer dependency");
    });

    it("does not suggest personal health insurance when personal health policy exists alongside employer", () => {
      const input = baseInput({
        healthPolicies: [
          { sumAssuredPaise: 5_00_000_00, ownership: "personal", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
          { sumAssuredPaise: 5_00_000_00, ownership: "employer", healthType: "indemnity", deductiblePaise: null, coPayBps: null, roomRentLimitPaise: null, roomRentLimitBps: null, archived: false },
        ],
      });

      const { suggestions } = computeInsuranceAdequacy(input);
      const healthSuggestion = suggestions.find((s) => s.coverType === "Personal health insurance");
      assert.equal(healthSuggestion, undefined, "Should NOT suggest personal health insurance when personal policy exists");
    });
  });

  describe("graceful degradation", () => {
    it("returns insufficient_data verdict when no income data is available", () => {
      const input = baseInput({ annualIncomePaise: null });
      const { termLife } = computeInsuranceAdequacy(input);
      assert.equal(termLife.verdict, "insufficient_data");
      assert.equal(termLife.annualIncomePaise, null);
      assert.equal(termLife.gapPaise, 0);
      assert.equal(termLife.incomeReplacementNeedPaise, 0);
    });

    it("still computes with no dependents (uses default years)", () => {
      const input = baseInput({
        annualIncomePaise: 100_000_00,
        dependents: [],
        lifePolicies: [],
        assumptions: { incomeReplacementYears: 15, medicalInflationBps: 1200, healthProjectionYears: 10 },
      });

      const { termLife } = computeInsuranceAdequacy(input);
      // No dependents → uses default incomeReplacementYears = 15
      assert.equal(termLife.assumptions.incomeReplacementYears, 15);
      assert.equal(termLife.incomeReplacementNeedPaise, 100_000_00 * 15);
      // No cover → underinsured
      assert.equal(termLife.verdict, "underinsured");
    });

    it("all fields present in output even with minimal input", () => {
      const input = baseInput({ annualIncomePaise: null, dependents: [], lifePolicies: [], healthPolicies: [] });
      const report = computeInsuranceAdequacy(input);
      assert.ok("termLife" in report);
      assert.ok("health" in report);
      assert.ok("suggestions" in report);
      assert.ok("dependents" in report.termLife);
      assert.ok("gaps" in report.health);
    });
  });
});
