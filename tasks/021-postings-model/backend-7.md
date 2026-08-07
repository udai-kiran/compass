All changes are complete and verified.

## Summary

Per Slice A4b (dual-write recurring + demo + categories-merge), I dual-wrote `postings` in the same DB transaction each legacy writer already opens, importing the canonical `rebuildPostingsForTransaction` helper from `transactions.ts`.

**Changes (only the three owned files):**

1. **`apps/api/src/modules/ledger/services/recurring.ts`** — Added `import ... from "./transactions.ts"`. Added `.returning({ id: transactions.id })` to all three direct bulk inserts inside `trx` (EMI source, EMI principal, generic), then looped the inserted rows and called `await rebuildPostingsForTransaction(trx, t.userId, row.id)`. EMI stays **two independent ordinary families** (source + principal) — not a transfer; rebuild's ordinary branch is correct since these rows are non-opening, non-transfer-linked, and have no splits.

2. **`apps/api/src/modules/system/services/demo.ts`** — Added `import ... from "../../ledger/services/transactions.ts"` (verified relative path correct). Changed `tx.insert(transactions).values(txns)` to `.returning({ id: transactions.id })` and looped `await rebuildPostingsForTransaction(tx, userId, row.id)`. Rebuild handles each demo row's shape; card-payment pairs are not transfer-linked, so they stay ordinary.

3. **`apps/api/src/modules/ledger/services/categories.ts`** — Added `import ... from "./transactions.ts"`. In `mergeCategory`, **before** the `transactions.categoryId` and `transaction_splits.categoryId` updates, collected the affected transaction ids (direct `transactions` where `categoryId = id` ∪ `transaction_splits.transactionId` where `categoryId = id`). **After** the updates, looped the deduped ids and called `await rebuildPostingsForTransaction(tx, userId, txnId)`, updating each row's Expenses/Income counter category (rebuild's branch priority preserves Clearing/Opening).

No readers/aggregations/DTO/schema changed; no other writer touched; hydrate/readers untouched; EMI did not become a transfer.

**Verification:**
- `npm run typecheck -w apps/api` → exit 0
- `node --test apps/api/src/modules/ledger/services/postings.test.ts` → 20/20 pass
- `node --test apps/api/src/db/schema.decomposition.test.ts` → 3/3 pass
- `db:migrate` not run.
