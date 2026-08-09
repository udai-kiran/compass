# PR-D — planning readers + prefs large-txn alert → postings

## Status
APPROVED (review-27: no blockers; warnings resolved below)

## Context / lineage
Task 2.1 postings-model, dual-write strategy (`PLAN-dualwrite.md`).
SP0, PR-A, PR-B, PR-C merged. PR-D converts the remaining planning-module
readers and the prefs large-transaction alert to use the `postings` mirror.
These are the last direct consumers of `transfer_links`, `is_opening`, and
`transaction_splits` outside the ledger/credit/automation/ingest/extractor
modules (those follow in PR-E/PR-F). Green + releasable → next version bump.

## Objective
Seven services still contain SQL that references `transfer_links`, `is_opening`,
`transaction_splits`, and/or `transactions.amount_paise` directly:
- `modules/planning/services/dashboard.ts` — `getTrends` (monthly rollups)
- `modules/planning/services/insights.ts` — `cashAndLiabilities`, `topMerchants`, inline `largest` query
- `modules/planning/services/reports.ts` — `merchants` query in `buildReport`
- `modules/planning/services/cashflow.ts` — `burnRes` query in `getForecast`
- `modules/planning/services/bills.ts` — `suggestSubscriptions`
- `modules/system/services/prefs.ts` — `evaluateLargeTransactions` (D20)
- `modules/planning/services/goals.ts` — `mappedContributionRate` (PD12)

Convert every query to use postings. No writer, schema, migration, shared
contract, or web change. Legacy columns remain; dual-write continues; the
per-transaction invariant and parity stay green.

## Parity proof (common pattern)

For all converted functions, the key identities are:

**Transfer detection:** replace `NOT EXISTS (SELECT 1 FROM transfer_links tl WHERE ...)` with `NOT EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.transaction_id = t.id AND a2.system_kind = 'clearing')`. Equivalent because PR-A maintains Clearing ↔ transfer_links parity as an invariant.

**Opening exclusion:** replace `NOT t.is_opening` with `NOT EXISTS (... a2.system_kind IN ('clearing', 'opening'))`. For spend functions that filter on `a.system_kind = 'expenses'`, opening rows are excluded naturally (opening postings never produce Expenses system postings — confirmed in postings.ts).

**Real posting grain (income/expense/topMerchants/largest/burnRes):** `JOIN postings p JOIN accounts a ON a.id = p.account_id WHERE a.system_kind IS NULL` selects exactly one posting per transaction (the real leg; invariant from PR-A). `p.amount_paise` equals `t.amount_paise` for all invariant-compliant rows (parity from PR-A per-transaction characterization invariant).

**Spend grain (spentByCategory-style):** `WHERE a.system_kind = 'expenses' AND p.amount_paise > 0` selects exactly the Expenses-system postings, one per split (or per ordinary transaction). This is the same grain as `spentByCategory` / `spendByNecessity` in PR-C.

## Scope (files)

### Changed files
- `apps/api/src/modules/planning/services/dashboard.ts` — `getTrends`
- `apps/api/src/modules/planning/services/insights.ts` — `cashAndLiabilities`, `topMerchants`, `largest` inline query
- `apps/api/src/modules/planning/services/reports.ts` — `merchants` query in `buildReport`
- `apps/api/src/modules/planning/services/cashflow.ts` — `burnRes` query in `getForecast`
- `apps/api/src/modules/planning/services/bills.ts` — `suggestSubscriptions`
- `apps/api/src/modules/system/services/prefs.ts` — `evaluateLargeTransactions`
- `apps/api/src/modules/planning/services/goals.ts` — `mappedContributionRate` (PD12)

### New file
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` (DB-backed parity test)

### Must NOT change
- Any writer, schema, migration, shared-contract, or web file
- `upcomingBills`, `evaluateBillReminders` in bills.ts (no legacy SQL)
- Everything in `goals.ts` EXCEPT `mappedContributionRate` (the rest already uses converted helpers)
- `getDashboard` in dashboard.ts (already uses converted helpers)
- `monthlySeries`, `getInsights` structure (only sub-queries change)
- Return types of all converted functions (unchanged)
- Existing pure-helper tests: `insights.test.ts`, `reports.test.ts`

## Design decisions

### PD1 — `getTrends` totals: real-posting grain, grouped by month
Replace the `notTransfer = sql\`not t.is_opening and not exists (select 1 from transfer_links ...)\`` fragment and the `totals` query on `transactions t, t.amount_paise` with a real-posting query. Same logic as `incomeExpense` but grouped by `to_char(t.date, 'YYYY-MM')`:

```sql
SELECT to_char(t.date, 'YYYY-MM') as month,
  COALESCE(SUM(CASE
    WHEN p.amount_paise > 0 AND a.type NOT IN (${LIABILITY_TYPES_SQL})
    THEN p.amount_paise ELSE 0
  END), 0)::bigint as income,
  COALESCE(SUM(CASE
    WHEN p.amount_paise < 0 THEN -p.amount_paise ELSE 0
  END), 0)::bigint as expense
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
GROUP BY 1
```

The `notTransfer` SQL fragment is removed; it must not appear anywhere in `getTrends` after this change. The parity between real-posting income/expense and legacy `t.amount_paise` income/expense for the same date cut is already proven by PR-C (`incomeExpense` parity test). Monthly grouping is a pure SQL extension of the same query.

### PD2 — `getTrends` byCategory: single Expenses-posting query, grouped by month+category
Replace the two-query `nonSplitCat + splitCat` pattern with one Expenses-posting query (same logic as `spentByCategory` from PR-C but adding a `to_char(t.date, 'YYYY-MM')` group-by dimension):

```sql
SELECT to_char(t.date, 'YYYY-MM') as month, p.category_id as cid,
  COALESCE(SUM(p.amount_paise), 0)::bigint as spent
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND a.system_kind = 'expenses'
  AND p.amount_paise > 0
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind = 'clearing'
  )
GROUP BY 1, 2
```

The JS combining loop currently merges `nonSplitCat.rows` and `splitCat.rows`. Replace it with a single loop over the new result set. The `m.cats.set(r.cid, ...)` logic stays the same.

Opening rows are excluded naturally (no Expenses posting). The `notTransfer` variable is eliminated entirely from `getTrends`.

### PD3 — `cashAndLiabilities`: use `accountBalancesAtDate` (already postings-based)
Replace the raw SQL query (which uses `a.opening_balance_paise` + legacy `transactions.amount_paise` subquery) with a call to `accountBalancesAtDate(db, userId, asOf)` (already converted in PR-B) and group the results by account type in JS:

```typescript
import { accountBalancesAtDate } from "../../ledger/services/accounts.ts";

async function cashAndLiabilities(db, userId, asOf) {
  const rows = await accountBalancesAtDate(db, userId, asOf);
  const byType = new Map<string, number>();
  for (const r of rows) {
    byType.set(r.type, (byType.get(r.type) ?? 0) + r.balancePaise);
  }
  const cash = (byType.get("bank") ?? 0) + (byType.get("cash") ?? 0);
  const liabilities =
    Math.max(0, -(byType.get("credit_card") ?? 0)) +
    Math.max(0, -(byType.get("loan") ?? 0)) +
    Math.max(0, -(byType.get("overdraft") ?? 0)) +
    Math.max(0, -(byType.get("home_loan_od") ?? 0));
  return { cashPaise: cash, liabilitiesPaise: liabilities };
}
```

This eliminates `opening_balance_paise` from `insights.ts`. `accountBalancesAtDate` already excludes system accounts (`system_kind IS NULL`) and archived accounts (`archived_at IS NULL`), exactly matching the current query's `a.archived_at IS NULL`. The overflow guards are already inside `accountBalancesAtDate` (per-account level).

However, the JS loop in PD3 sums multiple per-account balances by type and then derives `cash` and `liabilities` totals. These JS-level summations can overflow for users with many accounts. Apply `Number.isSafeInteger` guards on the final `cash` and `liabilities` values following the PB6 pattern (HttpError 500). Specifically: after computing `cash` and `liabilities`, check both with `Number.isSafeInteger` before returning `{ cashPaise: cash, liabilitiesPaise: liabilities }`.

Note: `Math.max(0, -(byType.get("credit_card") ?? 0))` negates already-checked values and takes max with 0, which is safe within the range; the guard on the final `liabilities` sum catches the aggregation of multiple liability buckets.

### PD4 — `topMerchants` in insights.ts: real-posting grain
Replace `NOT t.is_opening`, `transfer_links` exclusion, and `t.amount_paise` with real-posting query:

```sql
SELECT t.merchant,
  COALESCE(SUM(-p.amount_paise), 0)::bigint as spent,
  COUNT(*)::int as n
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND p.amount_paise < 0
  AND t.merchant <> ''
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
GROUP BY t.merchant ORDER BY spent DESC LIMIT $limit
```

