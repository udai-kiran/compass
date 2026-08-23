# Task: 080 — Pantry & Price Watch UI (task 12.3)

## Status

COMPLETE

## Objective

Build the Pantry and Price Watch pages that display pantry stock levels with correction controls, and price history charts with buy-now-vs-wait and honesty flags.

## Root Cause

Placeholder pages exist from task 078; backend APIs exist from tasks 077 (pantry) and 076 (price history).

## Codex Review Findings (review-1, addressed)

- F1: Pantry mutations return 204/void → use raw fetch or handle empty response body
- F2: Price Watch needs item selection UI — use catalog list as selector
- F3: Source names not in PriceHistoryPoint → use usePriceSources hook to resolve IDs
- F4: AC2 conditional — correction only affects rate when habit exists; show "not enough history" otherwise
- F5: Invalidation: mutations must invalidate ["shopping", "pantry"] and ["shopping", "habits"]
- F6: Thin data: distinguish insufficient_data from stable (both have null recommendationPaise)
- F7: Multiple EmptyState scenarios: no pantry, no catalog items, no observations, no evidence
- F8: Chart data: use pricePaise only (integer), not unitPricePaisePerBase (can be fractional)
- F9: UI conventions: States.tsx, no libraries, formatINR/compactINR only

## Scope

### Backend routes consumed (do not modify)

- `GET /api/shopping/pantry` → PantryListResponse
- `POST /api/shopping/pantry/:catalogItemId/correct` → 204 void
- `POST /api/shopping/pantry/:catalogItemId/replenish` → 204 void
- `GET /api/shopping/habits` → HabitProfileListResponse
- `GET /api/shopping/catalog/:itemId/price-history` → PriceHistoryResponse
- `GET /api/shopping/catalog/:itemId/buy-wait` → BuyNowVsWait
- `GET /api/shopping/catalog/:itemId/honesty-check` → PriceHonestyResult (GET, query params)
- `GET /api/shopping/catalog` → CatalogItem[] (for item selection)
- `GET /api/shopping/sources` → PriceSource[] (for source name resolution)

### Files to modify

- `apps/web/src/routes/shopping/PantryPage.tsx` — replace placeholder
- `apps/web/src/routes/shopping/PriceWatchPage.tsx` — replace placeholder
- `apps/web/src/lib/shopping-queries.ts` — add pantry + price-history hooks

### New files

- `apps/web/src/routes/shopping/pantry-view.ts` — pure view-model helpers
- `apps/web/src/routes/shopping/pantry-view.test.ts` — tests for view helpers

## Dependencies

- task 077 (11.1) — pantry API routes (MUST complete first) ✅
- task 076 (10.7) — price history API routes (done) ✅
- task 078 (12.1) — nav group + placeholder pages (MUST complete first) ✅

## Plan

- P1: Write pantry-view helpers + tests FIRST (TDD: helpers before pages)
  - `formatDepletionEstimate(expectedDepletionAt, now)` → "3 days", "2 weeks", "depleted"
  - `formatConsumptionRate(rate, unit)` → "500g / month"
  - `chartDataFromPoints(points)` → { labels, series } for LineChart (pricePaise only, integer)
  - `trendLabel(trend, confidence)` → human-readable string
  - `honestyVerdict(flagged, maxObserved, claimed)` → explanation string
- P2: Extend shopping-queries.ts:
  - `usePantryItems()` → GET /pantry
  - `usePantryMutations()` → correct/replenish using raw fetch for 204 void responses
  - `usePriceHistory(itemId, sourceId?)` → GET /catalog/:itemId/price-history
  - `useBuyWait(itemId, sourceId?)` → GET /catalog/:itemId/buy-wait
  - `useHonestyCheck(itemId, sourceId, claimedMrpPaise, packQty?, unit?)` → GET honesty-check with query params
  - `usePriceSources()` → GET /sources (for name resolution)
  - Mutations invalidate ["shopping", "pantry"] and ["shopping", "habits"]
- P3: Build PantryPage:
  - List pantry items with stock level, unit, depletion estimate, consumption rate
  - Each item: inline correction control (quantity input + "Update" button)
  - Correction feedback: refetches pantry + habits to show updated rate (AC2)
  - Items with no habit profile: show "not enough purchase history" instead of rate
  - EmptyState when no pantry items
- P4: Build PriceWatchPage:
  - Catalog item selector (dropdown/list from useShoppingCatalog)
  - Selected item: LineChart of price history (pricePaise, integer, via compactINR)
  - Buy-now-vs-wait: show trend + confidence; "insufficient_data" → "Not enough data (X obs, Y days)"
  - Honesty check: input for claimed MRP, show flagged/not-flagged with evidence
  - Source names resolved from usePriceSources
  - EmptyState for: no catalog items, no observations, no evidence
- P5: Verify typecheck + lint + test + build

## Acceptance Criteria

- [x] AC1: Pantry levels shown with their basis; correction is one interaction and persistent
- [x] AC2: Correction visibly affects the learned consumption rate (reloads habit profile)
- [x] AC3: Price history charted from viz.tsx primitives only (LineChart/Sparkline)
- [x] AC4: Buy-now-vs-wait states confidence; refuses to advise on thin data
- [x] AC5: Inflated "was" prices flagged with observed history as evidence
- [x] AC6: Empty pantry and no-observation states use EmptyState
- [x] AC7: typecheck + lint + test + build pass

## Verification

- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/web` exits 0
- T4: `npm run build -w apps/web` exits 0

## Non-Goals

- Backend modifications
- Cart draft display (task 12.2)
