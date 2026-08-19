# Task 056 — Split Modal UI — Verification 1

## Files Created
- `apps/web/src/routes/household/split-math.ts` — pure client-side split math (equal, proportional, exact validation)
- `apps/web/src/routes/household/split-math.test.ts` — 6 tests covering all 3 functions
- `apps/web/src/lib/split-queries.ts` — React Query hooks: useHouseholdBalances, useSettlements, useCreateSettlement
- `apps/web/src/routes/household/BalancesPanel.tsx` — per-person balances + recent settlements panel

## Files Modified
- `apps/web/src/routes/household/HouseholdPage.tsx` — added BalancesPanel import and `<BalancesPanel household={household} />` after MemberList in HouseholdCard

## Commands Run

### 1. typecheck
```
npm run typecheck 2>&1 | tail -20
```
Output: All 5 workspaces passed, exit 0 (no errors printed).

### 2. split-math tests
```
node --test apps/web/src/routes/household/split-math.test.ts 2>&1
```
Output:
```
▶ computeEqualShares
  ✔ splits evenly with no remainder (0.734901ms)
  ✔ distributes remainder to first members (0.09974ms)
✔ computeEqualShares (1.40629ms)
▶ computeProportionalShares
  ✔ splits 2:1 proportionally (0.171026ms)
  ✔ preserves total with remainder (0.112985ms)
✔ computeProportionalShares (0.386356ms)
▶ validateExactShares
  ✔ returns 0 for valid shares (0.126211ms)
  ✔ returns difference when shares don't match (0.089942ms)
✔ validateExactShares (0.312936ms)
ℹ tests 6
ℹ suites 3
ℹ pass 6
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 64.233232
```

### 3. web build
```
npm run build -w apps/web 2>&1 | tail -15
```
Output: `✓ built in 171ms` — no errors.

## Notes
- `formatINR(paise: number): string` confirmed in `packages/shared/src/money.ts` — takes paise directly, no division needed.
- `HouseholdBalancesSchema`, `SettlementSchema`, `CreateSettlementSchema`, `CreateSettlement` all confirmed exported from `@compass/shared` via `packages/shared/src/schemas/household.ts`.
- The HouseholdPage.tsx already had a `SharingControl` import added by task 055; the BalancesPanel import was added alongside it cleanly.
- `useHouseholdMembers` import removed from BalancesPanel.tsx (the brief included it but it was unused — balances are keyed by personId, not userId, so member lookup can't map them without a separate persons table).
