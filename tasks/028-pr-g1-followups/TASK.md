# Task: Fix PR-G1 follow-ups F7/F10/F11/F12

## Status
COMPLETE — PR #180 squash-merged (commit 4556345). CI check PASS (4m52s). Tagged v2.8.1 on main.
Note: v2.8.0 was already used by PR #179; this release is v2.8.1.

Previous: APPROVED — review-1.md exit 0. Three findings incorporated:
- R1 (BLOCKING accepted): F7 scope missed `legacySpentByCategory` split query at
  postings-periods-parity.test.ts:123-124. Added to scope + AC4.
- R2 (IMPORTANT accepted): F10 "all non-zero openings get stable date" blanket is
  wrong. postings-planning-parity test 9 (savingsWithOpening line 783) MUST use
  today because the postings window is `cutoffIso (today-365) to today`. All other
  non-zero opening sites: explicitly enumerated below. Each helper accepts optional
  `openingDate?` forwarded to `createAccount`; callers pass it site-by-site.
- R3 (IMPORTANT accepted): F11 `Promise.all` does not prove contention. Use the
  existing `afterAggregate` hook instead: pause `absorbCarryover` while it holds
  the advisory lock, then verify `updateAccount` stays pending for 250 ms, then
  release — proves PostgreSQL-level blocking, not just eventual-consistency.

## Objective
Address the four non-blocking follow-ups recorded in task 027. Deliver them
as a single new branch → PR → squash-merge → tag v2.8.0 on `main`.

## Root Cause (per follow-up)

### F7 — dormant `transfer_links` SQL in legacy helper queries
Four live queries across two test files still filter transfers via
`not exists (select 1 from transfer_links tl ...)`:
- `postings-periods-parity.test.ts:123-124`: `legacySpentByCategory` splitParts query (MISSED by original F7 note — review-1 finding R1)
- `postings-periods-parity.test.ts:177-178`: `legacySpendByNecessity` nonSplit query
- `postings-periods-parity.test.ts:191-192`: `legacySpendByNecessity` splitParts query
- `postings-planning-parity.test.ts:289-290`: `legNonSplit` splitParts (getTrends byCategory test)
- `postings-planning-parity.test.ts:442-443`: `legMerchantRes` (topMerchants test)
- `postings-planning-parity.test.ts:529-530`: `legRes` (buildReport merchants test)

Since `transfer_links` is never populated under PR-G1, this filter is
vacuously true — it never excludes anything. Currently dormant (no fixture
adds a transfer AND compares against these queries), but a future fixture
adding a transfer would silently miscount.

Fix: replace with the same independent postings-shape predicate already used
in the SIBLING queries inside each file:
```sql
and not (
  (select count(*) from postings pr join accounts ar on ar.id = pr.account_id
   where pr.transaction_id = t.id and ar.system_kind is null) = 2
  and
  (select count(*) from postings ps join accounts asys on asys.id = ps.account_id
   where ps.transaction_id = t.id and asys.system_kind is not null) = 0
)
```

### F10 — wall-clock date bombs in tests with hardcoded past dates
`createAccount` (accounts.ts:247) dates the opening transaction at
`new Date().toISOString().slice(0,10)` — wall-clock "today". Tests that then
query with `stmt_date / close < today` fail once "today" passes those dates.

Three bombs already ticking in `reconciliation-writes.test.ts`:
- Line 247: overflow test, close="2027-02-20" — will fail from Feb 2027
- Line 262: overflow test, close="2027-03-20" — will fail from Mar 2027
- Line 434: preexisting opening test, close="2028-07-20" — will fail from Jul 2028

Two already fixed by D11b (raw SQL re-dating, task 027):
- Line 120 (Diners test): re-dated to "2020-01-01"
- card-due-tasks.test.ts AC15: re-dated to "2020-01-01"

Root-cause fix: add optional `openingDate?: string` parameter to `createAccount`
service function (NOT to shared schema — internal to service layer). Default:
`new Date().toISOString().slice(0,10)` (today). All test-file helper wrappers
(`createCardAccount`, `createAcct`) accept and forward this parameter. Individual
call sites that need a stable date pass it explicitly; others leave it omitted.

MUST NOT change: `postings-planning-parity.test.ts:783` (`savingsWithOpening`,
openingBalance=20000) — its postings query filters `t.date >= cutoffIso` (today
minus 365 days) through `today`, and the expected total 200000 includes that
opening. A "2020-01-01" date would move it outside the window → test fails.
Leave this call WITHOUT an `openingDate` argument.

Explicit call sites and required dates (review-1 R2):

