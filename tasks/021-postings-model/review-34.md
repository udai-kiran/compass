**Blocking Findings**

No blocking findings found. The file typechecks with `npm run typecheck -w apps/api`, and I did not see wrong import paths, wrong column names, or wrong live function signatures that would make the tests fail against a correctly prepared real DB.

**Checklist**

1. PE1-PE9 all exist. PE8 is split into PE8a/PE8b, so there are 10 tests total.
2. PE1 calls both `listCardHolders` and `getCardActivity`, and verifies `balancePaise = openingBalance + postings sum`: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:112).
3. PE2 verifies `listEmiInstallments` returns 3 rows, each `amountPaise === -5000`, and cross-checks the direct postings query: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:155).
4. PE3 verifies `ledgerDuesAtDates` for 3 dates using `expectedDue`: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:232).
5. PE4 verifies unlinked=2, calls `linkSipInstallment` with `{ transactionId: txn1.id }`, and verifies linked=1 with `amountPaise=5000`: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:271).
6. PE5 runs the same core SQL shape as `suggestCategoriesFor` and compares IDs against the legacy `is_opening` + `transfer_links` query: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:339). It omits `merchant`/`notes` from the select list, but the filtering logic matches.
7. PE6 verifies both `listUserTasks` and `getUserTask` return `amountPaise=-800` and `accountId=bankAcct.id`: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:441).
8. PE7 calls `search`, updates the transfer out-leg merchant via `xfer.outTransactionId`, and verifies exactly 1 transaction result: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:495).
9. PE8a/PE8b each build postings-based and legacy queries and assert `deepEqual`: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:537), [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:607).
10. PE9 calls `listPolicyPremiums` and verifies count=2, totalPaise=3500, per-item amounts, accountId, and legacy total: [postings-pr-e-parity.test.ts](/work/personal/compass/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:688).
11. Every test ends with `assert.deepEqual(await findInconsistentPostings(db, userId), [])`.
12. No live signature/schema blockers found. `linkSipInstallment` correctly uses the object input shape.

**Non-Blocking Suggestions**

PE1 is thinner than the PLAN’s “New file” text: it does not seed a split transaction or transfer-payment transaction, and `getCardActivity` only verifies count/finite amounts rather than checking a split’s real posting amount.

PE2 does not test the `upsertEmiDetails` history/existence-check path mentioned in the PLAN, only `listEmiInstallments`.

PE4 does not assert that `linkSipInstallment` rejects the opening transaction with a 400, which is listed in `DELEGATION-pr-e.md`.

PE8b only compares `{ id, amountPaise }`; comparing the full normalized row shape would make the parity proof stronger.

The top-level `requireDatabaseUrl()` throws instead of skipping when `DATABASE_URL` is unset. That matches the Iteration 2 skeleton, but conflicts with the PLAN line saying to skip without `DATABASE_URL`.