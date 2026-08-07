# PLAN-A7 — per-transaction invariant + DB-backed reconcile tests + NB1/NB2/lock-order fixes

## Status
COMPLETE ✓ — 2026-08-06. All 3 production fixes landed (NB1, NB2, lock-order including the
review-18 role-remapping regression fix). reconcile-postings.test.ts 5/5, postings.test.ts 20/20,
backup.test.ts 19/19. Typecheck + lint clean. Codex review-18 finding 1 FIXED, finding 2
acknowledged (test-vacuity for the specific commit-reject scenario; code fix proven by inspection).

## Objective
Close the 3 non-blocking carry-forwards (NB1, NB2, linkTransfer lock-order) and add the mandatory
DB-backed reconcile/invariant/concurrency test file that Codex reviews-8/11/13 require before
PR-A completion.

## Decisive verified facts (read in source this session)
- reconcile-postings.ts:105 `repaired++` INSIDE `db.transaction(async (t) => { ... })` callback.
  If the commit fails (rejected promise), repaired was already incremented AND failures.push runs
  → overstates repaired count. FIX: return a boolean from the tx, increment outside.
- reconcile-postings.ts:62-67 comment claims "rows are sequential to keep each comparison against
  a stable snapshot" — inaccurate; the per-row tx does NOT `FOR UPDATE` source rows before
  computing drafts, so a concurrent mutation could change the row mid-compute. The code is safe at
  quiescent boot but the comment overclaims. FIX: narrow comment wording.
- transfers.ts:83-104 locks outTransactionId THEN inTransactionId without sorting → adversarial
  reversed-role concurrent linkTransfer deadlock. FIX: sort the two IDs deterministically and
  issue `for("update")` in sorted order.
- reconcile-postings.test.ts does NOT exist (confirmed by verifier exit 1). Must be created.

## Plan
- P1: NB1 — move `repaired++` outside the per-row transaction callback in reconcileUserPostings.
  Return a `didRepair` boolean from the tx lambda; increment only after the awaited promise
  resolves.
- P2: NB2 — narrow comment lines 62-67 to state "per-row tx gives compare+replace atomicity; the
  sequential iteration avoids CONTENTION but does not prevent a concurrent mutation from changing
  the source row between compute and replace within the same per-row tx" (or similar honest
  phrasing). No code-logic change.
- P3: linkTransfer lock-order — in transfers.ts, before the two `for("update")` queries, compute
  `const [firstId, secondId] = [outTransactionId, inTransactionId].sort();` and issue the two
  select-for-update queries in that order. After both resolve, identify which result is `out` vs
  `inn` by matching the returned `id` to the original outTransactionId/inTransactionId. Keep all
  existing validation logic unchanged.
- P4: Create apps/api/src/modules/ledger/services/reconcile-postings.test.ts with DB-backed tests:
  - Idempotency: reconcile a user, then reconcile again → second run has repaired=0.
  - Soft-deleted: a soft-deleted txn also gets postings (findInconsistentPostings returns []).
  - Tenant-scope: reconcileUserPostings for user A does NOT touch user B's transactions.
  - replacePostings cross-tenant rejection: calling replacePostings with a transactionId owned by
    user B rejects (the ownership check).
  - Duplicate/extra cleanup: manually insert an extra posting on a txn, reconcile → it is pruned
    (repaired=1, findInconsistentPostings after == []).
  - Second-run zero-write after the above: reconcile again → repaired=0.
  - NB1 regression: use a deliberately corrupt transaction (e.g. split whose splits don't sum →
    PostingShapeError thrown from computePostingDrafts) → that txn is a failure entry, repaired
    does NOT increment for it.

## Acceptance Criteria
- AC1: NB1 fixed — repaired++ only after successful tx commit (code reads clearly).
- AC2: NB2 comment narrowed — no "stable snapshot" overclaim remains.
- AC3: linkTransfer locks in sorted-id order — the two `for("update")` queries issue on the
  lexicographically-smaller id first.
- AC4: reconcile-postings.test.ts exists and all tests pass (DB-backed, using the live DB with
  migration 0067 applied).
- AC5: typecheck + lint clean.
- AC6: existing postings.test.ts (20/20) and backup.test.ts (19/19) still pass.

## Non-Goals
- No linkTransfer deadlock *integration test* (requires concurrent pg sessions; deferred to a
  manual/stress-test pass). The deterministic lock-order fix is proven by code inspection.
- No change to reader paths, shared schemas, or web.
- No new migration.

## Verification
- T1: npm run typecheck -w apps/api
- T2: npm run lint
- T3: node --test apps/api/src/modules/ledger/services/reconcile-postings.test.ts
- T4: node --test apps/api/src/modules/ledger/services/postings.test.ts
- T5: node --test apps/api/src/modules/system/services/backup.test.ts
