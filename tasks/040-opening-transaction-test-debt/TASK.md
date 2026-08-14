# Task: Close the openingTransactionPaise test debt and the single-opening-row invariant

## Status
COMPLETE

## Objective
The `openingTransactionPaise` read path is covered by an automated test, and the
invariant that path silently depends on — at most one active opening transaction
per account — is documented and tested.

## Root Cause (why this is owed)
`listAccounts` has an `openingTxnPaise` aggregate with zero test coverage.
The aggregate uses a postings-based EXISTS subquery (system_kind = 'opening')
after PR-G2 dropped the `is_opening` column.

## Design Decision — P5 invariant
**Document, don't enforce.** Rationale:
- `planOpeningBalanceChange` prevents duplicates by construction (returns
  update/noop when an opening row exists)
- The ledger integrity check (task 2.6) catches inconsistencies at runtime
- A partial unique index on postings would be complex (the constraint spans
  two tables: transactions + postings + accounts.system_kind) and fragile
- Adding a migration for a code-path invariant (not user-input boundary) is
  unnecessary complexity

The tests assert the duplicate-row behavior explicitly so it's visible.

## Scope
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` — add tests

## Dependencies
Task 039 (COMPLETE).

## Plan
- **P1:** Add a helper `createOpeningTransaction(db, userId, accountId, amountPaise)`
  that calls `resolveSystemAccounts` + inserts a transaction header + calls
  `postTransaction` with `buildOpeningPostings`. Reuses existing test scaffolding.
- **P2:** Test: EPF account with opening transaction returns correct
  `openingTransactionPaise` from `listAccounts`, while `openingBalancePaise` stays 0.
- **P3:** Exclusion tests: soft-deleted opening excluded; non-opening txn excluded;
  cross-user isolation.
- **P4:** Future-dated opening IS included (no date cut on openingTxnPaise).
- **P5:** Duplicate-row test: two active opening rows → aggregate returns their
  sum (documents the non-idempotent behavior).

## Acceptance Criteria
- AC1: `npm run typecheck` and `npm run lint` exit 0
- AC2: Tests are structurally correct and would pass with DATABASE_URL set
  (verification is environment-gated)
- AC3: The single-opening-row decision is documented in this TASK.md

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: Manual review of test code for correctness

## Non-Goals
- Component/React tests for `EpfOpeningSection`
- Any UI change
- Migration for unique index (decided against)
