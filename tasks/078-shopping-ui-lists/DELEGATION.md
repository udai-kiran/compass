# Sonnet Worker Delegation — Iteration 1

## Task
078 — Shopping Nav Group, Lists & Capture UI (task 12.1)

## Approved Plan
- P1: Add 4 icon names to IconName + SVG paths
- P2: Add Shopping nav group to NAV_GROUPS
- P3: Add 4 pages to PAGES in CommandPalette
- P4: Add lazy imports and route entries in main.tsx
- P5: Extend shopping-queries.ts with list/capture hooks + tests
- P6: Build ListsPage.tsx
- P7: Build CapturePanel.tsx
- P8: Create placeholder pages
- P9: Verify typecheck + lint + test + build

## Files and Symbols

### New files to create
- `apps/web/src/routes/shopping/ListsPage.tsx`
- `apps/web/src/routes/shopping/CapturePanel.tsx`
- `apps/web/src/routes/shopping/CartPage.tsx` (placeholder)
- `apps/web/src/routes/shopping/PantryPage.tsx` (placeholder)
- `apps/web/src/routes/shopping/PriceWatchPage.tsx` (placeholder)

### Files to modify
- `apps/web/src/components/icons.tsx` — add to IconName union AND PATHS record
- `apps/web/src/layouts/AppLayout.tsx` — add Shopping nav group
- `apps/web/src/components/CommandPalette.tsx` — add to PAGES array
- `apps/web/src/main.tsx` — add lazy imports + router children
- `apps/web/src/lib/shopping-queries.ts` — extend (preserve existing exports)
- `apps/web/src/lib/shopping-queries.test.ts` — extend (preserve existing tests)

### Files to reference (read, do not modify)
- `apps/web/src/routes/investments/MfImportPage.tsx` — 2-step wizard pattern
- `apps/web/src/routes/inbox/InboxPage.tsx` — escape-hatch pattern
- `apps/web/src/routes/transactions/TransactionDrawer.tsx` — FormData upload pattern
- `apps/web/src/lib/api.ts` — apiGet, apiPost, apiPut, apiDelete signatures
- `apps/web/src/components/States.tsx` — PageLoading, PageError, EmptyState
- `apps/web/src/lib/viz.tsx` — compactINR if needed
- `packages/shared/src/schemas/shopping.ts` — ALL schemas to import from @compass/shared
- `tasks/UI.md` — frontend conventions (must follow)

## Required Changes

### 1. `icons.tsx`
Add to `IconName` union (before the semicolon):
```ts
  | "shopping"
  | "cart"
  | "pantry"
  | "pricewatch";
```
Add SVG path entries to `PATHS` record. Use simple, recognizable Heroicons-style outlines:
- `shopping` — shopping bag or list icon
- `cart` — shopping cart
- `pantry` — box/package storage
- `pricewatch` — eye or chart/magnifying glass

### 2. `AppLayout.tsx`
Insert Shopping group between "Plan" and "Setup" groups:
```ts
  {
    heading: "Shopping",
    items: [
      { to: "/shopping/lists", label: "Lists", icon: "shopping" },
      { to: "/shopping/cart", label: "Cart", icon: "cart" },
      { to: "/shopping/pantry", label: "Pantry", icon: "pantry" },
      { to: "/shopping/price-watch", label: "Price Watch", icon: "pricewatch" },
    ],
  },
```

### 3. `CommandPalette.tsx`
Add to PAGES array:
```ts
  { label: "Shopping Lists", to: "/shopping/lists" },
  { label: "Shopping Cart", to: "/shopping/cart" },
  { label: "Pantry", to: "/shopping/pantry" },
  { label: "Price Watch", to: "/shopping/price-watch" },
```

### 4. `main.tsx`
Add lazy imports:
```ts
const ShoppingListsPage = lazy(() =>
  import("./routes/shopping/ListsPage.tsx").then((m) => ({ default: m.ListsPage })),
);
const ShoppingCartPage = lazy(() =>
  import("./routes/shopping/CartPage.tsx").then((m) => ({ default: m.CartPage })),
);
const ShoppingPantryPage = lazy(() =>
  import("./routes/shopping/PantryPage.tsx").then((m) => ({ default: m.PantryPage })),
);
const ShoppingPriceWatchPage = lazy(() =>
  import("./routes/shopping/PriceWatchPage.tsx").then((m) => ({ default: m.PriceWatchPage })),
);
```
Add route entries before the `*` catch-all:
```ts
      { path: "shopping/lists", element: <ShoppingListsPage /> },
      { path: "shopping/cart", element: <ShoppingCartPage /> },
      { path: "shopping/pantry", element: <ShoppingPantryPage /> },
      { path: "shopping/price-watch", element: <ShoppingPriceWatchPage /> },
```

### 5. `shopping-queries.ts`
EXTEND the existing file. Keep `shoppingUnitsQuery` and `useShoppingUnits`. Add:
- Import schemas from `@compass/shared`: ShoppingListSchema, ShoppingListWithItemsSchema, CreateShoppingListSchema, UpdateShoppingListSchema, etc.
- `useShoppingLists()` — apiGet /api/shopping/lists
- `useShoppingList(id)` — apiGet /api/shopping/lists/:id, enabled only when id truthy
- `useShoppingCatalog()` — apiGet /api/shopping/catalog
- `useShoppingListMutations()` — returns { create, update, remove, addItem, updateItem, removeItem, reorder, canonicalize } using useMutation + invalidation
- `useParseText()` — useMutation calling apiPost /api/shopping/parse-text
- `useParseImage()` — useMutation using raw fetch with FormData (NOT apiPost)

