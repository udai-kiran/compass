# Task: 072 — Basket Arbitrage Optimizer (task 10.3)

## Status
COMPLETE

## Objective
Pure deterministic service: given a shopping list (persisted, via `POST /lists/:id/arbitrage`), find the cheapest way to split items across serviceable platforms, accounting for delivery fees and minimum-cart thresholds. Not an LLM call. Outputs the split, total cost, and saving vs best single-source. Items without prices listed in `unpricedItems` — never silently dropped. All arithmetic integer paise. Source cap: ≤15 active serviceable sources.

## Root Cause
No optimizer service exists.

## Scope
- `packages/shared/src/schemas/shopping.ts` — add:
  - `ArbitrageSourcePlanSchema` (sourceId, sourceName, itemSubtotalPaise, deliveryFeePaise, minCartPaise, totalPaise, assignedItemIds[], priceEvidenceByItemId: Record<itemId, {pricePaise, observedAt}>)
  - `BasketArbitrageResultSchema` (splits: ArbitrageSourcePlanSchema[], grandTotalPaise, bestSingleSourceTotalPaise, savingPaise, unpricedItemIds: string[], tooFewSources: boolean)
- `apps/api/src/modules/shopping/services/basket-arbitrage.ts` — pure optimizer:
  - Input type: items[], sources[] (with deliveryFeePaise, minCartPaise), priceMap: Map<itemId×sourceId, pricePaise>
  - Algorithm: enumerate all non-empty subsets of sources (cap n≤15, guard with thrown Error if >15); for each subset, assign each priced item to cheapest source in subset; verify min-cart per source (add to source if threshold met, else add delivery anyway if item must come from there — see note); compute grand total; find minimum. Return unpriced items separately
  - NOTE on min-cart: if a source in the subset has totalItems < minCartPaise, that assignment still includes deliveryFeePaise (threshold not met = full delivery cost applies)
  - `computeBestSingleSource(...)` helper for baseline delta
- `apps/api/src/modules/shopping/services/basket-arbitrage.test.ts` — 6+ hand-computed fixtures:
  1. All items on one source (no split)
  2. Split saves more than delivery fees
  3. Split is WORSE than single source (3 platforms × ₹40 fee) — single source returned
  4. Missing prices on some items — unpricedItems populated
  5. Min-cart threshold: item assignment meets threshold → no delivery fee wasted
  6. Min-cart boundary: two cheap items meet threshold exactly
- `apps/api/src/modules/shopping/routes/arbitrage.ts` — `POST /lists/:listId/arbitrage` (relative path). Load list items, fetch active serviceable observations for user's home pincode, cap to ≤15 sources, call optimizer, return result
- `apps/api/src/modules/shopping/plugin.ts` — register route
- `apps/api/src/route-surface.snapshot.txt` — add new route
- `apps/api/src/route-table.snapshot.txt` — add new route

## Dependencies
- task 070 (price observations)
- task 071 (serviceability + delivery fields on price_sources)

## Plan
- P1: Add shared schemas (ArbitrageSourcePlanSchema, BasketArbitrageResultSchema)
- P2: Implement `optimizeBasket` pure function — subset enumeration with source cap guard
- P3: Implement `computeBestSingleSource` helper
- P4: Write 6+ unit test fixtures (hand-computed)
- P5: Write route handler (load data, filter serviceable, cap, call optimizer)
- P6: Register route in plugin.ts
- P7: Update route snapshot files

## Acceptance Criteria
- AC1: Optimizer accounts for delivery fees and minimum-cart thresholds
- AC2: Output: splits[], grandTotalPaise, bestSingleSourceTotalPaise, savingPaise, unpricedItemIds
- AC3: When splitting is worse than single source, bestSingleSource returned as recommendation
- AC4: Items without price observations in `unpricedItemIds` — not in cost calculation
- AC5: All arithmetic integer paise; no floats
- AC6: Source cap ≤15 enforced before enumeration (throws Error if violated — caught by route handler → 400)
- AC7: Unit tests pass including the "split is worse" and min-cart boundary cases
- AC8: Route path: `POST /api/shopping/lists/:listId/arbitrage` (relative: `/lists/:listId/arbitrage`)
- AC9: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0 with all 6+ basket-arbitrage test cases visible in output

## Non-Goals
- LLM involvement in arithmetic
- Card offers or rewards (task 10.6)
- Slot-based scheduling optimization
