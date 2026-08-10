# Implementation Report — iteration 2

## Files changed
- `apps/extractor/src/statement-duplicate.test.ts` — three targeted edits (see diff below)

## Files inspected
- `tasks/022-pr-f-extractor-postings/DELEGATION.md` (iteration 2 section)
- `tasks/022-pr-f-extractor-postings/TASK.md`
- `apps/extractor/src/statement-duplicate.test.ts`

## Implementation details

### 1. Fixture label rename (lines 50, 59 in original)
`'AC9 test user'` → `'AC-shared test user'`
`` `AC9 test ${type}` `` → `` `AC-shared test ${type}` ``

### 2. AC5 strengthened
`transactions.account_id` now points at `cardAccountId` (the queried account) while the posting is placed on `otherAccountId`. Under the old legacy reader (`where account_id = $2`) this would have returned one row; under the postings reader it returns zero. Mirror of the AC3 decoy technique.

### 3. AC7 date-range test added
New test "AC7 (date-range): out-of-range transactions are excluded; BETWEEN boundaries are inclusive" placed after the cross-tenant AC7 test and before AC8. Inserts 5 transactions: one on `fromDate` (2026-05-01, included), one inside range (2026-05-15, included), one on `toDate` (2026-05-31, included), one one day before `fromDate` (2026-04-30, excluded), one one day after `toDate` (2026-06-01, excluded). Asserts exactly 3 rows returned with the correct merchants.

## Commands and literal output

### npm run typecheck
```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```
Exit code: 0

### npm run lint
```
> compass@0.1.0 lint
> eslint .
```
Exit code: 0

### node --test apps/extractor/src/statement-duplicate.test.ts
BLOCKED — DATABASE_URL is not set. The file throws at module load:
```
file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:34
    throw new Error(
          ^

Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — ...
    at requireDatabaseUrl (file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:34:11)
    at file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:43:25
    ...
ℹ tests 1
ℹ pass 0
ℹ fail 1
```
Exit code: 1

## db.ts confirmation
`git diff apps/extractor/src/db.ts` shows only the iteration-1 PR-F changes (pre-existing before this conversation — the gitStatus snapshot at conversation start was taken before iteration 1 ran). No changes were made to `db.ts` in this iteration. The file is byte-identical to what it was at the start of this task.

## Complete diff (statement-duplicate.test.ts changes from this iteration only)

Change 1 — label rename:
- `'AC9 test user'` → `'AC-shared test user'`
- `` `AC9 test ${type}` `` → `` `AC-shared test ${type}` ``

Change 2 — AC5 strengthened:
```diff
-    // Transaction record uses the other account.
+    // Decoy: transactions.account_id deliberately set to the QUERIED card account
+    // (same technique as AC3). Under the OLD legacy reader that filtered on
+    // transactions.account_id this would have returned a row. Under the new
+    // postings reader it must not, because the posting is on the OTHER account.
     const txnRes = await pool.query<{ id: string }>(
       ...
-      [userId, otherAccountId],
+      [userId, cardAccountId],
     );
     const txnId = txnRes.rows[0]!.id;
-    // Posting is on the other account — not the card.
+    // Posting is on the other account — not the card. This is the decisive
+    // difference: the legacy reader would return this row (account_id matches),
+    // but the postings reader must not (no posting on cardAccountId).
     await createPosting(txnId, otherAccountId, -50000);
 
-    assert.equal(rows.length, 0, "posting on a different account must not appear under the card");
+    assert.equal(rows.length, 0, "must return 0 rows — posting is on a different account even though transactions.account_id = cardAccountId");
```

Change 3 — new "AC7 (date-range)" test inserted before AC8 (5 transactions, 3 in range including both boundaries, 2 excluded).

## Assumptions
- The `git diff apps/extractor/src/db.ts` output reflects iteration-1 changes that were implemented before this conversation and left uncommitted; I made no changes to that file.

## Unresolved risks
- None. No DATABASE_URL available to run the DB-backed test suite; blocked as expected per the brief.
