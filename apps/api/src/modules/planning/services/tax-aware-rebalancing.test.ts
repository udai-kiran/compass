import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildTaxAwareRebalancingPlan,
  LTCG_ANNUAL_EXEMPTION_PAISE,
  type SwitchGainData,
} from "./tax-aware-rebalancing.ts";
import type { RebalancingPlan } from "./rebalancing-plan.ts";

// ---------------------------------------------------------------------------
// Test helpers
// ---------------------------------------------------------------------------

function makePlan(overrides: Partial<RebalancingPlan> = {}): RebalancingPlan {
  return {
    drift: {
      equityCurrentPaise: 60_00_00_000,
      equityTargetPaise: 50_00_00_000,
      debtCurrentPaise: 40_00_00_000,
      debtTargetPaise: 50_00_00_000,
      overweightLeg: "equity",
      driftPaise: 10_00_00_000,
    },
    actions: [
      {
        type: "switch_corpus",
        fromLeg: "equity",
        toLeg: "debt",
        amountPaise: 10_00_00_000,
      },
    ],
    deRiskingSchedule: [],
    ...overrides,
  };
}

function makeGainData(overrides: Partial<SwitchGainData> = {}): SwitchGainData {
  return {
    estimatedLtcgPaise: 0,
    estimatedStcgPaise: 0,
    estimatedExemptPaise: 0,
    earliestStcgFlipDate: null,
    lockedCategories: [],
    ...overrides,
  };
}

// A fixed reference date so tests are deterministic
const REF_DATE = new Date("2026-08-18");

// ---------------------------------------------------------------------------
// Test 11 (constant): LTCG_ANNUAL_EXEMPTION_PAISE exported constant
// ---------------------------------------------------------------------------

test("LTCG_ANNUAL_EXEMPTION_PAISE equals 1_25_00_000", () => {
  assert.equal(LTCG_ANNUAL_EXEMPTION_PAISE, 1_25_00_000);
});

// ---------------------------------------------------------------------------
// Test 1: no switches in plan
// ---------------------------------------------------------------------------

test("no switches in plan: switchAnnotations=[], ltcgHeadroomPaise=LTCG_ANNUAL_EXEMPTION_PAISE", () => {
  const plan = makePlan({ actions: [], drift: { ...makePlan().drift, overweightLeg: "none", driftPaise: 0 } });
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  assert.deepEqual(result.switchAnnotations, []);
  assert.equal(result.ltcgHeadroomPaise, LTCG_ANNUAL_EXEMPTION_PAISE);
});

// ---------------------------------------------------------------------------
// Test 2: LTCG fits in headroom
// ---------------------------------------------------------------------------

test("LTCG fits in headroom: ltcgFitsInHeadroom=true", () => {
  const plan = makePlan();
  // LTCG = ₹50,000 = 50_00_000 paise; headroom starts at ₹1.25L = 1_25_00_000 paise
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData({ estimatedLtcgPaise: 50_00_000 })],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  assert.equal(result.switchAnnotations.length, 1);
  const ann = result.switchAnnotations[0]!;
  assert.equal(ann.ltcgFitsInHeadroom, true);
  assert.equal(ann.ltcgHeadroomBeforePaise, 1_25_00_000);
  assert.equal(ann.ltcgHeadroomAfterPaise, 1_25_00_000 - 50_00_000);
});

// ---------------------------------------------------------------------------
// Test 3: LTCG exceeds headroom
// ---------------------------------------------------------------------------

test("LTCG exceeds headroom: ltcgFitsInHeadroom=false, ltcgHeadroomAfterPaise negative", () => {
  const plan = makePlan();
  // FY already realized ₹1L; headroom = ₹25,000 = 25_00_000 paise; LTCG = ₹1L = 1_00_00_000
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData({ estimatedLtcgPaise: 1_00_00_000 })],
    fyLtcgAlreadyRealizedPaise: 1_00_00_000,
    onDate: REF_DATE,
  });
  const ann = result.switchAnnotations[0]!;
  assert.equal(ann.ltcgFitsInHeadroom, false);
  assert.equal(ann.ltcgHeadroomAfterPaise, 25_00_000 - 1_00_00_000); // negative
  assert.equal(ann.ltcgHeadroomAfterPaise < 0, true);
});

// ---------------------------------------------------------------------------
// Test 4: FY gains partially consume headroom
// ---------------------------------------------------------------------------

test("FY gains partially consume headroom: fyLtcgAlreadyRealizedPaise=50_00_000 → headroom=75_00_000", () => {
  const plan = makePlan();
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData()],
    fyLtcgAlreadyRealizedPaise: 50_00_000,
    onDate: REF_DATE,
  });
  assert.equal(result.ltcgHeadroomPaise, 1_25_00_000 - 50_00_000); // 75_00_000
  assert.equal(result.switchAnnotations[0]!.ltcgHeadroomBeforePaise, 75_00_000);
});

