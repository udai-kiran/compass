/**
 * Unit tests for applyOffer and scoreCheckout — pure functions with no DB
 * dependency (task 10.6).
 *
 * Money is always integer paise.
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { applyOffer, scoreCheckout } from "./checkout-recommendation.ts";
import type { CardInfo, IssuerUtilization } from "./checkout-recommendation.ts";
import type { BasketArbitrageResult, CardOffer, RewardRule } from "@compass/shared";

// ---------------------------------------------------------------------------
// Fixture helpers
// ---------------------------------------------------------------------------

/** Minimal BasketArbitrageResult with a single source. */
function makeArbitrageResult(
  sourceId: string,
  sourceName: string,
  itemSubtotalPaise: number,
  deliveryFeePaise: number,
  items: Array<{ id: string; pricePaise: number }>,
): BasketArbitrageResult {
  const priceEvidence: Record<string, { pricePaise: number; observedAt: Date }> = {};
  for (const item of items) {
    priceEvidence[item.id] = { pricePaise: item.pricePaise, observedAt: new Date("2026-01-01") };
  }
  return {
    splits: [
      {
        sourceId,
        sourceName,
        itemSubtotalPaise,
        deliveryFeePaise,
        minCartPaise: null,
        totalPaise: itemSubtotalPaise + deliveryFeePaise,
        assignedItemIds: items.map((i) => i.id),
        priceEvidenceByItemId: priceEvidence,
      },
    ],
    grandTotalPaise: itemSubtotalPaise + deliveryFeePaise,
    bestSingleSourceTotalPaise: itemSubtotalPaise + deliveryFeePaise,
    savingPaise: 0,
    unpricedItemIds: [],
    tooFewSources: false,
  };
}

