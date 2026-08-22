# Task 083 — Cart Review Screen UI — Implementation Report

## Files Inspected
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` (to extend)
- `apps/api/src/modules/shopping/services/ownership.ts` (reference)
- `apps/web/src/lib/shopping-queries.ts` (to extend)
- `apps/web/src/routes/shopping/CartPage.tsx` (to replace)
- `apps/web/src/layouts/AppLayout.tsx` (to extend)
- `apps/web/src/routes/inbox/InboxPage.tsx` (structural reference)
- `apps/web/src/components/States.tsx` (PageLoading, PageError, EmptyState)
- `apps/web/src/routes/transactions/RecordEpfModal.tsx` (modal reference)
- `apps/web/src/lib/auth.ts` (useMe reference)
- `apps/web/src/lib/api.ts` (apiGet/apiPost/apiPut/ApiError)
- `packages/shared/src/schemas/shopping.ts` (CartDraftWithItemsSchema, PriceSourceSchema, etc.)
- `apps/api/src/app.route-snapshot.test.ts` (snapshot gate)
- `apps/api/src/route-surface.snapshot.txt` / `route-table.snapshot.txt` (to update)

## Files Changed

### New files created
- `apps/web/src/routes/shopping/cart-view.ts` — pure view-model helpers
- `apps/web/src/routes/shopping/cart-view.test.ts` — 20 unit tests
- `apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts` — 8 hermetic route tests

### Modified files
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` — added accept endpoint + status guards
- `apps/web/src/lib/shopping-queries.ts` — added 5 new hooks + mutations
- `apps/web/src/routes/shopping/CartPage.tsx` — replaced placeholder with full implementation
- `apps/web/src/layouts/AppLayout.tsx` — added draft count badge to sidebar
- `apps/api/src/route-surface.snapshot.txt` — regenerated to include new accept route + pre-existing receipt routes from task 082
- `apps/api/src/route-table.snapshot.txt` — regenerated to include new registration structure

## Implementation Details

### P1: Backend (cart-drafts.ts)
- Added `POST /drafts/:id/accept`: assertOwnedDraft → load draft → check status='draft' (400 if not) → UPDATE status='ordered' + updatedAt → return getDraftWithItems
- Added status='draft' guard to `PUT /drafts/:id/items/:itemId`: after assertOwnedDraft inside transaction, load draft from tx.query.cartDrafts.findFirst, throw 400 if status != 'draft'
- Added status='draft' guard to `DELETE /drafts/:id`: after assertOwnedDraft, load draft from app.db, throw 400 if status != 'draft'

### P2: Query hooks (shopping-queries.ts)
- Added `useCartDrafts()` — GET /api/shopping/drafts, local CartDraftListResponseSchema
- Added `useCartDraft(id)` — GET /api/shopping/drafts/:id, enabled when id truthy
- Added `useFinancialGuards(cartTotalPaise)` — GET /api/shopping/guards/check?cartTotalPaise=N, enabled when > 0
- Added `useCartDraftMutations()` with generate/updateItem/abandon/accept mutations; abandon uses raw fetch (204, no JSON body)
- Added `useDraftCount()` — derived from useCartDrafts via select, count status='draft', refetchInterval 60s

### P3: View-model helpers (cart-view.ts)
- `groupItemsBySource(items, sourcesMap)` → SourceGroup[]: groups by suggestedSourceId, null/unknown → "Unknown source", removed items included in group but excluded from subtotalPaise
- `draftSummary(draft)` → {totalItems, activeItems, removedCount, unpricedCount, totalPaise, hasSubstitutions}
- `guardSummaryText(guards)` → {budgetLine, goalLines[], hasOverage}: uses formatINR, null budget → null budgetLine
- `itemDisplayName(item, catalogMap)` → canonicalName or "Unknown item"
- `priceLine(item, sourcesMap)` → {priceText (formatINR or "—"), sourceText, caveat: "from draft generation"}

### P4: CartPage.tsx
- Full cart review implementation following InboxPage structural pattern
- Uses PageLoading/PageError/EmptyState from States.tsx
- Draft list failure → PageError; source/guard/catalog failure → degraded inline
- Draft selector: renders all status='draft' drafts as DraftCard components
- Guard banner: budget over/under, goal impact lines, unpriced item count disclosure, "Excludes delivery fees" note
- Source groups via groupItemsBySource, each with source name, subtotal, delivery fee/minCart/ETA, "Inactive" badge
- Item rows: catalog name resolution, reason text, price provenance ("from draft generation"), substitution badge with priceDeltaPaise, qty+unit editor (NormalizedUnitInfo[] type), remove/undo toggle
- Summary bar: active/removed counts, total (formatINR)
- Action bar: "Accept as shopping guide" (disabled when allRemoved or demo mode), "Abandon" (opens confirmation dialog)
- AbandonDialog: role="dialog" aria-modal, Escape closes, auto-focus confirm button, focus restoration
- Demo mode: reads me.isDemo from useMe(), shows banner, disables all mutation buttons
- Empty states: no drafts → EmptyState with generate CTA; zero items in draft → "No items need replenishment"
- Disclaimer copy: "This is a shopping guide — nothing is ordered or paid..."
- Card recommendations note: "Card recommendations available when linked to a shopping list."

