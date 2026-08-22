/**
 * Checkout Recommendation — pure scorer (task 10.6).
 *
 * No DB access, no I/O. Takes the arbitrage result, the user's active card
 * offers, reward rules, card list, and issuer-utilization state, and returns
 * a per-item checkout recommendation.
 *
 * Design:
 *  - applyOffer:   compute the saving from one offer against a basket total.
 *  - scoreCheckout: for each source split, evaluate every candidate card and
 *    pick the one with the lowest effective cost. Effective cost accounts for
 *    offer savings and earned-points value (first configured redemption route).
 *    Cards that would breach the issuer's utilisation alert threshold are skipped.
 *    Savings and delivery-fee shares are allocated to lines proportionally by
 *    item price.
 *
 * Money is always integer paise — no float rupees.
 */

import type {
  BasketArbitrageResult,
  CardOffer,
  CardOfferDiscountKind,
  CheckoutLine,
  CheckoutRecommendation,
  RewardRule,
} from "@compass/shared";
import { getEffectiveEarnPoints, getPointValue } from "../../credit/services/reward-rules.ts";

// ---------------------------------------------------------------------------
// Public interfaces used by the loader
// ---------------------------------------------------------------------------

export interface CardInfo {
  accountId: string;
  /** issuing bank/institution; matches accounts.institution and offer.issuer */
  institution: string | null;
  /** matches cardDetails.productName; used to look up the reward rule */
  productName: string;
  /** card network; used for reward-rule network filtering */
  network: string | null;
}

export interface IssuerUtilization {
  /** combined credit limit across all cards for this issuer; null = not set */
  creditLimitPaise: number | null;
  /** current outstanding balance estimate in paise; 0 when unavailable */
  currentOwedPaise: number;
  /** alert percentage threshold; null = disabled (card always eligible) */
  utilizationAlertPct: number | null;
}

// ---------------------------------------------------------------------------
// applyOffer helper
// ---------------------------------------------------------------------------

/**
 * Compute the saving in integer paise from one card offer applied to a basket.
 *
 * @param discountRateBps - for flat: the saving amount in paise; for percentage/
 *   cashback/points: percentage × 100 (basis points). e.g. 1000 bps = 10%.
 * @param discountKind    - "flat" | "percentage" | "cashback" | "points"
 * @param maxCapPaise     - maximum saving allowed; null = uncapped.
 * @param minSpendPaise   - minimum basket required; null = no minimum.
 * @param basketSubtotalPaise - the basket subtotal to evaluate against.
 * @returns saving in integer paise (always ≥ 0).
 */
export function applyOffer(
  discountRateBps: number,
  discountKind: CardOfferDiscountKind,
  maxCapPaise: number | null,
  minSpendPaise: number | null,
  basketSubtotalPaise: number,
): number {
  if (minSpendPaise !== null && basketSubtotalPaise < minSpendPaise) return 0;

  let saving: number;
  if (discountKind === "flat") {
    // discountRateBps is the flat saving amount in paise
    saving = discountRateBps;
  } else {
    // percentage / cashback / points: discountRateBps is bps of the basket
    saving = Math.floor((basketSubtotalPaise * discountRateBps) / 10000);
  }

  if (maxCapPaise !== null) saving = Math.min(saving, maxCapPaise);
  return Math.max(0, saving);
}

// ---------------------------------------------------------------------------
// scoreCheckout
// ---------------------------------------------------------------------------

/**
 * Score checkout options for all source splits in the arbitrage result.
 *
 * For each source split:
 *  1. Evaluate every candidate card against the source (offer + reward earn).
 *  2. Skip cards that would breach the issuer's utilisation threshold.
 *  3. Pick the card with the lowest effective cost (itemSubtotal + delivery
 *     − offerSaving − pointsValue). Fall back to no-card baseline if no card
 *     improves on it.
 *  4. Allocate delivery, offer-saving, and points-value proportionally to each
 *     item assigned to the source.
 *
 * @param arbitrageResult - output of optimizeBasket
 * @param activeOffers    - reviewed, non-expired card offers for the user
 * @param rewardRules     - all reward rules for the user
 * @param cards           - credit cards belonging to the user
 * @param issuerUtilization - keyed by institution; entries may be absent when
 *   the issuer has no settings row (card is then always eligible)
 */
