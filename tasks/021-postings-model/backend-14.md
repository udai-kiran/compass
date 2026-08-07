# backend-14 — A7 Implementation Report

## Summary

Implemented all four changes from DELEGATION-A7.md (Iteration 1):
- P1 (NB1): `repaired++` moved outside the per-row `db.transaction` callback  
- P2 (NB2): comment narrowed to remove "stable snapshot" overclaim  
- P3: `linkTransfer` issues `for("update")` locks in sorted-id order  
- P4: new `reconcile-postings.test.ts` with 5 DB-backed tests (5/5 pass)

---

## Files Changed

1. `apps/api/src/modules/ledger/services/reconcile-postings.ts` (P1 + P2)
2. `apps/api/src/modules/ledger/services/transfers.ts` (P3)
3. `apps/api/src/modules/ledger/services/reconcile-postings.test.ts` (P4 — NEW FILE)

---

## Implementation Details

### P1 — NB1 (reconcile-postings.ts)

**Before (lines 90-107 of original):**
```typescript
await db.transaction(async (t) => {
  ...
  if (!postingsMultisetEqual(drafts, stored)) {
    await replacePostings(t, id, userId, drafts);
    repaired++;   // ← inside the callback
  }
});
```

**After:**
```typescript
const didRepair = await db.transaction(async (t) => {
  ...
  if (!postingsMultisetEqual(drafts, stored)) {
    await replacePostings(t, id, userId, drafts);
    return true;
  }
  return false;
});
if (didRepair) repaired++;  // ← outside, only after successful commit
```

### P2 — NB2 (reconcile-postings.ts comment lines 62-68)

Old comment claimed "Rows are NOT parallelized — the writes are sequential to keep each comparison against a stable snapshot."

New comment (accurate):
```
The per-row transaction gives compare+replace atomicity: if a drift is
detected, the deletion and re-insertion of that row's postings either fully
commit or fully roll back. Rows are processed sequentially to reduce
contention, but this does NOT lock source rows before computing drafts — a
concurrent mutation could theoretically change the row between compute and
replace within the same per-row tx. This is harmless at quiescent boot but
would need explicit FOR UPDATE locking if used as a live maintenance primitive.
```

### P3 — linkTransfer lock-order (transfers.ts)

Inside `db.transaction(async (t) => {...})`, replaced the two sequential select-for-update queries on `outTransactionId` then `inTransactionId` with:

```typescript
const [firstId, secondId] =
  outTransactionId < inTransactionId
    ? [outTransactionId, inTransactionId]
    : [inTransactionId, outTransactionId];
const firstRows = await t.select()...where(eq(transactions.id, firstId),...).for("update");
const secondRows = await t.select()...where(eq(transactions.id, secondId),...).for("update");
const outRows = firstRows[0]?.id === outTransactionId ? firstRows : secondRows;
const innRows = firstRows[0]?.id === inTransactionId ? firstRows : secondRows;
const out = outRows[0];
const inn = innRows[0];
```

All subsequent validation logic (amount/account/isOpening/transfer_links checks) left unchanged.

### P4 — reconcile-postings.test.ts (new file)

5 DB-backed tests using the same pattern as `backup.test.ts` (createPool, createDb, requireDatabaseUrl, createUser/cleanupUser helpers, `t.after()` for cleanup):

1. **idempotency** — first reconcile repairs (repaired > 0), second has repaired=0
2. **soft-deleted txns receive postings** — soft-deleted txn included in reconcile; findInconsistentPostings returns []
3. **tenant-scope** — reconciling user A leaves user B's postings at count 0
4. **duplicate/extra posting pruned** — rogue posting inserted directly → second reconcile detects drift, repaired=1, findInconsistentPostings returns []
5. **NB1 regression guard** — per-row tx failure → repaired=0, failures.length=1 with the txn's id

**NB1 test deviation** (see plan deviation section below).

---

## Commands Run and Literal Output

### 1. `npm run typecheck -w apps/api`

```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```
Exit code: **0**

### 2. `npm run lint`

```
> compass@0.1.0 lint
> eslint .
```
Exit code: **0**

### 3. `node --env-file-if-exists=.env --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts`

```
✔ idempotency: second reconcile has repaired=0 (177.30682ms)
✔ soft-deleted txns receive postings (47.738862ms)
✔ tenant-scope: reconcile user A does not touch user B (40.598367ms)
✔ duplicate/extra posting pruned (38.332449ms)
✔ NB1: failed shape does not inflate repaired (51.206988ms)
ℹ tests 5
ℹ suites 0
ℹ pass 5
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1540.771597
```
Exit code: **0**

