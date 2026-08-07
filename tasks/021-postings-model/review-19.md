Verdict: APPROVED

The central parity claim is correct, conditional on PR-A’s posting-consistency gate remaining satisfied. I found no transaction shape produced by the current builders where the real-account posting differs from the legacy transaction amount.

1. Parity identity

For each legacy transaction row, `computePostingDraftsForTransaction` produces exactly one posting on that row’s real account:

- Ordinary: real posting equals `transactions.amount_paise`.
- Split: real posting equals the BigInt-safe sum of split amounts, and the function refuses the shape unless that sum equals the parent transaction amount.
- Linked transfer leg: each legacy row independently receives a real posting equal to its signed legacy amount and an opposite Clearing posting.
- Opening row: the real posting equals the opening transaction amount.
- Zero-amount ordinary rows also preserve parity; their counter-posting happens to use Income, but the real leg remains zero.

Therefore, for a real account, summing postings joined through their parent transactions produces the same sum as the legacy transaction rows when both queries use the same parent-transaction predicates.

The listed edge cases are handled correctly:

- Bank/cash opening: the column is zero and the `is_opening` transaction has a matching real posting, so it is counted once.
- Column-only openings: every non-bank/cash account type uses the column and has no opening posting, so retaining the column addend is necessary and correct. “Cards/loans/schemes” in the plan is descriptive rather than exhaustive.
- Splits: one real posting equals the parent amount; split counter-postings cannot leak into a real-account balance.
- Transfers: each real-account leg equals its corresponding legacy row. Clearing does not enter a real-account sum. Whether the two linked legacy legs happen to net exactly is irrelevant to per-account parity.
- Soft-deleted rows: postings remain stored, but joining the parent and applying `deleted_at is null` excludes them exactly as before.
- Future-dated rows: applying the cutoff to the parent transaction preserves current behavior.
- Zero-activity accounts: the left join/coalesce leaves only the opening column.
- Archived-account behavior remains query-specific. In particular, `listAccounts` currently includes archived accounts; the rewrite should not silently add an archived filter.

This is a conditional identity over consistent dual-written data, not an unconditional database theorem. The schema permits posting drift and does not encode tenant identity on a posting. Duplicate, missing, or incorrectly assigned postings would diverge from legacy results. The PR-A reconciler and invariant are consequently genuine prerequisites. The parity test should also run `findInconsistentPostings` or otherwise assert exact posting shape so a coincidentally equal aggregate cannot conceal drift.

All converted SQL should retain a parent-transaction user predicate as defense in depth, even where matching `postings.account_id` to a user-owned account already limits the normal path.

2. Other direct balance readers

The four downstream files named in the request do not contain another direct account-balance formula:

- `networth.ts` calls `accountBalancesAtDate`.
- `cashflow.ts` and `dashboard.ts` call `bankCashTotal`.
- `prefs.ts` calls `bankCashBalances` for low-balance alerts.
- Their other transaction aggregates are income/spend or transaction-alert readers, not account balances.

The wider repository does contain direct legacy balance readers omitted by the plan’s scan:

- `planning/services/insights.ts`, `cashAndLiabilities`: groups `opening_balance_paise + sum(transactions.amount_paise)` by account type.
- `credit/services/cards.ts`: both card-summary and card-activity paths add `openingBalancePaise` to transaction aggregates.
- `credit/services/reconciliation-reads.ts`, `ledgerDuesAtDates`: derives historical card dues from the opening column plus a transaction sum.

They will not disagree during dual-write because the parity identity holds. The durable strategy also assigns planning and credit readers to later PRs, so their omission is not a correctness blocker for a releasable PR-B. The plan should nevertheless replace its broad implication that no other balance readers exist with an explicit statement that these direct readers intentionally remain legacy until PR-D/PR-E. `insights.ts` is especially easy to mistake for part of the “first balance reader group.”

The `recurring.test.ts` occurrence is test-only balance verification, not a production reader.

3. `listAccounts` join fan-out

The proposed join topology is safe:

```text
accounts 1 ── N postings N ── 1 transactions
    │
    └── 0/1 bank_details
```

`bank_details.account_id` is its primary key, so it cannot multiply posting rows. Each posting has one parent transaction. Grouping by account ID and bank subtype therefore does not introduce fan-out.

Implementation cautions:

