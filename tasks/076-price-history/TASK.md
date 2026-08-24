# Task: 076 — Price History, Buy-Now-vs-Wait & Honesty Check (task 10.7)

## Status
COMPLETE

## Objective
Two read-only features over `price_observations` history: (1) price history per item/source; (2) buy-now-vs-wait trend with confidence signal — refuses to advise below MIN_OBSERVATIONS=5 AND minimum time span (≥3 distinct days); (3) price-honesty check — compares claimed MRP against Compass's observed history for same pack size, flags inflated reference prices. All routes are GET (honesty-check uses query params to avoid POST/CSRF issues).

## Root Cause
`price_observations` table exists but no history analysis service or routes exist.

## Scope
- `packages/shared/src/schemas/shopping.ts` — add:
  - `PriceTrendSchema` (z.enum `rising|falling|stable|insufficient_data`)
  - `TrendConfidenceSchema` (z.enum `low|medium|high|insufficient_data`)
  - `PriceHistoryPointSchema` (pricePaise, unitPricePaisePerBase nullable, packQuantityBase nullable, unit nullable, sourceId, observedAt)
  - `PriceHistoryResponseSchema` (catalogItemId, sourceId nullable, points: PriceHistoryPointSchema[])
  - `BuyNowVsWaitSchema` (trend: PriceTrendSchema, confidence: TrendConfidenceSchema, minObservationsRequired: 5, observationCount: number, distinctDaysRequired: 3, distinctDayCount: number, recommendationPaise: number|null — null when insufficient_data)
  - `PriceHonestyResultSchema` (catalogItemId, sourceId, claimedMrpPaise, maxObservedPricePaise: number|null, INFLATION_THRESHOLD_PCT: 110, flagged: boolean, evidence: PriceHistoryPointSchema[])
- `apps/api/src/modules/shopping/services/price-history.ts`:
  - STALE constants: MIN_OBSERVATIONS = 5, MIN_DISTINCT_DAYS = 3, INFLATION_THRESHOLD_PCT = 110 (named exports)
  - `getPriceHistory(db, userId, catalogItemId, sourceId?)` → PriceHistoryPoint[] sorted by observedAt asc; filter to same (packQuantityBase, unit) group if sourceId provided, or group by pack size and return all; compute unitPricePaisePerBase = pricePaise / packQuantityBase when available
  - `analyzeTrend(points: PriceHistoryPoint[])` → BuyNowVsWait: if <5 obs or <3 distinct days → `{trend: "insufficient_data", confidence: "insufficient_data", recommendationPaise: null}`; else linear regression of pricePaise vs elapsed milliseconds (time as x-axis, not array index); slope > 1 paise/day = rising; slope < -1 paise/day = falling; else stable; confidence: 5-9→low, 10-19→medium, ≥20→high
  - `checkPriceHonesty(db, userId, catalogItemId, sourceId, claimedMrpPaise, packQuantityBase?, unit?)` → PriceHonestyResult: fetch observations for same pack size in last 30 days; maxObservedPricePaise = max(pricePaise); flagged = maxObserved > 0 AND claimedMrpPaise > maxObserved * INFLATION_THRESHOLD_PCT / 100
- `apps/api/src/modules/shopping/services/price-history.test.ts`:
  1. 0 obs → insufficient_data
  2. 4 obs, 4 distinct days → insufficient_data (< MIN_OBSERVATIONS)
  3. 5 obs, 2 distinct days → insufficient_data (< MIN_DISTINCT_DAYS)
  4. 5 obs, 3 distinct days, rising prices → trend: rising, confidence: low
  5. Claimed MRP ₹1000, max observed ₹850 (>110%) → flagged: true
  6. Claimed MRP ₹1000, max observed ₹950 (<110%) → flagged: false
  7. No observations in window → flagged: false (not enough data)
  8. Different pack sizes excluded from honesty check (filter by packQuantityBase+unit)
- `apps/api/src/modules/shopping/routes/price-history.ts`:
  - `GET /catalog/:itemId/price-history?sourceId=` → PriceHistoryResponse
  - `GET /catalog/:itemId/buy-wait?sourceId=` → BuyNowVsWait
  - `GET /catalog/:itemId/honesty-check?sourceId=&claimedMrpPaise=&packQuantityBase=&unit=` → PriceHonestyResult (GET not POST — avoids demo-block/CSRF; params in query string)
  - All relative paths
- `apps/api/src/modules/shopping/plugin.ts` — register route
- `apps/api/src/route-surface.snapshot.txt` — add
- `apps/api/src/route-table.snapshot.txt` — add

## Dependencies
- task 070 (price observations must exist)
- Parallel to 071/072/073/074

## Plan
- P1: Add shared Zod schemas
- P2: Write `services/price-history.ts` with named constants, pack-size filtering, linear regression
- P3: Write 8 unit test cases
- P4: Write route file (all GET); register in plugin.ts
- P5: Update route snapshots

## Acceptance Criteria
- AC1: `analyzeTrend` with <5 observations → `{trend: "insufficient_data", recommendationPaise: null}`
- AC2: `analyzeTrend` with <3 distinct observation days → `{trend: "insufficient_data"}` even if ≥5 observations
- AC3: Trend uses linear regression with time as x-axis (not array index)
- AC4: `INFLATION_THRESHOLD_PCT = 110` named constant; returned in response for explainability
- AC5: Honesty check filters to same (packQuantityBase, unit) — no cross-pack-size comparison
- AC6: No observations in 30-day window → `flagged: false`, `maxObservedPricePaise: null`
- AC7: All 3 routes are GET (no CSRF/demo issues)
- AC8: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0 with all 8 price-history test cases visible

## Non-Goals
- viz.tsx chart component (frontend — phase 12)
- ML-based prediction (linear regression only)
- Configurable threshold via UI/API (named constant is sufficient)
