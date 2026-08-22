## High

1. **AC2 and AC3 cannot consume cart drafts with the existing backend contracts.** Task 079 creates independent draft/item IDs but no `listId` or conversion endpoint ([079 plan](/work/personal/compass/tasks/079-predictive-cart/TASK.md:51)). The platform optimizer is `POST /api/shopping/lists/:listId/arbitrage`, while `POST /api/shopping/recommend` also requires a shopping-list `listId` ([recommend route](/work/personal/compass/apps/api/src/modules/shopping/routes/checkout-recommendation.ts:17)). Task 083 does not even list the arbitrage route ([083 routes](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:14)). A draft therefore cannot produce either the requested split or recommendation. Resolve this in 079/083 by adding a draft-native optimizer/recommendation contract, a draft-to-list bridge, or an explicit list reference. That conflicts with 083’s “backend routes consumed (do not modify)” constraint.

2. **The recommendation response cannot display offer-cap arithmetic.** `CheckoutRecommendationSchema` exposes only allocated saving, points value, effective cost, and `cardAccountId`; it does not expose the selected offer, discount rate/kind, minimum spend, maximum cap, uncapped saving, or whether the cap was reached ([shared schema](/work/personal/compass/packages/shared/src/schemas/shopping.ts:642)). Even fetching all card offers would not reliably identify which tied/best offer the backend selected. AC3 requires an enriched recommendation response, such as selected-offer evidence and source/card display data, before the UI can show exact arithmetic.

3. **AC1/AC5 price provenance is unavailable from task 079’s planned draft contract.** Draft items contain `suggestedPricePaise` and `suggestedSourceId`, but no source name or `observedAt` ([079 schema plan](/work/personal/compass/tasks/079-predictive-cart/TASK.md:26)). Arbitrage evidence does contain an observation timestamp, but it is list-based and therefore unusable for the draft as currently designed. The plan must either enrich draft items with immutable price evidence or add price-source and observation queries and define how the exact originating observation is selected. AC5 should also clarify that provenance applies to observed item prices—not derived totals, budget values, fees, or savings.

4. **AC2 cannot guarantee location-correct serviceability.** The GET route returns all checks for a source, but task 083 defines no selected pincode or source for it. More importantly, the optimizer currently excludes a source if it has any `false` check for any pincode and includes sources with unknown serviceability ([arbitrage route](/work/personal/compass/apps/api/src/modules/shopping/routes/arbitrage.ts:66)). The recommendation accepts a pincode but its loader explicitly reserves and does not use it ([loader](/work/personal/compass/apps/api/src/modules/shopping/services/checkout-recommendation-loader.ts:37)). The plan needs a defined pincode source and backend filtering for that pincode; this is not safely repairable only in `CartPage.tsx`.

5. **Budget and goal guards can materially understate impact when draft prices are missing.** Task 079 permits `suggestedPricePaise: null` and calculates the total only from priced, non-removed items ([079 findings](/work/personal/compass/tasks/079-predictive-cart/TASK.md:18)). Task 081 accepts only `cartTotalPaise` ([081 route plan](/work/personal/compass/tasks/081-financial-guards/TASK.md:42)). Passing that partial total would present budget overage and goal delay as if the cart were complete. The plan must carry an `isComplete`/unpriced count into guard presentation and either suppress the result or label it explicitly as a priced-items-only lower bound.

## Medium

1. **AC7 is outside the declared file scope.** The pending-cart badge requires modifying [AppLayout.tsx](/work/personal/compass/apps/web/src/layouts/AppLayout.tsx:15), but task 083 lists only `CartPage.tsx` and `shopping-queries.ts` as modified files ([083 scope](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:23)). `AppLayout` currently has a hard-coded inbox-only badge and a single `pending` prop ([AppLayout.tsx](/work/personal/compass/apps/web/src/layouts/AppLayout.tsx:119)). Add `AppLayout.tsx` and `shopping-queries.test.ts` to scope, define pending as drafts with `status === "draft"`, and specify polling/invalidation after generate, edit, and abandon.

2. **Task 081’s EMI guard has no UI owner.** Task 081 includes EMI decomposition and explicitly assigns guard UI to task 12.2 ([081 plan](/work/personal/compass/tasks/081-financial-guards/TASK.md:36)), but task 083 covers only budget and goal results. Unless another task owns it, add EMI-offer input/results and graceful no-offer handling to 083 or explicitly move that UI elsewhere.