- Match postings to the real account with `postings.account_id = accounts.id`.
- Apply parent `deleted_at` and date conditions in the aggregate `FILTER` or transaction join condition. Putting them in the outer `WHERE` clause would collapse the left join and remove zero-activity accounts.
- If using a filtered aggregate, ensure rows with a posting but no qualifying parent contribute nothing.
- Retain `accounts.system_kind is null`.
- Add `transactions.user_id = userId` to the parent join/filter for tenant defense in depth.
- Duplicate real postings caused by drift would be counted twice, but that is data inconsistency rather than SQL fan-out and should be caught by the PR-A gate.

4. PB6 overflow refusal

PB6 is safe in principle and fits the durable strategy’s explicit requirement that touched monetary aggregates be range-checked. Changing silent IEEE-754 rounding into a refusal is a correctness improvement, not a meaningful compatibility regression for representable application balances.

The implementation needs these details:

- Check the aggregate result before allowing it into application arithmetic.
- Checking `Number(value)` with `Number.isSafeInteger` is sufficient to reject the `9007199254740993` fixture: it converts to an unsafe numeric value and is rejected.
- For `listAccounts`, checking only the posting aggregate is insufficient. The final `openingBalancePaise + postingSum` must also be checked because two individually safe values can produce an unsafe result.
- `bankCashTotal` must check its cross-account reduction as well; individually safe account balances can sum beyond the safe range.
- Average-balance code must check opening-plus-carried-in addition, each daily delta conversion, and relevant accumulated daily-balance arithmetic. Merely checking the SQL rows does not protect later addition or multiplication across days.
- Do not reuse the input-validation semantics of `assertSafePaise` blindly. It throws `HttpError(400)`, but an oversized database aggregate is a server/data-integrity failure, not a malformed client request. Prefer an equivalent aggregate guard producing a 500-class error, consistent with `ledgerDuesAtDates`.
- The updated `account-balances.test.ts` should preserve SQL parameter assertions in a separate safe-result case. If its only fixture now throws during row mapping, assertions placed after the call will never verify the rewritten query parameters.

Those are implementation constraints, not reasons to defer PB6.

5. Average-balance conversion

The proposed three-query conversion is parity-correct:

- `first_activity`: `min(parent_transaction.date)` over postings for the account, restricted to non-deleted parents through `today`.
- `carried_in_delta`: sum real-account postings whose parent date is before the month start.
- Daily deltas: group real-account postings by the parent transaction date within the month-to-date window.

Because every applicable transaction has exactly one real posting equal to its legacy amount, all three results match the current transaction-based queries.

Column-only openings retain the current `firstActivity` semantics. A bank account with a nonzero opening column but no transaction—possible after a type change—still has no posting and therefore returns `firstActivity = null`, producing no AMB. The conversion must not substitute account creation date or treat the column as posting activity in PR-B. Once that account has a real transaction, its first activity is that transaction’s date and the opening column participates in the carried-in balance exactly as today.

An `is_opening` bank transaction is legitimate first activity and should remain so. Soft-deleted and future activity must not establish the window.

6. Tests and plan refinements

The planned parity fixture should additionally cover:

- A zero-activity bank account with zero column and a zero-activity column-opening account.
- A column-opening bank account with no transaction, preserving `firstActivity = null`.
- A column-opening bank account whose first real activity falls inside the current month.
- An opening transaction predating the month, verifying carried-in AMB.
- Multiple same-day postings/transactions for daily grouping.
- A soft-deleted transaction that would otherwise be the earliest activity.
- An account whose only transaction is future-dated.
- A split containing mixed positive and negative components while still matching the parent total.
- Zero-amount ordinary activity.
- Archived-account behavior for each reader.
- Tenant isolation, ideally with a second user and adversarial cross-user-looking data where schema constraints permit construction.
- Overflow of the final opening-plus-sum result, not only overflow of the raw aggregate.
- Overflow in `bankCashTotal` across individually safe account balances.
- SQL/query-shape tests confirming zero-activity accounts survive the left joins.
- Explicit confirmation that `listAccounts` returns one row per account when bank details exist.

The DB-backed parity test must compute its legacy expected values directly from legacy tables, not call another existing balance helper. For AMB, compare the complete result, including window dates and `partialHistory`, rather than only `averagePaise`.

No security, compatibility, or convention issue blocks implementation. The important qualifications are to describe parity as dependent on the PR-A consistency invariant, document the intentionally deferred direct readers, preserve left-join semantics, and implement PB6 as a complete 500-class aggregate/final-arithmetic guard rather than simply calling the existing 400-class input validator.