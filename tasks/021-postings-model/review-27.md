**BLOCKING**

None found. The review-26 blocker is resolved in the revised plan.

**WARNINGs**

1. The parity cases are broad enough for the conversion, but I would add two explicit fixtures before implementation:
   - `getInsights` largest expense with a blank merchant that is the largest row, because PD5 intentionally preserves the legacy lack of `t.merchant <> ''`.
   - A split or mixed-sign split in `getTrends` totals and `getForecast` burnRes, to directly exercise the real-posting parent-amount grain in those readers. The plan already covers split behavior elsewhere, so this is a coverage-strength warning, not a semantic blocker.

2. Minor doc inconsistency: the Objective still says “Six services” while scope now lists seven changed service files including `goals.ts`. The detailed scope and ACs are correct, so this is not blocking.

**NOTEs**

- PD12’s no-exclusion rationale is correct. The legacy `mappedContributionRate` query at [goals.ts](/work/personal/compass/apps/api/src/modules/planning/services/goals.ts:198) sums positive `transactions.amountPaise` for mapped accounts with no `is_opening` or `transfer_links` exclusion. Therefore incoming transfers to savings and positive opening rows currently count, and omitting Clearing/Opening exclusion preserves that behavior.

- PD12’s postings grain is equivalent for invariant-compliant rows:
  - Ordinary positive transaction: real posting on the mapped account is positive and included.
  - Ordinary negative transaction: real posting is negative and excluded.
  - Split transaction: real posting amount is the parent/sum amount, matching legacy `transactions.amount_paise`.
  - Transfer-in leg: real posting on destination account is positive and included; the Clearing posting does not matter because there is no exclusion.
  - Transfer-out leg: real posting is negative and excluded.
  - Positive opening row: real posting on the mapped account is positive and included.
  - Soft-deleted, future-dated, and other-user rows remain excluded by the planned predicates.

- The PD12 SQL shape is sound as long as implementation reads `db.execute(...)` via `res.rows[0]`, consistent with existing codebase usage. The plan’s non-empty `accountIds.length > 0` guard also makes the `sql.join(...)` `IN (...)` construction safe.

- PD3/PD10 explicitly call out the required `Number.isSafeInteger` guards for the JS-level `cash` and `liabilities` sums at [PLAN-pr-d.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:145) and [PLAN-pr-d.md](/work/personal/compass/tasks/021-postings-model/PLAN-pr-d.md:319).

- The Redis stub plan is sufficient for `cached()`: [cache.ts](/work/personal/compass/apps/api/src/lib/cache.ts:11) only requires `redis.get(...)` and `redis.set(...)`; the described in-memory stub returning `null|string` from `get` and accepting the extra `set(key, value, "EX", ttl)` args avoids a real Redis dependency.

- (A) No uncovered legacy readers found in the seven scoped files. The current remaining hits are the queries covered by PD1-PD12. Other `amountPaise` hits in those files are recurring-template, bill, SIP, or holding-event amounts, not legacy transaction/posting conversion targets.

- (B) Cases 1-11 cover every converted function and the key transfer/opening/soft-delete/future/liability/tenant paths. With the warning additions above, the parity test list would be strong.

- (C) PD1-PD12 are complete and directionally correct. The plan now covers `dashboard.ts`, `insights.ts`, `reports.ts`, `cashflow.ts`, `bills.ts`, `prefs.ts`, and `goals.ts`, including stale-comment cleanup, range checks, and DB-backed parity verification.