**reconciliation-writes.test.ts** (4 bombs → fix):
- Line 120 `createCardAccount(userId, -2000000)`: D11b raw SQL replaces with
  `openingDate = "2020-01-01"` in the helper call. Remove raw SQL re-dating.
- Line 247 `createCardAccount(userId, openingBalancePaise)`: bomb Feb 2027.
  Pass `"2020-01-01"`.
- Line 262 `createCardAccount(userId, openingBalancePaise)`: bomb Mar 2027.
  Pass `"2020-01-01"`.
- Line 434 `createCardAccount(userId, -500000)`: bomb Jul 2028. Pass `"2020-01-01"`.

**card-due-tasks.test.ts** (1 → fix):
- Line 790 `createCardAccount(userId, "Opening balance card", -300000)`:
  D11b raw SQL replaces with `openingDate = "2020-01-01"`. Remove raw SQL.

**postings-periods-parity.test.ts** (2 → fix/strengthen):
- Line 542 `createAcct(userId, "Bank", "bank", 50000)` test 8: strengthen.
  Pass `openingDate = "2020-06-01"` (inside FROM/TO = 2020-01-01/2020-12-31)
  so the `is_opening` exclusion is actually exercised.
- Line 769 `createAcct(userId, "Bank", "bank", 10000)` test 15:
  `findInconsistentPostings` only; opening date irrelevant. Pass `"2020-01-01"`
  for consistency.

**postings-balance-parity.test.ts** (2 → semantically fix):
- Line 185 `createAcct(userId, "Bank Opening", "bank", 500000)`: opening at
  "today" is after the 2020-03-01/02 transactions (semantically wrong — opening
  should precede activity). Pass `"2020-01-01"`.
- Line 190 `createAcct(userId, "Card Opening", "credit_card", 250000)`:
  stale comment says "column-based opening" (pre-PR-G1 assumption).
  Under PR-G1 `carriesOpeningAsTransaction` is true for ALL types including
  credit_card — update the comment to reflect an is_opening transaction.
  Pass `"2020-01-01"`.

**postings-planning-parity.test.ts** (6 → consistent stable date, EXCEPT line 783):
- Line 261 `createAcct(userId, "BankWithOpening", "bank", 5000)`: `"2020-01-01"`.
- Line 337 `createAcct(userId, "Bank", "bank", 50000)`: `"2020-01-01"`.
- Line 432 `createAcct(userId, "OpeningBank", "bank", 30000)`: `"2020-01-01"`.
- Line 678 `createAcct(userId, "OpeningBank", "bank", 50000)`: `"2020-01-01"`.
- Line 732 `createAcct(userId, "OpeningLarge", "bank", 80000)`: `"2020-01-01"`.
- Line 874 `createAcct(userId, "Bank", "bank", 10000)`: `"2020-01-01"`.
- **Line 783 `createAcct(userId, "SavingsOpening", "bank", 20000)`: LEAVE UNCHANGED.**

### F11 — integration test for `updateAccount ↔ absorbCarryover` advisory lock
The existing concurrent test in reconciliation-writes.test.ts (lines 651-739)
proves the advisory-lock MECHANISM works by having a raw `pg_advisory_lock`
holder block `absorbCarryover`. F11 wants a test that uses the ACTUAL
`updateAccount` function (which wraps `withAccountAdvisoryLock` internally)
concurrently with `absorbCarryover` — proving the production callers
are correctly integrated, not just the mechanism.

Design (review-1 R3 — uses the existing `afterAggregate` hook, same gate
pattern as the existing concurrent test at lines 651-739):
1. Create card account (openingBalance=0), one charge transaction, reconciliation.
2. Start `absorbCarryover` with an `afterAggregate` hook that signals a gate
   (advisory lock is now held, SERIALIZABLE transaction open) then waits for a
   release gate.
3. Await the signal gate — `absorbCarryover` is now paused inside its advisory lock.
4. Start `updateAccount(db, userId, accountId, { openingBalancePaise: -80000 })`.
5. 250 ms pause: assert `updateAccount` is still pending (not settled).
6. Release the release gate — `absorbCarryover` proceeds and commits.
7. Await both. Assert both resolved without error.
8. Assert exactly ONE live opening posting exists, with `amount_paise === -80000`.
   Serial order is deterministic: absorb ran first (held the lock), inserted an
   opening posting (drift=250000 → -250000); then `updateAccount` found that
   posting and updated it to -80000. This proves `updateAccount`'s advisory lock
   wrapper actually serialized against `absorbCarryover`'s lock.

Numbers:
- Charge: -100000, statementDate="2029-06-20", totalDuePaise=350000
- ledgerDuePaise = 100000; drift = 350000 - 100000 = 250000; nextOpeningPaise = -250000
- absorbCarryover INSERTs opening posting = -250000
- updateAccount then UPDATEs it to -80000
- Final: 1 posting at -80000

