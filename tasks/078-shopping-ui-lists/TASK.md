# Task: 078 — Shopping Nav Group, Lists & Capture UI (task 12.1)

## Status
COMPLETE

## Objective
Add the Shopping navigation group to the app and build the Lists page with paste-text and photo-capture panels. The existing backend API routes for lists, capture, and catalog are consumed — no backend changes.

## Root Cause
No `routes/shopping/` directory or Shopping nav entry exists in the frontend.

## Codex Review Findings (review-1, addressed)
- F1: `shopping-queries.ts` already exists → extend it, preserve existing `useShoppingUnits` + tests
- F2: Missing `npm run test -w apps/web` → added to verification
- F3: `apiPost` JSON-serializes → use raw `fetch` + FormData for parse-image
- F4: Import all shared contracts from `@compass/shared` — no duplicated shapes
- F5: PUT requires full object — list update sends name+note+status, item update sends all fields
- F6: Catalog match resolution — canonicalize returns candidateIds; use GET /catalog to resolve names
- F7: AI unavailable — capture controls show explanatory disabled state; list CRUD unaffected
- F8: Demo-mode 403 — toast error, no stuck optimistic state
- F9: Reorder sends complete orderedIds set including bought/dropped items
- F10: Parse failures — empty items + message shown; network errors toast'd
- F11: Photo input — `accept="image/jpeg,image/png,image/webp"` + capture="environment"
- F12: Quantity display — use DisplayUnitSchema for UI, convert to base via shared utility

## Scope

### Existing backend routes (consume only, do not modify)
- Lists: GET/POST/PUT/DELETE /api/shopping/lists, items, reorder
- Capture: POST /api/shopping/parse-text, POST /api/shopping/parse-image
- Catalog: GET /api/shopping/catalog, match, canonicalize
- Units: GET /api/shopping/units

### Existing frontend file to extend
- `apps/web/src/lib/shopping-queries.ts` — already has `useShoppingUnits`; extend with list/capture hooks
- `apps/web/src/lib/shopping-queries.test.ts` — extend with tests for new query keys

### New files
- `apps/web/src/routes/shopping/ListsPage.tsx` — list CRUD, item management
- `apps/web/src/routes/shopping/CapturePanel.tsx` — paste-text and photo-capture 2-step wizard
- `apps/web/src/routes/shopping/CartPage.tsx` — placeholder
- `apps/web/src/routes/shopping/PantryPage.tsx` — placeholder
- `apps/web/src/routes/shopping/PriceWatchPage.tsx` — placeholder

### Modified files (3-edit nav pattern + router)
- `apps/web/src/components/icons.tsx` — add `"shopping"`, `"cart"`, `"pantry"`, `"pricewatch"` to IconName + SVG paths
- `apps/web/src/layouts/AppLayout.tsx` — add Shopping nav group
- `apps/web/src/components/CommandPalette.tsx` — add 4 pages to PAGES
- `apps/web/src/main.tsx` — add lazy imports + route entries
- `apps/web/src/lib/shopping-queries.ts` — extend with new hooks
- `apps/web/src/lib/shopping-queries.test.ts` — extend with tests

## Dependencies
- task 9.2 (lists CRUD API, done), 9.3 (catalog API, done)
- task 9.4 (paste-text API, done), 9.5 (photo capture API, done)

## Plan
- P1: Add 4 icon names (`shopping`, `cart`, `pantry`, `pricewatch`) to `IconName` union in `icons.tsx` with SVG path markup (inline SVG, no icon package)
- P2: Add Shopping nav group to `NAV_GROUPS` in `AppLayout.tsx` between Plan and Setup groups:
  ```
  { heading: "Shopping", items: [
    { to: "/shopping/lists", label: "Lists", icon: "shopping" },
    { to: "/shopping/cart", label: "Cart", icon: "cart" },
    { to: "/shopping/pantry", label: "Pantry", icon: "pantry" },
    { to: "/shopping/price-watch", label: "Price Watch", icon: "pricewatch" },
  ]}
  ```