export function scoreCheckout(
  arbitrageResult: BasketArbitrageResult,
  activeOffers: CardOffer[],
  rewardRules: RewardRule[],
  cards: CardInfo[],
  issuerUtilization: Map<string, IssuerUtilization>,
): CheckoutRecommendation {
  const lines: CheckoutLine[] = [];

  for (const split of arbitrageResult.splits) {
    // No-card baseline: plain arbitrage cost for this source.
    let bestCardId: string | null = null;
    let bestOfferSaving = 0;
    let bestPointsValue = 0;
    let bestEffectiveCost = split.itemSubtotalPaise + split.deliveryFeePaise;

    for (const card of cards) {
      // ── Utilisation guard ────────────────────────────────────────────────
      if (card.institution !== null) {
        const util = issuerUtilization.get(card.institution);
        if (util !== undefined && util.utilizationAlertPct !== null) {
          const limit = util.creditLimitPaise;
          if (limit !== null && limit > 0) {
            const utilizationPct =
              ((util.currentOwedPaise + split.itemSubtotalPaise) / limit) * 100;
            if (utilizationPct > util.utilizationAlertPct) {
              // Would breach the threshold — skip this card for this source.
              continue;
            }
          }
        }
      }

      // ── Best offer for this source × card pair ──────────────────────────
      let cardBestOfferSaving = 0;
      for (const offer of activeOffers) {
        const platformMatch =
          offer.platform.trim().toLowerCase() === split.sourceName.trim().toLowerCase();
        const issuerMatch =
          card.institution !== null &&
          offer.issuer.trim().toLowerCase() === card.institution.trim().toLowerCase();

        const productMatch =
          offer.cardProductName === null ||
          offer.cardProductName.trim().toLowerCase() === card.productName.trim().toLowerCase();

        if (platformMatch && issuerMatch && productMatch) {
          const saving = applyOffer(
            offer.discountRateBps,
            offer.discountKind,
            offer.maxCapPaise,
            offer.minSpendPaise,
            split.itemSubtotalPaise,
          );
          if (saving > cardBestOfferSaving) {
            cardBestOfferSaving = saving;
          }
        }
      }

      // ── Reward points value ──────────────────────────────────────────────
      // Match reward rule by cardProductName (and network when specified).
      const rule = rewardRules.find(
        (r) =>
          r.cardProductName === card.productName &&
          (r.network === null || r.network === card.network),
      );

      let cardPointsValue = 0;
      if (rule !== undefined) {
        // Use the first configured redemption route for point valuation.
        const routes = Object.keys(rule.redemptionValues);
        if (routes.length > 0) {
          const firstRoute = routes[0]!;
          const paisePerPoint = getPointValue(
            rule,
            firstRoute as Parameters<typeof getPointValue>[1],
          );
          if (paisePerPoint !== null) {
            const earnPoints = getEffectiveEarnPoints(
              rule,
              split.itemSubtotalPaise,
              null, // MCC unknown at recommendation time
              0,    // priorEligibleSpend: conservative estimate = 0
            );
            cardPointsValue = Math.floor(earnPoints * paisePerPoint);
          }
        }
      }

      // ── Effective cost for this card on this source ──────────────────────
      const effectiveCost =
        split.itemSubtotalPaise -
        cardBestOfferSaving +
        split.deliveryFeePaise -
        cardPointsValue;

      if (effectiveCost < bestEffectiveCost) {
        bestEffectiveCost = effectiveCost;
        bestCardId = card.accountId;
        bestOfferSaving = cardBestOfferSaving;
        bestPointsValue = cardPointsValue;
      }
    }

    // ── Allocate per-item shares proportionally by price ─────────────────
    for (const itemId of split.assignedItemIds) {
      const evidence = split.priceEvidenceByItemId[itemId];
      if (evidence === undefined) continue;

      const weight =
        split.itemSubtotalPaise > 0
          ? evidence.pricePaise / split.itemSubtotalPaise
          : 0;

      const deliveryFeeShare = Math.floor(split.deliveryFeePaise * weight);
      const offerSavingShare = Math.floor(bestOfferSaving * weight);
      const pointsValueShare = Math.floor(bestPointsValue * weight);
      const effectiveCost = Math.max(
        0,
        evidence.pricePaise + deliveryFeeShare - offerSavingShare - pointsValueShare,
      );

      lines.push({
        itemId,
        sourceId: split.sourceId,
        cardAccountId: bestCardId,
        baseItemPricePaise: evidence.pricePaise,
        deliveryFeeSharePaise: deliveryFeeShare,
        offerSavingPaise: offerSavingShare,
        pointsValuePaise: pointsValueShare,
        effectiveCostPaise: effectiveCost,
      });
    }
  }

  // ── Summary ─────────────────────────────────────────────────────────────
  const totalEffectiveCostPaise = lines.reduce((sum, l) => sum + l.effectiveCostPaise, 0);
  const savingVsNaivePaise = arbitrageResult.grandTotalPaise - totalEffectiveCostPaise;

  const notes: string[] = [];
  if (arbitrageResult.tooFewSources) {
    notes.push("Too few price sources for a split comparison.");
  }
  if (arbitrageResult.unpricedItemIds.length > 0) {
    notes.push(
      `${arbitrageResult.unpricedItemIds.length} item(s) have no price data and are excluded from the recommendation.`,
    );
  }

  return {
    recommends: true as const,
    lines,
    totalEffectiveCostPaise,
    savingVsNaivePaise,
    unpricedItemIds: arbitrageResult.unpricedItemIds,
    notes,
  };
}
