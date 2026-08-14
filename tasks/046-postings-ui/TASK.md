# Task: Postings UI (2.7)

## Status
COMPLETE

## Objective
Close the one remaining gap in the transaction UI for postings: surface server-side split validation errors instead of the client-side balance guard.

## Scope
- `apps/web/src/routes/transactions/TransactionDrawer.tsx`
  - Line ~78: client-side `balanced` check
  - Line ~283: disabled Save button when not balanced
  - `setSplits.mutate()` lacks `onError` handler

## Plan
- P1: Keep the client-side balanced check as a visual hint (e.g. warning text) but NOT as a button disabler
- P2: Add `onError` handler to `setSplits.mutate()` that shows a toast/error message from the server response
- P3: Verify: typecheck + lint + build pass

## Acceptance Criteria
- AC1: Save button is always clickable (server validates)
- AC2: Server rejection (unbalanced splits) shows a clear error message
- AC3: typecheck + lint + `npm run build -w apps/web` pass
