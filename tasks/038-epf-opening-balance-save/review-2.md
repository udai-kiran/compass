## Review result

No correctness issues found in the requested implementation.

1. `openingTxnPaise` aggregate is correct. It filters on `transactions.isOpening = true`, excludes deleted transactions, and enforces transaction-level user isolation. Predicates remain inside `FILTER`, preserving accounts with no matching postings, consistent with `postingSum`. [accounts.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:200)

2. The safe-integer conversion and guard are correct and consistent with the existing aggregate guards. [accounts.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:219)

3. `OpeningBalanceSection` consistently uses `account.openingTransactionPaise` in:

   - the `useState` initializer;
   - the synchronization effect and dependencies;
   - the dirty comparison.

   The mutation correctly continues sending `openingBalancePaise`, which is the API write field. [AccountDetailPage.tsx](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:297)

4. The `editsOpeningBalanceAsAmount(account.type, account.openingBalancePaise)` call is correctly unchanged. That function specifically distinguishes column-backed balances from transaction-backed bank/cash balances. [AccountDetailPage.tsx](/home/udai/common/compass/apps/web/src/routes/settings/AccountDetailPage.tsx:320)

5. Repository-wide searches found no other code constructing an `AccountWithBalance` object that would now fail TypeScript.

6. Within the web app, `account-groups.test.ts` is the only direct `AccountWithBalance` object factory found, and it now supplies `openingTransactionPaise`. Other usages consume objects decoded from the accounts API. [account-groups.test.ts](/home/udai/common/compass/apps/web/src/routes/accounts/account-groups.test.ts:6)

One testing gap remains: the change adds no targeted regression test proving that `listAccounts` returns the active opening transaction amount while excluding deleted, non-opening, and other-user transactions, nor a component-level dirty-state test. The implementation itself is correct, but those tests would protect the exact failure mode.

I did not run typecheck or tests because the review harness requires absolute read-only operation and those commands may write caches or generated metadata.