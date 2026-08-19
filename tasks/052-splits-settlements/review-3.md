Pass.

Verified `getHouseholdBalances` in `apps/api/src/modules/household/services/settlements.ts`:

1. `othersTotal` is computed once per split, before the per-share loop.
2. Each non-payer is debited once by `sharePaise`.
3. The payer is credited once per split by `othersTotal`, outside the inner loop and not dependent on a payer share row.
4. Per-split deltas are zero-sum: payer receives `+othersTotal`, non-payers collectively receive `-othersTotal`.
5. Settlement direction is correct: `fromPersonId += amountPaise`, `toPersonId -= amountPaise`.
6. `npm run typecheck` passes across all workspaces.

No remaining defect found.