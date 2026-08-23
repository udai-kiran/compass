**Findings**

1. **AC6 violation: missing `recommends: true` guard field.**  
   [packages/shared/src/schemas/shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:665) defines `CheckoutRecommendationSchema` with `lines`, `totalEffectiveCostPaise`, `savingVsNaivePaise`, `unpricedItemIds`, and `notes`, but no `recommends` or equivalent recommendation-only guard.  
   [apps/api/src/modules/shopping/services/checkout-recommendation.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.ts:259) returns the same shape without `recommends: true`.  
   This violates [tasks/075-reward-aware-checkout/TASK.md](/work/personal/compass/tasks/075-reward-aware-checkout/TASK.md:54): `AC6: recommends: true (field present in recommendation); no purchase triggered`.

2. **Test coverage violation: “no redemption route → 0” is not covered.**  
   The requested six tests are present by count, but test 3 at [checkout-recommendation.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.test.ts:157) covers “no matching reward rule,” not “card with no configured redemption route.”  
   AC3 requires a matching card/rule with no redemption route configured to yield `pointsValuePaise = 0`; the current test does not exercise the `redemptionValues` empty/no-route path.

**Checks Passed**

- `CheckoutLineSchema` is present with expected line fields at [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:642).
- `CheckoutRecommendationSchema` has the requested base fields at [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:665), except for the AC6 guard noted above.
- `applyOffer` exists, returns `0` when `minSpend` is not met, and applies cap via `Math.min` at [checkout-recommendation.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.ts:68).
- Utilization guard skips cards when the projected utilization breaches the alert threshold at [checkout-recommendation.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.ts:129).
- `scoreCheckout` returns the expected recommendation shape except missing `recommends`.
- Route is `POST /recommend` relative path at [checkout-recommendation.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/checkout-recommendation.ts:27).
- `checkoutRecommendationRoutes` is registered in [plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:36).
- Route snapshots include `POST /api/shopping/recommend` in both `route-surface.snapshot.txt` and `route-table.snapshot.txt`.

I did not run tests; this was a read-only implementation review.