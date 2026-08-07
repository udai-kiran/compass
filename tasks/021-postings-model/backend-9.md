All verification passes. Here's a summary of the changes:

---

## Summary of changes

**Three files modified, two owned (postings.ts, transactions.ts) + one helper (post-entry.ts):**

### `apps/api/src/modules/ledger/services/postings.ts`
- Added `export class PostingShapeError extends Error {}` — a typed marker for unrepairable posting shapes (e.g. split sum mismatch). No builder math was changed.

### `apps/api/src/modules/ledger/services/post-entry.ts`
- Added `export interface ResolvedSystemAccounts` — a named type alias for the `{ expenses, income, opening, clearing }` return shape of `resolveSystemAccounts`. Updated the function's return type and the `result as` cast to use it.

### `apps/api/src/modules/ledger/services/transactions.ts`
- **Extracted** `export async function computePostingDraftsForTransaction(t, userId, id, systemAccounts?)` — tenant-scoped (row lookup uses `and(eq(id), eq(userId))`), returns `null` on not-found, same branch order/precedence as before (opening → transfer-leg → split → ordinary), and **the split branch now enforces a new invariant**: `sumPaise(splitRows) !== row.amountPaise` throws `PostingShapeError` before calling `buildSplitPostings`.
- **Rewired** `rebuildPostingsForTransaction` to delegate to `computePostingDraftsForTransaction` and then `replacePostings`, removing the now-extracted inline branching. Behavior-preserving for all valid data.
- Added imports for `PostingShapeError`, `PostingDraft` (from `./postings.ts`) and `ResolvedSystemAccounts` (from `./post-entry.ts`).

### Verification
- `npm run typecheck -w apps/api` → exit 0
- `node --test apps/api/src/modules/ledger/services/postings.test.ts` → 20/20 pass
- `node --test apps/api/src/db/schema.decomposition.test.ts` → 3/3 pass
