# Task: 071 — Platform Serviceability & Delivery ETA (task 10.2)

## Status
COMPLETE

## Objective
Extend `price_sources` with nullable delivery fee, minimum cart threshold, and delivery ETA band. Add `serviceability_checks` table (per source × pincode). Basket arbitrage (task 10.3) reads these fields. Unknown serviceability is `null` — never assumed available. Delivery address (pincode) never leaves the instance or appears in AI prompts.

## Root Cause
`price_sources` has no delivery-cost or serviceability fields. No serviceability data model exists.

## Scope
- `apps/api/src/modules/shopping/schema.ts` — add `deliveryEtaBand` pgEnum (`instant`, `same_day`, `next_day`, `scheduled` — null means unknown, NO `unknown` enum value); add nullable `deliveryFeePaise bigint`, `minCartPaise bigint`, `deliveryEtaBand` to `priceSources`; add `serviceabilityChecks` table (id uuid PK, userId uuid FK users, priceSourceId uuid FK priceSources, pincode text NOT NULL, isServiceable boolean nullable, observedAt timestamp NOT NULL, createdAt timestamp); CHECK constraints: deliveryFeePaise >= 0, minCartPaise >= 0; unique index (priceSourceId, pincode)
- `apps/api/drizzle/` — generate SQL migration (ALTER TABLE adds are nullable so safe for existing rows)
- `packages/shared/src/schemas/shopping.ts` — add `DeliveryEtaBandSchema` (z.enum literal), `ServiceabilityCheckSchema`, `CreateServiceabilityCheckSchema` (pincode, isServiceable nullable), extend `PriceSourceSchema` with new nullable fields, add `UpdatePriceSourceFullSchema`
- `apps/api/src/modules/shopping/services/serviceability.ts` — `upsertServiceabilityCheck(db, userId, sourceId, pincode, isServiceable)` (assertOwns sourceId); `listServiceabilityForUser(db, userId, pincode?)` with isStale (>24h); pincode NEVER sent to AI
- `apps/api/src/modules/shopping/routes/serviceability.ts` — GET /sources/:sourceId/serviceability, PUT /sources/:sourceId/serviceability/:pincode. Relative paths
- `apps/api/src/modules/shopping/plugin.ts` — register route
- `apps/api/src/modules/system/services/backup.ts` — add `serviceability_checks` to ALL_TABLES (after price_sources) + USER_TABLES (user_id)
- `apps/api/src/modules/shopping/schema.smoke.test.ts` — update table count (8→9), enum count (5→6), add serviceabilityChecks + deliveryEtaBand assertions; add price_sources new field assertions
- `apps/api/src/db/schema.decomposition.test.ts` — update shopping resident table set (add serviceability_checks) and enum set (add delivery_eta_band)
- `apps/api/src/modules/shopping/services/serviceability.test.ts` — unit tests for isStale (>24h), source ownership guard
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Dependencies
- task 070 (price source routes must exist first — though this task only adds fields)

## Plan
- P1: Add `deliveryEtaBand` enum + new fields to `priceSources` + `serviceabilityChecks` table in schema.ts
- P2: Run `npm run db:generate` to produce migration SQL; review for nullable ADD COLUMN correctness
- P3: Extend shared Zod schemas
- P4: Write `services/serviceability.ts` — upsert (conflict on sourceId+pincode), list with isStale, ownership guard
- P5: Write route file with relative paths; register in plugin.ts
- P6: Update backup.ts ALL_TABLES/USER_TABLES
- P7: Update schema.smoke.test.ts and schema.decomposition.test.ts
- P8: Write unit tests
- P9: Update route snapshot files

## Acceptance Criteria
- AC1: `price_sources` has nullable `deliveryFeePaise`, `minCartPaise`, `deliveryEtaBand` (null=unknown); CHECK constraints on non-negative
- AC2: `serviceabilityChecks` table: userId, priceSourceId, pincode, isServiceable (nullable), observedAt; unique (priceSourceId, pincode)
- AC3: `isServiceable: null` returned when serviceability unknown — never defaulted to true
- AC4: Stale serviceability (>24h) flagged in response with `isStale: true`
- AC5: `sourceId` ownership verified before upsert; cross-user returns 404
- AC6: `serviceability_checks` in ALL_TABLES (after price_sources) and USER_TABLES
- AC7: schema.smoke.test.ts and schema.decomposition.test.ts pass with updated counts
- AC8: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0

## Non-Goals
- Live serviceability API integration
- Geolocation (pincode only, not coordinates)
- Delivery slot availability (simpler ETA band is sufficient)