### 4. `node --env-file-if-exists=.env --test apps/api/src/modules/ledger/services/postings.test.ts`

```
✔ assertSafePaise rejects non-safe integers (3.672537ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.470211ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (9.258875ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.317636ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.324263ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.316736ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.452327ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.30375ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.368606ms)
✔ buildTransferPostings: rejects non-positive amounts (0.456311ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.299321ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.250302ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.255665ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.278962ms)
✔ classifyShape + projections round-trip: ordinary (0.437692ms)
✔ classifyShape + projections round-trip: split (0.41286ms)
✔ classifyShape + projections round-trip: mixed-sign split (0.24555ms)
✔ classifyShape + projections round-trip: opening (0.334263ms)
✔ classifyShape: transfer classifies as 'transfer' (0.398466ms)
✔ classifyShape: degenerate shapes throw (0.317548ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 211.892086
```
Exit code: **0**

### 5. `node --env-file-if-exists=.env --test apps/api/src/modules/system/services/backup.test.ts`

```
✔ the full backup covers every table in the schema (3.104029ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.277086ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.31467ms)
✔ no table is scoped both directly and through a parent (0.283462ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.82895ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.601354ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.489757ms)
✔ restore defers cyclic and self-referencing foreign keys (0.512814ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.791339ms)
✔ the mocked restoreDump records postings every column, positioned after FK parents (1.459175ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched (0.8119ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip (361.558571ms)
✔ misc-05 AC14: per-user archive round-trips card-due task's source/sourceKey (216.333086ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey falls back to DEFAULTs (46.672967ms)
✔ A6 AC2: a dest user with seeded categories + system accounts restores; 409 for blocked (303.537879ms)
✔ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (304.204937ms)
✔ A6 AC3 OLD-style (B1): restore re-synthesizes postings from archive with no postings (82.14457ms)
✔ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (32.650967ms)
✔ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore (152.501636ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2815.729731
```
Exit code: **0**

---

## Test Pass/Fail/Skip Counts

| Test file | Pass | Fail | Skip |
|-----------|------|------|------|
| reconcile-postings.test.ts | 5 | 0 | 0 |
| postings.test.ts | 20 | 0 | 0 |
| backup.test.ts | 19 | 0 | 0 |

---

## Plan Deviation

### NB1 Test — PostingShapeError not achievable via DB

The brief (DELEGATION-A7.md P4 test 5, PLAN-A7.md) asks for: "create a split txn with splits that DON'T sum to the parent amount → PostingShapeError thrown from computePostingDrafts."

**Discovery:** The schema has a deferred constraint trigger `check_split_sum()` (defined in `apps/api/drizzle/0002_fts-and-split-check.sql`) that fires on `AFTER INSERT OR UPDATE OR DELETE` on `transaction_splits` and `AFTER UPDATE OF amount_paise` on `transactions`. Although `DEFERRABLE INITIALLY DEFERRED`, the check runs at the implicit-transaction commit of each autocommit statement. The `compass` DB role is NOT a superuser (`usesuper: false` confirmed via pg query), so `SET LOCAL session_replication_role = 'replica'` and `ALTER TABLE ... DISABLE TRIGGER` are both blocked.

**Alternative used:** The NB1 test triggers a per-row `db.transaction` failure via a different mechanism: a category's `userId` is temporarily re-assigned to a second real user (`otherUserId`), causing `assertOwnedCategory` inside `replacePostings` to throw `HttpError(404)`. The per-row tx rolls back, the transaction appears in `failures`, and `repaired` stays 0 — identical outcome to the PostingShapeError case.

The test correctly verifies the invariant: a per-row reconcile failure → `failures.push` runs AND `repaired` is NOT incremented. This is the behavioral guarantee of the NB1 fix. A note in the test file explains the deviation and why the mechanism is equivalent.

---

## Assumptions

- `reconcile-postings.ts` was already an untracked (new) file in the branch before this delegation — it was introduced by a prior slice. The changes I made were P1 (return-value wrapping) and P2 (comment narrowing).
- `transfers.ts` was already heavily modified in the working tree (prior slices had added the `db.transaction` wrapper, `isOpening` check, `rebuildPostingsForTransaction` calls, etc.). My change was specifically the sorted-id lock-order logic inside `linkTransfer`.

---

## Unresolved Risks

- The NB1 test does not exercise the exact commit-failure scenario (repaired++ was incremented inside the callback but the commit then failed), which is the precise scenario the P1 fix addresses. That specific failure mode requires mocking the DB commit, which is beyond a real-DB test. The test is a structural regression guard — it verifies the failure path correctly leaves `repaired` at 0.
- linkTransfer deadlock prevention (P3) has no integration test (concurrent sessions required); fix is provable by code inspection as noted in PLAN-A7.md Non-Goals.
