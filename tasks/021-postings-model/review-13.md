## Verdict

No BLOCKING findings for slice A5. The implementation conforms to the approved review-12 resolutions.

The split/import interaction is intentional and correct: an import reconciliation that changes a split parent’s amount away from its split total now fails atomically instead of creating invalid postings. No imports-specific guard is required for PR-A.

## Findings

### BLOCKING

None.

### Non-blocking

1. `repaired` is incremented inside the transaction callback before the outer transaction promise has definitively committed ([reconcile-postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:103)). A commit-time failure could therefore produce both a failure entry and an overstated `repaired` count. Posting correctness and atomicity remain intact; only the summary could be inaccurate. Increment after the successful `await db.transaction(...)` would make reporting exact.

2. The concurrency claim in the reconciler comment is stronger than the implementation guarantees ([reconcile-postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:62)). The per-row transaction does not lock the parent, split, or link rows before computing the shape. A concurrent legacy writer could change the source shape between compute and replace, allowing a stale replacement. This is not an A5 boot hazard because the hook runs in the required quiescent window, but the comment’s claim that concurrent reconciles/writes necessarily observe a stable snapshot should be narrowed or locking added before treating this as a live maintenance primitive.

## 1. A5a extraction and writer behavior

The extraction is behavior-preserving for valid source shapes.

`computePostingDraftsForTransaction`:

- Uses the required tenant-scoped parent lookup and returns `null` when the `(id, userId)` row is absent ([transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:201)).
- Includes soft-deleted rows because it has no `deletedAt` predicate.
- Preserves the exact branch precedence:

  1. Opening
  2. Transfer-link membership
  3. Split
  4. Ordinary

- Passes the same shape inputs to each builder:

  - Opening: real account, parent amount, resolved Opening account.
  - Transfer leg: real account, signed parent amount, resolved Clearing account, empty note.
  - Split: real account, split category/amount/note, parent necessity, resolved Expenses/Income accounts.
  - Ordinary: real account, parent amount/category/necessity, resolved Expenses/Income accounts.

`rebuildPostingsForTransaction` delegates exactly as designed: compute, return on `null`, then call `replacePostings` ([transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:282)).

I traced every call site named in the request. No valid writer path regressed:

- `createTransaction` constructs an ordinary shape directly.
- `updateTransaction` locks the parent, rejects linked-leg account/amount changes, enforces split equality for amount changes, then rebuilds.
- `setSplits` locks the parent and validates the new split sum before replacement and rebuild.
- `bulkAction` rebuilds restored and recategorized rows; deletion/tag operations correctly do not change postings.
- Opening-row creation/update in `accounts.ts` produces an opening shape; column-only openings remain rowless.
- `linkTransfer` validates and links before rebuilding both legs; `unlinkTransfer` deletes the link before rebuilding both legs.
- Fresh import rows, recurring rows, and demo rows are ordinary.
- Import rollback restores the pre-import parent amount before rebuilding.
- Category merge changes category references only and rebuilds all directly and split-affected transactions.

No caller passes a bare database handle where the posting rebuild must be atomic with a legacy mutation.

## 2. Split-parent invariant and imports

The split branch sums using `sumPaise` and throws typed `PostingShapeError` before calling `buildSplitPostings` when the total differs from the parent ([transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:233), [postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:24)).

For normal transaction writers, valid split transactions satisfy the invariant at rebuild time:

- `setSplits` validates against a locked parent.
- `updateTransaction` rejects a mismatching amount update.
- Category, necessity, account, date, and metadata changes do not invalidate the split total.
- Transfer linking can accept a transaction carrying splits, but transfer precedence intentionally suppresses split projection while linked; unlinking reveals the pre-existing valid split shape. No linked-leg amount change is permitted.

The exceptional path is exactly the one identified by review-12: import reconciliation updates a matched transaction’s `amountPaise` directly before rebuilding ([imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:636)). Its candidate query does not exclude transactions with splits. Therefore a statement correction can match a split transaction and change its parent amount away from its split total.

In that case:

- `rebuildPostingsForTransaction` throws.
- The enclosing `commitImport` database transaction rolls back the parent update, link deletion, import-row changes, and posting work.
- No invariant-violating posting set or mismatched legacy parent is committed.
- Date/merchant/note-only corrections, equal-amount corrections, and ordinary transactions remain unaffected.

Clear verdict: this is acceptable and intended atomic refusal, not a regression requiring an imports guard. An imports-specific preflight could improve the returned conflict/error semantics, but weakening or bypassing the invariant would be incorrect.

Rollback restores the exact pre-import amount snapshot, so a transaction that was valid before import remains valid when rebuilt. If historical data was already corrupt, throwing and rolling back is correct.

## 3. Idempotency and multiset comparison

A second successful `reconcileAllPostings` run performs zero posting writes, assuming no intervening source mutation:

- Builders are deterministic.
- System-account resolution returns the same four account IDs.
- The first repair replaces the entire stored posting collection with the computed drafts.
- The second pass compares before calling `replacePostings`.
- Equal multisets bypass all deletes/inserts.

