# Task: 083 — Cart Review Screen UI (task 12.2)

## Status
COMPLETE

## Final verdict (2026-08-22)
F1–F9 implemented and independently verified. Codex review-7 found no remaining 083 defects. Deferred by prior reviews: UI tests, dialog a11y, hermetic SQL-predicate observation, prettier sweep, full DATABASE_URL API suite. No unapproved leftover 083 work.

## Codex Review-6 Findings — Digested

### Must Fix
- **F9: Successful abandon shows an error toast.** `toast("Draft abandoned")` uses the helper default `kind="error"`. Pass `"success"` like generate/accept.

### Accepted
- F8 has no extracted pure-function tests — already deferred UI-test limitation.
- Prettier drift in in-scope files — lint passes; not a Review-4/5 AC. Do not expand into a formatting sweep.

### F1–F8 after Review-6
All present in source. No new conceptual defects.

## Codex Review-5 Findings — Digested

### Must Fix
- **F7 (M1): Edit races with accept.** PUT `/drafts/:id/items/:itemId` still reads status then writes the item. Accept can commit in between and the edit still mutates an ordered cart. Accept/abandon are atomic (F3); edit is not. Fix: claim the draft row with `UPDATE ... WHERE status='draft' RETURNING` at the start of the existing transaction (row lock), then edit; 0 rows → 400.

