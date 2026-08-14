# Task: Ledger Invariants & Reconciliation Guard (2.6)

## Status
IMPLEMENTING

## Objective
Make the double-entry guarantees enforceable: property tests proving builders always produce balanced postings, an extended integrity check covering orphans/partial-deletes/global-balance, and an operator-facing endpoint.

## What exists
- `assertZeroSum()` in `postings.ts:67` — write-time guard via BigInt
- `findInconsistentPostings()` in `reconcile-postings.ts:31` — checks per-txn: no postings, non-zero sum, unrecognized shape
- Seeded PRNG property-style tests in `postings.test.ts` (hand-rolled mulberry32, not fast-check)
- `FOR UPDATE` row locking in transactions.ts and accounts.ts
- `ON DELETE CASCADE` on postings.transactionId FK

## What's missing (per AC)
1. Property tests with fast-check (not installed yet)
2. Balance-equals-postings per-account assertion
3. Orphan posting detection (postings whose txn is missing)
4. Whole-ledger zero-sum check
5. On-demand integrity endpoint (route)
6. Deliberately corrupted fixture test
7. Concurrent half-balanced transaction test (needs live DB — deferred note)

## Plan
- P1: Install fast-check as devDependency in apps/api
- P2: Write pure property tests in `postings.test.ts` (no DB):
  - Every `buildOrdinaryPostings` output sums to zero
  - Every `buildTransferPostings` output sums to zero
  - Every `buildSplitPostings` output sums to zero
  - Every `buildOpeningPostings` output sums to zero
  - Random posting arrays that sum to zero pass `assertZeroSum`; those that don't throw
- P3: Extend `findInconsistentPostings()` in `reconcile-postings.ts`:
  - Add orphan-posting check (postings WHERE transaction_id NOT IN active transactions)
  - Add whole-ledger sum check (sum of all postings across all users = 0)
  - Add per-account balance-equals-postings check (no dual source of truth — this is mainly asserting no legacy openingBalancePaise interference)
- P4: Add `GET /api/ledger/integrity` route in ledger module:
  - Calls extended `findInconsistentPostings()`
  - Returns problem list with transaction IDs, not a boolean
  - Behind auth (admin/owner only)
- P5: Write corruption fixture test (DB-backed):
  - Insert a transaction with deliberately unbalanced postings (bypass assertZeroSum via raw SQL)
  - Verify `findInconsistentPostings()` detects it
  - Insert an orphan posting; verify detection
- P6: Verify: typecheck + lint + test

## Acceptance Criteria
- AC1: fast-check is installed and used in property tests
- AC2: Property tests: generated transactions always balance (postings sum to zero)
- AC3: Balance-equals-postings asserted
- AC4: Orphan-posting and partial-delete cases covered
- AC5: On-demand integrity check reporting offending transaction IDs
- AC6: Corrupted fixture detected by check
- AC7: typecheck + lint + test green

## Dependencies
- None (v3.0.0 postings model is in place)

## Non-Goals
- Concurrent write test (needs live DB with serializable isolation — noted, not implemented here)
- UI for the integrity check (backend-only)
