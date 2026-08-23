# Task: 075 — Deal- & Reward-Aware Portal Recommendation (task 10.6)

## Status
COMPLETE

## Objective
Given a shopping list, recommend which portal to buy each item from and which card to pay with, combining: basket arbitrage costs (072), active card offers (073), and reward earn rates (074). Cap arithmetic exact. Points valued at user-configured redemption rate only. Utilization-aware (reads issuer settings). Recommends only. Single best applicable offer per source/card pair.

## Root Cause
No recommendation service exists. Depends on tasks 072–074.

## Scope
- `packages/shared/src/schemas/shopping.ts` — add:
  - `CheckoutLineSchema` (itemId, sourceId, cardAccountId nullable, baseItemPricePaise, deliveryFeeSharePaise, offerSavingPaise, pointsValuePaise, effectiveCostPaise)
  - `CheckoutRecommendationSchema` (lines: CheckoutLineSchema[], totalEffectiveCostPaise, savingVsNaivePaise, unpricedItemIds: string[], notes: string[])
- `apps/api/src/modules/shopping/services/checkout-recommendation.ts` — pure function `scoreCheckout(items, arbitrageResult, activeOffers, rewardRules, cardDetails, issuerSettings)`:
  - `applyOffer(offerPaise, maxCapPaise, minSpendPaise, basketSubtotalPaise)` → savingPaise (0 if minSpend not met; min(offerPaise, maxCapPaise) if capped)
  - `scoreCard(basket, card, issuerSettings, activeOffers, rewardRules, redemptionRoute)` → effectiveCostPaise: first pick best applicable offer for this source/card pair; apply earn rate (getEffectiveEarnRate); value points at redemptionRoute (null → treat as worthless); skip card if utilization would breach issuerSettings.utilizationAlertPct
  - For each portal split in arbitrageResult, for each candidate card: compute effectiveCostPaise; pick minimum; return CheckoutLine
- `apps/api/src/modules/shopping/services/checkout-recommendation-loader.ts` — `buildCheckoutRecommendation(db, userId, listId, pincode)`: loads arbitrage result, active offers, reward rules, card details + issuer settings; calls scoreCheckout; returns CheckoutRecommendation
- `apps/api/src/modules/shopping/services/checkout-recommendation.test.ts` — unit tests:
  1. 10% offer capped ₹500 vs 5% uncapped: ₹9,999 → 5% wins; ₹10,001 → 10%+cap wins (boundary at ₹10,000)
  2. minSpend not met → offer not applied (not even partially)
  3. Card with no configured redemption route → null point value → excluded from reward comparison (base cost only)
  4. No active offers → falls back to arbitrage + rewards only
  5. Card would breach utilization (30% default) → skip card
  6. Card with null utilizationAlertPct (disabled) → not skipped
- `apps/api/src/modules/shopping/routes/checkout-recommendation.ts` — POST `/recommend` (relative). Validate input (listId, pincode optional), call loader, return recommendation
- `apps/api/src/modules/shopping/plugin.ts` — register route
- `apps/api/src/route-surface.snapshot.txt` — add
- `apps/api/src/route-table.snapshot.txt` — add

## Dependencies
- task 072 (basket arbitrage)
- task 073 (card offers)
- task 074 (reward model)

## Plan
- P1: Add shared Zod schemas (CheckoutLineSchema, CheckoutRecommendationSchema)
- P2: Implement `applyOffer` helper with cap boundary arithmetic
- P3: Implement `scoreCard` — offer selection (best per source/card pair), earn rate, point value, utilization guard
- P4: Implement `scoreCheckout` pure function
- P5: Write `checkout-recommendation-loader.ts` DB facade
- P6: Write route, register in plugin.ts
- P7: Write unit tests (6 cases above)
- P8: Update route snapshots

## Acceptance Criteria
- AC1: ₹10,000 basket: 10% capped ₹500 (saves ₹500) == 5% uncapped (saves ₹500) — boundary handled correctly
- AC2: minSpend not met → `offerSavingPaise = 0`
- AC3: Card with no redemption route configured: `pointsValuePaise = 0` (excluded from reward comparison but base cost still shown)
- AC4: No active offers: recommendation = arbitrage + reward earn value only
- AC5: Card that breaches utilizationAlertPct (30% default) not recommended; card with null threshold always eligible
- AC6: `recommends: true` (field present in recommendation); no purchase triggered
- AC7: Single best offer per source/card pair applied; no stacking
- AC8: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0 with all 6 unit test cases visible

## Non-Goals
- Auto-checkout or order placement
- Stacking multiple offers
- Card reward auto-earning from ledger transactions
