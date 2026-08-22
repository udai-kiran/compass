The replanned task is not ready for implementation. It does not adequately resolve any of review-1’s five High gaps; it mostly reclassifies canonical requirements as non-goals. No files were modified.

## High

1. **The proposed source grouping is not the canonical optimized platform split.**

   The plan assumes drafts are “already optimized” because items carry a source ID ([TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:19)). That is incorrect. Draft generation selects the latest price observation independently for each item; it does not run basket arbitrage, account for delivery fees or minimum-cart thresholds, or filter serviceability.

   The canonical spec requires fees, thresholds, ETA, and exclusion of non-serviceable platforms ([12.02-cart-review-ui.md](/work/personal/compass/tasks/12.02-cart-review-ui.md:17)). `PriceSourceSchema` does expose `deliveryFeePaise`, `minCartPaise`, and `deliveryEtaBand` ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:92)), so the plan could at least display those fields, but P2/P3 only specify source name and item subtotal. More importantly, neither draft items nor `GET /sources` establish location-specific serviceability. A draft may point to an inactive or non-serviceable source.

   This leaves review-1 H1 and H4 unresolved.

2. **The card recommendation and cap-arithmetic acceptance criterion is completely missing.**

   The canonical requirement to show the recommended card and visible offer-cap arithmetic is omitted from the replanned acceptance criteria and explicitly moved out of scope ([TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:25), [TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:129)). That is a scope change, not a resolution.

   The plan is correct that the current recommendation endpoint takes a shopping-list `listId`, not a draft ID, and that `CheckoutRecommendationSchema` does not expose selected-offer rate/cap evidence. Therefore this requires a backend contract change or a canonical-spec amendment. It cannot simply be deferred while task 12.2 is claimed complete.

   Review-1 H1 and H2 remain open.

3. **`CartDraftItemSchema` does not contain enough data for the claimed provenance strip.**

   It has price and source ID, but no:

   - source name;
   - price observation ID;
   - `observedAt`;
   - staleness flag;
   - immutable evidence tying the saved suggested price to a particular observation.

   See [shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:895). `usePriceSources()` can resolve a current source name, but it cannot recover the exact observation time. Calling the price “as of generation time” ([TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:28)) is inaccurate: the observation can predate generation by several days, and a newer or deleted observation can make a later lookup disagree with the draft snapshot.

   Consequently AC1/AC4 in the replanned plan are weaker than the canonical requirement for source plus observation time. Review-1 H3 is only partially addressed.

4. **There is no accept transition.**

   D5 says acceptance moves a draft to `ordered` “via DELETE or a future status endpoint” ([TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:31)). Neither is valid:

   - `DELETE /drafts/:id` sets status to `abandoned`, not `ordered` ([cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:118)).
   - No future or current accept/status route is in scope.
   - A client-only “Accept as shopping guide” would leave the draft pending and leave the sidebar badge unchanged.

   The plan must define a real advisory acceptance transition, remove the accept action, or obtain a canonical-spec decision. DELETE must not be repurposed as acceptance.

5. **Financial guards can present an understated partial total as the whole-cart impact.**

   Draft items permit `suggestedPricePaise: null`, while `totalPaise` sums only priced, non-removed items. The plan passes that total directly to the guard endpoint without tracking an unpriced count or labeling the result as a lower bound.

   A cart with ₹2,000 of known prices plus unpriced items would therefore show budget and goal impact as if ₹2,000 were the complete cart. A fully unpriced cart has total zero, and P1 disables the guard query entirely. Removed-all and empty-generated drafts have the same ambiguity.

   Review-1 H5 is not addressed.

6. **Editable quantity does not affect the draft total or guard results.**

   The update route accepts quantity/unit, but recalculates `totalPaise` using only `suggestedPricePaise` and `isRemoved` ([cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:82), [cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:105)). Changing quantity therefore leaves the displayed total and financial guards unchanged.

   The plan needs to state this limitation honestly or resolve the pricing semantics. Otherwise an “editable” cart produces apparently responsive fields with stale financial advice.