### 6. `ListsPage.tsx`
Exported as `ListsPage`. Layout:
- Use `.card` class for containers, `.btn-primary`/`.btn-secondary` for buttons, `.input` for text fields
- Left sidebar: list of lists (useShoppingLists), each clickable
  - "New List" button at top (opens inline create form)
  - Status badges for active/archived
- Main panel: selected list detail (useShoppingList)
  - Header: name (click to edit inline), archive/delete buttons
  - Items: ordered list with status indicators
  - Each item: text, quantity/unit display, status badge
  - Click item to edit inline (PUT full replace: rawText + catalogItemId + quantityBase + unit + status)
  - Mark bought: button that PUTs status → "bought" (all other fields preserved)
  - Reorder: up/down arrow buttons (send complete orderedIds array with ALL item IDs)
  - Add item: inline form at bottom
  - "Capture" button: opens CapturePanel (as a section/modal within the page)
- PageLoading / PageError / EmptyState from States.tsx

### 7. `CapturePanel.tsx`
Exported as `CapturePanel`. Props: `{ listId: string, onClose: () => void, onItemsAdded: () => void }`.
- Step 1: Text/Photo toggle
  - Text tab: textarea + "Parse" button → useParseText mutation
  - Photo tab: file input with accept + capture → useParseImage mutation (FormData)
  - If available===false: show message from response, disable submit
  - Loading state during mutation
- Step 2: Preview parsed items
  - Editable list: rawText, quantityBase, unit per item
  - Remove individual items
  - "Add to List" button: sequential POST /lists/:listId/items for each item
  - Track progress: "Added 3/7 items"
  - On completion: call onItemsAdded() → parent invalidates list query
  - On partial failure: toast error, stop, show count
  - "Cancel" returns to step 1

### 8. Placeholder pages
Each exports named component. Renders `EmptyState` with appropriate message.
```tsx
import { EmptyState } from "../../components/States.tsx";
export function CartPage() { return <EmptyState message="Cart coming soon" />; }
```

## Must Not Change
- Any file in `apps/api/`
- Any file in `packages/shared/`
- Existing `useShoppingUnits` export and behavior in shopping-queries.ts
- Existing shopping-queries.test.ts test cases (extend only)

## Acceptance Criteria
- AC1-AC13 from TASK.md

## Commands
1. `npm run typecheck` — must exit 0
2. `npm run lint` — must exit 0
3. `npm run test -w apps/web` — must exit 0
4. `npm run build -w apps/web` — must exit 0

## Required Evidence
- List of all files changed/created
- Complete diff of each modified file
- All 4 commands with literal output and exit codes
- Any plan deviations or blockers

---

# Sonnet Worker Delegation — Iteration 2 (Codex review fixes)

## Task
078 — Fix Codex review findings

## Fixes Required

### Fix 1 (HIGH): AC5 — Ambiguous catalog matches not surfaced
The `canonicalize` mutation exists in `shopping-queries.ts` but is never called from ListsPage or CapturePanel.

**Required changes in `ListsPage.tsx`:**
- In `ItemRow`: after an item is added or when an item has no `catalogItemId`, show a small "Link to catalog" button that calls `canonicalize.mutate({ listId, itemId })`
- When canonicalize returns `match.status === "ambiguous"`: show the candidate IDs with a "not this" dismiss action. Need to resolve candidate IDs to names — use `useShoppingCatalog()` data to look up names by ID.
- When `match.status === "matched"`: item is auto-linked, show a brief success indicator
- When `match.status === "none"`: no action needed, item stays raw-text

**Required changes in `CapturePanel.tsx`:**
- After `handleAddToList()` successfully adds items, auto-trigger canonicalize for each added item (fire-and-forget, non-blocking). The list query invalidation from addItem will show updated items.

### Fix 2 (LOW): No-lists EmptyState
Line 728-730 in `ListsPage.tsx`:
```tsx
{(lists ?? []).length === 0 && !showCreate && (
  <p className="text-xs text-slate-400">No lists yet. Create one to get started.</p>
)}
```
Replace with:
```tsx
{(lists ?? []).length === 0 && !showCreate && (
  <EmptyState
    title="No lists yet"
    hint="Create your first shopping list to get started."
    action={
      <button onClick={() => { setShowCreate(true); setNewName(""); }} className="btn-primary">
        Create list
      </button>
    }
  />
)}
```

## Files to modify
- `apps/web/src/routes/shopping/ListsPage.tsx` — both fixes
- `apps/web/src/routes/shopping/CapturePanel.tsx` — auto-canonicalize after add

## Must Not Change
- Any file in `apps/api/`
- `packages/shared/`
- `shopping-queries.ts` (canonicalize mutation already exists)

## Commands
1. `npm run typecheck` — exit 0
2. `npm run lint` — exit 0
3. `npm run test -w apps/web` — exit 0
4. `npm run build -w apps/web` — exit 0

## Required Evidence
- Diffs of changed files
- All 4 commands with exit codes
