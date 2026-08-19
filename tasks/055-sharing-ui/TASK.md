# Task: Per-record sharing controls (task board 4.7)

## Status
COMPLETE

## Verified
- review-1.md: PASS — API paths correct, types match, no React anti-patterns, typecheck exit 0, build exit 0

## Objective
One reusable `SharingControl` component, wired into accounts, goals,
budgets and the transaction drawer. Current visibility always explicit;
private is the default and visually distinct.

## Root Cause
No UI surface for sharing grants.

## Scope

### New component
- `components/SharingControl.tsx` — reusable control showing current
  visibility (Private / Shared with N), toggle to share/un-share with
  household members by name

### Integration points
- `routes/settings/AccountDetailPage.tsx`
- `routes/goals/GoalsPage.tsx`
- `routes/budgets/BudgetsPage.tsx`
- Transaction drawer

### Query hooks
- `lib/household-queries.ts` — useSharingGrants, useSharingMutations

## Dependencies
- 053 (API routes) — PLANNING

## Plan
- P1: Build SharingControl component
- P2: Wire into AccountDetailPage
- P3: Wire into GoalsPage
- P4: Wire into BudgetsPage
- P5: Wire into transaction drawer
- P6: Handle absent-household case (control hidden)
- P7: Cascade warning before un-sharing
- P8: Keyboard accessibility + focus state

## Acceptance Criteria
- AC1: One reusable control used identically everywhere
- AC2: Current visibility always explicit; private visually distinct
- AC3: Share/un-share names the people affected
- AC4: Cascade effect stated before confirming
- AC5: Control absent when user has no household
- AC6: Keyboard accessible
- AC7: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build -w apps/web` all pass

## Verification
- T1-T4: typecheck, lint, test, build all exit 0

## Non-Goals
- Backend sharing logic changes (4.3 owns that)
