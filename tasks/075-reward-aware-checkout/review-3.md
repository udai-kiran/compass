**Findings**

1. **AC7 violation: product-specific offers can be applied to the wrong card.**  
   [checkout-recommendation.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.ts:149) only checks `platform` and `issuer` before applying an offer. It ignores `offer.cardProductName`, even though `CardOffer` supports nullable product targeting. A non-null product-specific offer for one HDFC card can therefore be applied to another HDFC card, violating “best applicable offer per source/card pair.”

**Confirmed Fixed / Intact**

- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:665): `CheckoutRecommendationSchema` has `recommends: z.literal(true)` as the first field.
- [checkout-recommendation.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.ts:259): `scoreCheckout` returns `recommends: true as const`.
- [checkout-recommendation.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation.test.ts:157): test 3 uses a matching card/rule with `redemptionValues: {}` and asserts `pointsValuePaise = 0`; it is no longer the “no rule at all” path.
- `applyOffer` cap boundary and `minSpend` behavior are covered.
- Utilization guard and `null utilizationAlertPct` eligibility are intact.
- Route snapshots include `POST /api/shopping/recommend` in both [route-table.snapshot.txt](/work/personal/compass/apps/api/src/route-table.snapshot.txt:150) and [route-surface.snapshot.txt](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:352).

**Verification**

I attempted `pnpm --filter @compass/api test -- checkout-recommendation.test.ts`; the package script ran the broader API suite and failed on unrelated DB-backed tests because `DATABASE_URL` is not set. In that run, all six `checkout-recommendation.test.ts` tests passed.