function makeRewardRule(overrides: Partial<RewardRule> = {}): RewardRule {
  return {
    id: "00000000-0000-4000-8000-000000000001",
    cardProductName: "Regalia Gold",
    network: "visa",
    baseEarnPer100: 4, // 4 points per ₹100 spent
    mccExclusions: [],
    accelEarnMultiplier: null,
    accelEarnCapPaise: null,
    accelEarnCapPeriod: null,
    redemptionValues: { cashback: 50 }, // 50 paise per point
    milestoneSpendPaise: null,
    milestoneBenefitDesc: null,
    annualFeeWaiverSpendPaise: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeCardOffer(overrides: Partial<CardOffer> = {}): CardOffer {
  return {
    id: "00000000-0000-4000-8000-000000000010",
    platform: "Amazon",
    issuer: "HDFC",
    cardProductName: null,
    discountKind: "percentage",
    discountRateBps: 1000, // 10%
    maxCapPaise: 50_000, // ₹500 cap
    minSpendPaise: null,
    validFrom: new Date("2026-01-01"),
    validUntil: new Date("2027-01-01"),
    stackable: false,
    isReviewed: true,
    sourceEmailId: null,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    ...overrides,
  };
}

function makeCard(overrides: Partial<CardInfo> = {}): CardInfo {
  return {
    accountId: "00000000-0000-4000-8000-000000000020",
    institution: "HDFC",
    productName: "Regalia Gold",
    network: "visa",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Test 1: applyOffer — percentage cap boundary arithmetic
// ---------------------------------------------------------------------------

test("applyOffer: 10% capped ₹500 vs 5% uncapped — cap boundary at ₹10,000", () => {
  // 10% offer, capped at 50,000 paise (₹500). discountRateBps = 1000 (10%).
  // 5% offer, no cap.                       discountRateBps = 500  (5%).

  // At ₹5,000 (500,000 paise): 10% = 50,000 (cap hit), 5% = 25,000 → 10% wins
  assert.equal(applyOffer(1000, "percentage", 50_000, null, 500_000), 50_000, "10% cap ₹500 at ₹5k basket");
  assert.equal(applyOffer(500, "percentage", null, null, 500_000), 25_000, "5% uncapped at ₹5k basket");

  // At ₹10,000 (1,000,000 paise): 10% = 50,000 (cap), 5% = 50,000 — tied
  const save10Pct10k = applyOffer(1000, "percentage", 50_000, null, 1_000_000);
  const save5Pct10k  = applyOffer(500,  "percentage", null,   null, 1_000_000);
  assert.equal(save10Pct10k, 50_000, "10% cap ₹500 at exactly ₹10k basket hits cap");
  assert.equal(save5Pct10k,  50_000, "5% uncapped at exactly ₹10k equals cap");
  assert.equal(save10Pct10k, save5Pct10k, "both offers tied at ₹10,000 basket");

  // At ₹20,000 (2,000,000 paise): 10% = 50,000 (still capped), 5% = 100,000 → 5% wins
  assert.equal(applyOffer(1000, "percentage", 50_000, null, 2_000_000), 50_000,  "10% cap ₹500 at ₹20k still capped");
  assert.equal(applyOffer(500,  "percentage", null,   null, 2_000_000), 100_000, "5% uncapped at ₹20k exceeds cap");

  // Flat offer: saving = discountRateBps paise regardless of basket (no minSpend)
  assert.equal(applyOffer(30_000, "flat", null, null, 500_000), 30_000, "flat ₹300 offer");
  assert.equal(applyOffer(30_000, "flat", 20_000, null, 500_000), 20_000, "flat capped at ₹200");
});

// ---------------------------------------------------------------------------
// Test 2: applyOffer — minSpend not met → saving = 0
// ---------------------------------------------------------------------------

test("applyOffer: minSpend not met → offer not applied", () => {
  const minSpend = 500_000; // ₹5,000

  // Basket just below minSpend
  assert.equal(
    applyOffer(1000, "percentage", 50_000, minSpend, 499_900),
    0,
    "basket ₹4,999 < minSpend ₹5,000 → 0",
  );

  // Basket exactly at minSpend
  const atThreshold = applyOffer(1000, "percentage", 50_000, minSpend, 500_000);
  assert.equal(atThreshold, 50_000, "basket exactly at minSpend ₹5,000 → offer applies (cap hit)");

  // Basket above minSpend
  const above = applyOffer(1000, "percentage", 50_000, minSpend, 600_000);
  assert.equal(above, 50_000, "basket ₹6,000 > minSpend → offer applies (cap hit)");
});

// ---------------------------------------------------------------------------
// Test 3: card with no configured redemption route → pointsValuePaise = 0
// ---------------------------------------------------------------------------

test("scoreCheckout: card with no configured redemption route → pointsValuePaise = 0", () => {
  const result = makeArbitrageResult(
    "00000000-0000-4000-8000-000000000001",
    "Amazon",
    100_000, // ₹1,000
    0,
    [{ id: "00000000-0000-4000-8000-000000000002", pricePaise: 100_000 }],
  );

  // Rule exists but redemptionValues is empty — no route configured
  const rule = makeRewardRule({ redemptionValues: {} });
  const card = makeCard(); // productName "Regalia Gold" matches rule

  // Offer: 10% on Amazon for HDFC cards → offerSaving = 10,000 paise
  const offer = makeCardOffer();

  const recommendation = scoreCheckout(result, [offer], [rule], [card], new Map());

  assert.equal(recommendation.lines.length, 1, "one line for the one item");
  const line = recommendation.lines[0]!;
  assert.equal(line.pointsValuePaise, 0, "no redemption route → 0 points");
  assert.equal(line.offerSavingPaise, 10_000, "offer still applies");
  assert.equal(line.effectiveCostPaise, 90_000, "effectiveCost = 100k - 10k offer = 90k");
});

// ---------------------------------------------------------------------------
// Test 4: no active offers → only arbitrage + reward earn value
// ---------------------------------------------------------------------------

test("scoreCheckout: no active offers → offerSavingPaise = 0, pointsValuePaise from earn rule", () => {
  // 1 source (Amazon), 1 item at ₹1,000 (100,000 paise), no delivery fee
  const result = makeArbitrageResult(
    "00000000-0000-4000-8000-000000000001",
    "Amazon",
    100_000,
    0,
    [{ id: "00000000-0000-4000-8000-000000000002", pricePaise: 100_000 }],
  );

  const card = makeCard();
  // Reward rule: 4 pts/₹100, redemption at 50 paise/pt
  // Spend ₹1,000 → 40 points → 40 × 50 = 2,000 paise saved
  const rule = makeRewardRule();

  // No offers
  const recommendation = scoreCheckout(result, [], [rule], [card], new Map());

  assert.equal(recommendation.lines.length, 1);
  const line = recommendation.lines[0]!;
  assert.equal(line.offerSavingPaise, 0, "no offers → 0 offer saving");
  assert.equal(line.pointsValuePaise, 2_000, "4pts/₹100 × ₹1000 = 40pts × 50p = 2,000 paise");
  assert.equal(line.effectiveCostPaise, 98_000, "effectiveCost = 100k - 2k = 98k");
  assert.equal(line.cardAccountId, card.accountId, "card recommended via reward points");
  assert.equal(recommendation.savingVsNaivePaise, 2_000, "saving vs naive (no card) = 2,000 paise");
});

// ---------------------------------------------------------------------------
// Test 5: card would breach utilisation threshold → not recommended
// ---------------------------------------------------------------------------

test("scoreCheckout: card breaching utilisation threshold is skipped → cardAccountId = null", () => {
  // 1 source (Amazon), 1 item at ₹1,000
  const result = makeArbitrageResult(
    "00000000-0000-4000-8000-000000000001",
    "Amazon",
    100_000, // ₹1,000 proposed spend
    0,
    [{ id: "00000000-0000-4000-8000-000000000002", pricePaise: 100_000 }],
  );

  const card = makeCard(); // institution = "HDFC"
  const rule = makeRewardRule();
  const offer = makeCardOffer();

  // HDFC: limit ₹10,000, already owed ₹2,500 (25%).
  // Proposed spend ₹1,000 → new utilisation (2500+1000)/10000 = 35% > 30% → skip.
  const utilization = new Map<string, IssuerUtilization>([
    [
      "HDFC",
      {
        creditLimitPaise: 1_000_000, // ₹10,000
        currentOwedPaise: 250_000,   // ₹2,500 already owed
        utilizationAlertPct: 30,
      },
    ],
  ]);

  const recommendation = scoreCheckout(result, [offer], [rule], [card], utilization);

  assert.equal(recommendation.lines.length, 1);
  const line = recommendation.lines[0]!;
  assert.equal(line.cardAccountId, null, "card skipped → no card recommended");
  assert.equal(line.offerSavingPaise, 0, "skipped card → no offer saving");
  assert.equal(line.pointsValuePaise, 0, "skipped card → no points value");
  assert.equal(line.effectiveCostPaise, 100_000, "cost falls back to plain arbitrage");
});

// ---------------------------------------------------------------------------
// Test 6: null utilizationAlertPct → card always eligible
// ---------------------------------------------------------------------------

test("scoreCheckout: null utilizationAlertPct disables the threshold → card is eligible", () => {
  // Same scenario as test 5 but with null alert threshold
  const result = makeArbitrageResult(
    "00000000-0000-4000-8000-000000000001",
    "Amazon",
    100_000,
    0,
    [{ id: "00000000-0000-4000-8000-000000000002", pricePaise: 100_000 }],
  );

  const card = makeCard(); // institution = "HDFC"
  const rule = makeRewardRule();
  const offer = makeCardOffer();

  // Null utilizationAlertPct disables the guard entirely
  const utilization = new Map<string, IssuerUtilization>([
    [
      "HDFC",
      {
        creditLimitPaise: 1_000_000,
        currentOwedPaise: 250_000, // same as test 5
        utilizationAlertPct: null, // disabled
      },
    ],
  ]);

  const recommendation = scoreCheckout(result, [offer], [rule], [card], utilization);

  assert.equal(recommendation.lines.length, 1);
  const line = recommendation.lines[0]!;
  assert.equal(line.cardAccountId, card.accountId, "null alertPct → card is eligible");
  // offer saving: 10% of 100,000 = 10,000 paise (cap 50,000, not hit)
  assert.equal(line.offerSavingPaise, 10_000, "offer applies");
  // points: 4pts/₹100 × ₹1k = 40pts × 50p = 2,000 paise
  assert.equal(line.pointsValuePaise, 2_000, "reward points apply");
  assert.equal(line.effectiveCostPaise, 88_000, "100k - 10k offer - 2k points = 88k");
});
