# Sonnet Worker Delegation — Iteration 1

## Task
048 — Ledger Invariants (pure property tests)

## Approved Plan
P1 + P2 from TASK.md

## Required Changes

### P1: Install fast-check
- Run `npm install --save-dev fast-check -w apps/api`

### P2: Property tests in postings.test.ts
Upgrade the existing seeded-PRNG tests to use fast-check. Add new property tests.

In `apps/api/src/modules/ledger/services/postings.test.ts`:

1. Replace the mulberry32/randInt helpers with fast-check imports
2. Replace the existing `assertZeroSum: random balanced sets pass` test (line 73) with a fast-check property test that:
   - Generates k random amounts (2-8 legs) where the last leg balances the rest
   - Asserts `assertZeroSum` passes
   - Perturbs one amount by ±1 and asserts it throws

3. Add property tests for every builder:
   - `buildOrdinaryPostings`: for any (accountId, amountPaise, categoryId, systemAccountIds), output sums to zero
   - `buildTransferPostings`: for any (fromAccountId, toAccountId, amountPaise > 0), output sums to zero
   - `buildSplitPostings`: for any split set summing to the parent amount, output sums to zero
   - `buildOpeningPostings`: for any (accountId, amountPaise, systemOpeningAccountId), output sums to zero

4. Keep the existing non-property tests (classifyShape, projectCounter, etc.) unchanged

### Patterns
- Use `fc.property(...)` with `fc.assert(...)` 
- Use `fc.integer()` for amounts (range: -1_000_000_000_000 to 1_000_000_000_000)
- Use `fc.uuid()` or `fc.string()` for account/category IDs (they're just strings in the builders)
- Use `fc.array()` for split legs
- Run 200+ iterations per property

### Must Not Change
- Any file other than postings.test.ts and package.json/package-lock.json
- The existing non-property tests in postings.test.ts
- Any production code

### Commands
1. `npm install --save-dev fast-check -w apps/api`
2. Make edits to postings.test.ts
3. `npm run typecheck`
4. `node --test apps/api/src/modules/ledger/services/postings.test.ts` (run the specific test file)

### Required Evidence
- npm install output
- files changed
- typecheck exit code
- test output (pass/fail counts)
