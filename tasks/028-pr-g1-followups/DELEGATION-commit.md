# Sonnet Worker Delegation — Commit + Push + PR

## Task
028-pr-g1-followups: Stage exactly 7 files, commit, push, create PR.

## Branch
fix/pr-g1-followups (already checked out and fully implemented)

## Files to Stage (EXACTLY these 7 — no others)
1. apps/api/src/lib/account-lock.ts
2. apps/api/src/modules/ledger/services/accounts.ts
3. apps/api/src/lib/postings-periods-parity.test.ts
4. apps/api/src/modules/planning/services/postings-planning-parity.test.ts
5. apps/api/src/modules/credit/services/reconciliation-writes.test.ts
6. apps/api/src/modules/credit/services/card-due-tasks.test.ts
7. apps/api/src/modules/ledger/services/postings-balance-parity.test.ts

## Must Not Stage
- pnpm-lock.yaml
- tasks/ files
- Any other file

## Commit Message
```
fix(ledger/credit): resolve 4 PR-G1 follow-ups F7/F10/F11/F12

F7 — replace dormant transfer_links SQL in legacy helper queries
Six live queries across two test files used `not exists (select 1
from transfer_links tl ...)` — always vacuously true under PR-G1
(table is never populated). Replace with the independent postings-shape
predicate already used in sibling queries in each file.
Files: postings-periods-parity.test.ts (3 sites), postings-planning-parity.test.ts (3 sites).

F10 — eliminate wall-clock date bombs in tests with hardcoded past dates
createAccount (accounts.ts) dated opening transactions at wall-clock
"today". Tests with hardcoded statement-close dates break once today
passes those dates (three live bombs: Feb 2027, Mar 2027, Jul 2028).
Root-cause fix: add optional `openingDate?: string` param to
createAccount; default is still today's wall-clock date. All test
helper wrappers (createCardAccount, createAcct) forward this param.
Call sites that need a stable date pass "2020-01-01"; savingsWithOpening
(planning-parity line 783, window=today-365..today) intentionally left
without openingDate. Removes the two D11b raw-SQL re-dating workarounds.
Strengthens test 8 in postings-periods-parity (openingDate inside
FROM/TO window so is_opening filter is actually exercised).

F11 — add integration test proving updateAccount blocks on absorbCarryover's lock
New test in reconciliation-writes.test.ts uses the existing afterAggregate
hook + gate pattern to prove real Postgres-level contention between the
two production callers (not just the advisory-lock mechanism). Asserts
updateAccount stays pending for 250 ms while absorbCarryover holds the
account advisory lock; asserts serial final state: exactly 1 opening
posting at -80000.

F12 — type account-lock.ts lockedDb callback as Omit<Db,'$client'>
The runtime $client on lockedDb is a pg.PoolClient, not pg.Pool.
Change fn parameter type to Omit<Db,'$client'> to remove the type lie.
Db is assignable to Omit<Db,'$client'> so fn(lockedDb) still compiles.

Co-Authored-By: Claude Sonnet 4.6 <noreply@anthropic.com>
```

## Commands (in order)
1. git status (confirm branch and only 7 files modified)
2. git add apps/api/src/lib/account-lock.ts apps/api/src/modules/ledger/services/accounts.ts apps/api/src/lib/postings-periods-parity.test.ts apps/api/src/modules/planning/services/postings-planning-parity.test.ts apps/api/src/modules/credit/services/reconciliation-writes.test.ts apps/api/src/modules/credit/services/card-due-tasks.test.ts apps/api/src/modules/ledger/services/postings-balance-parity.test.ts
3. git status (confirm staged set — must be EXACTLY these 7 files, nothing else)
4. git commit -m "<commit message above — exact text>"
5. git push origin fix/pr-g1-followups
6. gh pr create --base main --head fix/pr-g1-followups --title "fix(ledger/credit): resolve 4 PR-G1 follow-ups F7/F10/F11/F12" --body "$(printf '## Summary\n\nAddresses four non-blocking follow-up items from PR-G1 (postings model).\n\n### F7 — Replace dormant `transfer_links` SQL in legacy helper queries\n\nSix live queries across two test files filtered transfers via `not exists (select 1 from transfer_links tl ...)`. Under PR-G1 the `transfer_links` table is never populated, so this predicate was vacuously true and would silently miscount any future transfer fixture. Replaced with the independent postings-shape predicate already used in sibling queries.\n\n- `postings-periods-parity.test.ts`: 3 sites (`legacySpentByCategory` splitParts, `legacySpendByNecessity` nonSplit, splitParts)\n- `postings-planning-parity.test.ts`: 3 sites (`legNonSplit`, `legMerchantRes`, `legRes`)\n\n### F10 — Eliminate wall-clock date bombs in test fixtures\n\n`createAccount` dated opening transactions at `new Date().toISOString().slice(0,10)`. Tests with hardcoded statement-close dates silently break once today passes those dates.\n\n- Root-cause fix: add optional `openingDate?: string` param to `createAccount` (service-internal only; shared schema unchanged)\n- All test helper wrappers (`createCardAccount`, `createAcct`) forward this param\n- Three live bombs fixed (Feb 2027, Mar 2027, Jul 2028 in reconciliation-writes.test.ts)\n- Two D11b raw-SQL re-dating workarounds removed\n- `savingsWithOpening` (planning-parity) intentionally left without openingDate (window = today−365..today)\n\n### F11 — Integration test: `updateAccount` blocks on `absorbCarryover` advisory lock\n\nNew test in `reconciliation-writes.test.ts` uses the existing `afterAggregate` hook + gate pattern to prove actual Postgres-level contention between the two production callers. Asserts `updateAccount` stays pending for 250 ms while `absorbCarryover` holds the account advisory lock, then asserts serial final state (exactly 1 opening posting at −80 000).\n\n### F12 — Fix `lockedDb` callback type in `withAccountAdvisoryLock`\n\nThe runtime `$client` on `lockedDb` is a `pg.PoolClient`, not `pg.Pool`. Changed `fn` parameter type from `Db` to `Omit<Db, '"'"'$client'"'"'>`. `Db` is assignable to `Omit<Db, '"'"'$client'"'"'>` so the internal call still compiles; both callers only use `.transaction(...)` on lockedDb.\n\n---\n🤖 Generated with [Claude Code](https://claude.com/claude-code)')"

## Required Evidence
- git status before and after staging
- git commit output (commit hash)
- git push output
- gh pr create output (PR URL)
- Confirm staged set is EXACTLY the 7 files — no extras
