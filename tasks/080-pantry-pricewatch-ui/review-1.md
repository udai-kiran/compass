**Findings**

1. **High: pantry mutation hooks need explicit 204 handling.**  
   `POST /pantry/:catalogItemId/replenish` and `/correct` return `204` with `z.void()` responses ([pantry route lines 84-124](</work/personal/compass/apps/api/src/modules/shopping/routes/pantry.ts:84>)). The current `apiPost` always runs `await res.json()` before Zod parsing, so a naive `apiPost(..., z.void(), body)` hook will throw on an empty 204 body. The plan should call out either a shared no-content request helper or local raw `fetch` handling in `shopping-queries.ts`.

2. **High: the TDD order in the plan is backwards.**  
   `P4: Write pantry-view helpers + tests` comes after building both pages ([TASK.md lines 37-42](</work/personal/compass/tasks/080-pantry-pricewatch-ui/TASK.md:37>)), but `tasks/TDD.md` requires every unchecked AC to have a failing test before implementation. Also, only `pantry-view.ts/test.ts` is planned, but AC3-AC5 contain price-watch decisions that should be covered by pure helpers too.

3. **High: Price Watch lacks item and input scope.**  
   All price-watch routes require an `itemId` path param ([price-history route lines 57-101](</work/personal/compass/apps/api/src/modules/shopping/routes/price-history.ts:57>)), and honesty check additionally requires `claimedMrpPaise` as query string ([lines 43-51](</work/personal/compass/apps/api/src/modules/shopping/routes/price-history.ts:43>)). The task does not specify how the user selects a catalog item, enters a claimed “was”/MRP price, or optionally provides source/pack filters. Without that, AC5 cannot be implemented from the listed response contracts alone, because `PriceHistoryPoint` does not include `mrpPaise` or source names ([schema lines 580-583](</work/personal/compass/packages/shared/src/schemas/shopping.ts:580>)).

4. **Medium: source filtering/names are underspecified.**  
   The backend supports optional `sourceId` on history, buy-wait, and honesty-check ([price-history route lines 33-45](</work/personal/compass/apps/api/src/modules/shopping/routes/price-history.ts:33>)), but `PriceHistoryResponse` returns only source IDs in points, not source names. If the UI charts multiple sources or exposes a source selector, the plan needs hooks/scope for price sources; otherwise it should explicitly avoid source-named legends and filters.

5. **Medium: AC2 is conditional, not guaranteed for every correction.**  
   `correctPantry` only adjusts the learned rate when a habit exists with positive `consumptionBasePerMonth` ([pantry-management lines 197-230](</work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:197>)). If there is no habit profile, zero/null rate, no last purchase, or an upward correction, the visible rate may not change. The UI/test plan should define that AC2 applies to rows with an existing positive habit profile, and it should show a “not enough purchase history” basis otherwise.

6. **Medium: invalidation scope is missing.**  
   Pantry correction/replenishment should invalidate `["shopping", "pantry"]` and `["shopping", "habits"]`, not just the mutated row, because the mutation returns no body and AC2 explicitly requires reloading habit profile data. If Price Watch uses catalog/source selection, those query keys need stable item/source-scoped invalidation too.

7. **Medium: thin data states need stricter handling.**  
   `BuyNowVsWait` has two insufficiency thresholds: fewer than 5 observations or fewer than 3 distinct days ([schema lines 596-613](</work/personal/compass/packages/shared/src/schemas/shopping.ts:596>)). The UI should refuse advice only when `trend`/`confidence` is `"insufficient_data"` and state both counts. It should not confuse `stable` with insufficient data, since `stable` also has `recommendationPaise: null`.

8. **Medium: no-observation and no-evidence states need separate EmptyState coverage.**  
   AC6 says empty pantry and no-observation states use `EmptyState` ([TASK.md line 50](</work/personal/compass/tasks/080-pantry-pricewatch-ui/TASK.md:50>)). That should include: no pantry items, no catalog items to select for Price Watch, selected item with `points.length === 0`, and honesty check with `maxObservedPricePaise === null` / `evidence.length === 0` ([schema lines 621-631](</work/personal/compass/packages/shared/src/schemas/shopping.ts:621>)).

9. **Low: chart data should be normalized before `LineChart`.**  
   `LineChart` expects aligned `labels` and per-series numeric arrays and formats the y-axis with `compactINR` ([viz lines 158-183](</work/personal/compass/apps/web/src/lib/viz.tsx:158>)). Multi-source observations will need pure helper logic for grouping, date labels, missing values, and whether to chart `pricePaise` or `unitPricePaisePerBase`. Since `unitPricePaisePerBase` can be fractional/null ([schema lines 580-581](</work/personal/compass/packages/shared/src/schemas/shopping.ts:580>)), the plan should avoid passing nulls or misleading fractional paise to money-format chart axes without an explicit decision.

10. **Low: UI conventions to keep explicit.**  
   The implementation must use shared state components for loading/error/empty ([States lines 8-53](</work/personal/compass/apps/web/src/components/States.tsx:8>)), no new chart/form/date/icon libraries, and money formatting via `formatINR` or `compactINR` only ([UI.md lines 65-75](</work/personal/compass/tasks/UI.md:65>)). Correction controls also need demo-mode 403 surfaced clearly, keyboard-accessible controls, and narrow-width chart/table containment ([UI.md lines 74-85](</work/personal/compass/tasks/UI.md:74>)).