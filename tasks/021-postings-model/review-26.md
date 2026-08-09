**BLOCKING Findings**

- [tasks/021-postings-model/PLAN-pr-d.md:56](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:56) incorrectly excludes `goals.ts` as “already uses converted incomeExpense”. It also has a direct legacy transaction amount reader in [goals.ts:199](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:199): `sum(${transactions.amountPaise})` in `mappedContributionRate`.
  This contradicts the overall PR-D scope in [PLAN-dualwrite.md](/work/personal/compass/tasks/021-postings-model/PLAN-dualwrite.md:56), which includes `goals`, and it is a missing consumer for task 2.1. The plan needs to either convert this query in PR-D or explicitly defer it with a justified PR-E/PR-G owner. For parity, the conversion should be very explicit about whether it preserves current behavior exactly. The current legacy query counts positive mapped-account transactions regardless of transfer/opening status; a postings conversion that adds Clearing/Opening exclusion would change goal contribution semantics.

**WARNINGs**

- [PLAN-pr-d.md:120](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:120) PD3’s `cashAndLiabilities` conversion is parity-correct on account inclusion, but its range-check statement is incomplete. `accountBalancesAtDate` checks each per-account balance in [accounts.ts:181](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:181)-[189](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:189), but PD3 then sums multiple safe account balances by type and again combines cash/liability buckets in JS. Those new reductions in [PLAN-pr-d.md:129](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:129)-[137](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:137) also need `Number.isSafeInteger` guards under the PB6 rule.

- [PLAN-pr-d.md:324](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:324) says the DB-backed parity test requires `DATABASE_URL` only and no Redis. That is feasible, but only if the new test supplies a stub Redis for `getTrends` and `getForecast`, because both call `cached`, which requires `get`/`set` as shown in [cache.ts:14](/work/personal/compass/apps/api/src/lib/cache.ts:14)-[19](/work/personal/compass/apps/api/src/lib/cache.ts:19). Add that explicitly to the test plan. No real Redis is required.

- PD10 covers the new monetary `Number(...)` reads in `getTrends`, `topMerchants`, `largest`, `reports.merchants`, `burnRes`, and `evaluateLargeTransactions`, but it should also state that PD3’s new JS additions are guarded. Otherwise AC5 is weaker than the overall dual-write PB6 rule.

**NOTEs**

- PD1 is parity-correct. Real postings with `a.system_kind IS NULL` select the parent transaction amount for ordinary and split rows, matching legacy `t.amount_paise`; Clearing and Opening `NOT EXISTS` exclusions match legacy transfer/opening exclusion.

- PD2 is parity-correct. Expenses postings are the correct grain for category spend: ordinary expense creates one positive Expenses posting; split negative parts create one positive Expenses posting each; mixed-sign positive split parts land on Income and are excluded.

- PD3’s inclusion rules are correct: `accountBalancesAtDate` excludes archived and system accounts in [accounts.ts:176](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:176), matching the effective cash/liability result of the legacy query.

- PD4, PD5, and PD6 are parity-correct on grain. `COUNT(*)` is correct for merchant counts because `a.system_kind IS NULL` gives exactly one real posting per transaction under the PR-A invariant; `count(distinct t.id)` is not required.

- PD7 preserves the `t.source <> 'recurring'` filter because `source` remains on the transaction header and the postings query still joins `transactions t`.

- PD8 is correct for dual-write. `t.category_id` remains the legacy/header value used by the existing suggestion output, while `a.id` from the real posting equals `t.account_id` under the invariant.

- PD9 is parity-correct for D20. `ABS(p.amount_paise)` on the one real posting matches `ABS(t.amount_paise)`, including split transactions where the parent amount is the legacy alert threshold basis.

- Search of the six named files found the legacy consumers the plan lists and no additional `transfer_links`, `is_opening`, `transaction_splits`, `opening_balance_paise`, or raw `t.amount_paise` consumers beyond those covered. The exception is the separate `goals.ts` direct `transactions.amountPaise` aggregate noted as blocking above.

I did not run tests; this was a static read-only plan/code review.