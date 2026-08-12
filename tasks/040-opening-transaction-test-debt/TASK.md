# Task: Close the openingTransactionPaise test debt and the single-opening-row invariant

## Status
BLOCKED — waiting on task 039 (must land first; it changes the component under test)

## Objective
The `openingTransactionPaise` read path is covered by an automated test, and the
invariant that path silently depends on — at most one active `is_opening`
transaction per account — is either enforced or explicitly asserted.

## Root Cause (why this is owed)
`listAccounts` gained an `openingTxnPaise` aggregate
(`apps/api/src/modules/ledger/services/accounts.ts:200`) with **zero** test
coverage. Codex asked for this test in task 038's review-1 (Medium) and again in
review-2, it was accepted both times, and it was never written. Task 039's
review-1 raised it a third time. It is being tracked here so it stops being
re-discovered.

The aggregate `sum`s **every** active `is_opening` posting, while `updateAccount`
selects and updates only the earliest (`accounts.ts:441-457`, `limit 1`). If an
account ever has two active opening rows, the UI shows their sum and saving that
sum updates one row to the sum — non-idempotent, and it grows on each save.
`planOpeningBalanceChange` prevents duplicates by construction, but no database
constraint does.

## Scope
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` — extend; it
  already imports `listAccounts` (line 13) and has `requireDatabaseUrl` +
  `createPool`/`createDb` + `createUser`/`createAccount` + `after(pool.end)`
  scaffolding (lines 22-60). Reuse it rather than standing up a new harness.
- Possibly a partial unique index migration (decide in plan review).

## Dependencies
Task 039.

## Plan
- **P1:** DB-backed test: an EPF account with an `is_opening` transaction returns
  that amount as `openingTransactionPaise` from `listAccounts`, while
  `openingBalancePaise` stays 0.
- **P2:** Exclusion cases: soft-deleted opening rows excluded; non-opening
  transactions excluded; another user's rows excluded (cross-user isolation).
- **P3:** Zero/cleared case returns 0. Liability-signed account preserves sign.
- **P4:** Future-dated opening row IS included — `openingTxnPaise` deliberately
  has no `date <= current_date` cut, unlike `balancePaise`. Pin that difference in
  a test so nobody "fixes" it later.
- **P5:** Decide the invariant: partial unique index on
  `(account_id) where is_opening and deleted_at is null` (needs a migration, and
  check `backup.test.ts`'s `ALL_TABLES`/`USER_TABLES` coverage rules still pass),
  versus documenting it and asserting the two-active-rows behaviour in a test.
  Recommendation to be settled at plan review.

## Acceptance Criteria
- AC1: `npm test -w apps/api` exits 0 with `DATABASE_URL`/`REDIS_URL` set, and the
  new cases appear in the pass counts.
- AC2: Deleting the `filter (where … is_opening …)` clause makes a new test FAIL
  (proves the test actually exercises the aggregate).
- AC3: The single-opening-row decision is recorded with its rationale.

## Verification
- T1: `npm test -w apps/api` with DB env — exit 0 + counts
- T2: mutation check for AC2, with literal before/after output

## Non-Goals
- Component/React tests for `EpfOpeningSection` — this repo has no React test
  harness (web tests are pure `node:test` logic tests). Adding one is its own
  task, not a smuggled dependency of this one.
- Any UI change