## Medium

1. **Existing-hook assumptions need correction.**

   `shopping-queries.ts` currently has no cart-draft, draft-count, or financial-guard hooks, so adding those is appropriate. However, `usePriceSources()` already exists and should be reused, not recreated ([shopping-queries.ts](/work/personal/compass/apps/web/src/lib/shopping-queries.ts:304)).

   The API list response is `{ drafts: CartDraftWithItems[] }`, not a bare array ([cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:24)). Its response schema is local to the API rather than exported from `@compass/shared`. Implementing the web hook would therefore require redeclaring a backend response shape, contrary to UI.md, unless `CartDraftListResponseSchema` is moved to shared scope.

2. **The plan’s item-name fallback is not supported by the draft schema.**

   `CartDraftItemSchema` has neither a catalog snapshot name nor raw item text. The `reason` field contains explanations such as “Expected to run out within 7 days,” not a product name. Thus “raw text via reason field” ([TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:34)) is incorrect.

   The existing catalog hook can resolve a live non-null `catalogItemId`, but deleted/null catalog references remain unnamed. The contract needs a display-name snapshot or the UI needs an explicit honest fallback such as “Unknown catalog item,” separate from the reason.

3. **The abandon mutation conflicts with the standard API helper.**

   The route returns an empty 204 response. `apiDelete()` always calls `res.json()`, so using the mandated helper will throw on a successful abandon. The plan does not identify this mismatch. It needs either a shared no-content-capable API helper or an explicitly justified raw-fetch path.

4. **The sidebar badge plan is underspecified.**

   `AppLayout` currently passes one `pending` number to `NavRow` and renders it only for `/inbox` ([AppLayout.tsx](/work/personal/compass/apps/web/src/layouts/AppLayout.tsx:119)). Adding Cart requires redesigning that API or passing per-route badge values.

   Unlike `useInboxCount()`, the proposed derived hook specifies no polling. It also needs cache invalidation after generate, abandon, and accept once acceptance exists. Because `GET /drafts` returns all statuses, the Cart page itself—not only the badge—must explicitly exclude or separately present `ordered` and `abandoned` drafts.

5. **Mutation UX and demo behavior are too vague.**

   “Mutations disabled, visual indicator” does not define:

   - how `me.isDemo` is obtained;
   - disabled states for generate, edit, remove/undo, accept, and abandon;
   - success feedback through `toast`;
   - handling a 403 if demo status changes or a mutation is invoked anyway;
   - preventing parallel edits;
   - confirmation for abandoning a draft;
   - restoring an accidentally removed item.

   The global layout already displays a demo-mode banner, but the page must still prevent or clearly surface every rejected mutation.

6. **The plan does not cover the independently failing query states.**

   A draft can load while sources or guards fail. An optional panel failure should not replace the whole cart with a page-level error. The plan should distinguish:

   - draft-list failure;
   - selected-draft failure;
   - source-name/logistics failure;
   - financial-guard failure;
   - generation/update/abandon failure.

   Query errors already produce global toasts, so it should not add duplicate per-call error toasts.

7. **Empty-state coverage is incomplete.**

   “No drafts” is only one case. The plan needs defined behavior for:

   - only abandoned or ordered drafts;
   - an active generated draft with zero items;
   - all items removed;
   - all items unpriced;
   - unknown/deleted catalog items;
   - null or unknown source;
   - inactive source;
   - unknown delivery fee, threshold, ETA, or serviceability;
   - multiple drafts and selection after the current one disappears;
   - generate returning today’s existing draft rather than creating a new one.

8. **“Generate new draft” is not always true.**

   Draft generation is idempotent for the current UTC day while a draft-status row exists. Clicking generate with today’s active draft returns the existing draft. The copy and escape-hatch criterion should not promise a new draft unless the current one has first been abandoned or the backend behavior changes.

