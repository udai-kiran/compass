# Task: Split modal, balances & settle-up (task board 4.8)

## Status
COMPLETE

## Verified
- review-1.md (combined with 055): PASS — split-math algorithms correct, API paths correct, BalancesPanel uses paise correctly, typecheck exit 0, split-math.test 6/6 pass

## Objective
Split modal on transactions, balance panel on household page, settle-up
flow. All amounts via formatINR; split math in a tested sibling module.

## Root Cause
No UI for splits and settlements.

## Scope

### New components
- `routes/transactions/SplitModal.tsx` — modal: choose members, choose
  rule (equal/shares/exact), live running total, remainder display
- `routes/transactions/split-math.ts` — pure split computation (tested)
- `routes/transactions/split-math.test.ts` — tests
- `routes/household/BalancesPanel.tsx` — per-person netted balances
- `routes/household/SettleUpModal.tsx` — settle-up confirmation

### Query hooks
- `lib/household-queries.ts` — useSplits, useSplitMutations,
  useHouseholdBalances, useSettlements, useSettlementMutations

### Integration
- Transaction drawer or detail → launch SplitModal
- HouseholdPage → BalancesPanel + SettleUpModal

## Dependencies
- 053 (API routes) — PLANNING

## Plan
- P1: Create split-math.ts pure functions + tests
- P2: Build SplitModal with all 3 rules
- P3: Live total reconciliation + remainder display
- P4: Build BalancesPanel
- P5: Build SettleUpModal
- P6: Wire into transaction drawer + household page
- P7: Verify modal a11y (role="dialog", focus trap, escape)

## Acceptance Criteria
- AC1: All 3 split rules with live total reconciling to txn amount
- AC2: Remainder allocation visible, not silent
- AC3: Unbalanced exact split blocked with shortfall shown numerically
- AC4: Balances netted per person; settle-up zeroes the pair
- AC5: Copy states no money is moved
- AC6: Split math in tested sibling module, not JSX
- AC7: Modal a11y: role="dialog", Escape-closable, focus-trapped
- AC8: `npm run typecheck`, `npm run lint`, `npm run test`,
  `npm run build -w apps/web` all pass

## Verification
- T1-T4: typecheck, lint, test, build all exit 0
- T5: split-math.test.ts covers edge cases

## Non-Goals
- Multi-currency
- Groups-of-groups
