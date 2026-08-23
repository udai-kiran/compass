No AC violations found.

Verified:

- [basket-arbitrage.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.ts:27): `MAX_SOURCES = 15`.
- [basket-arbitrage.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.ts:91): source cap is enforced before subset enumeration.
- [basket-arbitrage.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.ts:129): `optimizeBasket` enumerates non-empty source subsets via bitmask.
- [basket-arbitrage.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.ts:96): unpriced items are partitioned into `unpricedItemIds` and only `pricedItemIds` are enumerated/costed.
- [basket-arbitrage.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.ts:57): basket arithmetic is integer paise additions/subtractions; I found no float money arithmetic.

- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:518): `ArbitrageSourcePlanSchema` is present with source, subtotal, delivery fee, min cart, total, assigned item IDs, and price evidence fields.
- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:553): `BasketArbitrageResultSchema` is present with `splits`, `grandTotalPaise`, `bestSingleSourceTotalPaise`, `savingPaise`, `unpricedItemIds`, and `tooFewSources`.

- [basket-arbitrage.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.test.ts:34): 6 tests are present.
- [basket-arbitrage.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.test.ts:102): includes split-worse-than-single-source coverage.
- [basket-arbitrage.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.test.ts:133): includes missing/unpriced item coverage.
- [basket-arbitrage.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.test.ts:165): includes delivery fee computation coverage.
- [basket-arbitrage.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/basket-arbitrage.test.ts:204): includes source cap throwing `Error`.

- [arbitrage.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/arbitrage.ts:37): route is registered as relative `POST /lists/:listId/arbitrage`.