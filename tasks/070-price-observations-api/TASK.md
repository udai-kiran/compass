# Task: 070 — Price Sources & Observations API (task 10.1)

## Status
COMPLETE

## Objective
Ship CRUD API routes for `price_sources` and `price_observations` so users can manually submit prices attributed to a source. Every price must be returned with its source and `observedAt` timestamp; stale observations (>7 days, computed in service code not SQL) must be flagged. Seed the platform registry with 11 Indian platforms idempotently on GET /sources. Document the adapter interface for future live-scraping adapters (no implementation).

## Root Cause
Schema tables (`price_sources`, `price_observations`) already exist from task 9.1 and are in `ALL_TABLES`/`USER_TABLES`. Zero API routes or services exist for them yet.

## Scope
- `packages/shared/src/schemas/shopping.ts` — add `CreatePriceSourceSchema` (PUT-style, all required), `UpdatePriceSourceSchema`, `CreatePriceObservationSchema`, `PriceObservationWithSourceSchema` (includes `isStale: boolean`), `PriceObservationsResponseSchema`
- `packages/shared/src/schemas/shopping.test.ts` — add tests for new schemas (quantity/unit pairing, Date coercion)
- `apps/api/src/modules/shopping/services/ownership.ts` — add `assertOwnedPriceSource(db, userId, sourceId)` and `assertOwnedPriceObservation(db, userId, obsId)` (return 404 on cross-user or missing)
- `apps/api/src/modules/shopping/services/price-sources.ts` — list, create, update (PUT full replace), softDelete (isActive=false)
- `apps/api/src/modules/shopping/services/price-observations.ts` — list by catalogItemId with isStale flag (>7 days from Date.now()), create, delete. STALE_DAYS = 7 named constant; injectable clock for tests
- `apps/api/src/modules/shopping/services/platform-seeds.ts` — `ensurePlatformSeeds(db, userId)` inserting 11 platforms with ON CONFLICT DO NOTHING (idempotent). Called from GET /sources handler
- `apps/api/src/modules/shopping/services/price-observations.test.ts` — unit tests for isStale calculation and stale constant
- `apps/api/src/modules/shopping/routes/price-sources.ts` — GET /sources, POST /sources, PUT /sources/:id, DELETE /sources/:id (soft). Register relative paths (no /api/shopping prefix)
- `apps/api/src/modules/shopping/routes/price-observations.ts` — GET /observations?catalogItemId=, POST /observations, DELETE /observations/:id. Ownership guard on write paths
- `apps/api/src/modules/shopping/routes/price-sources.hermetic.test.ts`
- `apps/api/src/modules/shopping/routes/price-observations.hermetic.test.ts`
- `apps/api/src/modules/shopping/routes/price-sources.route.test.ts` — DB-backed: create, list, duplicate name →409, cross-user FK →404
- `apps/api/src/modules/shopping/routes/price-observations.route.test.ts` — DB-backed: create, list, stale flag, cross-user →404
- `apps/api/src/modules/shopping/plugin.ts` — register new routes
- `apps/api/src/route-surface.snapshot.txt` — add new route entries
- `apps/api/src/route-table.snapshot.txt` — add new route entries

## Dependencies
- task 9.1 (schema already done) ✓

## Plan
- P1: Add shared Zod schemas + shopping.test.ts tests
- P2: Add `assertOwnedPriceSource` + `assertOwnedPriceObservation` to ownership.ts
- P3: Write `services/price-sources.ts`
- P4: Write `services/price-observations.ts` (isStale via service code, injectable clock)
- P5: Write `services/platform-seeds.ts` — 11 platforms, idempotent
- P6: Write route files with relative paths; register in plugin.ts
- P7: Write hermetic tests
- P8: Write DB-backed route tests
- P9: Update route snapshot files

## Acceptance Criteria
- AC1: GET /api/shopping/sources triggers seed; returns 11 platform sources for new user
- AC2: POST /api/shopping/observations creates observation; GET returns it with `isStale: false`
- AC3: GET /api/shopping/observations?catalogItemId=X returns observations with `isStale: true` when `observedAt` >7 days ago
- AC4: Cross-user priceSourceId or catalogItemId on POST /observations returns 404
- AC5: Duplicate source name returns 409
- AC6: No scraping code; adapter interface commented in platform-seeds.ts
- AC7: typecheck + lint + test green (including shared package tests)

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0
- T4: `npm run test -w packages/shared` exits 0

## Non-Goals
- Live price scraping or adapter implementations
- Serviceability / delivery ETA (task 10.2)
- `priceSources.deliveryFeePaise` / `minCartPaise` fields (task 10.2 adds those)
