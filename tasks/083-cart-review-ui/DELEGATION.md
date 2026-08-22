# Worker Delegation

## Task
083 — Cart Review Screen UI (task 12.2)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: UI pattern work following InboxPage structural template, multiple query integration points (drafts + guards + sources + catalog), view-model design, state management across multiple independent queries, demo mode, accessibility, and a backend endpoint addition with status guards. Needs judgment about edge cases (empty states, partial failures, inactive sources) and faithful canonical spec compliance.

## Approved Plan
Full plan in tasks/083-cart-review-ui/TASK.md. Key steps:
- P1: Backend accept endpoint + status guards on edit/abandon
- P2: Query hooks in shopping-queries.ts
- P3: View-model helpers (cart-view.ts)
- P4: CartPage.tsx full implementation
- P5: Sidebar badge (AppLayout.tsx)
- P6: Tests (cart-view.test.ts + accept route test)
- P7: Verify all gates

## Files and Symbols
### Backend (P1)
- apps/api/src/modules/shopping/routes/cart-drafts.ts — add POST accept, status guards on PUT/DELETE

### Frontend (P2-P5)
- apps/web/src/lib/shopping-queries.ts — add draft/guard hooks
- apps/web/src/routes/shopping/cart-view.ts — new, pure helpers
- apps/web/src/routes/shopping/cart-view.test.ts — new, tests
- apps/web/src/routes/shopping/CartPage.tsx — replace placeholder
- apps/web/src/layouts/AppLayout.tsx — draft count badge

## Required Changes
All changes specified in TASK.md Plan section P1-P7.

## Must Not Change
- Any shopping module service files
- Schema files
- Other route files besides cart-drafts.ts
- InboxPage.tsx (reference only)

## Acceptance Criteria
AC1-AC11 from TASK.md

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/web`
4. `npm run test -w apps/api`
5. `npm run build -w apps/web`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 2 — Independent Verification

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: run typecheck, lint, test, build. Pass/fail criteria defined. Read-only.

## Approved Plan
- V1: `npm run typecheck` — exit 0
- V2: `npm run lint` — exit 0 or document pre-existing failures
- V3: `npm run test -w apps/web` — pass/fail/skip counts (expect 342+)
- V4: `npm run test -w apps/api` — hermetic test count (expect 8+ from cart-drafts.hermetic)
- V5: `npm run build -w apps/web` — exit 0
- V6: `git diff --stat HEAD` — file list

## Must Not Change
Everything — read-only verification.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/web`
4. `npm run test -w apps/api`
5. `npm run build -w apps/web`
6. `git diff --stat HEAD`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- build output
- modified file list

---

## Iteration 3 — Codex Review-4 Fix Pass

## Worker
`codex-worker`

## Routing Reason
Low-thinking: all fixes are well-specified, localized, and mechanical. No design judgment needed.

## Approved Plan (fixes F1-F6 from review-4)

### F1: All-unpriced guard warning
File: `apps/web/src/routes/shopping/CartPage.tsx` (around line 222)
- Show unpriced warning independently of `summary.totalPaise > 0`
- Currently the entire guard banner block is conditional on `summary.totalPaise > 0`. Move the unpriced warning OUTSIDE that conditional:
  ```
  {summary.unpricedCount > 0 && (
    <p>Budget impact based on {summary.activeItems - summary.unpricedCount} of {summary.activeItems} priced items</p>
  )}
  ```
- This should render even when totalPaise is 0

### F2: Source loading → false "Inactive"
File: `apps/web/src/routes/shopping/CartPage.tsx` (around line 370 where "Inactive" badge renders)
- Add a check: only show "Inactive" badge when `sourcesQuery.isSuccess` (sources have actually loaded)
- When sources are loading (`sourcesQuery.isLoading`), show "Loading source details..." or just hide the badge
- When sources failed (`sourcesQuery.isError`), show "Source details unavailable"
- The sourcesQuery variable comes from `usePriceSources()` — check how it's used in the component
- Need to thread `sourcesQuery` status (not just data) to the group rendering

### F3: Accept/abandon race
File: `apps/api/src/modules/shopping/routes/cart-drafts.ts`
- For the accept route: change the UPDATE to include `AND status = 'draft'` in the WHERE clause and use RETURNING to check rows affected
- Pattern: `const result = await app.db.update(cartDrafts).set({ status: 'ordered', updatedAt: new Date() }).where(and(eq(cartDrafts.id, draftId), eq(cartDrafts.userId, userId), eq(cartDrafts.status, 'draft'))).returning({ id: cartDrafts.id }); if (result.length === 0) throw new HttpError(409, ...)`
- Same pattern for abandon (DELETE): add `AND status = 'draft'` to the WHERE
- Remove the separate status check reads that precede the updates
- Import `eq` is already available (Drizzle ORM)

