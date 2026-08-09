**BLOCKING**
None found.

**WARNINGs**
- [prefs.ts](/work/personal/compass/apps/api/src/modules/system/services/prefs.ts:109): `evaluateLargeTransactions` inserts into `alertLedger` before validating `Number(t.amount_paise)` is safe at lines 116-119. If an unsafe bigint ever matches, the function throws after the dedupe row is written, so later runs will skip the notification. Move the Number conversion and guard before the insert.
- [postings-planning-parity.test.ts](/work/personal/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:815): tenant-isolation coverage only exercises `getTrends`, but the approved plan says user B data should be absent for every converted function. The service SQL I reviewed has user predicates, so this looks like a test coverage gap, not an observed implementation leak.
- [postings-planning-parity.test.ts](/work/personal/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:630): `suggestSubscriptions` test does not compute a legacy expected list and does not cover templated/dismissed merchant exclusion from the plan. It verifies the main happy path plus transfer/opening exclusion only.
- [postings-planning-parity.test.ts](/work/personal/compass/apps/api/src/modules/planning/services/postings-planning-parity.test.ts:153): the getTrends split-total fixture uses parent `-80000` and splits `-50000/-30000`, so parent expense and split sum are identical. It does not actually prove real-posting grain differs from split-grain behavior.

**NOTEs**
- AC1/AC8 verified: no `transfer_links`, `is_opening`, `transaction_splits`, or `notTransfer` references remain in the 7 changed service files.
- AC2 verified: converted real-posting queries use `a.system_kind is null` plus `NOT EXISTS` for `clearing/opening`; expense-posting category queries exclude transfers via `clearing` and opening naturally. `mappedContributionRate` intentionally has no clearing/opening exclusion.
- AC3 verified: [insights.ts](/work/personal/compass/apps/api/src/modules/planning/services/insights.ts:104) uses `accountBalancesAtDate`; no raw `opening_balance_paise` remains there.
- AC4 verified: [prefs.ts](/work/personal/compass/apps/api/src/modules/system/services/prefs.ts:93) uses postings real grain, `a.system_kind is null`, and `abs(p.amount_paise)`, so D20 is satisfied under the postings invariant.
- AC5 verified for the listed new conversions: getTrends income/expense/spent, topMerchants spent, largest `valuePaise`, forecast expense/income/discretionary, prefs amount, cash/liability JS sums, and PD12 `branchTotal` all have `Number.isSafeInteger` guards.
- PD1-PD12 SQL shapes match the approved plan in the service implementation. I did not run tests in this read-only review.