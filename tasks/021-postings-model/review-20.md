# Verdict: BLOCKING FINDINGS

The postings SQL conversions are fundamentally correct, and typecheck, lint, and API tests pass. However, PB5/PB6 and AC3/AC4 are not fully satisfied. The implementation should not be approved until the overflow handling and parity coverage gaps below are fixed.

## Blocking findings

### 1. PB6: `bankCashTotal` can overflow during reduction and later return to a safe final value

[balances.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:71) performs the complete reduction first:

```ts
const total = rows.reduce((sum, r) => sum + r.balancePaise, 0);
```

It checks only the final result. PB6 requires a check at every point where two safe values combine. An intermediate partial sum can become unsafe and then be offset by a later negative balance, leaving a safe-looking final result after precision has already been lost.

The guard must run after every reduction addition, not only after `reduce` completes. The current test covers only an unsafe final total and therefore does not catch unsafe-intermediate/safe-final cancellation.

### 2. PB6: AMB arithmetic can become unsafe before the final average check

[average-balance.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/average-balance.ts:172) computes AMB through `sumDailyClosingPaise`, whose loop does unchecked additions:

```ts
running += deltas.get(dateStr) ?? 0;
sum += running;
```

`accountAverageBalances` checks the raw opening, carried-in aggregate, opening-plus-carried-in value, and individual daily aggregates, but then validates only `result.averagePaise` after all running-balance and daily-closing accumulation has happened.

This does not meet the approved PLAN-pr-b PB6 requirement to refuse overflow in accumulated daily-closing arithmetic. Two independently safe inputs can produce:

- an unsafe `running` balance;
- an unsafe accumulated `sum`;
- a safe final average after division, despite prior precision loss.

The relevant AMB arithmetic must be guarded as it happens, with `HttpError(500)`. A regression test must demonstrate rejection where the intermediate running balance or daily-closing sum is unsafe even though the resulting average would be safe.

This is also an AC4 failure.

### 3. PB5/T4: the required nonzero column-opening bank with no transaction is not tested

The parity test claims that `zeroActivityBank` covers the column-opening bank case:

[postings-balance-parity.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts:226)

But it creates that account with an opening balance of zero:

```ts
const zeroActivityBank = await createAcct(
  userId,
  "Zero Activity Bank",
  "bank",
  0,
);
```

That proves only an ordinary empty bank account. It does not prove the specifically required legacy state:

- bank account;
- nonzero `opening_balance_paise`;
- no transaction or posting;
- balance supplied entirely by the column;
- `firstActivity === null`;
- no AMB result and no account-creation-date substitution.

This matters because column-based openings are the explicit reason PB2 remains in PR-B. The fixture must genuinely contain a nonzero column opening.

### 4. PB5/T4: archived behavior is not checked for `accountAverageBalances`

The archived-account test checks:

- `listAccounts` includes the archived account;
- `bankCashBalances` excludes it;
- `accountBalancesAtDate` excludes it.

It does not call or assert `accountAverageBalances`. T4 requires archived-account behavior for each reader. The missing assertion should prove that archived banks are absent from AMB results.

### 5. PB5/AC3: total parity expectation is derived from the reader under test

In the main parity test:

[postings-balance-parity.test.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings-balance-parity.test.ts:280)

```ts
const expectedTotal = bcb.reduce((sum, r) => sum + r.balancePaise, 0);
const total = await bankCashTotal(db, userId, dbToday);
assert.equal(total, expectedTotal);
```

`bcb` is the output of `bankCashBalances`, another converted postings reader. Therefore the expected total is not computed independently from the legacy tables as T4 requires.

The expected bank/cash total must be the sum of independently queried legacy balances, or be computed directly with legacy `accounts`/`transactions` SQL. The current assertion can prove only that `bankCashTotal` sums `bankCashBalances`, not postings-to-legacy total parity.

## P-item assessment

### PB1 — PASS

All converted activity components use `postings.amount_paise` keyed by the real account:

- `bankCashBalances`;
- `accountBalancesAtDate`;
- `listAccounts`;
- all three AMB reads.

The posting builders establish row-local parity:

- ordinary real leg equals the transaction amount;
- split real leg equals the split sum, with `computePostingDraftsForTransaction` enforcing that it equals the parent amount;
- transfer-leg real posting equals that legacy leg’s signed amount;
- opening real posting equals the opening transaction amount.

Thus ordinary, split, transfer-leg, and opening-row shapes reproduce the legacy activity amount when postings are consistent.

### PB2 — PASS

Each balance path retains `opening_balance_paise` as an explicit addend. This correctly handles:

