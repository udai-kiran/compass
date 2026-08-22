## High

None.

## Medium

1. **All-unpriced drafts omit the required financial-impact disclosure (AC3 / P4).**  
   The entire guard banner is conditional on `summary.totalPaise > 0`. When every active item has `suggestedPricePaise: null`, the total is zero, so neither the guard request nor “Budget impact based on 0 of N priced items” is shown. The draft can still be accepted. Render the unpriced warning independently of whether the guards query is enabled.  
   [CartPage.tsx:222](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:222)  
   [shopping-queries.ts:385](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:385)

2. **Source loading and failure states falsely label sources as both unknown and inactive (P4, AC2).**  
   Until `usePriceSources()` resolves—or permanently if it fails—`sourcesMap` is empty. A known `suggestedSourceId` therefore becomes “Unknown source” with `isActive: false`, and because its ID remains non-null, the UI adds an “Inactive” badge. There is also no required inline “source details unavailable” error. This presents missing metadata as a factual inactive-source determination.  
   [CartPage.tsx:64](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:64)  
   [cart-view.ts:71](/work/personal/compass/apps/web/src/routes/shopping/cart-view.ts:71)  
   [CartPage.tsx:370](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:370)

3. **The abandon dialog does not meet the required focus behavior (P4 accessibility).**  
   Escape closes it by directly updating state and does not restore focus to the Abandon button. Focus is not trapped, so Tab can move into content behind the modal. Backdrop and Cancel restoration work, but the approved accessibility requirements cover Escape and modal focus containment as well.  
   [CartPage.tsx:194](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:194)  
   [CartPage.tsx:331](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:331)  
   [CartPage.tsx:576](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:576)

4. **Accept and abandon status guards are vulnerable to a check/update race (P1 / AC10).**  
   Both routes read the status and then update using only `id` and `userId`. A concurrent accept/abandon after the read can be overwritten, despite the requirement that transition updates be restricted to `status = 'draft'`. The status predicate should be part of the update itself, with affected-row validation or a locking transaction.  
   [cart-drafts.ts:70](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:70)  
   [cart-drafts.ts:77](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:77)  
   [cart-drafts.ts:152](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:152)  
   [cart-drafts.ts:159](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:159)

5. **The accept-route test does not prove that persistence transitions the draft (P6 / AC10).**  
   The fake update is a no-op, while `getDraftWithItems` always returns an already-ordered fixture. Thus the happy-path test would still pass if the update were deleted or wrote the wrong status. It also mocks a Drizzle-style database chain, contrary to the contributor rule requiring real-database integration tests for persistence behavior and P7’s “real route test” wording.  
   [cart-drafts.hermetic.test.ts:26](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts:26)  
   [cart-drafts.hermetic.test.ts:51](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts:51)  
   [cart-drafts.hermetic.test.ts:91](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts:91)  
   [cart-drafts.hermetic.test.ts:132](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts:132)

6. **Generate, accept, and abandon failures produce duplicate toasts.**  
   The application-level `MutationCache` already toasts mutation errors, but these three call sites add their own `onError` toast. This directly conflicts with the plan’s “No duplicate toasts (global handler covers it)” requirement.  
   [CartPage.tsx:81](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:81)  
   [CartPage.tsx:179](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:179)  
   [CartPage.tsx:187](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:187)  
   [main.tsx:127](/work/personal/compass/apps/web/src/main.tsx:127)

7. **Most acceptance criteria have no UI/query tests (P6 and repository TDD policy).**  
   The 26 helper tests cover the five pure helpers, and the eight route tests cover route responses, but there are no tests for the new hooks, raw 204 abandon behavior, 60-second draft count, sidebar badge, loading/error/empty states, demo disabling, unpriced disclosure, mutation controls, source metadata, or dialog accessibility. AC1–AC9 therefore lack the criterion-level regression coverage required by `tasks/TDD.md`.

## Low

1. **Multiple active drafts are all rendered instead of using the planned selector.**  
   P4 requires tabs/cards to select one when multiple draft-status carts exist. The implementation maps every active draft onto the page, and generate does not explicitly select/focus the returned draft.  
   [CartPage.tsx:124](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:124)

2. **Catalog loading does not use skeleton names, and brands are never displayed.**  
   While the catalog query loads, the empty map makes every item read “Unknown item.” The plan called for skeleton names during loading and canonical name plus brand when available. Error degradation is present, but it repeats “Item names unavailable” in every row.  
   [CartPage.tsx:69](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:69)  
   [CartPage.tsx:436](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:436)

3. **Unknown source IDs are not consolidated into the unknown-source group.**  
   `groupItemsBySource` retains an unresolved UUID as the grouping key despite its documentation saying null/unknown IDs enter the “Unknown source” group. Multiple unresolved IDs produce multiple indistinguishable groups, and the test checks only the label rather than the key/grouping behavior.  
   [cart-view.ts:61](/work/personal/compass/apps/web/src/routes/shopping/cart-view.ts:61)  
   [cart-view.ts:72](/work/personal/compass/apps/web/src/routes/shopping/cart-view.ts:72)

4. **The item editor mishandles contract-valid null quantity/unit pairs.**  
   `CartDraftItemSchema` permits both fields to be null. The UI substitutes `"piece"` for a null unit while retaining a null quantity, so blur, unit change, and remove/undo can send the schema-invalid pair `{ quantityBase: null, unit: "piece" }`. Current generation normally supplies both fields, but the UI should still safely handle every valid API response.  
   [CartPage.tsx:432](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:432)  
   [CartPage.tsx:442](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:442)  
   [CartPage.tsx:466](/work/personal/compass/apps/web/src/routes/shopping/CartPage.tsx:466)

5. **P7 / AC11 is not fully verified.**  
   In this review, global typecheck and lint passed, all 342 web tests passed, the 8 new hermetic tests passed, and both route snapshots passed. The full API workspace test exited nonzero because `DATABASE_URL` was unavailable, producing 33 environment-dependent failures. The web build was not run because this review was required to remain strictly read-only. AC11 therefore cannot yet be certified.

## Plan and acceptance summary

- P1: Implemented, but transition updates are non-atomic.
- P2: All requested hooks/mutations are present; abandon correctly uses raw `fetch`.
- P3: Core calculations are correct and use `formatINR`; unresolved-source grouping has the noted defect.
- P4: Substantially implemented, with the guard, source-state, selector, catalog-loading, and dialog gaps above.
- P5: Sidebar badge is implemented for `/shopping/cart`.
- P6: All five helpers have tests; persistence and UI/query coverage are insufficient.
- P7: Partially verified only.

AC4, AC5, AC7, AC8, and AC9 are satisfied in the inspected code. AC1, AC2, AC3, AC6, AC10, and AC11 are partial because of the findings above.

The specifically requested checks otherwise pass: `sourcesMap` is threaded through `DraftCard → SourceGroupSection → CartItemRow`; currency rendering uses `formatINR`; no auto-categorization was added; the 204 abandon call does not use `apiDelete`; and every rendered mutation control is disabled in demo mode.