3. **The data-hook plan is incomplete.** The current [shopping-queries.ts](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:29) contains units, lists, catalog, and capture hooks only. P1 proposes draft/guard/recommend hooks, but the screen also needs platform split/arbitrage, price sources for ETA/display names, serviceability, and likely card display data. Each hook should use shared schemas, stable `["shopping", ...]` keys, `enabled` guards, and mutation invalidation. The existing hook tests should be extended rather than relying only on `cart-view.test.ts`.

4. **Loading, error, empty, and partial-result behavior is missing from both the plan and ACs.** The page has multiple independently failing requests. Define behavior for:

   - no drafts, empty generated draft, abandoned-only drafts;
   - unpriced or deleted-catalog items;
   - too few sources and unknown/stale serviceability;
   - no cards/offers and recommendations with only some priced items;
   - no budget/goals, as required by 081;
   - a successful draft load with failed guards/recommendation.

   Use `PageLoading`, `PageError`, and `EmptyState` from [States.tsx](/work/personal/compass/apps/web/src/components/States.tsx:8) without turning an optional-panel failure into a whole-page failure.

5. **Mutation UX and demo-mode behavior are unspecified.** Editing, removing, generating, and abandoning require pending/disabled states, success feedback, clear 403/demo feedback, and cache invalidation. Abandon also needs confirmation because it changes the draft status. These are repository UI conventions but are absent from AC1 and the plan.

6. **“Before accept” has no defined action or backend transition.** AC4 refers to acceptance ([083 AC4](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:46)), but the route set only supports generate, edit/remove, and abandon; 079 expressly keeps drafts as draft/abandoned. Define whether “accept” means a purely advisory “review complete/proceed externally” control, remove the term, or add an explicitly scoped transition. It must not imply that Compass orders or pays.

7. **The TDD sequence violates repository workflow.** The plan builds the page in P2 and writes helpers/tests in P3 ([083 plan](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:36)). Tests for each unchecked criterion must be written and observed failing first. The current test proposal also covers only pure helpers, not route/schema wiring, query keys, invalidation, badge counting, incomplete-price handling, or cap/provenance derivation.

8. **Editable-field semantics are underspecified.** Task 079’s update body contains `quantityBase`, `unit`, and `isRemoved` only; it does not permit changing the product, source, or price. AC1 should name exactly which fields are editable and define paired quantity/unit validation, zero quantity, removed-item visibility/undo behavior, and whether quantity changes recompute totals. Otherwise “fully editable” in 079 and “editable fields” in 083 invite incompatible implementations.

9. **Draft item display names need a fallback contract.** Task 079 allows `catalogItemId` to become null, and its draft item shape has no canonical name/raw text. A catalog query can resolve live IDs, but deleted items become unnamed. The response should include a display snapshot, or the UI plan should define an honest fallback using the reason rather than silently omitting the row.

10. **Dependent calculations need explicit refresh sequencing.** After quantity/removal edits, the draft total, guard results, split, recommendation, provenance, and sidebar count can all become stale. The plan should define invalidation/refetch order and prevent old async results from being displayed for the newly edited draft.

## Low

1. **The placeholder assumption is correct.** [CartPage.tsx](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:1) currently contains only a heading and `EmptyState` “coming soon” placeholder.

2. **Current versus future route availability should be documented explicitly.**

   - Available now: `POST /api/shopping/recommend` and `GET /api/shopping/sources/:sourceId/serviceability`.
   - Also available now but missing from task 083: `POST /api/shopping/lists/:listId/arbitrage` and `GET /api/shopping/sources`.
   - Added by 079: draft list/detail/generate/update/abandon routes.
   - Added by 081: `POST /api/shopping/guards/check`.

   No draft or guard routes are currently registered in the [shopping plugin](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:27). Task 079 is approved/in progress, while 081 remains planning, so 083 should remain blocked until their final shared schemas and response shapes land.

3. **The existing visual primitives are sufficient, but the plan should name their intended reuse.** `Meter` is appropriate for budget utilization and `StatTile` for totals; no new chart dependency is necessary ([viz.tsx](/work/personal/compass/apps/web/src/lib/viz.tsx:67)). All money display must use `formatINR` rather than `compactINR` for exact cart amounts; `compactINR` rounds values and is intended for axes.

4. **The task should add responsive and accessibility checks.** Platform splits are likely table-like and need contained horizontal overflow on narrow screens. Editable controls need labels, icon-only controls need `aria-label`, mutation status should be announced, and any confirmation dialog must support Escape, backdrop handling, and focus management.

5. **Dependency naming/status is inconsistent.** Task 083 refers generically to “task 078 — nav + placeholder,” while the repository task is `078-shopping-ui-lists`; it is marked complete despite unchecked criteria. Task 079 is marked `APPROVED`, while the checkpoint calls it implementing. Aligning task metadata will make the dependency gate auditable.