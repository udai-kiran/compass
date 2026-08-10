**BLOCKING Findings**

1. [PLAN-pr-e.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-e.md:258) breaks SIP linked-row recovery semantics.

The planned `linkedInstallmentRows` conversion joins postings on `targetAccountId`. Current code explicitly says linked rows must stay visible even if later edits moved the transaction to another account, flipped its sign, or pushed it outside eligibility, so the user can detach it: [sip-installments.ts](/work/personal/compass/apps/api/src/modules/investments/services/sip-installments.ts:400). If the transaction no longer has a posting on the SIP target account, the planned inner join drops it entirely.

Fix direction: linked rows should still select all linked active transactions. To remove `transactions.amountPaise`, project the real posting without reapplying target-account eligibility, likely exactly one non-system posting, and handle zero/multiple-posting drift deterministically.

2. [PLAN-pr-e.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-e.md:419) misses a remaining legacy `transactions.accountId` use in `commitImport`.

The plan converts the credit-card reconciliation read at [imports.ts](/work/personal/compass/apps/api/src/modules/ingest/services/imports.ts:617), but the later update still guards on `eq(transactions.accountId, batch.accountId)` at [imports.ts](/work/personal/compass/apps/api/src/modules/ingest/services/imports.ts:657). That is one of the exact columns the review asked to eliminate across all functions in the nine files, and it will break when PR-G drops legacy columns.

Fix direction: either keep this file out of “PR-G safe” scope, or convert that guard to an `EXISTS`/join against the batch account posting. Because this is a write update, the plan also needs to say how the guard and posting rebuild interact.

3. [PLAN-pr-e.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-e.md:322) can return inconsistent task transaction projections under malformed/multi-real posting data.

`taskQuery` uses two independent correlated subqueries, each with `LIMIT 1`, to fetch account id and amount. If a transaction has multiple real postings due to data drift or a future shape, the account id can come from one posting and amount from another because there is no shared selected row and no `ORDER BY`. Current writer shapes generally create exactly one real posting for ordinary/split/opening/transfer-leg rows, but the review specifically asks for zero/multiple-real edge cases.

Fix direction: use one lateral subquery selecting both `account_id` and `amount_paise` from the same posting, with deterministic ordering and/or a cardinality check strategy.

4. [PLAN-pr-e.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-e.md:359) likely introduces an import/lint issue.

The PE6 snippet uses raw table names inside `sql` strings, but the plan says to import `accounts` from schema. That imported symbol is not referenced by the snippet. With `noUnusedLocals`/lint, this will fail. It also uses `p.amount_paise` in raw SQL typed as `sql<number | null>`; unlike selecting `postings.amountPaise`, raw bigint SQL may not run through the Drizzle column decoder. The returned `txnAmountPaise` may be a string at runtime unless explicitly mapped/cast safely.

Fix direction: either use actual Drizzle joins/lateral selection with `postings.amountPaise`, or use `.mapWith(Number)`/safe conversion and avoid unused imports.

**NON-BLOCKING Notes**

- PE1 cards and PE3 reconciliation use the right account-scoped posting pattern. `openingBalancePaise` addends are preserved in the plan for card balances and ledger dues, which is required because card opening balances remain on `accounts.opening_balance_paise` during dual-write.

- PE5 categorize and PE7 search correctly add Pattern C transfer/opening exclusion. For current writer shapes, ordinary and split transactions have exactly one real posting, so those joins should not duplicate ordinary/split rows. The plan should still test split amount display, not just row count.

- PE8 `applyMapping` intentionally preserves the current absence of `deleted_at` filtering in duplicate detection. That matches legacy behavior, but the parity test should assert soft-deleted duplicate behavior if that behavior is intentional.

- PE9 insurance joins all non-system postings for policy transactions. That matches ordinary premium rows from `logPremium`, but a policy transaction that somehow becomes a transfer leg would still be shown. If policy premiums must never include transfers/opening rows, the plan should add Pattern C here too.

- The parity test plan is not sufficient as written:
  - PE4 does not cover the edited-linked-row case that the current comment explicitly protects.
  - PE6 does not cover multiple/zero real postings or linked transfer/opening display behavior.
  - PE7 should seed a matching transfer merchant and assert it is absent, not just “not transfers” in prose.
  - PE8 mentions only `applyMapping`; it does not verify the `commitImport` credit-card reconciliation read/update path.
  - PE5 should assert split transaction amount and single-row behavior, not just count.
  - PE1 should include opening balance and card payment/spend signs in both aggregate and activity rows.

Schema assumptions checked: `transactions.is_opening`, `transactions.account_id`, `transactions.amount_paise`, and `transactions.category_id` still exist during this phase; `postings` has `transaction_id`, `account_id`, `category_id`, `amount_paise`; `accounts.system_kind` is nullable and uses `expenses`, `income`, `opening`, `clearing`.