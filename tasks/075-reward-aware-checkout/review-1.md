**Findings**

1. **Utilization guard is underspecified and can be implemented incorrectly.**  
   `cardIssuerSettings` is issuer-level, keyed by `(userId, institution)`, not per card. The threshold is `utilizationAlertPct`, nullable, default `30`; `null` disables alerts. See [schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:85) and [cards.ts](/work/personal/compass/apps/api/src/modules/credit/services/cards.ts:219).  
   The plan’s “card details” fetch is not enough. The route/service must load each credit card’s `accounts.institution`, issuer settings, issuer-level `creditLimitPaise`, issuer-level current owed, and then test `(totalOwedPaise + proposedSpendPaise) / creditLimitPaise` against `utilizationAlertPct`. Cards with no institution/settings need an explicit policy.

2. **Offer selection should be “single best applicable offer per source × card”, not just per source.**  
   The Non-Goal “single best offer per source per visit” is reasonable for an MVP if the product is intentionally avoiding stacking. But “per source” alone is too coarse because offers are issuer/card-product specific from task 073. The optimizer must evaluate the best applicable offer for each portal basket and candidate card, otherwise it can pair Card A’s offer with Card B’s rewards. Update the wording to “single best applicable offer per source/card per visit; no combining multiple offers.”

3. **Route data loading is acceptable only as orchestration; the plan should add a DB-backed facade service.**  
   Existing shopping routes are thin and delegate work to services. The plan already has a pure `recommendCheckout(...)` service, which is good, but “route: fetch arbitrage result, active offers, reward rules, card details” at [TASK.md](/work/personal/compass/tasks/075-reward-aware-checkout/TASK.md:30) is large enough to hide business logic in the handler. Prefer a route that validates/session-loads only, then calls a DB-backed service like `buildCheckoutRecommendation(db, userId, input)` which gathers arbitrage/offers/rules/cards/utilization and then calls the pure scorer.

4. **Route snapshots are not mentioned.**  
   Adding `POST /api/shopping/recommend` changes the canonical route surface and raw route table. The repo has explicit snapshot gates in [app.route-snapshot.test.ts](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:17). The plan’s verification only lists typecheck/lint/API tests, so it should add regenerating/verifying `apps/api/src/route-surface.snapshot.txt` and `apps/api/src/route-table.snapshot.txt`.

5. **Path is conceptually right, but route file registration must use shopping’s relative-path convention.**  
   Public API path `POST /api/shopping/recommend` matches the module prefix pattern. However, shopping route files are registered under `{ prefix: "/api/shopping" }`, and the plugin docs say route files declare relative paths like `/units`, not full `/api/...` paths. See [plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:13). So `routes/checkout-recommendation.ts` should register `POST "/recommend"`, while the task can keep documenting the resolved path as `POST /api/shopping/recommend`.

**Open Questions**

Should cards with missing issuer settings be skipped for utilization-sensitive recommendations, or allowed with a “threshold unavailable” explanation? The current schema allows missing settings, and `null` threshold explicitly disables the guard, so the plan should choose this behavior before implementation.