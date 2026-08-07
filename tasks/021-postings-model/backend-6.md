All acceptance criteria are met. Here's the summary:

## Changes made (single file: `apps/api/src/modules/ingest/services/imports.ts`)

**1. Import** — added `rebuildPostingsForTransaction` from `../../ledger/services/transactions.ts` (cross-module service import, allowed by the architecture).

**2. `commitImport` reconciliation path** (inside the existing `t` transaction):
- **Before the delete**: SELECT auto `transfer_links` where `outTransactionId` or `inTransactionId` ∈ `updatedIds`, flatten all `out`+`in` ids into `severedLegTxIds` (capture-before-delete).
- **Keep the existing `t.delete(transferLinks)` as-is** (unchanged).
- **After the delete**: rebuild every id in `new Set([...updatedIds, ...severedLegTxIds])` via `rebuildPostingsForTransaction(t, userId, id)`. This means severed legs revert to ordinary, updated legs with surviving manual links re-mirror Clearing with the new amount, and plain updated legs re-mirror ordinary.

**3. `commitImport` bulk insert** (inside the existing `t`):
- After the `t.execute(...)` mapping that stamps `transaction_id` on import rows, loop `inserted` and `await rebuildPostingsForTransaction(t, userId, x.id)` for each fresh import row. The `importRows` mapping update is left untouched.

**4. `rollbackImport`** (inside the existing `t`):
- **After the row lock block, BEFORE the delete loop**: SELECT `transfer_links` where `out` or `in` ∈ `ids`, flatten into `survivingPartners` = ids NOT in the deleted set (the counterparts that survive the hard-delete).
- **Keep the delete loop and snapshot-restore updates exactly as-is** (unchanged).
- **After the snapshot updates**: rebuild every id in `new Set([...survivingPartners, ...snapshots.map(s => s.transactionId)])` — restored rows get correct postings; surviving transfer counterparts revert to ordinary since their Clearing partner is gone.

**Not changed**: `autoLinkTransfers` (left outside both tx, unchanged), all legacy insert/delete/update/link logic, `importRows` mapping, snapshot capture, SIP-rollback guard, lock order, reconciliation plan logic, reader/DTO/schema.

## Verification

- `npm run typecheck -w apps/api` → exit 0
- `node --test apps/api/src/modules/ledger/services/postings.test.ts` → 20/20 pass
- `node --test apps/api/src/db/schema.decomposition.test.ts` → 3/3 pass