9. **The InboxPage comparison is only structurally accurate.**

   `InboxPage` does demonstrate prefilled local state, editable cards, provenance-like source quotes, action bars, pending mutation states, toasts, and escape hatches. However, it does not use `PageLoading`, `PageError`, or `EmptyState` for its own primary states. The new page must follow UI.md’s current state-component rules rather than copying that part of InboxPage.

10. **EMI guard ownership remains unresolved.**

    Task 081 explicitly assigns guard UI to task 12.2, and `FinancialGuardsResponseSchema` includes `emi`. Task 083’s objective mentions EMI, but the implementation and acceptance criteria omit it and the non-goals reject it. If EMI input is unavailable on a draft, the plan should identify the actual future owner or reconcile task 081’s scope, rather than silently dropping it.

11. **The test plan is insufficient and ordered contrary to TDD.md.**

    P5 places tests after hooks/helpers/page implementation. Repository workflow requires each unchecked acceptance criterion to have a test written and observed failing first.

    Pure helper tests alone do not cover:

   - query URLs and response schemas;
   - enabled conditions;
   - mutation invalidation;
   - 204 abandon handling;
   - pending-count filtering;
   - incomplete-price warnings;
   - provenance observation time;
   - delivery logistics/serviceability;
   - badge rendering;
   - demo-mode disabling;
   - accept semantics.

    `shopping-queries.test.ts` and appropriate component/rendering coverage should be included in scope.

12. **The proposed price-label helper violates the money convention.**

    `priceProvenanceLabel()` is specified as manually producing `"₹X on SourceName"` ([TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:74)). Exact cart amounts must use `formatINR` from `@compass/shared`; currency strings must not be assembled manually. Pure helpers should return structured data or call the shared formatter.

13. **The escape hatches do not fully degrade wrong guesses.**

    The update schema only permits quantity, unit, and removal ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:926)). Users cannot change the product, suggested source, price, or substitution. Removal and abandonment are useful, but a wrong substitution cannot be reverted to the original item because only its UUID is retained and no restore-original action exists.

## Low

1. **The placeholder and route-availability assumptions are otherwise correct.**

   `CartPage.tsx` is currently only a heading plus “coming soon” `EmptyState`. All routes listed under “Backend routes consumed” exist and are registered:

   - draft generate/list/detail/update/abandon;
   - financial guard GET;
   - price-source GET.

   Important response details are: generate returns `GenerateDraftResponse`, draft list returns an object containing `drafts`, update is a full quantity/unit/removal body, and abandon returns 204.

2. **The shared schemas named by the plan do exist.**

   `CartDraftItemSchema`, `CartDraftWithItemsSchema`, and `FinancialGuardsResponseSchema` are present. The guard response provides nullable `budget`, `goals`, and `emi`; goal impact is represented as per-goal `delayMonths` plus a status discriminator. Helper tests need to cover every status and nullable branch rather than only a generic “goal/null” case.

3. **Navigation coordination is limited to the badge.**

   Cart is already present in `NAV_GROUPS`, the closed icon union, and the command palette. Since this task is not adding a new route entry, UI.md’s three-edit nav rule does not require new icon or palette changes. Only the badge behavior belongs in `AppLayout`.

4. **Accessibility and narrow-width verification are missing.**

   The plan should explicitly cover labeled quantity/unit controls, keyboard-operable remove/undo actions, announced mutation status, accessible confirmation behavior, and focus handling if a dialog is used. At narrow widths, source summaries and action bars must wrap or scroll internally without causing page-level horizontal overflow.

5. **The verification commands are correct but incomplete as acceptance evidence.**

   Typecheck, lint, web tests, and web build match UI.md. They should be run after criterion-level failing-first tests, and the task criteria/status should only be updated once each canonical criterion—not the reduced replanned subset—is satisfied.