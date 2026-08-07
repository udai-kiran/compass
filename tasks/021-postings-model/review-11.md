## Verdict

**No blocking findings. Both review-10 blockers are fully closed.**

### BLOCKING

None.

### Verification

1. **Target-row lock and 404 path: correct**

   The first database statement inside `db.transaction` is a `SELECT ... FOR UPDATE` at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:414).

   It is scoped by:

   - transaction `id`
   - `userId`
   - `deletedAt IS NULL`

   A missing row returns an empty result from the callback and reaches the existing 404 path at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:478).

2. **Transfer-link guard: blocker closed**

   The account/amount guard now runs after acquiring the target-row lock, inside the same write transaction, at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:423).

   It checks both transfer-link roles and rejects linked-leg account or amount changes with `HttpError(409)`. There is no stale or duplicate transfer-membership check before `db.transaction`.

   This closes the race:

   - If `updateTransaction` locks first, `linkTransfer` waits and subsequently validates the updated row.
   - If `linkTransfer` locks first, the update waits and then observes the committed link under its lock, returning 409.

3. **Split-amount guard: blocker closed**

   The guard at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:436) behaves correctly:

   - It queries splits only when `input.amountPaise !== undefined`.
   - It acts only when at least one split exists.
   - It calculates the total with BigInt-backed `sumPaise`.
   - An amount equal to the split sum is allowed.
   - A divergent amount is rejected with `HttpError(409)`.
   - Account-only and other non-amount edits on split transactions remain allowed.
   - It does not rescale or otherwise mutate splits.

   Because `setSplits` and `updateTransaction` both lock the same parent row before checking or changing the split invariant, the two operations serialize correctly.

4. **Ordinary edit behavior: no regression found**

   For a non-split, non-transfer-linked transaction:

   - Account edits remain allowed after ownership validation.
   - Amount edits bypass the split rejection because no split rows exist.
   - The legacy update and posting rebuild remain atomic.
   - The rebuilt ordinary posting family uses the resulting account, amount, category, and necessity.

   Inspection found no blocker-fix changes to `createTransaction`, `setSplits`, `bulkAction`, transfers, imports, accounts, `rebuildPostingsForTransaction`, or `buildSplitPostings`; the relevant blocker-closing logic is confined to `updateTransaction`.

5. **Lock ordering and deadlock assessment**

   The new `updateTransaction` lock does not introduce a deadlock cycle:

   - `updateTransaction` locks one transaction row.
   - `setSplits` locks one parent transaction row.
   - Neither subsequently requests another transaction-row lock.
   - `linkTransfer` may wait for either operation, but the single-row operation does not wait for `linkTransfer`’s other leg, so no cycle is formed.

### NON-BLOCKING

The stated premise that `linkTransfer` locks its two rows “ordered by id” is not true of the real current code. It locks the outbound row first and inbound row second at [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:83), without sorting the IDs.

This is pre-existing and does not undermine either review-10 fix. Valid transfer requests naturally lock a negative leg followed by a positive leg, but adversarial concurrent reversed-role calls could still create a PostgreSQL-detected deadlock before sign validation. Sorting both IDs and locking them in one deterministic order would remove that residual risk.

### Validation

`npm run typecheck --workspace=apps/api` passes.

**Final disposition: both review-10 blockers are closed; no blocking issue remains in the targeted fix.**