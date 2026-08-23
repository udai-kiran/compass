No AC violations found.

Reviewed against the requested files:

- [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:82): `deliveryEtaBandEnum` has exactly `instant/same_day/next_day/scheduled`, no `unknown`.
- [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:131): `priceSources` has nullable `deliveryFeePaise`, `minCartPaise`, and `deliveryEtaBand`.
- [schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:323): `serviceabilityChecks` table is present; `isServiceable` is nullable boolean at line 335.
- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:55): `DeliveryEtaBandSchema` matches the enum values.
- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:86): `PriceSourceSchema` includes the three nullable delivery fields.
- [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:469): `ServiceabilityCheckSchema` includes `isStale: z.boolean()`.
- [serviceability.ts](/work/personal/compass/apps/api/src/modules/shopping/services/serviceability.ts:28): `SERVICEABILITY_STALE_HOURS = 24` is a named exported constant.
- [serviceability.ts](/work/personal/compass/apps/api/src/modules/shopping/services/serviceability.ts:73): `assertOwnedPriceSource` is called before the insert/upsert.
- [serviceability.ts](/work/personal/compass/apps/api/src/modules/shopping/services/serviceability.ts:21): serviceability code has no AI/provider imports or calls; pincode is only stored/queried locally.
- [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:47): `serviceability_checks` is after `price_sources` in `ALL_TABLES`.
- [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:71): `serviceability_checks` is in `USER_TABLES` with `user_id`.
- [schema.smoke.test.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.smoke.test.ts:25): smoke test is updated for 9 shopping tables.
- [schema.smoke.test.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.smoke.test.ts:106): smoke test covers 6 enums, including `deliveryEtaBandEnum`.
- [schema.decomposition.test.ts](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:105): shopping residents include `serviceabilityChecks` and `deliveryEtaBandEnum`.