Required import: add `updateAccount` to `reconciliation-writes.test.ts` imports
from `"../../ledger/services/accounts.ts"` (currently only `createAccount` and
`listAccounts` are imported).

### F12 — type mismatch in `withAccountAdvisoryLock` callback
`fn: (lockedDb: Db) => Promise<T>` in account-lock.ts is typed as `Db`
(which has `readonly $client: pg.Pool`) but the runtime `$client` is a
`pg.PoolClient`. No current caller accesses `lockedDb.$client`, so it
compiles clean but is a type lie.

Fix: change to `fn: (lockedDb: Omit<Db, '$client'>) => Promise<T>`.
A `Db` value is assignable to `Omit<Db, '$client'>` so the internal
`fn(lockedDb)` call still type-checks. Both callers
(`reconciliation-writes.ts:240` and `accounts.ts:364`) use only
`.transaction(...)` on lockedDb — neither accesses `$client`. Clean.

## Scope

### Production files (2)
- `apps/api/src/modules/ledger/services/accounts.ts` — add `openingDate?: string` param to `createAccount` (F10)
- `apps/api/src/lib/account-lock.ts` — change `fn` parameter type (F12)

### Test files (5)
- `apps/api/src/lib/postings-periods-parity.test.ts` — F7 (lines 177-178, 191-192) + F10 (test 8 openingDate, update createAcct wrapper)
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` — F7 (lines 289-290, 442-443, 529-530) + F10 (update createAcct wrapper)
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` — F10 (createCardAccount wrapper + remove D11b raw SQL from Diners test) + F11 (new test)
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts` — F10 (createCardAccount wrapper + remove D11b raw SQL from AC15)
- `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts` — F10 (update createAcct wrapper with openingDate)

## Dependencies
- Depends on task 027 (COMPLETE) and the squash-merge of PR-G1 into main
- New branch from `origin/main`

## Plan
- P1: Codex plan review → already done (self-review; this is the plan)
- P2: Worker W1 implements production changes (accounts.ts + account-lock.ts)
- P3: Workers W2-W5 implement test changes in parallel AFTER W1 completes
  - W2: postings-periods-parity.test.ts (F7 + F10)
  - W3: postings-planning-parity.test.ts (F7 + F10)
  - W4: reconciliation-writes.test.ts (F10 + F11) + card-due-tasks.test.ts (F10)
  - W5: postings-balance-parity.test.ts (F10)
- P4: Independent verification (separate worker)
- P5: Codex implementation review
- P6: Commit + push + create PR + squash-merge + tag v2.8.0

## Acceptance Criteria
- AC1: `npm run typecheck` exits 0 after all changes
- AC2: `npm run lint` exits 0 after all changes
- AC3: CI `check` job passes (ℹ fail 0) on the new branch
- AC4: F7 — ALL SIX transfer_links occurrences replaced with the independent
  postings-shape predicate (periods-parity lines 123, 177, 191; planning-parity
  lines 289, 442, 529); no `transfer_links` reference in any live query in these
  files (doc comments, CASCADE notes, and retirement invariant assertions are OK)
- AC5: F10 — `createAccount` service accepts optional `openingDate`; all
  6 non-zero-opening createAcct/createCardAccount calls across the 5 test
  files use a stable date; D11b raw-SQL re-dating removed from both Diners test
  and AC15 test
- AC6: F10 (strengthening) — test 8 in postings-periods-parity passes
  `openingDate="2020-06-01"` so the opening transaction is INSIDE FROM/TO
  and actually exercises the `is_opening` filter
- AC7: F11 — new test in reconciliation-writes.test.ts uses `afterAggregate`
  hook + gate pattern to prove `updateAccount` is blocked (250 ms pending
  assertion) while `absorbCarryover` holds the advisory lock; asserts exactly
  1 opening posting at -80000 afterward; `updateAccount` imported
- AC8: F12 — `withAccountAdvisoryLock`'s `fn` typed as
  `(lockedDb: Omit<Db, '$client'>) => Promise<T>`; both callers compile clean
- AC9: No file outside the Scope list is modified

## Verification
- T1: Each worker's diff read by coordinator directly
- T2: `npm run typecheck` and `npm run lint` exit 0 (reported by verification worker)
- T3: Push to new branch, observe CI `check` job pass
- T4: On green CI: squash-merge PR, tag v2.8.0

## Non-Goals
- F5: imports.ts dead transfer_links lookup (separate task)
- F9: legacy-projection.ts stale doc comment (PR-G2 cleanup)
- Changing the shared `CreateAccount` Zod schema (opening date is service-internal)
