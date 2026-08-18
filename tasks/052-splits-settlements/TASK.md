# Task: Splits, shares & settle-up (task board 4.4)

## Status
COMPLETE

## Verified
- review-1.md: 3 highs (migration, backup parentUserCol, balance model) + 1 medium (N+1) — all fixed
- review-2.md: backup fix ✓, schema payerPersonId ✓, migration ✓ — one medium remaining (payer credit inside loop)
- review-3.md: PASS — balance model correct, zero-sum invariant, typecheck clean
- typecheck EXIT:0, split-math.test 14/14, decomposition 3/3, migration 0002 generated

## Objective
Tables and services for splitting a transaction among household members,
maintaining a running balance ledger, and recording settlements. All
amounts are integer paise with zero-sum invariants.

## Root Cause
Compass has no expense splitting. Indian households routinely share
expenses and need a lightweight settle-up mechanism.

## Scope

### New tables (in `modules/household/schema.ts`)
- `splits` — id, transactionId (unique FK → transactions, CASCADE),
  householdId (FK → households), rule (splitRule enum), createdBy,
  createdAt, updatedAt
- `splitShares` — id, splitId (FK → splits, CASCADE), personId (FK →
  familyMembers), sharePaise (bigint), createdAt
- `settlements` — id, householdId (FK → households), fromPersonId,
  toPersonId (FK → familyMembers), amountPaise (bigint),
  transferTransactionId (nullable FK → transactions), note, createdAt

### New enum
- `splitRule` — `["equal", "shares", "exact"]`

### Services
- `modules/household/services/split-math.ts` — pure functions:
  `computeEqualShares(totalPaise, memberCount)` with deterministic
  remainder distribution; `validateExactShares(shares, totalPaise)`;
  `computeProportionalShares(totalPaise, ratios)`
- `modules/household/services/splits.ts` — CRUD: create split on
  transaction, update, delete; always validate share sum = txn amount
- `modules/household/services/settlements.ts` — create settlement,
  compute household balances (net per-person-pair)
- `modules/household/services/split-math.test.ts` — property-style tests
  for remainder, sum invariant, zero-sum across members

### Backup
- Add `splits`, `split_shares`, `settlements` to ALL_TABLES /
  LINKED_TABLES

## Dependencies
- 051 (Sharing guard) — PLANNING

## Plan
- P1: Add `splitRule` enum + 3 tables to household schema.ts
- P2: Re-export from db/schema.ts; update backup tables
- P3: Implement split-math pure functions with tests
- P4: Implement splits CRUD service
- P5: Implement settlements service + balance computation
- P6: Generate Drizzle migration
- P7: Invariant tests: shares sum = txn amount; balances net to zero

## Acceptance Criteria
- AC1: Split shares sum exactly to the transaction amount for all 3 rules
- AC2: Equal-split remainder distribution is deterministic and tested
- AC3: Household balances sum to zero across members (invariant test)
- AC4: Settle-up records a transfer; no money movement
- AC5: Deleting a split leaves balances consistent
- AC6: backup.test.ts passes
- AC7: `npm run typecheck`, `npm run lint`, `npm run test` exit 0

## Verification
- T1: npm run typecheck (exit 0)
- T2: npm run lint (exit 0)
- T3: npm run test (no new failures)
- T4: split-math.test.ts covers edge cases

## Non-Goals
- Multi-currency splits
- Groups-of-groups
- Moving money (settle-up records, never transfers)