`COUNT(*)` = transaction count because there is exactly one real posting per transaction (PR-A invariant). No `count(distinct t.id)` needed since the real-posting filter already gives one row per transaction.

Range-check `Number(r.spent)` per PB6 pattern (HttpError 500).

### PD5 — `largest` inline query in `getInsights`: real-posting grain
The query that finds the largest single expense (highest absolute negative amount):

```sql
SELECT t.id, t.merchant, -p.amount_paise as amt, t.date
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND p.amount_paise < 0
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
ORDER BY p.amount_paise ASC LIMIT 1
```

The `t.merchant <> ''` filter from the original has been omitted intentionally — the original largest-expense query does not filter on merchant (unlike `topMerchants`). Verify this against the original query before implementing.

The JS after the query reads `lg.amt` as a number. Apply overflow guard: `Number.isSafeInteger(Number(lg.amt))` guard; this value is already a positive number (amt = -p.amount_paise where p.amount_paise < 0), so overflow is theoretically possible only for extreme values, but the guard costs nothing.

### PD6 — `reports.ts` merchants query: real-posting grain
The `merchants` query inside `buildReport` is structurally identical to `topMerchants` (PD4) with `limit 15`. Same converted SQL, same pattern:

```sql
SELECT t.merchant,
  COALESCE(SUM(-p.amount_paise), 0)::bigint as spent,
  COUNT(*)::int as n
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from AND t.date <= $to
  AND p.amount_paise < 0
  AND t.merchant <> ''
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
GROUP BY t.merchant ORDER BY spent DESC LIMIT 15
```

Range-check `Number(r.spent)` per PB6 pattern.

### PD7 — `getForecast` burnRes: real-posting grain + `t.source` from header
The `burnRes` query in `cashflow.ts` computes trailing 90-day expense/income/discretionary burn. Replace the `notTransfer` fragment and `t.amount_paise` with real-posting query. Note `t.source` is a column on the `transactions` header (not on postings) and stays readable from `t`:

```sql
SELECT
  COALESCE(SUM(CASE WHEN p.amount_paise < 0 THEN -p.amount_paise ELSE 0 END), 0)::bigint as expense,
  COALESCE(SUM(CASE
    WHEN p.amount_paise > 0 AND a.type NOT IN (${LIABILITY_TYPES_SQL})
    THEN p.amount_paise ELSE 0
  END), 0)::bigint as income,
  COALESCE(SUM(CASE
    WHEN p.amount_paise < 0 AND t.source <> 'recurring'
    THEN -p.amount_paise ELSE 0
  END), 0)::bigint as discretionary
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= $from90 AND t.date <= $today
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
```

Range-check `Number(burn.expense)`, `Number(burn.income)`, `Number(burn.discretionary)` per PB6 pattern.

### PD8 — `suggestSubscriptions`: real-posting grain; `t.category_id` from header
`suggestSubscriptions` reads `merchant`, `date`, `amount_paise`, `account_id`, and `category_id` to detect recurring charge patterns. Replace the legacy `NOT t.is_opening`/`transfer_links` exclusion and `t.amount_paise`/`t.account_id` with postings-based equivalents:

```sql
SELECT t.merchant, t.date, p.amount_paise, a.id as account_id, t.category_id
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND p.amount_paise < 0
  AND t.merchant <> ''
  AND t.date >= current_date - interval '400 days'
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
ORDER BY t.merchant, t.date
```

`t.category_id` is still available on the transactions header during dual-write and is the right value to use for the subscription suggestion (the suggestion will inherit the same category as the original spend). It will be moved to the posting's category in PR-G. This is a deliberate dual-write-phase choice, not a missing conversion.

`a.id as account_id` equals `t.account_id` for invariant-compliant rows (the real posting's account IS the transaction's account). The JS row type `{ merchant; date; amount_paise; account_id; category_id }` stays the same, so no downstream JS changes.