### F4: Duplicate toasts
File: `apps/web/src/routes/shopping/CartPage.tsx`
- Remove the `onError` callbacks from the generate, accept, and abandon mutation calls
- The global `MutationCache` in `main.tsx` already handles error toasts
- Look for code like `onError: (err) => { toast.error(...)  }` in the generate/accept/abandon handlers and remove those callbacks

### F5: Unknown sourceIds consolidated
File: `apps/web/src/routes/shopping/cart-view.ts` (groupItemsBySource function, line 61+)
- When `key` (suggestedSourceId) is non-null but not found in sourcesMap, treat it the same as null:
  ```
  const resolvedKey = (key !== null && sourcesMap.has(key)) ? key : null;
  ```
- This ensures all unresolved sourceIds fall into the same "Unknown source" group
- Update the test in `cart-view.test.ts` if needed

### F6: Null qty/unit in editor
File: `apps/web/src/routes/shopping/CartPage.tsx` (around line 432-466)
- When item.quantityBase is null AND item.unit is null, don't default unit to "piece"
- Instead, show the qty input as empty/placeholder and unit select as empty/disabled until the user enters a quantity
- Or: when qty is null, default both qty=1 and unit="piece" together (both or neither)
- Simplest: only show qty/unit editor when item.quantityBase is not null. If null, show "Qty not set" with an "Edit" link that initializes both to 1/piece.

## Files and Symbols
- `apps/web/src/routes/shopping/CartPage.tsx` — F1, F2, F4, F6
- `apps/web/src/routes/shopping/cart-view.ts` — F5
- `apps/web/src/routes/shopping/cart-view.test.ts` — F5 test update
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` — F3

## Must Not Change
- Shopping service files
- Schema files
- shopping-queries.ts (hooks are correct)
- AppLayout.tsx (badge is correct)

## Acceptance Criteria
- F1: Unpriced warning shows even when totalPaise=0
- F2: "Inactive" badge only shown when sources are successfully loaded
- F3: Accept/abandon use conditional UPDATE with status='draft'
- F4: No onError toast handlers in generate/accept/abandon
- F5: Unresolved sourceIds consolidated into single "Unknown source" group
- F6: Null qty/unit handled without creating invalid pairs
- All existing tests pass: `npm run typecheck`, `npm run lint`, `npm run test -w apps/web`, `npm run test -w apps/api`, `npm run build -w apps/web`

## Commands
1. Make changes per plan
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/web`
5. `npm run test -w apps/api`
6. `npm run build -w apps/web`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 4 — Independent Verification of Review-4 Fixes

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: collect git status/diff, re-run typecheck/lint/test/build, confirm each F1–F6 change exists in the current code. Read-only.

## Approved Plan
- V1: `git status --short` and `git diff --stat HEAD`
- V2: Confirm F1–F6 in current source (do not trust the implementation report)
- V3: `npm run typecheck`
- V4: `npm run lint`
- V5: `npm run test -w apps/web`
- V6: `npm run test -w apps/api` (document pre-existing DB failures; hermetic cart-draft tests must pass)
- V7: `npm run build -w apps/web`

## Must Not Change
Everything — read-only verification.

## Commands
1. `git status --short`
2. `git diff --stat HEAD`
3. `npm run typecheck`
4. `npm run lint`
5. `npm run test -w apps/web`
6. `npm run test -w apps/api`
7. `npm run build -w apps/web`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail/skip counts
- modified and untracked files
- per-finding present/absent for F1–F6

---

## Iteration 5 — Review-5 F7 (and cheap F8) fix

## Worker
`codex-worker`

## Routing Reason
Low-thinking: the edit-race fix is a specified SQL/transaction pattern matching the already-landed accept/abandon F3 change. Quantity-editor correction is a localized CartPage state change with explicit persist/restore rules. No new architecture.

## Approved Plan

### F7: Atomic edit-status guard
File: `apps/api/src/modules/shopping/routes/cart-drafts.ts` PUT `/drafts/:id/items/:itemId`

Inside the existing `app.db.transaction`:
1. Keep `assertOwnedDraft`.
2. Replace the `findFirst` status read + later item/total writes with a claim at the start:
   `UPDATE cart_drafts SET updatedAt = now() WHERE id = :id AND userId = :userId AND status = 'draft' RETURNING id`
3. If 0 rows → `throw new HttpError(400, "Only draft-status carts can be edited")` (keep the existing 400, not 409 — edit already uses 400).
4. Then load the item and continue the rest of the handler unchanged (item update, teach-signal, total recalculation).
5. Recalculate-total UPDATE at the end may stay keyed by id only because the transaction already holds the claimed draft row.
6. Do not change accept/abandon (already atomic).
7. Update hermetic tests only if the new UPDATE/RETURNING chain breaks the fake Drizzle fixture. Do not invent a new test architecture.