### P5: Sidebar badge (AppLayout.tsx)
- Imported useDraftCount from shopping-queries
- Added draftCount prop to NavRow
- Renders badge `<span class="badge bg-brand-600 text-white">{draftCount}</span>` for `item.to === "/shopping/cart" && draftCount > 0`
- SidebarNav calls useDraftCount().data ?? 0

### P6: Tests
- cart-view.test.ts: 20 tests in 5 describe blocks (groupItemsBySource, draftSummary, guardSummaryText, itemDisplayName, priceLine)
- cart-drafts.hermetic.test.ts: 8 tests covering accept endpoint status guards and PUT/DELETE guards

### Snapshot update
The route-surface.snapshot.txt and route-table.snapshot.txt were regenerated. The snapshot update captured:
- The new `POST /api/shopping/drafts/:id/accept` route (this task)
- 11 receipt routes from task 082 (pre-existing, untracked task 082 had modified plugin.ts to register them but hadn't updated the snapshots — the snapshots needed updating as part of this run)

## Commands Run

### `npm run typecheck`
```
Exit code 0
All 6 workspaces pass tsc --noEmit
```
(Two errors were found and fixed: `NormalizedUnitInfo[]` prop type in CartPage.tsx instead of `{ unit: string; label: string; pluralLabel: string }[]`, and wrong PriceSourceKind/deliveryEtaBand values in test fixtures)

### `npm run lint` (on my files only)
```
Exit code 0 (no errors in changed/created files)
```
Note: full `npm run lint` exits 1 due to two pre-existing errors in untracked task-082 files (`receipt-confirm.ts`: 'sql' unused; `receipt-parse.ts`: useless assignment). Neither file was touched by this task.

### `npm run test -w apps/web`
```
Exit code 0
tests 342, pass 342, fail 0
```
All cart-view tests pass (20 new tests covering all 5 helper functions).

### `npm run test -w apps/api` (full suite)
```
Exit code 1
tests 1056, pass 1021, fail 34, skipped 1
```
All failures are pre-existing:
- ~28 tests requiring DATABASE_URL (integration tests, no DB in CI without env)
- `receipt-reconcile.test.ts`: pre-existing task-082 failure (ambiguous fuzzy match test)
- `schema.decomposition.test.ts`: expects 70 tables, finds 72 (task 082 added receiptLines + receipts but didn't update the count)
- `app.test.ts`: requires DATABASE_URL
- `backup.test.ts`: requires DATABASE_URL

My new hermetic tests all pass:
- Route snapshot tests: ✔ (2/2)
- cart-drafts.hermetic.test.ts: ✔ (8/8)

### `npm run build -w apps/web`
```
Exit code 0
✓ built in 192ms, 357 modules transformed
CartPage-75s1pSS4.js: 13.44 kB (gzip: 4.08 kB)
```

## Assumptions
- The `NormalizedUnitInfoSchema` type has `{unit, kind, label}` (not `pluralLabel`) — confirmed from shared schema
- `usePriceSources()` returns PriceSource[] (array, not wrapper) — confirmed from existing code
- `useShoppingCatalog()` returns CatalogItem[] (array, not wrapper) — confirmed from existing code
- `useCartDrafts()` response is locally-defined `z.object({ drafts: z.array(CartDraftWithItemsSchema) })` since this shape is not in shared (matches backend CartDraftListResponseSchema)
- `useMe()` is imported from `../../lib/auth.ts`, not queries.ts — confirmed from auth.ts

## Unresolved Risks
- The route snapshot update also captured 11 receipt routes from task 082. This is justified because those routes were already in the app (plugin.ts modified) but the snapshot hadn't been updated. The coordinator should be aware that the snapshot now includes task 082's routes.
- The schema.decomposition.test.ts expects 70 tables but the app now has 72 (receiptLines, receipts from task 082). This is a pre-existing failure from task 082 — not introduced by this task.
- The `receipt-reconcile.test.ts` has a failing test (ambiguous fuzzy match) from task 082 — pre-existing.
- The 2 lint errors in task 082's receipt-confirm.ts and receipt-parse.ts are pre-existing and unrelated to this task.
- EMI guard section is omitted as documented: guard hook passes no emiOffers param → EMI always null. Would need a separate EMI offer input source.
- Delivery fees are excluded from budget impact (disclosed in UI copy).
- Quantity editing doesn't change totalPaise (backend limitation, disclosed in UI copy).
- Card recommendations not available for draft carts (noted in UI).