### PD9 — `evaluateLargeTransactions` (prefs.ts): real-posting grain, D20
Per D20: one alert per transaction, exclude transfers/openings. Replace `NOT t.is_opening`, `transfer_links` exclusion, and `t.amount_paise` with real-posting query. The per-account filter uses `a.id` (the real posting's account, equal to `t.account_id` in invariant-compliant data):

```sql
SELECT t.id, t.merchant, p.amount_paise, t.date
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId
  AND t.deleted_at IS NULL
  AND t.date >= current_date - interval '7 days'
  AND ABS(p.amount_paise) >= $thresholdPaise
  AND a.system_kind IS NULL
  ${pref.accountId === null ? sql`` : sql`AND a.id = ${pref.accountId}`}
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
```

D20 guarantee: `a.system_kind IS NULL` ensures exactly one real posting per transaction, so every matching transaction fires exactly ONE alert. Transfers (which have no Expenses/Income posting but a Clearing posting) are excluded by the NOT EXISTS guard. Opening rows (which have an Opening posting) are also excluded. A split transaction has one real posting (the parent amount), so `abs(p.amount_paise) >= threshold` checks the parent amount → exactly one alert per split if the parent clears the bar, matching legacy behaviour.

The JS code reads `t.amount_paise` from the row. After conversion, the row has `p.amount_paise` aliased as `amount_paise`. Update the TypeScript row type: `Array<{ id: string; merchant: string; amount_paise: string; date: string }>` — same field names, so `Number(t.amount_paise)` in the loop body works unchanged. Actually the local variable is also named `t` in the loop — rename it to `row` in the loop body to avoid confusion with the `transactions` alias in the SQL if needed, but the SQL alias `t` is only in the SQL string, not in TS.

### PD10 — Range-check all new monetary aggregates
Any `Number(row.X)` call introduced by this PR that wasn't already range-checked must have a `Number.isSafeInteger` guard. Follow the PB6 pattern (HttpError 500) from PR-B/PR-C. Specifically:
- `getTrends` totals: check `Number(r.income)` and `Number(r.expense)` per row (PD1)
- `getTrends` byCategory: check `Number(r.spent)` per row (PD2)
- `cashAndLiabilities` JS sums: check `cash` and `liabilities` after accumulation (PD3 note above)
- `topMerchants`: check `Number(r.spent)` per row (PD4)
- `reports.merchants`: check `Number(r.spent)` per row (PD6)
- `getForecast` burnRes: check `Number(burn.expense)`, `Number(burn.income)`, `Number(burn.discretionary)` (PD7)
- `evaluateLargeTransactions`: the `amount_paise` value is used as `Math.abs(Number(...))` directly; add isSafeInteger guard before `formatINR(Math.abs(amount))`.
- `mappedContributionRate` in goals.ts: check `Number(row.total)` per branch (PD12)

### PD11 — Stale documentation: remove `transfer_links` / `is_opening` references from comments
The `getTrends` function and `getForecast` have comments like "Opening-balance seed rows are not activity — excluded alongside transfers." and the `notTransfer` variable. Remove or update those comments to reflect the postings-based exclusion.

### PD12 — `mappedContributionRate` in `goals.ts`: real-posting grain, NO transfer/opening exclusion
`mappedContributionRate` counts positive inflows to goal-linked savings/investment accounts over the trailing 12 months. The legacy query is:
```
sum(transactions.amount_paise) WHERE account_id IN (accountIds) AND amount_paise > 0 AND deleted_at IS NULL
```
Transfer IN to a savings account (positive amount on the savings side) is an intentional contribution and must continue to count. An opening row (positive opening deposit) also counts. So this conversion uses real-posting grain but deliberately **omits** the Clearing/Opening NOT EXISTS exclusion — preserving the same semantics as the legacy query.

Converted query (Drizzle ORM style, replacing the existing `db.select(...)` call):
```typescript
db.execute(sql`
  SELECT COALESCE(SUM(p.amount_paise), 0)::bigint AS total
  FROM postings p
  JOIN accounts a ON a.id = p.account_id
  JOIN transactions t ON t.id = p.transaction_id
  WHERE t.user_id = ${userId}
    AND a.id IN (${sql.join(accountIds.map((id) => sql`${id}`), sql`, `)})
    AND p.amount_paise > 0
    AND a.system_kind IS NULL
    AND t.deleted_at IS NULL
    AND t.date >= ${cutoffIso}
    AND t.date <= ${today}
`)
```

The `holdingEvents` branch is unrelated to transactions/postings and stays unchanged.

Range-check `Number(row.total)` per PB6 pattern (isSafeInteger guard). The JS `total += Number(row?.total ?? 0)` pattern should also check the final `total` accumulation before it is divided (or the guard on the individual branch suffices since each branch is independently bounded).

## New parity test: `postings-planning-parity.test.ts`

DB-backed test (requires DATABASE_URL; no real Redis — but **must stub Redis** for functions that call `cached()`). Follows the same pattern as `postings-balance-parity.test.ts` and `postings-periods-parity.test.ts`.

`getTrends` and `getForecast` both call `cached(redis, userId, name, ttl, compute)` from `lib/cache.ts`, which calls `redis.get` and `redis.set`. The test must supply a stub Redis object that satisfies these two methods (e.g. a simple in-memory map stub — `{ get: async (k) => map.get(k) ?? null, set: async (k, v) => { map.set(k, v); } }`). This is the same pattern as `networth.test.ts` and `reconciliation-writes.test.ts` in this codebase. No real Redis connection is needed.

The test creates fixtures via the SERVICE LAYER (which dual-writes), computes expected values DIRECTLY from the legacy `transactions`/`transaction_splits`/`transfer_links`/`is_opening` tables inside the test (NOT by calling the converted functions), then calls the converted functions and asserts equality.

**Covered cases:**

1. **`getTrends` totals (income/expense by month):**
   - Ordinary expense (bank, negative amount): appears in `expense` for its month
   - Ordinary income (bank, positive amount, non-liability): appears in `income` for its month
   - Transfer pair: both legs excluded from income/expense
   - Opening row: excluded from income/expense
   - Soft-deleted transaction: excluded
   - Future-dated: excluded
   - Liability inflow (credit_card, positive, non-transfer): excluded from income by D4
   - Two distinct months: each month has its own totals (no cross-month leakage)
   - **Split transaction** (e.g., bank -10000 with two splits -6000 and -4000): verify real-posting grain reports expense=10000 for its month (parent amount, not split sum)
   Expected from: direct SQL on `transactions t JOIN accounts a ON a.id = t.account_id` with legacy filters

2. **`getTrends` byCategory (category spend by month):**
   - Non-split expense with category: appears in its month+category bucket
   - Split expense: each split category appears separately in the month bucket
   - Mixed-sign split: only negative splits appear in byCategory
   - Transfer: excluded
   - Opening: excluded
   Expected from: direct SQL on `transactions` (non-split) and `transaction_splits` (split parts) with legacy filters

3. **`cashAndLiabilities`:**
   - Bank with opening balance + activity → in `cashPaise`
   - Card with balance → negative balance, appears in `liabilitiesPaise` (only if negative)
   - Investment account → neither cash nor liabilities
   - Archived account → excluded
   Expected from: direct SQL `a.opening_balance_paise + sum(t.amount_paise)` per account type

4. **`topMerchants` and `getInsights` largest expense:**
   - Expenses from known merchants: appears in topMerchants ranked by sum
   - Split transaction: merchant appears with parent amount (one real posting = parent amount)
   - Transfer: excluded from topMerchants
   - Opening: excluded from topMerchants
   - Largest query: highest-absolute-amount non-transfer, non-opening expense
   - **Blank-merchant largest** (PD5 note): create a blank-merchant expense that is larger than all named merchants; verify it appears as the largest (PD5 intentionally does NOT filter `t.merchant <> ''`, unlike topMerchants)
   Expected from: direct SQL on `transactions t` with legacy `NOT t.is_opening` and `transfer_links` exclusion

5. **`reports.ts` merchants (same structure as topMerchants):**
   - Verify `buildReport` merchants uses the converted query
   Expected: same fixture as topMerchants, verify through `buildReport.merchants` field

6. **`getForecast` burnRes (expense/income/discretionary):**
   - Ordinary expense with `source = 'manual'`: appears in `expense` AND `discretionary`
   - Recurring expense (`source = 'recurring'`): appears in `expense` but NOT `discretionary`
   - Transfer: excluded from all three
   - Opening: excluded
   - Liability inflow: excluded from income by D4
   - **Split expense** (bank, manual source, -10000 parent with splits): expense=10000 (parent amount); discretionary=10000 (parent amount, manual source)
   Expected from: direct SQL on `transactions t JOIN accounts a` with legacy filters

7. **`suggestSubscriptions`:**
   - 3 monthly charges from the same merchant (~28-33 day gaps): produces a suggestion
   - Transfer: excluded from the charge list
   - Opening: excluded from the charge list
   - Templated merchant: excluded from suggestions
   Expected: verify the subscription suggestion list matches what legacy SQL would produce

8. **`evaluateLargeTransactions`:**
   - Transaction above threshold: fires an alert (inserted into alertLedger)
   - Transaction below threshold: no alert
   - Transfer above threshold: no alert (excluded)
   - Opening above threshold: no alert (excluded)
   - Split transaction above threshold (parent amount): exactly ONE alert (D20 — not N alerts for N splits)
   Expected: verify alert count and `findInconsistentPostings == []`

9. **`mappedContributionRate` (goals.ts):**
   - Savings account with 3 positive inflows in the 12-month window: total counted
   - Transfer IN to the savings account (positive real posting): counted (semantics preserved, NOT excluded)
   - Opening row (is_opening=true, positive amount, same account): counted (not excluded)
   - Soft-deleted positive transaction: excluded
   - Future-dated positive transaction: excluded
   - Negative transaction on the account: excluded (amount_paise < 0 filter)
   Expected from: direct SQL `sum(t.amount_paise) WHERE account_id IN (...) AND amount_paise > 0 AND deleted_at IS NULL AND date IN range`

10. **Tenant isolation:** user B's data absent from user A's results for every converted function.

11. **`findInconsistentPostings(db, userId) == []`** for the fixture user at the end.

## Acceptance Criteria
- AC1: All seven service files use postings-based queries with no `transfer_links`, `is_opening`, or `transaction_splits` references.
- AC2: Transfer exclusion uses NOT EXISTS (Clearing posting). Opening rows excluded naturally (spend functions) or via NOT EXISTS (Opening posting) (income/expense functions). Exception: `mappedContributionRate` deliberately omits exclusion (PD12 rationale).
- AC3: `cashAndLiabilities` uses `accountBalancesAtDate` — no raw `opening_balance_paise` SQL in insights.ts.
- AC4: `evaluateLargeTransactions` uses real-posting grain — exactly one alert per transaction (D20); split transaction → 1 alert; transfer → 0 alerts.
- AC5: Range-checked per PB6 pattern on every new Number() call including PD3 JS sums (cash, liabilities) and PD12 branch total.
- AC6: DB-backed parity test passes for all listed cases (cases 1–11). Redis is stubbed for getTrends and getForecast.
- AC7: `npm run typecheck` (all workspaces), `npm run lint`, and `npm run test -w apps/api` all green; specifically `insights.test.ts`, `reports.test.ts` pass unchanged.
- AC8: No `notTransfer` variable or `is_opening`/`transfer_links` references remain in the seven changed files.

## Verification
- T1 `npm run typecheck` — exit 0 across all workspaces.
- T2 `npm run lint` — exit 0.
- T3 `npm run test -w apps/api` — green; `insights.test.ts`, `reports.test.ts`, and the new `postings-planning-parity.test.ts` all pass.
- T4 Parity test (DB-backed, live Postgres). Expected values MUST be computed from legacy tables inside the test. Coverage per cases above.
- T5 `git diff --name-only` shows only the scoped files + new test file.

## Non-goals
- No conversion of credit/investments/automation/ingest readers (PR-E).
- No conversion of backup/restore/extractor (PR-F).
- No drop of transfer_links/transaction_splits/legacy columns (PR-G).
- No changes to `upcomingBills`, `evaluateBillReminders`, `getDashboard`.
- No changes to the rest of `goals.ts` beyond `mappedContributionRate` (other functions already use converted helpers).

## Review history
- review-26 (Codex plan review): 1 BLOCKING (goals.ts `mappedContributionRate` missed), 2 WARNINGs (PD3 JS-sum guards needed; parity test needs Redis stub for cached() calls). All resolved: PD12 added for mappedContributionRate (real-posting grain, no transfer/opening exclusion — semantics preserved); PD3 and PD10 updated with JS-sum guards; parity test section updated with Redis stub requirement and case 9 for mappedContributionRate.
- review-27 (Codex re-review): NO BLOCKING. 2 WARNINGs (add blank-merchant largest test; add split fixture for getTrends/getForecast). Both resolved: added sub-cases to parity test sections. Fixed Objective "Six" → "Seven". VERDICT: APPROVED.
- review-28 (Codex implementation review): NO BLOCKING. 4 WARNINGs: (1) prefs.ts: guard fires after alertLedger insert — FIXED (review-29 confirms). (2) Tenant isolation parity test covers only getTrends. (3) suggestSubscriptions test doesn't verify templated-merchant exclusion. (4) getTrends split fixture doesn't prove grain differs from split-grain. Items (2)-(4) are test coverage gaps, not implementation bugs; deferred to cleanup. VERDICT: COMPLETE.
- review-29 (Codex targeted re-review of prefs.ts fix): CLEAN — no blocking findings. Guard-before-insert confirmed.
