All checks confirm correctness:

- Line 210: inside `rebuildPostingsForTransaction` (existing, unchanged)
- Line 425: the new in-tx guard (inside the write transaction, after the `FOR UPDATE` lock)
- The old pre-tx guard (`db.query.transferLinks.findFirst` at lines 413-416) is gone

## Summary of changes

**File modified:** `apps/api/src/modules/ledger/services/transactions.ts` — `updateTransaction` function only.

**What changed:**

1. **Removed the pre-transaction transfer-link guard** (old lines 409-421) — the `db.query.transferLinks.findFirst` check that ran on the bare `Db` handle before the write transaction. This was raceable against a concurrent `linkTransfer`.

2. **Added `FOR UPDATE` row lock** as the first statement inside the `db.transaction` callback — locks the target transaction row with `t.select(...).for("update")`, returning `[]` (→ 404) if not found.

3. **Moved the transfer-leg guard inside the tx** — now runs under the `FOR UPDATE` lock using `t.query.transferLinks.findFirst` (the tx handle), so it's serialized against concurrent linking/unlinking. Same error message and behavior.

4. **Added split-amount guard** — when `input.amountPaise` is provided and the transaction has existing splits, validates that `sumPaise(splitAmounts) === input.amountPaise`, throwing `HttpError(409, "Update the transaction's splits to match the new amount")` on mismatch. Uses the existing `sumPaise` (BigInt-safe) function.

**Everything else unchanged:** pre-tx ownership checks (assertOwnedRealAccount, assertOwnedCategory, assertOwnedResource, recurring template), the legacy update + `rebuildPostingsForTransaction`, the `isUniqueViolation` catch, the 404 fallback, and `hydrate` all remain identical.

**Verification:**
- `npm run typecheck -w apps/api` → exit 0
- `node --test apps/api/src/modules/ledger/services/postings.test.ts` → 20/20 pass
- `node --test apps/api/src/db/schema.decomposition.test.ts` → 3/3 pass
