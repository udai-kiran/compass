# Implementation 1 — Task 078 Shopping Nav Group, Lists & Capture UI

## Files changed
- `apps/web/src/components/icons.tsx` — added `shopping`, `cart`, `pantry`, `pricewatch` to IconName union and PATHS record
- `apps/web/src/layouts/AppLayout.tsx` — added Shopping nav group between Plan and Setup
- `apps/web/src/components/CommandPalette.tsx` — added 4 page entries to PAGES array
- `apps/web/src/main.tsx` — added 4 lazy imports + 4 route entries before catch-all
- `apps/web/src/lib/shopping-queries.ts` — extended with shoppingListsQuery, useShoppingLists, useShoppingList, shoppingCatalogQuery, useShoppingCatalog, useShoppingListMutations, useParseText, useParseImage; existing useShoppingUnits preserved
- `apps/web/src/lib/shopping-queries.test.ts` — extended with 10 new tests; existing 4 preserved (311 total, 0 failures)

## Files created
- `apps/web/src/routes/shopping/ListsPage.tsx`
- `apps/web/src/routes/shopping/CapturePanel.tsx`
- `apps/web/src/routes/shopping/CartPage.tsx`
- `apps/web/src/routes/shopping/PantryPage.tsx`
- `apps/web/src/routes/shopping/PriceWatchPage.tsx`

## Command outputs and exit codes

### 1. `npm run typecheck` — exit 0
Initial run had 4 errors: test file accessing `result[0]` without `?.` (TS2532 x3), and ListsPage `splice` returning `T|undefined` (TS2345). Fixed with optional chaining and a guard after splice.

### 2. `npm run lint` — exit 0
No issues.

### 3. `npm run test -w apps/web` — exit 0
311 pass, 0 fail. Initial run had 2 failures: test fixtures used `00000000-0000-0000-0000-000000000001/2` which fail Zod's UUID regex (version nibble must be 1-8). Fixed by using nil UUID and max UUID.

### 4. `npm run build -w apps/web` — exit 0
355 modules, ListsPage chunk 20.52 kB gzip 5.36 kB.

## Implementation notes
- `useParseImage` uses raw `fetch` + `FormData` (not `apiPost`) per AC10
- `UpdateShoppingList` / `UpdateShoppingListItem` PUT mutations send all required fields per AC9
- `reorder` sends complete `orderedIds` array (all items, all statuses) per AC9/F9
- `convertToBaseQuantity` is wrapped in try/catch (it throws on invalid quantity string, never returns null)
- `useCapabilities()` gates CapturePanel parse controls when `aiEnabled === false` per AC8
- Placeholder pages use `EmptyState` with `title` prop (not `message`) matching States.tsx
