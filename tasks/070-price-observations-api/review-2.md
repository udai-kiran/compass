**Findings**

Medium: [packages/shared/src/schemas/shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:383) does define `CreatePriceSourceSchema`, but it is not “PUT-style, all required” as specified in `TASK.md` scope. `url` has `.default(null)` and `isActive` has `.default(true)` at lines 389 and 391, so omitted fields are accepted instead of rejected. `UpdatePriceSourceSchema` is full-required.

**Acceptance Check**

1. [ownership.ts](/work/personal/compass/apps/api/src/modules/shopping/services/ownership.ts:59): `assertOwnedPriceSource` exists and throws `HttpError(404)` on missing/cross-user. `assertOwnedPriceObservation` exists at line 75 and also throws `HttpError(404)`.

2. [price-observations.ts](/work/personal/compass/apps/api/src/modules/shopping/services/price-observations.ts:21): `STALE_DAYS = 7` is a named exported constant. `isStale` is computed in service code via `isStaleObservation`, not SQL, at lines 27-29 and 97. The clock is injectable via `now?: Date` on `listObservations` and the `now` parameter on `isStaleObservation`.

3. [platform-seeds.ts](/work/personal/compass/apps/api/src/modules/shopping/services/platform-seeds.ts:26): 11 seed entries are present. Insert uses `.onConflictDoNothing()` at line 48. Adapter interface note is commented at lines 9-14; no scraping implementation found in this file.

4. [price-sources.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/price-sources.ts:41): route paths are relative (`/sources`, `/sources/:id`). `GET /sources` calls `ensurePlatformSeeds` before listing at line 49.

5. [price-observations.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/price-observations.ts:32): `catalogItemId` query param is required by `ObsQuery`. POST and DELETE route handlers delegate to service methods; ownership guards are called in [price-observations.ts](/work/personal/compass/apps/api/src/modules/shopping/services/price-observations.ts:111) for POST and line 138 for DELETE.

6. [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:383): all requested schemas exist: `CreatePriceSourceSchema`, `UpdatePriceSourceSchema`, `CreatePriceObservationSchema`, `PriceObservationWithSourceSchema` with `isStale`, and `PriceObservationsResponseSchema`.

I did not run typecheck/lint/tests because this was a read-only implementation review.