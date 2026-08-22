## High

1. Financial guards still omit delivery fees. The plan calls `useFinancialGuards(cartTotalPaise)` using the draft total ([TASK.md:82](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:82)), but `calculateDraftTotalPaise()` sums only item prices; it does not include source delivery fees. Consequently, the displayed “budget impact” can remain understated even when every item is priced. Include applicable delivery fees in the guard amount or explicitly disclose their exclusion.

2. AC1 requires editable quantity and unit, but the implementation plan specifies an editable quantity with a static “unit display” ([TASK.md:113](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:113)). The update contract requires both fields together ([shopping.ts:926](/work/personal/compass/packages/shared/src/schemas/shopping.ts:926)). The plan needs a unit control—preferably using the existing `useShoppingUnits()` hook—and tests for paired/null validation.

3. The test plan does not satisfy the repository’s TDD requirement that every acceptance criterion receive a failing test before implementation. P6 covers only pure helper functions ([TASK.md:133](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:133)); it does not test editing, mutation wiring, demo disabling, accessibility, empty/error states, sidebar badge behavior, or the accept transition. No API route-test file is listed either, despite P7 referring to “accept tests.” Add component/route tests mapped to AC1–AC10 and a real-database accept-route integration test.

## Medium

1. The promised inactive-source warning is absent from the planned view model and rendering. `SourceGroup` does not retain `isActive`, and P4 handles only unknown sources ([TASK.md:92](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:92), [TASK.md:108](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:108)). The inactive-source P6 test therefore has no specified observable behavior to assert.

2. The EMI section cannot ever receive non-null data through the proposed hook. `useFinancialGuards(cartTotalPaise)` supplies only the total ([TASK.md:82](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:82)), while the API returns EMI data only when `emiOffers` is supplied in the request query ([financial-guards.ts:17](/work/personal/compass/apps/api/src/modules/shopping/routes/financial-guards.ts:17), [financial-guards.ts:23](/work/personal/compass/apps/api/src/modules/shopping/routes/financial-guards.ts:23)). There is no separately configured server-side offer source. Either add an offer input/source to the hook or describe the section as unavailable; “when data available” is not reachable under the current plan.

3. The documented source and catalog response shapes are incorrect. Both existing hooks parse top-level arrays, not `{ sources: [...] }` or `{ items: [...] }` wrappers ([shopping-queries.ts:79](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:79), [shopping-queries.ts:305](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:305)). Correct [TASK.md:68](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:68)–[69](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:69) to prevent incorrect consumption in `CartPage`.

4. Removed-item subtotal behavior is unspecified. Removed items must remain rendered for Undo, but `groupItemsBySource()` merely says it receives `items` and calculates a subtotal ([TASK.md:92](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:92)). The backend excludes removed items from the draft total ([cart-drafts.ts:105](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:105)). Define source subtotals as active-item totals and add removed-item coverage so group subtotals reconcile with the summary.

5. The plan digests but does not carry forward two empty-state rules: a zero-item generated draft should say “No items need replenishment,” and an all-removed draft must disable Accept. Neither behavior appears in P4 or P6 ([TASK.md:98](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:98), [TASK.md:133](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:133)). Without these, an empty guide can be accepted and the zero-item case can be confused with having no draft.

6. Catalog lookup failure has no degraded-state behavior. Item names depend on `useShoppingCatalog()`, yet P4 only specifies independent handling for guard failure, while the revision’s broader failure rule mentions sources and guards but not catalog. A catalog outage would make every item appear deleted as “Unknown item.” Add an inline catalog-loading/error state distinct from the deleted-item fallback.

7. Accept introduces a terminal status, but the existing PUT and DELETE routes permit mutations regardless of status ([cart-drafts.ts:64](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:64), [cart-drafts.ts:118](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:118)). After acceptance, a stale client can still edit or abandon the ordered guide. Enforce `status = "draft"` on edit/abandon as well as accept, and make the accept transition conditional/transactional to avoid check-then-update races.

8. The accessibility requirements are present only in the digested notes, not the executable plan or tests. The abandonment dialog has no stated `role="dialog"`, `aria-modal`, Escape/backdrop behavior, focus trap/restoration, and the generate/abandon focus-management requirement has no test. Add these details to P4/P6.

## Low

None.