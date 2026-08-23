## Fix: CapturePanel over-canonicalization (task 078 review finding)

**File changed:** `apps/web/src/routes/shopping/CapturePanel.tsx`

**Bug:** `seenItemIds` started empty in `handleAddToList()`. The first `addItem` response
returns the full list, so every pre-existing item was diffed as "new" and queued for
canonicalize.

**Fix:** Before the draft loop, call `apiGet(/api/shopping/lists/${listId}, ShoppingListWithItemsSchema)`
and pre-populate `seenItemIds` from the existing items. Added `ShoppingListWithItemsSchema`
to the `@compass/shared` import and `apiGet` from `../../lib/api.ts`.

**Validation:**
- `npm run typecheck` — pass (0 errors)
- `npm run lint` — pass (0 warnings)
- `npm run test -w apps/web` — 311 pass, 0 fail
- `npm run build -w apps/web` — success, built in 178 ms
