## BLOCKING

- [reconcile-postings.test.ts:64](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.test.ts:64) does not implement the required non-zero-sum-postings test.
- [reconcile-postings.test.ts:107](/home/udai/common/compass/apps/api/src/modules/ledger/services/reconcile-postings.test.ts:107) calls `reprojectAllLegacyColumns(db)` correctly, but the idempotence test only checks empty failures. It does not verify that both calls report the same counts as required.
- [cards.ts:343](/home/udai/common/compass/apps/api/src/modules/credit/services/cards.ts:343) still reads `t.category_id` and returns it at line 369. This violates the plan’s postings-native/AC5 requirement and can expose stale categories in card activity.

## ADVISORY

- [backup.test.ts:674](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:674) functionally creates posting-backed opening data through `updateAccount`, but deviates from T6’s explicit instruction to use `createAccount(...openingBalancePaise)` and then locates the opening through legacy `transactions.accountId/isOpening` at line 679.
- `backup.test.ts` contains no `reconcileUserPostings` or camel-case `transferLinks` reference. It does still contain deliberate legacy `transfer_links` archive fixtures and several `isOpening`/`is_opening` references, including lines 679, 867–905, and 1496. Some belong to explicit old-archive compatibility tests, so they are not all stale.
- [average-balance.ts:153](/home/udai/common/compass/apps/api/src/modules/ledger/services/average-balance.ts:153) has stale documentation claiming openings may reside solely in `accounts.opening_balance_paise` and referring to `is_opening`.
- [categorize.ts:58](/home/udai/common/compass/apps/api/src/modules/automation/services/categorize.ts:58) is correctly correlated by `cp.transaction_id = t.id`. For defense against corrupt cross-tenant posting/account associations, adding `ca.user_id = t.user_id` would strengthen it.
- [bills.ts:97](/home/udai/common/compass/apps/api/src/modules/planning/services/bills.ts:97) does not constrain the outer real account with `a.user_id = t.user_id`. The category lateral itself is tenant-filtered correctly.

## OK

1. R1: All specified opening-balance addends were removed from `balances.ts`, `average-balance.ts`, and both card paths. No dead variables or duplicated safe-integer checks remain.

2. R2: [sip-installments.ts:449](/home/udai/common/compass/apps/api/src/modules/investments/services/sip-installments.ts:449) correctly filters `p.account_id` by the target account and removes the lateral `ORDER BY`. The call uses `sip.targetAccountId!` at line 544. The user-task and backup projections use negative-first ordering correctly.

3. R3 review queue: The chain is correctly `transactions → postings → system account → category`. Both account and category ownership are constrained to the transaction user; no evident tenant hole exists.

4. R3 bills: The lateral joins system-account counter-postings and tenant-owned categories correctly. All relevant downstream usage now uses `cat.category_id`; no `t.category_id` remains there.

5. R3 categorize: The `NOT EXISTS` is correctly scoped to `cp.transaction_id = t.id`.

6. T4: The unlink result is captured and destructured as `[outId, inId]`, matching `unlinkTransfer`’s negative-leg-first return contract, and passed correctly to `linkTransfer`. No stale `transfer.inTransactionId`, `transfer.outTransactionId`, `transferLinkId`, or rebuild reference remains in that file.

7. T5 signatures: Every shown `createAccount` call includes the requested nullable identity fields and `currency: "INR"`. `reprojectAllLegacyColumns` is called with only `db`.

8. T6 fixture semantics: Ordinary, split, transfer, opening, and soft-deleted cases all receive postings through service-layer operations. There is no `reconcileUserPostings` dependency.

9. Tooling: Full workspace typecheck completed successfully. ESLint completed successfully for all reviewed files; no unused imports or lint-detected unsafe patterns were found. Database-backed tests were not run.