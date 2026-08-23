**Findings**

1. **Medium: source-subset enumeration is finite but needs an explicit source cap.**  
   The plan’s `O(2^n sources)` approach at [tasks/072-basket-arbitrage/TASK.md:25](/work/personal/compass/tasks/072-basket-arbitrage/TASK.md:25) will not be infinite if implemented as bounded loops over arrays. With 11 sources, 2048 subsets is fine. The real risk is unbounded exponential work if the route fetches every user-created active source. The plan says “fine for n≤15” but does not say where that limit is enforced. Add a request/service guard like `sources.length <= 15`, and probably reject/trim inactive, non-serviceable, and unknown-serviceability sources before enumeration.

2. **Medium: “enumerate source subsets” is directionally right over greedy, but underspecified for min-cart constraints.**  
   Greedy per-item selection is not correct because delivery fees and min-cart thresholds couple item choices across a source. Example: two items are individually ₹10 cheaper on source B, but B adds a ₹50 delivery fee, so greedy loses. Exact enumeration is the right posture for task 10.3.  
   However, subset enumeration alone is only exact if, for each selected subset, the evaluator correctly solves assignment constraints. If min cart is a minimum order/subtotal requirement, “choose each item’s cheapest source within the subset” can miss valid cheaper assignments where one item is intentionally moved to meet a threshold. The plan should specify the per-subset assignment rule and add a fixture where the cheapest-item assignment fails a min-cart boundary but a slightly more expensive item move makes the source valid/optimal.

3. **Medium: route path should be clarified; implementation path must be relative.**  
   The plan says `POST /api/shopping/arbitrage` at [TASK.md:16](/work/personal/compass/tasks/072-basket-arbitrage/TASK.md:16). In this module, route files register relative paths because `shoppingRoutes` is mounted with `{ prefix: "/api/shopping" }` in [app.ts:153](/work/personal/compass/apps/api/src/app.ts:153), and [plugin.ts:13](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:13) documents that convention. So `routes/arbitrage.ts` should register `"/arbitrage"`, not `"/api/shopping/arbitrage"`.  
   Design-wise: if the optimizer is for a persisted shopping list, existing conventions point to `POST /lists/:id/arbitrage`. If it accepts an ad hoc basket in the request body, top-level `POST /arbitrage` is acceptable. The current plan says “given a shopping list” but also adds `BasketArbitrageRequestSchema`, so it should choose one explicitly.

4. **Medium: route snapshots are not mentioned.**  
   Adding a route will intentionally change the global route surface. The plan’s verification at [TASK.md:40](/work/personal/compass/tasks/072-basket-arbitrage/TASK.md:40) only mentions typecheck/lint/API tests. It should include the route snapshot gate in [app.route-snapshot.test.ts:80](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:80) and [app.route-snapshot.test.ts:120](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:120), with updates to `route-surface.snapshot.txt` and likely `route-table.snapshot.txt`.

5. **Low/Medium: `ArbitrageSourcePlanSchema` needs an auditable cost shape.**  
   The plan only names the schema at [TASK.md:13](/work/personal/compass/tasks/072-basket-arbitrage/TASK.md:13), so the risk is ambiguity. Each source plan should expose at least `sourceId`, source display metadata, `itemSubtotalPaise`, `deliveryFeePaise`, `minCartPaise`, `totalPaise`, and assigned item ids/lines. It should also preserve evidence for chosen prices, ideally `priceObservationId` and `observedAt`, since current price observations are point-in-time records with `observedAt` in [schema.ts:174](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:174).  
   Also make baseline fields nullable or explicitly absent when no single source can price all priced items; otherwise `savingVsBestSingleSourcePaise` becomes misleading for partially priced baskets. Keep `userId` out of response shapes, matching the shared schema convention at [shopping.ts:15](/work/personal/compass/packages/shared/src/schemas/shopping.ts:15).

**Answers To The Specific Checks**

1. No inherent infinite-computation risk from subset enumeration, but there is an exponential DoS/performance risk unless `n <= 15` is enforced before optimization.

2. Exact enumeration is better than greedy for this problem. But the plan must specify how assignments are optimized inside each source subset, especially around min-cart thresholds.

3. In code, register the route as `"/arbitrage"` under the shopping plugin. Whether the public URL should be `/api/shopping/arbitrage` or `/api/shopping/lists/:id/arbitrage` depends on whether the request is ad hoc basket input or tied to a persisted list. Given “shopping list,” I would prefer the sub-path.

4. No, route snapshots are not mentioned. They should be.

5. Main data-shape concern: make source plans cost-auditable and evidence-backed, and make baseline/savings semantics clear when prices are missing or no single-source baseline exists.