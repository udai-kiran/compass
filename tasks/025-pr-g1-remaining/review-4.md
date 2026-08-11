BLOCKING

- Existing `accounts.test.ts` has five deterministic failures because its expectations still reflect the old bank/cash-only opening-balance model. CI will remain red unless those tests are updated. This is broader PR-G1 fallout, not caused by `accountBalancesAtDate`.

OK

1. SQL no longer reads `opening_balance_paise`.
2. Computation is solely `Number(r.posting_total)`.
3. One `Number.isSafeInteger(balancePaise)` check is sufficient.
4. Test 1 correctly proves the new formula. Omitting `opening` also makes the old implementation fail via `NaN`.
5. Three bindings remain: `userId`, `asOf`, `userId`; the assertion passes.
6. Caller compatibility is preserved. `cashAndLiabilities` uses only `type` and `balancePaise`, and its aggregation guards remain intact.
7. No regression found in this specific fix.

The focused `account-balances.test.ts` run passes both tests. The broader suite could not fully run without `DATABASE_URL`, but it also exposed the five non-database failures noted above.