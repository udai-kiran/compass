# Sonnet Worker Delegation — A7 (NB1/NB2/lock-order fixes + reconcile DB-backed tests)

## Task
021-postings-model, dual-write PR-A, slice A7. Approved plan: tasks/021-postings-model/PLAN-A7.md.

## Iteration 1

## Files and Symbols
- apps/api/src/modules/ledger/services/reconcile-postings.ts — NB1 fix (repaired++ timing) + NB2
  comment (lines 62-67)
- apps/api/src/modules/ledger/services/transfers.ts — linkTransfer lock-order (lines 82-104)
- NEW apps/api/src/modules/ledger/services/reconcile-postings.test.ts — DB-backed tests

## Required Changes

### P1: NB1 (reconcile-postings.ts)
Current (line 90-107):
```
await db.transaction(async (t) => {
  ...
  if (!postingsMultisetEqual(drafts, stored)) {
    await replacePostings(t, id, userId, drafts);
    repaired++;
  }
});
```
Change to:
```
const didRepair = await db.transaction(async (t) => {
  ...
  if (!postingsMultisetEqual(drafts, stored)) {
    await replacePostings(t, id, userId, drafts);
    return true;
  }
  return false;
});
if (didRepair) repaired++;
```

### P2: NB2 (reconcile-postings.ts lines 62-67)
Replace the current comment with something honest like:
```
 * The per-row transaction gives compare+replace atomicity: if a drift is
 * detected, the deletion and re-insertion of that row's postings either fully
 * commit or fully roll back. Rows are processed sequentially to reduce
 * contention, but this does NOT lock source rows before computing drafts — a
 * concurrent mutation could theoretically change the row between compute and
 * replace within the same per-row tx. This is harmless at quiescent boot but
 * would need explicit FOR UPDATE locking if used as a live maintenance primitive.
```

### P3: linkTransfer lock-order (transfers.ts lines 82-104)
Replace the two sequential select-for-update queries with:
1. `const [firstId, secondId] = outTransactionId < inTransactionId ? [outTransactionId, inTransactionId] : [inTransactionId, outTransactionId];`
2. Issue select-for-update on `firstId`, then on `secondId` (same where clause, just id differs).
3. After both resolve, identify `out` and `inn` by matching `rows[0].id === outTransactionId`.
Keep all subsequent validation logic (amount, account, isOpening, transfer_links check) unchanged.

### P4: reconcile-postings.test.ts (new file)
DB-backed test file using node:test. Same pattern as backup.test.ts (imports createDb/createPool,
reads DATABASE_URL via requireDatabaseUrl or process.env, createUser/cleanupUser helpers).
Tests:
1. "idempotency: second reconcile has repaired=0" — create user, create a txn, reconcile →
   repaired>0; reconcile again → repaired===0.
2. "soft-deleted txns receive postings" — create user, create txn, soft-delete it; reconcile →
   findInconsistentPostings returns [].
3. "tenant-scope: reconcile user A does not touch user B" — create 2 users each with a txn;
   reconcile user A; user B has NO postings (select count where transaction.userId=B).
4. "duplicate/extra posting pruned" — reconcile a txn (generates correct postings); manually
   insert one extra posting on that txn; reconcile again → repaired===1; findInconsistentPostings
   returns [].
5. "NB1: failed shape does not inflate repaired" — create user, create a split txn with splits
   that DON'T sum to the parent amount → reconcile returns failures with that txn + repaired
   does NOT count it (repaired for that single txn is 0, failure has length=1).

## Must Not Change
- No reader/DTO/hydrate change; no packages/shared; no web; no schema change; no migration.
- Do NOT change the meaning of postingsMultisetEqual, replacePostings, or
  computePostingDraftsForTransaction beyond the NB1 return-value wrapping.
- Keep all existing tests (postings.test.ts 20, backup.test.ts 19) passing.
- Node native TS: relative imports MUST include the .ts extension. Money is integer paise.

## Acceptance Criteria
AC1-AC6 per PLAN-A7.md.

## Commands (run and capture literal output + exit codes)
1. npm run typecheck -w apps/api
2. npm run lint
3. node --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts
4. node --test apps/api/src/modules/ledger/services/postings.test.ts
5. node --test apps/api/src/modules/system/services/backup.test.ts

## Required Evidence
- files changed (git diff --stat); complete diff of each changed file; all commands + literal
  output + exit codes; test pass/fail counts; any plan deviation or blocker.

---

## Iteration 2 — fix Codex review-18 finding 1 (P3 role-remapping 404 regression)

### Defect (confirmed by coordinator tracing the code)
When one of the two transaction IDs in linkTransfer doesn't exist or belongs to the wrong tenant,
`firstRows` is empty → `firstRows[0]?.id` is `undefined` → both ternary conditions are false →
both `outRows` and `innRows` resolve to `secondRows`. If secondRows has a row, `out === inn`
(same row), 404 check bypassed, user gets 400 "opposite-sign" instead of 404 "not found".

### Required fix (transfers.ts, lines 111-114 area)
Replace the current role-remapping:
```ts
const outRows = firstRows[0]?.id === outTransactionId ? firstRows : secondRows;
const innRows = firstRows[0]?.id === inTransactionId ? firstRows : secondRows;
const out = outRows[0];
const inn = innRows[0];
```
With:
```ts
const out = [firstRows[0], secondRows[0]].find(r => r?.id === outTransactionId);
const inn = [firstRows[0], secondRows[0]].find(r => r?.id === inTransactionId);
```
This correctly handles: (a) both found (normal), (b) one missing → out or inn is undefined → 404,
(c) both missing → both undefined → 404. The subsequent `if (!out || !inn)` check stays as-is.

### Also fix (review-18 finding 2, non-blocking documentation)
The NB1 regression test (test 5 in reconcile-postings.test.ts) is technically vacuous for the
specific commit-failure scenario — it tests "replacePostings throws → repaired doesn't increment"
which is true in BOTH old and new code. Add a comment to the test explaining this limitation:
the test validates the general per-row-failure→no-inflation property but cannot exercise the
specific commit-time-reject scenario without DB-level mocking. The code fix (P1) is proven
correct by inspection (Codex confirmed AC1 met). No code change to the test logic needed.

### Must not change
- Same constraints as Iteration 1. Do NOT change anything else in transfers.ts or reconcile-postings.ts.

### Commands / evidence: same as Iteration 1 (typecheck, lint, all 3 test files).