### F8: Quantity editor does not persist invalid/stale values
File: `apps/web/src/routes/shopping/CartPage.tsx` `CartItemRow`

1. Keep the F6 null-qty path (`Qty not set` + Edit initializes 1/piece).
2. Add a `useEffect` that resets local `qty`/`unit` from `item.quantityBase`/`item.unit` when those props change.
3. On blur / unit change:
   - Treat empty, non-numeric, non-integer, or `<= 0` as invalid.
   - On invalid input, restore the local fields to the last persisted pair and do not call `updateItem`.
   - On valid integer > 0, persist `{ quantityBase, unit, isRemoved }` as today.
4. Do not use `parseInt` on a decimal in a way that silently persists a truncated value while the input still shows the decimal.
5. Remove/undo must continue to send the persisted `item.quantityBase`/`item.unit` pair (including nulls).

## Files and Symbols
- `apps/api/src/modules/shopping/routes/cart-drafts.ts` — PUT handler
- `apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts` — fixture only if required
- `apps/web/src/routes/shopping/CartPage.tsx` — CartItemRow local state

## Must Not Change
- shopping service files
- schema files
- shopping-queries.ts
- AppLayout.tsx
- cart-view.ts (F5 is done)
- receipt files

## Acceptance Criteria
- F7: Item edit cannot succeed after the draft has left `draft` status, including vs a concurrent accept
- F7: Failed claim returns 400 with the existing message
- F8: Invalid/empty/fractional qty does not persist; local fields restore to the last saved pair
- F8: Prop updates overwrite local qty/unit
- F6 behavior remains: null qty shows Qty not set + Edit writes 1/piece together
- typecheck, lint, `npm run test -w apps/web`, cart-drafts hermetic tests, `npm run build -w apps/web` pass

## Commands
1. Make the changes
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/web`
5. `node --env-file-if-exists=../../.env --experimental-test-module-mocks --test apps/api/src/modules/shopping/routes/cart-drafts.hermetic.test.ts` from `apps/api` or equivalent
6. `npm run build -w apps/web`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes
- plan deviations or blockers

---

## Iteration 6 — Independent Verification of F7/F8

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: inspect the atomic edit claim and qty-editor validation, re-run typecheck/lint/web tests/hermetic tests/build. Read-only.

## Approved Plan
- V1: Confirm PUT edit claims draft with `UPDATE ... status='draft' RETURNING` inside the existing transaction; 0 rows → 400
- V2: Confirm no remaining findFirst status-read-then-unconditional-write on edit
- V3: Confirm CartItemRow syncs qty/unit from props and rejects invalid/empty/fractional qty without persisting
- V4: Confirm F6 null-qty path still exists
- V5: `npm run typecheck`, `npm run lint`, `npm run test -w apps/web`, hermetic cart-drafts tests, `npm run build -w apps/web`

## Must Not Change
Everything — read-only verification.

## Commands
1. `git status --short`
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/web`
5. hermetic cart-drafts tests
6. `npm run build -w apps/web`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail counts
- per-check present/absent with file:line citations

---

## Iteration 7 — Review-6 F9 abandon-toast fix

## Worker
`codex-worker`

## Routing Reason
Low-thinking: one-line mechanical change. `toast("Draft abandoned")` must pass `"success"`.

## Approved Plan
File: `apps/web/src/routes/shopping/CartPage.tsx` `handleAbandon`
Change:
`toast("Draft abandoned")`
to:
`toast("Draft abandoned", "success")`

Do not change generate/accept. Do not run a prettier sweep.

## Must Not Change
Everything else.

## Acceptance Criteria
- Successful abandon toast is kind success
- typecheck, lint, web tests, web build still pass

## Commands
1. Make the one-line change
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/web`
5. `npm run build -w apps/web`

## Required Evidence
- files changed
- complete diff
- commands and literal output
- exit codes

---

## Iteration 8 — Independent Verification of F9 toast

## Worker
`codex-worker`

## Routing Reason
Verification is deterministic: confirm the one-line toast change and re-run typecheck/lint/web tests/build. Read-only.

## Approved Plan
- Confirm `handleAbandon` calls `toast("Draft abandoned", "success")`
- Confirm generate/accept still use success toasts and have no onError
- `npm run typecheck`, `npm run lint`, `npm run test -w apps/web`, `npm run build -w apps/web`

## Must Not Change
Everything — read-only verification.

## Commands
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/web`
4. `npm run build -w apps/web`

## Required Evidence
- exact commands and literal output
- exit codes
- pass/fail counts
- file:line citation for the toast call