### Accepted (deferred / already decided)
- **M2 (hermetic F3 tests don't observe the WHERE predicate):** Same limitation as Review-4 M5. No DB in CI; cannot add a real-Postgres integration test here. Not blocking this pass.
- **M4 (full API suite / AC11):** Pre-existing DATABASE_URL-gated failures. Unchanged.
- **M5 (no UI tests for F1/F2/F4/F6):** Same as Review-4 M7. Impractical with node:test. Not blocking.
- **L1 (abandon dialog focus):** Already deferred as Review-4 M3.
- **L2 (selector / skeleton / brands / substitution copy):** Already deferred as Review-4 L1/L2.
- **L3 (useShoppingUnits per group):** Deduped by TanStack Query. Non-blocking.
- **L4 (duplicated generate button):** Cosmetic.

### Optional / adjacent (include if cheap)
- **F8 (M3): Quantity editor stale/invalid state.** `parseInt` silently truncates `1.5`; local qty/unit never resyncs from props; clearing the field sends nothing. Specify: sync from props; reject non-integer / empty by restoring the last persisted pair; do not persist an invalid pair.

## Codex Review-4 Findings — Digested

### Must Fix
- **F1 (M1): All-unpriced guard warning.** When totalPaise=0, guard query disabled and no unpriced disclosure shown. Show unpriced warning independently.
- **F2 (M2): Source loading → false "Inactive".** Empty sourcesMap during loading makes known sources appear as "Unknown + Inactive". Show loading indicator or skip inactive badge when sources not loaded.
- **F3 (M4): Accept/abandon race.** Read-then-update without status predicate in UPDATE. Fix: `UPDATE WHERE status='draft' RETURNING`, check 0 rows.
- **F4 (M6): Duplicate toasts.** CartPage adds onError handlers but global MutationCache already toasts. Remove onError handlers.
- **F5 (L3): Unknown sourceIds not consolidated.** Items with different unknown sourceIds create separate groups. Consolidate unresolved sourceIds.
- **F6 (L4): Null qty/unit in editor.** UI defaults unit to "piece" when null but qty stays null → invalid pair. Handle null qty gracefully.

### Accepted (deferred)
- M3 (dialog focus): Minor a11y gap. Defer.
- M5 (hermetic test limits): Expected — no DB in CI.
- M7 (no UI tests): Impractical with node:test.
- L1 (multiple drafts vs selector): Minor UX, showing all is valid.
- L2 (skeleton names): Minor UX. Defer.

## Objective
Replace the CartPage.tsx placeholder with the cart review page — the centrepiece of the shopping surface. Shows draft cart with editable items, per-source grouping with delivery logistics, financial guards (budget/goal), price provenance, and escape hatches. Follows the InboxPage structural pattern: pre-filled editable draft cards, review-then-accept. Nothing is ordered or paid.

## Root Cause
CartPage.tsx is a placeholder `<EmptyState>` from task 078.

## Dependencies
- task 079 (11.2, cart drafts API) — done
- task 081 (11.3, financial guards API) — done
- task 078 (12.1, nav + placeholder) — done

## Codex Review-2 Findings — Digested

### Confirmed (must address)
- **H1/H4: Source grouping is not optimized arbitrage.** Draft items carry one source each from latest price, not an optimized split. The UI must honestly present this as "suggested source" grouping, not an optimized platform split. Show source delivery fee/minCart/ETA from `usePriceSources()`. Note inactive/unknown source. Do NOT claim optimization.
- **H2: Card recommendation needs draft-native endpoint.** `POST /recommend` takes `listId`, not `draftId`. `CheckoutRecommendationSchema` lacks offer cap details. This is a genuine backend gap. **Decision: omit card recommendation with an explicit "not available for draft carts" note. The canonical AC3 cannot be fully met without backend work. Note this honestly in the UI.**
- **H3: CartDraftItemSchema lacks observedAt.** No observation timestamp in draft items. Provenance shows source name only with "as of draft generation" caveat. Honest but incomplete vs canonical requirement.
- **H4 (accept transition): DELETE is abandon, no accept route exists.** **Decision: add a minimal backend endpoint `POST /drafts/:id/accept` → set status='ordered', return 200.** This is a 5-line backend addition — acceptable scope creep to close the gap. Without it, the UI has no way to distinguish accepted from abandoned.
- **H5: Understated partial total.** Track and display unpriced-item count. Guard banner shows "Budget impact based on N of M priced items" when items are unpriced.
- **H6: Quantity edit doesn't affect total.** Backend recalculates total from `suggestedPricePaise * active items`, not from user-edited quantities. Show advisory note: "Total based on suggested prices, not adjusted for quantity changes."

### Confirmed (medium, must address)
- **M1: `usePriceSources()` exists** — reuse it, don't recreate.
- **M2: Item names from catalog, not reason field.** `reason` contains "Expected to run out within 7 days", not product names. Use `useShoppingCatalog()` to resolve `catalogItemId` → `canonicalName`. Unknown/deleted items → "Unknown item".
- **M3: DELETE returns 204 — apiDelete parses JSON.** Use raw fetch + manual invalidation for abandon, not apiDelete helper.
- **M4: Badge needs per-route passing.** NavRow gets `pending` for inbox only (hardcoded `item.to === "/inbox"`). Add a `draftCount` prop and render for `/shopping/cart`.
- **M5: Demo mode.** Use `useMe()` to check `me.isDemo`. Disable generate/edit/remove/accept/abandon buttons. Show "Demo mode — changes disabled" note.
- **M6: Independent query failures.** Draft-list failure → PageError. Source/guard failure → degraded panels with inline error, not page-level error. No duplicate toasts (global handler covers it).
- **M7: Empty states.** No drafts → EmptyState with generate CTA. Only abandoned/ordered → same. Zero items generated → "No items need replenishment" in draft card. All removed → show removed items with undo option + disabled accept.
- **M8: Generate idempotency.** Generate returns today's existing draft. UI says "Generate draft" not "Generate new draft". After generate, show/select the returned draft.
- **M9: formatINR.** All currency formatting via `formatINR` from `@compass/shared`. No manual ₹ strings.
- **M10: EMI guard.** Show EMI section when guard response includes non-null `emi`. EMI input comes from the guards query (user would need to configure it separately — show "No EMI offers configured" when null).
- **M11: Escape hatches.** Remove item (isRemoved=true), undo remove (isRemoved=false), abandon draft, generate new draft (after abandoning current). Substitution not revertible via current API — note as limitation.
- **M12: Accessibility.** Labeled qty/unit inputs, keyboard-operable remove/undo, aria-live for guard updates, focus management on abandon/generate, responsive source groups that wrap at narrow widths.

## Codex Review-3 Findings — Digested (amendments folded into plan below)
- **H1 (delivery fees in guard):** `calculateDraftTotalPaise` sums item prices only, not delivery fees. UI discloses: "Excludes delivery fees" alongside guard figures.
- **H2 (unit editable):** UpdateCartDraftItemSchema requires both quantity+unit. Add unit selector (reuse `useShoppingUnits()`) alongside quantity input.
- **H3 (test coverage):** Expand P6 to cover more AC items. Accept route needs real route test in P7.
- **M1 (isActive in SourceGroup):** Retain isActive in groupItemsBySource. Show "Inactive" badge for inactive sources.
- **M2 (EMI unreachable):** Guard hook passes no emiOffers → EMI always null. Drop EMI section from scope. Note honestly.
- **M3 (source/catalog response shapes):** Existing hooks return arrays, not `{ sources/items }` wrappers. Fix P2 docs.
- **M4 (removed items subtotal):** Source subtotals count only active items (matching backend). Removed items rendered with strike-through but excluded from group subtotal.
- **M5 (zero-item/all-removed states):** Add to P4: zero items → "No items need replenishment"; all removed → disable Accept.
- **M6 (catalog failure):** Catalog loading → skeleton names; catalog error → "Item names unavailable" inline, not page error.
- **M7 (status guards on edit/abandon after accept):** Accept endpoint enforces `WHERE status='draft'`. Add status='draft' guard to edit/abandon routes too.
- **M8 (accessibility dialog):** Abandon confirmation dialog: role="dialog", aria-modal, Escape closes, focus restoration.

### Accepted (low)
- Nav entry already exists — no icon/palette changes needed, only badge.
- `CartDraftListResponseSchema` not in shared — define locally in hooks file (wrapper `z.object({ drafts: z.array(CartDraftWithItemsSchema) })`).

## Scope

### Backend addition (minimal, justified by canonical AC requirement)
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` — add `POST /drafts/:id/accept` (5 lines: assertOwned, UPDATE status='ordered', return draft)
- `packages/shared/src/schemas/shopping.ts` — no change needed (CartDraftWithItemsSchema already handles status='ordered')

### Files to create
- `apps/web/src/routes/shopping/cart-view.ts` — pure view-model helpers
- `apps/web/src/routes/shopping/cart-view.test.ts` — unit tests

### Files to modify
- `apps/web/src/routes/shopping/CartPage.tsx` — replace placeholder with full cart review
- `apps/web/src/lib/shopping-queries.ts` — add draft/guard hooks + accept mutation
- `apps/web/src/layouts/AppLayout.tsx` — draft count badge in sidebar for Cart nav item

### Backend routes consumed
- `GET /api/shopping/drafts` → `{ drafts: CartDraftWithItems[] }`
- `GET /api/shopping/drafts/:id` → `CartDraftWithItems`
- `PUT /api/shopping/drafts/:id/items/:itemId` → `CartDraftWithItems` (body: UpdateCartDraftItem)
- `DELETE /api/shopping/drafts/:id` → 204 (no body)
- `POST /api/shopping/drafts/generate` → `GenerateDraftResponse`
- `POST /api/shopping/drafts/:id/accept` → `CartDraftWithItems` (NEW — added by this task)
- `GET /api/shopping/guards/check?cartTotalPaise=N` → `FinancialGuardsResponse`
- `GET /api/shopping/sources` → `PriceSource[]` (existing, returns array not wrapper)
- `GET /api/shopping/catalog` → `CatalogItem[]` (existing, returns array not wrapper)

## Plan

### P1: Backend — accept endpoint + status guards
Add `POST /drafts/:id/accept` to `cart-drafts.ts`:
- assertOwnedDraft, check status='draft' (reject if not), UPDATE status='ordered' + updatedAt, return getDraftWithItems
- Add status='draft' guard to existing PUT /drafts/:id/items/:itemId (reject edit if status != 'draft')
- Add status='draft' guard to existing DELETE /drafts/:id (reject abandon if status != 'draft')
- Update route snapshot

### P2: Query hooks (shopping-queries.ts)
Add:
- `useCartDrafts()` — GET /drafts, response: local `z.object({ drafts: z.array(CartDraftWithItemsSchema) })`
- `useCartDraft(id)` — GET /drafts/:id, response: CartDraftWithItemsSchema, enabled when id truthy
- `useFinancialGuards(cartTotalPaise)` — GET /guards/check (no emiOffers param — EMI always null, noted as limitation), enabled when totalPaise > 0
- `useCartDraftMutations()`:
  - `generate` — POST /drafts/generate → GenerateDraftResponse, invalidates drafts
  - `updateItem` — PUT /drafts/:id/items/:itemId → CartDraftWithItems, invalidates draft + drafts
  - `abandon` — raw fetch DELETE /drafts/:id (204), invalidates drafts
  - `accept` — POST /drafts/:id/accept → CartDraftWithItems, invalidates drafts
- `useDraftCount()` — derived from useCartDrafts, count of status='draft' items, refetchInterval: 60_000

### P3: View-model helpers (cart-view.ts)
Pure functions tested independently:
- `groupItemsBySource(items, sourcesMap)` → `SourceGroup[]` where each has { sourceId, sourceName, deliveryFeePaise, minCartPaise, deliveryEtaBand, isActive, items[], subtotalPaise (active items only) }. Null/unknown sourceId → "Unknown source" group. Removed items included in group but excluded from subtotal.
- `draftSummary(draft, catalog)` → { totalItems, activeItems, removedCount, unpricedCount, totalPaise, hasSubstitutions }
- `guardSummaryText(guards)` → { budgetLine, goalLines[], hasOverage } — uses formatINR from @compass/shared
- `itemDisplayName(item, catalogMap)` → string (catalog canonicalName or "Unknown item")
- `priceLine(item, sourcesMap)` → { priceText: string (via formatINR), sourceText: string, caveat: string }

### P4: CartPage.tsx — full implementation
Structure:
1. **Header**: "Cart" heading + "Generate draft" button (disabled in demo mode; says "Generate" not "Generate new")
2. **Draft selector**: if multiple status='draft' drafts → show tabs/cards to select one. Ordered/abandoned not shown in selector (collapsed section at bottom if desired).
3. **Guard banner** (above items, per canonical spec "before accept"):
   - Budget: "₹X over budget" or "₹X remaining in budget" (advisory tone, not scolding). Note: "Excludes delivery fees."
   - Goal impact: per-goal delay summary
   - Unpriced warning: "Budget impact based on N of M priced items" when unpricedCount > 0
   - EMI: not shown (guard hook passes no emiOffers → always null; noted as limitation)
   - Guard query failure → "Could not load financial summary" inline, not page error
4. **Source groups**: items grouped by suggestedSourceId via groupItemsBySource
   - Source header: name + subtotal (formatINR) + delivery fee/minCart/ETA badge (from usePriceSources)
   - Unknown source → "Unknown source" header
5. **Item cards** (per group):
   - Name (from catalog via useShoppingCatalog, not reason) + brand if available. Catalog loading → skeleton. Catalog error → "Item names unavailable" inline. Null/deleted catalogItemId → "Unknown item".
   - Quantity input (number, editable) + unit selector (from useShoppingUnits, editable — UpdateCartDraftItemSchema requires both)
   - Price (formatINR) + "from draft generation" provenance caveat
   - Substitution badge when substitutionForItemId set + priceDeltaPaise shown
   - Remove toggle (strike-through + "Undo" link when removed)
   - Reason text in secondary line
6. **Summary bar**: total (formatINR), active items count, removed count, note about total accuracy
7. **Action bar**:
   - "Accept as shopping guide" button (calls accept mutation → status='ordered', toast success). Disabled when zero active items or all items removed.
   - "Abandon" button (confirmation dialog with role="dialog", aria-modal, Escape closes, focus restoration; calls abandon, toast)
   - Both disabled in demo mode (check me.isDemo from useMe())
8. **Copy**: "This is a shopping guide — nothing is ordered or paid. Prices are from the time this draft was generated. Budget impact excludes delivery fees."
9. **Empty states**:
   - No drafts at all → `EmptyState` with "No draft carts" + generate CTA
   - Only abandoned/ordered drafts → same EmptyState
   - Active draft with zero items → "No items need replenishment" in draft card
   - All items removed → show items with undo, Accept disabled, summary note
10. **Loading**: `PageLoading` while draft list loads
11. **Error**: `PageError` when draft list fails. Source/guard/catalog failure → degraded inline panels, not page error.
12. **Inactive source**: Show "Inactive" badge on source group header.

### P5: Sidebar badge (AppLayout.tsx)
- Import `useDraftCount()` from shopping-queries
- Pass `draftCount` to SidebarNav → NavRow
- Render badge for `item.to === "/shopping/cart"` similar to inbox badge

### P6: Tests (cart-view.test.ts)
Pure helper tests:
- groupItemsBySource: mixed sources, null source, empty items, inactive source, removed items excluded from subtotal
- draftSummary: all priced, some unpriced, all removed, substitutions, empty, zero items
- guardSummaryText: budget over/under, null budget, goals delayed/unreachable/no_impact/null
- itemDisplayName: known catalog, unknown catalog, null catalogItemId
- priceLine: known source, unknown source, null price, formatINR usage

Accept route test (apps/api):
- POST /drafts/:id/accept: status='draft' → 'ordered', returns draft
- POST /drafts/:id/accept: status='abandoned' → 400
- PUT /drafts/:id/items/:itemId: status='ordered' → 400
- DELETE /drafts/:id: status='ordered' → 400

### P7: Verify all gates
- `npm run typecheck` (all workspaces)
- `npm run lint`
- `npm run test -w apps/web` (cart-view tests)
- `npm run test -w apps/api` (route snapshot + accept route)
- `npm run build -w apps/web`

## Acceptance Criteria
- [ ] AC1: Draft cards with editable quantity/unit and provenance strip (source name + "from draft generation" caveat)
- [ ] AC2: Items grouped by source; each group shows source name, delivery fee, minCart threshold, and ETA when available
- [ ] AC3: Budget overage and goal impact shown before accept (from guards API); unpriced-item count disclosed
- [ ] AC4: Every price labelled with source name via formatINR; staleness caveat in copy
- [ ] AC5: Copy makes clear nothing is ordered or paid; no "Buy" affordance; "Accept as shopping guide" language
- [ ] AC6: Escape hatches: remove/undo item, abandon draft, generate draft
- [ ] AC7: Pending-draft count badge in sidebar
- [ ] AC8: Loading, error, and empty states use PageLoading/PageError/EmptyState
- [ ] AC9: Demo mode disables all mutations
- [ ] AC10: Accept transitions draft to 'ordered' via backend endpoint
- [ ] AC11: typecheck + lint + test + build pass

## Canonical spec gaps (documented, not silently dropped)
- **Card recommendation with cap arithmetic**: Needs draft-native endpoint (POST /recommend takes listId). Not available. UI note: "Card recommendations available when linked to a shopping list."
- **Price observation time**: CartDraftItemSchema has no observedAt. Shows "from draft generation" caveat.
- **Serviceability filtering**: No pincode-scoped serviceability check in this flow. Shows source-level data only.
- **Substitution revert**: API allows only remove, not revert-to-original. Documented limitation.
- **EMI guard**: Guard hook passes no emiOffers param → EMI always null. Would need separate EMI offer input source. Out of scope.
- **Delivery fees in budget impact**: Guard total excludes delivery fees. Disclosed in UI copy.
- **Quantity-aware total**: Editing quantity doesn't change suggestedPricePaise or totalPaise. Backend limitation disclosed.

## Verification
- T1: `npm run typecheck` — exit 0
- T2: `npm run lint` — exit 0
- T3: `npm run test -w apps/web` — cart-view tests pass
- T4: `npm run test -w apps/api` — snapshot + accept tests pass
- T5: `npm run build -w apps/web` — exit 0

## Non-Goals
- Full basket arbitrage on draft items (requires draft-native arbitrage endpoint)
- Receipt upload/reconciliation UI
- Per-line category splits
- Quantity-aware total recalculation (backend limitation)
