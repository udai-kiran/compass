**Findings**

1. **High: Raw price comparisons ignore pack size/unit.**  
   The plan compares `pricePaise` directly for both trend and honesty checks ([TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:27), [TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:28)), but `price_observations` explicitly stores observation-level `packQuantityBase` and `unit`, and says the pack size may differ from the catalog default ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:190)). Comparing 500g and 1kg pack prices as absolute paise will produce false trends and false honesty flags. The plan should either filter to same `(packQuantityBase, unit)` or normalize to unit price before trend/max comparisons, and preserve pack metadata in evidence/history responses.

2. **Medium: Honesty threshold is hardcoded, not documented as configurable.**  
   The plan states `claimedMrpPaise > 1.1× maxObserved` and AC3 says `>110%` ([TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:28), [TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:35)). There is no mention of config/env, a named policy constant, or schema field exposing the threshold. If configurability is expected, the plan is missing it. If not, it should still name/document the constant and return the applied threshold for explainability.

3. **Medium: Route snapshot updates are not mentioned.**  
   The plan adds three routes and registers them in the shopping plugin ([TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:16), [TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:17)), but does not mention updating route snapshots. The repo has a route-surface snapshot and raw route-table snapshot gate ([app.route-snapshot.test.ts](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:80), [app.route-snapshot.test.ts](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:120)); adding routes will change both.

4. **Medium: `POST /honesty-check` is semantically acceptable but has repo-specific side effects.**  
   POST is reasonable for a computed check with a request body, especially to avoid logging `claimedMrpPaise` in a URL. However, this repo treats `POST` as mutating for demo blocking and CSRF/rate-limit policy: demo sessions are rejected for `POST` unless allowlisted ([auth.ts](/work/personal/compass/apps/api/src/plugins/auth.ts:16), [auth.ts](/work/personal/compass/apps/api/src/plugins/auth.ts:66)), and security applies write bucket/CSRF to `POST` ([security.ts](/work/personal/compass/apps/api/src/plugins/security.ts:9), [security.ts](/work/personal/compass/apps/api/src/plugins/security.ts:69)). If honesty-check is read-only and should work in demo/read-only mode, GET or an explicit auth-policy adjustment is needed.

5. **Low/Medium: `MIN_OBSERVATIONS=5` is a reasonable floor, but count alone is weak.**  
   Refusing advice below 5 observations is sensible as a minimum guard ([TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:7), [TASK.md](/work/personal/compass/tasks/076-price-history/TASK.md:27)). But 5 observations clustered in one hour are not equivalent to 5 observations over weeks. The plan should also require a minimum time span or distinct observation days before returning a directional trend.

**Direct Answers**

1. Linear regression is okay with non-uniform spacing if implemented as price versus actual elapsed time, as the plan says. It would be wrong if implemented against array index. Also guard zero time variance and clustered samples.

2. `MIN_OBSERVATIONS=5` is a reasonable lower bound, but not sufficient by itself.

3. No, the 110% inflation threshold is not documented as configurable.

4. Different pack sizes currently break the plan’s comparisons unless the implementation normalizes or filters by `packQuantityBase`/`unit`.

5. Route snapshots are not mentioned, and they should be.

6. GET for price-history/buy-wait is appropriate. POST for honesty-check is acceptable API design, but in this repo it will be treated as mutating for demo/CSRF/rate-limit behavior, so that needs an explicit decision.