// ---------------------------------------------------------------------------
// Test 5: FY gains exhaust headroom
// ---------------------------------------------------------------------------

test("FY gains exhaust headroom: fyLtcgAlreadyRealizedPaise>=1_25_00_000 → ltcgHeadroomPaise=0", () => {
  const plan = makePlan();
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData()],
    fyLtcgAlreadyRealizedPaise: 2_00_00_000, // more than exemption
    onDate: REF_DATE,
  });
  assert.equal(result.ltcgHeadroomPaise, 0);
  assert.equal(result.switchAnnotations[0]!.ltcgHeadroomBeforePaise, 0);
});

// ---------------------------------------------------------------------------
// Test 6: locked category → notRecommendedNow=true
// ---------------------------------------------------------------------------

test("locked category ppf: notRecommendedNow=true, reason mentions locked", () => {
  const plan = makePlan();
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData({ lockedCategories: ["ppf"] })],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  const ann = result.switchAnnotations[0]!;
  assert.equal(ann.notRecommendedNow, true);
  assert.ok(ann.notRecommendedReason !== null);
  assert.ok(ann.notRecommendedReason.includes("locked"));
  assert.equal(ann.lockedCategoryDetails.length, 1);
  assert.equal(ann.lockedCategoryDetails[0]!.category, "ppf");
  assert.ok(ann.lockedCategoryDetails[0]!.lockInSummary.length > 0);
});

// ---------------------------------------------------------------------------
// Test 7: STCG with near flip date → notRecommendedNow=true
// ---------------------------------------------------------------------------

test("STCG with flip date 60 days away: notRecommendedNow=true, reason mentions the flip date", () => {
  const flipDate = new Date(REF_DATE);
  flipDate.setDate(flipDate.getDate() + 60);
  const flipDateStr = flipDate.toISOString().slice(0, 10);

  const plan = makePlan();
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [
      makeGainData({
        estimatedStcgPaise: 30_00_000,
        earliestStcgFlipDate: flipDateStr,
      }),
    ],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  const ann = result.switchAnnotations[0]!;
  assert.equal(ann.notRecommendedNow, true);
  assert.ok(ann.notRecommendedReason !== null);
  assert.ok(ann.notRecommendedReason.includes(flipDateStr));
});

// ---------------------------------------------------------------------------
// Test 8: STCG but distant flip date → notRecommendedNow=false
// ---------------------------------------------------------------------------

test("STCG with flip date 120 days away: notRecommendedNow=false", () => {
  const flipDate = new Date(REF_DATE);
  flipDate.setDate(flipDate.getDate() + 120);
  const flipDateStr = flipDate.toISOString().slice(0, 10);

  const plan = makePlan();
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [
      makeGainData({
        estimatedStcgPaise: 30_00_000,
        earliestStcgFlipDate: flipDateStr,
      }),
    ],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  const ann = result.switchAnnotations[0]!;
  assert.equal(ann.notRecommendedNow, false);
  assert.equal(ann.notRecommendedReason, null);
});

// ---------------------------------------------------------------------------
// Test 9: redirectionAvailable=true
// ---------------------------------------------------------------------------

test("redirectionAvailable=true when plan has a redirect_contributions action with matching fromLeg", () => {
  const plan = makePlan({
    actions: [
      {
        type: "switch_corpus",
        fromLeg: "equity",
        toLeg: "debt",
        amountPaise: 10_00_00_000,
      },
      {
        type: "redirect_contributions",
        fromLeg: "equity",
        toLeg: "debt",
        monthlyAmountPaise: 50_00_000,
        estimatedClosureMonths: 20,
      },
    ],
  });
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData()],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  assert.equal(result.switchAnnotations[0]!.redirectionAvailable, true);
});

// ---------------------------------------------------------------------------
// Test 10: redirectionAvailable=false
// ---------------------------------------------------------------------------

test("redirectionAvailable=false when plan has no redirect_contributions action", () => {
  const plan = makePlan(); // default plan has only switch_corpus
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData()],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  assert.equal(result.switchAnnotations[0]!.redirectionAvailable, false);
});

// ---------------------------------------------------------------------------
// Test 12: redirectionNote always present
// ---------------------------------------------------------------------------

test("redirectionNote is always present in output", () => {
  const plan = makePlan();
  const result = buildTaxAwareRebalancingPlan({
    plan,
    switchGainData: [makeGainData()],
    fyLtcgAlreadyRealizedPaise: 0,
    onDate: REF_DATE,
  });
  assert.ok(typeof result.redirectionNote === "string");
  assert.ok(result.redirectionNote.length > 0);
  assert.ok(result.redirectionNote.includes("Redirecting contributions"));
});
