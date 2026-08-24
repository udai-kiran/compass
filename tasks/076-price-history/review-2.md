No AC violations found.

Checked:

- [price-history.ts](/work/personal/compass/apps/api/src/modules/shopping/services/price-history.ts:29): `MIN_OBSERVATIONS = 5`, `MIN_DISTINCT_DAYS = 3`, and `INFLATION_THRESHOLD_PCT = 110` are exported constants.
- [price-history.ts](/work/personal/compass/apps/api/src/modules/shopping/services/price-history.ts:124): `analyzeTrend` returns `insufficient_data` when observations are `< 5` OR distinct days are `< 3`.
- [price-history.ts](/work/personal/compass/apps/api/src/modules/shopping/services/price-history.ts:243): `checkPriceHonesty` filters evidence by matching `packQuantityBase` and `unit` when both are supplied.
- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:565): all requested schemas are present, including `BuyNowVsWaitSchema.minObservationsRequired: z.literal(5)` and `PriceHonestyResultSchema.inflationThresholdPct: z.literal(110)`.
- [price-history.ts routes](/work/personal/compass/apps/api/src/modules/shopping/routes/price-history.ts:58): all three routes are `GET` and use relative paths.
- [price-history.test.ts](/work/personal/compass/apps/api/src/modules/shopping/services/price-history.test.ts:52): 8 tests are present and cover the requested cases, including insufficient observations, insufficient distinct days, rising trend, flagged/not-flagged MRP checks, no observations, and pack-size filtering.