- bank/cash opening rows: column zero plus the real opening posting;
- card/loan/scheme column openings: column amount plus no opening posting;
- zero-activity accounts: column plus zero posting sum.

### PB3 — PASS

No system posting leaks into the balance sums:

- `bankCashBalances` restricts outer accounts to bank/cash accounts;
- `accountBalancesAtDate` and `listAccounts` restrict outer accounts to `system_kind is null`;
- AMB correlates or filters posting account IDs against user-owned, non-archived bank accounts.

Because each aggregate keys postings to those selected real-account IDs, Clearing, Expenses, Income, and Opening Balances legs cannot enter the real-account sum.

### PB4 — PASS

All converted queries join postings to their parent transaction and apply parent predicates:

- `deleted_at is null`;
- the correct date cut;
- `transactions.user_id = userId`.

`listAccounts` correctly retains `current_date`; the other readers use their bound `asOf`/`today` values.

Soft-deleted and future-dated transactions are excluded. Postings retained for soft-deleted parents therefore do not affect these readers.

### PB5 — FAIL

The suite uses real dual-write writers, computes per-account legacy expectations from legacy tables, and checks `findInconsistentPostings(...) === []`. It covers most listed shapes, including mixed-sign splits, transfers, zero-amount activity, soft deletion, future-only activity, tenant isolation, and complete AMB object comparison.

It nevertheless misses the genuine nonzero column-opening bank state and archived AMB behavior, and its total expectation is derived from a converted reader.

### PB6 — FAIL

The correct `HttpError(500)` class is used, not the 400-class `assertSafePaise`. Raw posting aggregates and most direct additions are guarded.

It is incomplete because:

- `bankCashTotal` does not check every intermediate reduction addition;
- AMB does not guard each running-balance and daily-closing-sum addition;
- no tests exercise either unsafe-intermediate/safe-final path.

### PB7 — PASS

No diff exists in:

- `planning/services/insights.ts`;
- `credit/services/cards.ts`;
- `credit/services/reconciliation-reads.ts`;
- `investments/services/networth.ts`.

Deferring their direct legacy reads is correct during dual-write because the real-account posting leg is row-locally equal to the legacy transaction amount while posting consistency holds. `networth.ts` also inherits converted numbers where it calls the converted balance service.

No posting builder, transaction writer, reconciliation implementation, schema, or migration was changed.

## `listAccounts` rewrite

The rewrite is correct:

- deleted/date/parent-user predicates are inside the aggregate `FILTER`;
- the outer `WHERE` filters only account ownership and real-account status;
- zero-activity accounts survive both left joins;
- archived accounts remain included;
- future and soft-deleted parents contribute zero without removing the account.

There is no apparent fan-out:

- account to postings is one-to-many;
- posting to parent transaction is many-to-one;
- `bank_details.account_id` is the account key and is treated as one-to-one.

Grouping by account ID and bank subtype therefore does not duplicate posting amounts under the schema’s intended cardinality.

## Query-shape correctness

Subject to posting consistency, the converted queries reproduce the legacy formula for:

- ordinary positive and negative transactions;
- mixed-sign and ordinary splits;
- each transfer leg independently, without Clearing leakage;
- transaction-based opening rows;
- column-based openings;
- soft-deleted transactions;
- future-dated transactions;
- zero-activity accounts;
- archived behavior according to each reader’s existing contract;
- tenant isolation.

The parent-user predicate provides appropriate defense in depth even though account ownership and posting foreign-key integrity should already prevent cross-tenant association.

## Acceptance criteria

- AC1: PASS.
- AC2: PASS.
- AC3: FAIL due to incomplete T4 coverage and non-independent total expectation.
- AC4: FAIL due to incomplete per-operation overflow guarding.
- AC5: PASS for the requested commands:
  - root typecheck passed;
  - lint passed;
  - API tests passed: 923 tests, 922 passed, 0 failed, 1 skipped.

Passing tests do not resolve the missing PB5/PB6 cases because those failure modes are currently untested.

## Required fixes before approval

1. Guard every `bankCashTotal` partial addition with `Number.isSafeInteger` and `HttpError(500)`.
2. Guard AMB’s running-balance and accumulated daily-closing additions before precision can be lost.
3. Add overflow tests for unsafe intermediate arithmetic even when the final total or average would appear safe.
4. Seed and assert a genuinely nonzero column-opening bank with no transaction/posting and verify both its balance and absence from AMB.
5. Assert archived-bank exclusion from `accountAverageBalances`.
6. Compute expected `bankCashTotal` directly from legacy tables or independently obtained legacy per-account values, not from `bankCashBalances`.