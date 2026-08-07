All verifications pass. Here's a summary of what was done:

## Summary

**Slice A6 (backup/restore posting round-trip)** was already implemented in the working tree — the changes had been applied but not yet verified. I confirmed the implementation and fixed one test assertion that was semantically incorrect.

### Files changed (already in working tree before verification)

1. **`apps/api/src/modules/system/services/backup.ts`** — Added `"postings"` to `ALL_TABLES` immediately after `"transactions"`, added `postings` to `LINKED_TABLES` (FK: `transaction_id` → `transactions`), updated the doc comment explaining the ordering. Postings is NOT added to `USER_TABLES`.

2. **`apps/api/src/modules/system/services/restore-user.ts`** — Extracted `countBlockingRows` helper used by both freshness checks (pre-upload and in-transaction). Replaced the hard-coded `MUST_BE_EMPTY` guard with `restorableTables()` loop calling `countBlockingRows`. Added `if (table === "postings") continue` to skip archived posting rows. Added `postings?: { repaired: number; failed: number }` to `RestoreSummary`. Added injectable `reconcile` parameter defaulting to `reconcileUserPostings`. Restructured control flow so post-commit reconcile runs outside every failure-cleanup scope (DB rollback and blob deletion).

3. **`apps/api/src/modules/system/routes/backup.ts`** — Added `app.log.error` when `summary.postings?.failed > 0`.

4. **`apps/api/src/modules/system/services/backup.test.ts`** — Added ordering assertions for postings in `restorableTables()`, a mocked restoreDump test verifying every posting column is preserved and positioned after FK parents, and four DB-backed tests (AC2, AC3+AC4, AC5, AC5 post-commit throw).

### Fix applied during verification

- **`backup.test.ts`** — Fixed the AC5 test's final assertion: it previously asserted *all* postings reference the restored real account, but the reconcile-derived shape for an ordinary expense includes a system "Expenses" counter leg. Changed to assert that the foreign account is never referenced, and exactly one posting (the asset leg) references the real account.

### Verification results

| Check | Result |
|-------|--------|
| `npm run typecheck -w apps/api` | ✅ Pass (0 errors) |
| `npm run lint` | ✅ Pass (0 errors) |
| `node --test apps/api/src/modules/system/services/backup.test.ts` | **18/18 pass** |
| `node --test apps/api/src/modules/ledger/services/postings.test.ts` | **20/20 pass** |