`postingsMultisetEqual` correctly occurrence-counts a JSON key over exactly:

- `accountId`
- `amountPaise`
- `categoryId`
- `necessity`
- `note`

This avoids delimiter collisions and detects duplicate multiplicity, extras, and missing rows ([reconcile-postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:25)).

No field mismatch is masked:

- Stored `note` is `NOT NULL DEFAULT ''`; drafts always supply a string. There is no stored `null` requiring normalization.
- `''` remains distinct from other strings.
- Nullable `necessity` and `categoryId` serialize consistently as `null`.
- Drizzle’s `bigint({ mode: "number" })` yields numbers on both sides.
- Builders reject unsafe paise values, so unsafe historical values become structured compute failures rather than false equality.
- Posting IDs, creation timestamps, and transaction IDs are deliberately excluded because they are not draft shape fields.

The selected stored fields exactly match all five persisted fields supplied by `replacePostings`. There is neither false drift nor masked shape drift for valid values.

## 4. Reconciler coverage and correctness

Coverage is correct:

- Users come from the `users` table.
- Transactions are enumerated per user.
- There is no `deleted_at` filter, so soft-deleted parents are included ([reconcile-postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/reconcile-postings.ts:82)).
- Column-only openings have no transaction row and are excluded by construction.
- System accounts are seeded before resolution.
- Missing kinds after seeding cause `resolveSystemAccounts` to fail and become a structured user failure, not a skip.
- Each transaction runs in its own database transaction, isolating malformed rows and making each compare-and-replace atomic.
- `replacePostings` deletes all existing rows before inserting drafts, pruning stale, duplicate, and extra postings.
- Transaction failures carry both `userId` and `transactionId`.
- User-level failures carry `userId`.
- `reconcileAllPostings` aggregates all failures rather than aborting the remaining users.

`findInconsistentPostings` is read-only:

- It never calls `seedSystemAccounts`.
- It only resolves, enumerates, computes, selects, and reports.
- Missing system accounts produce a structured user result.
- Compute/query failures produce per-transaction nonconforming results.
- It includes soft-deleted parents and supports either one user or all users.

The empty `transactionId` sentinel for a missing-system-account user follows the specified return type, though a tagged union would be clearer in a later refinement.

## 5. Boot hook

Placement is correct and quiescent:

- Database decoration occurs first at [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:165).
- The ledger cache subscriber is registered before reconciliation.
- Reconciliation runs at [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:186).
- `startJobs` is called only afterward at line 195, before BullMQ workers can be constructed.
- `buildApp` completes before `server.ts` calls `app.listen`.

The hook is `.catch()`-guarded as required for PR-A. Structured failures produce an error log including counts and sampled failing user/transaction records; repairs without failures produce an informational log. A top-level rejection is also logged.

The source search found no posting-backed production reader. Uses of the `postings` table are limited to the dual-write primitive, reconciler/checker, builders/schema, and boot integration. Existing hydration, DTO projection, reports, balances, and other served reads remain legacy-derived. Consequently a reconciliation failure in PR-A cannot surface posting-derived wrong data.

## 6. Tenant scope and cross-user safety

No cross-user write hazard was found.

The unauthenticated boot pass derives user IDs from `users`, then:

- Enumerates only transactions with that `transactions.userId`.
- Tenant-scopes the compute parent lookup by both transaction ID and user ID.
- Resolves system accounts using the same user ID.
- Calls `replacePostings`, which independently verifies the transaction belongs to that user.
- Verifies every referenced account belongs to that user.
- Verifies every non-null category belongs to that user.
- Deletes postings only after all ownership checks succeed.

The transfer-link and split lookups use globally unique transaction IDs rather than repeating a user predicate. Because the parent has already been tenant-scoped and the referenced transaction IDs are unique foreign keys, those lookups cannot redirect the replacement to another user. The final independent ownership validation provides additional defense.

## 7. Guardrails, complexity, and out-of-scope work

No PR-A guardrail violation was found:

- No shared DTO or `packages/shared` file changed.
- No web file changed.
- No legacy ledger column was removed or rewired.
- No reader was converted to postings.
- `hydrate` remains legacy-based.
- The account-reader changes visible in the branch are the previously approved system-account exclusions/type narrowing, not posting-backed conversion.

A5 does not improperly pull in:

- A6 restore/backup support.
- A7 database-backed reconciliation/invariant/parity tests.
- The transfer link lock-order fix.
- PR-B reader conversion.

The full API test command also exposed the expected out-of-scope A6 backup coverage failure (`postings` is not yet in `ALL_TABLES`) and numerous database tests failing because the live test database has not had migration 0067 applied. These are not A5 implementation blockers. The focused pure tests passed: 23/23, including posting builders and schema decomposition.

Verification results:

- API typecheck: passed.
- Lint: passed.
- Focused posting/schema tests: 23 passed, 0 failed.
- Full DB-backed reconciliation/idempotency coverage remains appropriately deferred to A7.