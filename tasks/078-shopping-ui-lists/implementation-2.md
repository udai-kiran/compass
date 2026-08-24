# Implementation 2 — Codex review fixes (task 078)

## Files changed
- `apps/web/src/routes/shopping/ListsPage.tsx` — Fix 1 (canonicalize) + Fix 2 (EmptyState)
- `apps/web/src/routes/shopping/CapturePanel.tsx` — Fix 1 (auto-canonicalize after add)

## Fix 1: AC5 — Ambiguous catalog matches
- Added `useShoppingCatalog` import in `ListsPage.tsx`
- `ItemRow`: added `canonicalize` mutation + `catalogData` + `ambiguousCandidates` state
- "🔗 Link" button shown when `item.catalogItemId === null && item.status === "pending"`
- On success: `matched` → toast success; `ambiguous` → inline candidate list with "not this" dismiss; `none` → toast
- Candidate names resolved from `useShoppingCatalog()` data by ID
- `CapturePanel`: `handleAddToList` tracks item IDs by diffing each `addItem` response; fires `canonicalize.mutate` for each after all items are added (fire-and-forget, non-blocking)

## Fix 2: No-lists EmptyState
- Replaced plain `<p>` at line 728 with `<EmptyState title hint action>` including "Create list" button

## Commands run
1. `npm run typecheck` — exit 0
2. `npm run lint` — exit 0
3. `npm run test -w apps/web` — exit 0 (311 pass, 0 fail)
4. `npm run build -w apps/web` — exit 0 (built in 746ms)