- P3: Add 4 entries to `PAGES` in `CommandPalette.tsx`
- P4: Add lazy imports and route entries in `main.tsx` for all 5 shopping pages (ListsPage + 3 placeholders + CapturePanel if standalone)
- P5: Extend `shopping-queries.ts` (preserve existing exports) with hooks using `@compass/shared` schemas:
  - `useShoppingLists()` — GET /api/shopping/lists → `z.object({ lists: z.array(ShoppingListSchema) })`
  - `useShoppingList(id)` — GET /api/shopping/lists/:id → `ShoppingListWithItemsSchema`
  - `useShoppingCatalog()` — GET /api/shopping/catalog
  - `useShoppingListMutations()` — mutations for create/update/delete list, addItem/updateItem/deleteItem/reorder/canonicalize
  - `useParseText()` — POST mutation → `ParseListTextResponseSchema`
  - `useParseImage()` — raw `fetch` with FormData (not apiPost), parse `ParseListImageResponseSchema`
  - Extend `shopping-queries.test.ts` with query key tests for new hooks
- P6: Build `ListsPage.tsx`:
  - Left panel: list of shopping lists (create button, click to select, status badges)
  - Selected list: inline rename (PUT full object: name+note+status), archive (status→archived), delete
  - Right panel: items of selected list
    - Add item (POST), edit item (PUT full object), delete item, mark bought (PUT status→bought)
    - Reorder: up/down buttons, sends complete orderedIds including all statuses
    - CapturePanel integration: button to open paste/photo capture
  - `EmptyState` when no lists or no items
  - `PageLoading` during fetch, `PageError` on error
- P7: Build `CapturePanel.tsx` — 2-step wizard modelled on `MfImportPage.tsx`:
  - Step 1: tab or toggle for Text vs Photo
    - Text: textarea + submit (calls useParseText)
    - Photo: file input with `accept="image/jpeg,image/png,image/webp"` and `capture="environment"`; calls useParseImage
    - Both: show `available: false` message if AI not configured; disable submit
    - Loading spinner during parse; toast on error
  - Step 2: preview parsed items in editable list
    - Each item: rawText (editable), quantityBase + unit (editable, paired)
    - Remove individual items; add all remaining to the shopping list via sequential POST calls
    - If canonicalize returns `ambiguous`: show candidate names with "not this" dismiss
    - Partial commit failure: show count added, toast error, invalidate list query
    - Nothing saved before explicit "Add to List" confirmation
- P8: Create placeholder pages (CartPage, PantryPage, PriceWatchPage) with `EmptyState` message "Coming soon"
- P9: Verify typecheck + lint + test + build

## Acceptance Criteria
- [ ] AC1: Shopping nav group added with all 3 coordinated edits; all 4 pages ⌘K-reachable
- [ ] AC2: List CRUD (create, rename, archive), item add/edit/delete, reorder, mark-bought functional
- [ ] AC3: Paste → preview → commit; nothing saved before confirmation
- [ ] AC4: Photo capture uses `capture="environment"` + `accept="image/jpeg,image/png,image/webp"`
- [ ] AC5: Ambiguous catalog matches surfaced for review with "not this" escape hatch
- [ ] AC6: Loading/error/empty states use `PageLoading`, `PageError`, `EmptyState`
- [ ] AC7: No new dependencies added (no UI/icon/drag/form library)
- [ ] AC8: AI unavailable → capture controls disabled with explanation; list CRUD unaffected
- [ ] AC9: PUT mutations send complete object (all required fields)
- [ ] AC10: Parse-image uses raw `fetch` + FormData, not `apiPost`
- [ ] AC11: All shared schemas imported from `@compass/shared`
- [ ] AC12: Existing `useShoppingUnits` and its tests preserved
- [ ] AC13: typecheck + lint + test + build all pass

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/web` exits 0
- T4: `npm run build -w apps/web` exits 0

## Non-Goals
- Cart review screen (task 12.2)
- Pantry display (task 12.3)
- Price Watch display (task 12.3)
- Backend modifications
- Drag-and-drop reorder (up/down buttons only)
- React component rendering tests (no test infrastructure)
