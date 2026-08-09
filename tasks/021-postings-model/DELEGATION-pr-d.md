# Sonnet Worker Delegation — PR-D

## Task
021-postings-model PR-D: planning readers + prefs large-txn alert + goals.ts mappedContributionRate → postings

## Approved Plan
Full plan at `tasks/021-postings-model/PLAN-pr-d.md` (APPROVED, review-27 clean).

Summary of design decisions:
- PD1: `getTrends` totals → real-posting grain, grouped by month. Remove `notTransfer` SQL fragment.
- PD2: `getTrends` byCategory → single Expenses-posting query grouped by month+category (replaces nonSplitCat+splitCat two-query pattern).
- PD3: `cashAndLiabilities` → call `accountBalancesAtDate(db, userId, asOf)` and group in JS. Add isSafeInteger guards on JS-level `cash` and `liabilities` sums.
- PD4: `topMerchants` → real-posting grain with `a.system_kind IS NULL`.
- PD5: `largest` inline query in `getInsights` → real-posting grain. Do NOT add `t.merchant <> ''` filter (the original lacks it intentionally — blank merchant is valid for largest-expense).
- PD6: `reports.ts` merchants query → same real-posting grain as PD4, limit 15.
- PD7: `getForecast` burnRes → real-posting grain. `t.source` remains on the header (join keeps it accessible).
- PD8: `suggestSubscriptions` → real-posting grain. `t.category_id` stays on header (valid during dual-write).
- PD9: `evaluateLargeTransactions` → real-posting grain. `a.id = ${pref.accountId}` replaces `t.account_id`.
- PD10: isSafeInteger guards on all new Number() calls (see full list below).
- PD11: Remove stale comments mentioning `transfer_links`, `is_opening`, `notTransfer` variable.
- PD12: `mappedContributionRate` in goals.ts → real-posting grain with NO Clearing/Opening exclusion (preserving semantics: transfers INTO goal accounts count as contributions, same as legacy).

## Files and Symbols

### Changed files (7 service files):
1. `apps/api/src/modules/planning/services/dashboard.ts` — `getTrends`
2. `apps/api/src/modules/planning/services/insights.ts` — `cashAndLiabilities`, `topMerchants`, `largest` inline query
3. `apps/api/src/modules/planning/services/reports.ts` — `merchants` query in `buildReport`
4. `apps/api/src/modules/planning/services/cashflow.ts` — `burnRes` in `getForecast`
5. `apps/api/src/modules/planning/services/bills.ts` — `suggestSubscriptions`
6. `apps/api/src/modules/system/services/prefs.ts` — `evaluateLargeTransactions`
7. `apps/api/src/modules/planning/services/goals.ts` — `mappedContributionRate`

### New file:
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts`

### Must NOT change:
- Any writer, schema, migration, shared-contract, or web file
- `getDashboard`, `getCashflow`, `cashflowCsv` in cashflow.ts / dashboard.ts (no legacy SQL there)
- `upcomingBills`, `evaluateBillReminders` in bills.ts
- `getGoalProgress`, `listGoals`, `checkGoalMilestones` (and everything else in goals.ts except `mappedContributionRate`)
- `monthlySeries`, `savingRatePct`, `coefficientOfVariation`, etc. (pure helpers) in insights.ts
- `resolveReportRange`, `splitByNecessity`, `reportToCsv` in reports.ts
- Return types of all converted functions (unchanged)
- `insights.test.ts`, `reports.test.ts` (pure helper tests — must pass unchanged)

## Required Changes

### 1. `dashboard.ts` — `getTrends`

Remove the `notTransfer` variable declaration (lines 61-63). Replace the three raw SQL queries (`totals`, `nonSplitCat`, `splitCat`) with two postings-based queries:

**Totals query (real-posting grain, grouped by month):**
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
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= ${from} AND t.date <= ${to}
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
GROUP BY 1
```

**ByCategory query (Expenses-posting grain, grouped by month+category):**
```sql
SELECT to_char(t.date, 'YYYY-MM') as month, p.category_id as cid,
  COALESCE(SUM(p.amount_paise), 0)::bigint as spent
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= ${from} AND t.date <= ${to}
  AND a.system_kind = 'expenses'
  AND p.amount_paise > 0
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind = 'clearing'
  )
GROUP BY 1, 2
```

Replace the combining loop `[...nonSplitCat.rows, ...splitCat.rows]` with a single loop over the new byCategory result.

Add isSafeInteger guards on `Number(r.income)`, `Number(r.expense)` (per-row, PD1), and `Number(r.spent)` (per-row, PD2). Use `HttpError(500, "...")` pattern from PR-B/PR-C. The `HttpError` import is not currently in dashboard.ts — add it: `import { HttpError } from "../../../lib/errors.ts";`.

Remove or update the stale comment "Opening-balance seed rows are not activity — excluded alongside transfers." to reflect that postings-based exclusion is used.

### 2. `insights.ts` — `cashAndLiabilities`

Replace the entire body of `cashAndLiabilities` with:

```typescript
import { accountBalancesAtDate } from "../../ledger/services/accounts.ts";

async function cashAndLiabilities(
  db: Db,
  userId: string,
  asOf: string,
): Promise<{ cashPaise: number; liabilitiesPaise: number }> {
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
  // Guard the JS-level aggregations (per-account guards are already inside accountBalancesAtDate)
  if (!Number.isSafeInteger(cash)) {
    throw new HttpError(500, "Cash aggregate exceeded a safe integer — refusing to lose paise");
  }
  if (!Number.isSafeInteger(liabilities)) {
    throw new HttpError(500, "Liabilities aggregate exceeded a safe integer — refusing to lose paise");
  }
  return { cashPaise: cash, liabilitiesPaise: liabilities };
}
```

Add the `accountBalancesAtDate` import to insights.ts. `HttpError` is not currently imported in insights.ts — add it: `import { HttpError } from "../../../lib/errors.ts";`.

Remove the old `sql` import or keep it only if still used by the remaining raw SQL queries (`largest`, `topMerchants`). Since those still use `db.execute(sql\`...\`)`, `sql` is still needed.

### 3. `insights.ts` — `topMerchants`

Replace the existing query body:
```sql
SELECT t.merchant,
  COALESCE(SUM(-p.amount_paise), 0)::bigint as spent,
  COUNT(*)::int as n
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= ${from} AND t.date <= ${to}
  AND p.amount_paise < 0
  AND t.merchant <> ''
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
GROUP BY t.merchant ORDER BY spent DESC LIMIT ${limit}
```

Add isSafeInteger guard: `const spentPaise = Number(r.spent); if (!Number.isSafeInteger(spentPaise)) throw new HttpError(500, "Merchant spend aggregate exceeded a safe integer — refusing to lose paise");`

### 4. `insights.ts` — `largest` inline query inside `getInsights`

Replace:
```sql
SELECT t.id, t.merchant, -p.amount_paise as amt, t.date
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= ${from} AND t.date <= ${to}
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

Note: NO `t.merchant <> ''` filter (PD5 — the original query intentionally lacks it).

The existing code does `Number(lg.amt)` after the query. Add isSafeInteger guard before use:
```typescript
const valuePaise = Number(lg.amt);
if (!Number.isSafeInteger(valuePaise)) {
  throw new HttpError(500, "Largest expense value exceeded a safe integer — refusing to lose paise");
}
```

### 5. `reports.ts` — merchants query in `buildReport`

Replace the inline `db.execute(sql\`...\`)` for merchants with:
```sql
SELECT t.merchant,
  COALESCE(SUM(-p.amount_paise), 0)::bigint as spent,
  COUNT(*)::int as n
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= ${from} AND t.date <= ${to}
  AND p.amount_paise < 0
  AND t.merchant <> ''
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
GROUP BY t.merchant ORDER BY spent desc LIMIT 15
```

Add isSafeInteger guard on `Number(r.spent)` in the `.map()` call.
`HttpError` is not currently imported in reports.ts — add it: `import { HttpError } from "../../../lib/errors.ts";`.

### 6. `cashflow.ts` — `getForecast` burnRes

Remove the `notTransfer` variable declaration (lines 63-64). Replace the `burnRes` query:
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
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= ${from90} AND t.date <= ${today}
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
```

Add isSafeInteger guards on `Number(burn.expense)`, `Number(burn.income)`, `Number(burn.discretionary)` before computing `netBurnMonthly` and `dailyDiscretionary`. `HttpError` is not in cashflow.ts — add it: `import { HttpError } from "../../../lib/errors.ts";`.

Remove or update the stale comment "Opening-balance seed rows are not activity — excluded alongside transfers."

### 7. `bills.ts` — `suggestSubscriptions`

Replace the query:
```sql
SELECT t.merchant, t.date, p.amount_paise, a.id as account_id, t.category_id
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = ${userId}
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

The row type stays the same: `{ merchant: string; date: string; amount_paise: string; account_id: string; category_id: string | null }`. The existing JS logic (grouping, gap calculation, etc.) is unchanged. The existing `Number(r.amount_paise)` calls in the JS processing loop are not new and already work correctly (negative amounts from postings, abs checks).

`t.category_id` is intentionally read from the transaction header — valid during dual-write phase (it stores the same value as the Expenses counter posting's category_id during dual-write).

### 8. `prefs.ts` — `evaluateLargeTransactions`

Replace the inner query:
```sql
SELECT t.id, t.merchant, p.amount_paise, t.date
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND t.date >= current_date - interval '7 days'
  AND ABS(p.amount_paise) >= ${pref.thresholdPaise}
  AND a.system_kind IS NULL
  ${pref.accountId === null ? sql`` : sql`AND a.id = ${pref.accountId}`}
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id
      AND a2.system_kind IN ('clearing', 'opening')
  )
```

The row type stays the same field names (`{ id: string; merchant: string; amount_paise: string; date: string }`). The loop variable `t` is used in the existing code body — that's fine (it's a TS variable, not the SQL alias `t`).

Add isSafeInteger guard on `const amount = Number(t.amount_paise)` — add guard before the `formatINR(Math.abs(amount))` call:
```typescript
const amount = Number(t.amount_paise);
if (!Number.isSafeInteger(amount)) {
  throw new HttpError(500, "Transaction amount exceeded a safe integer — refusing to lose paise");
}
```

`HttpError` is already imported in prefs.ts (it's used for the large transaction HttpError already in the service — verify this). Check if HttpError is imported; if not, add the import.

### 9. `goals.ts` — `mappedContributionRate`

Replace the `accountIds` branch (lines 198-212) with a postings-based query. Use `db.execute(sql\`...\`)`. The `accountIds.length > 0` guard already exists — keep it.

New accountIds branch:
```typescript
if (accountIds.length > 0) {
  const res = await db.execute(sql`
    SELECT COALESCE(SUM(p.amount_paise), 0)::bigint AS total
    FROM postings p
    JOIN accounts a ON a.id = p.account_id
    JOIN transactions t ON t.id = p.transaction_id
    WHERE t.user_id = ${userId}
      AND a.id = ANY(${accountIds})
      AND p.amount_paise > 0
      AND a.system_kind IS NULL
      AND t.deleted_at IS NULL
      AND t.date >= ${cutoffIso}
      AND t.date <= ${today}
  `);
  const row = (res.rows as Array<{ total: string }>)[0];
  const branchTotal = Number(row?.total ?? "0");
  if (!Number.isSafeInteger(branchTotal)) {
    throw new HttpError(500, "Contribution aggregate exceeded a safe integer — refusing to lose paise");
  }
  total += branchTotal;
}
```

Note: `ANY(${accountIds})` should work in Drizzle's `db.execute(sql\`...\`)` with a JS array as parameter — Drizzle's SQL template handles array binding for PostgreSQL ANY. If there are issues with this form, fall back to `a.id IN (${sql.join(accountIds.map(id => sql`${id}`), sql`, `)})`.

The `holdingEvents` branch is unchanged.

Goals.ts already imports `sql` from `drizzle-orm` and `HttpError` from `../../../lib/errors.ts`. No new imports needed.

The existing Drizzle ORM imports (`and, asc, eq, gt, inArray, isNull`) — keep them (used elsewhere in the file). The `transactions` import from `../../../db/schema.ts` stays (used elsewhere). No cleanup needed.

## New parity test: `postings-planning-parity.test.ts`

Location: `apps/api/src/modules/planning/services/postings-planning-parity.test.ts`

Pattern: DB-backed, follows `apps/api/src/lib/postings-balance-parity.test.ts` and `apps/api/src/lib/postings-periods-parity.test.ts`. Requires DATABASE_URL. NO real Redis — stub Redis for functions that call `cached()` (getTrends, getForecast).

**Redis stub required** (because `getTrends` and `getForecast` call `cached(redis, userId, ...)` which uses `redis.get` and `redis.set`):
```typescript
function makeRedisStub(): Pick<Redis, "get" | "set" | "incr"> {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    set: async (key: string, value: string) => { store.set(key, value); return "OK"; },
    incr: async (key: string) => { const v = Number(store.get(key) ?? "0") + 1; store.set(key, String(v)); return v; },
  } as Pick<Redis, "get" | "set" | "incr">;
}
```

Actually, `cached()` in `lib/cache.ts` only calls `redis.get` and `redis.set`. The `incr` is for `invalidateUserCache` — you likely won't need that in the parity test. Check the `cached` signature: `cached(redis, userId, name, ttlSeconds, compute)` — calls `redis.get(key)` and `redis.set(key, JSON.stringify(value), "EX", ttlSeconds)`. The `set` call has 4 args (key, value, "EX", ttl). The stub needs to accept those:

```typescript
function makeRedisStub() {
  const store = new Map<string, string>();
  return {
    get: async (key: string) => store.get(key) ?? null,
    // ioredis set signature: set(key, value, expiryMode, time)
    set: async (key: string, value: string, ..._rest: unknown[]) => {
      store.set(key, value);
      return "OK" as const;
    },
  };
}
```

Cast to `Redis` type as needed (or use `as unknown as Redis`).

**Test cases** (11 total, from plan cases 1-11):

1. **getTrends totals (income/expense by month)**:
   - Create bank account + transactions: ordinary expense (-1000), ordinary income (+2000 bank), transfer pair (bank→bank), opening row, soft-deleted, future-dated, credit_card inflow (+500 credit_card, non-transfer)
   - Two distinct months: put income in month A, expense in month B
   - Extra: split transaction (bank -10000, with splits -6000/-4000 — verify expense=10000 for the month, not 14000)
   - Compute expected directly from legacy SQL: `sum(t.amount_paise > 0 AND a.type NOT IN (...)) as income` on non-transfer, non-opening, non-deleted transactions
   - Call `getTrends(db, redis, userId, months)` where months covers both months
   - Assert month-by-month income/expense equality

2. **getTrends byCategory**:
   - Non-split expense with category → its month+category bucket
   - Split expense (3 splits with distinct categories) → each category in its month bucket
   - Transfer: excluded from byCategory
   - Opening: excluded
   - Compute expected from legacy: `sum(-t.amount_paise) WHERE category_id = X` (non-split) + `sum(-s.amount_paise) WHERE category_id = X` (splits)

3. **cashAndLiabilities**:
   - Bank account with opening balance + a positive transaction → cashPaise
   - Credit card with negative balance → liabilitiesPaise
   - Investment account → excluded from both
   - Archived account → excluded
   - Compute expected from legacy SQL: `a.opening_balance_paise + sum(t.amount_paise)` per account type

4. **topMerchants and getInsights largest**:
   - Expenses from known merchants; split tx → parent amount
   - Transfer: excluded
   - Opening: excluded
   - **Blank-merchant expense larger than all named ones**: verify it appears as `largest` (PD5 has no merchant filter) but does NOT appear in topMerchants (PD4 filters `t.merchant <> ''`)
   - Compute expected from legacy SQL

5. **buildReport merchants** (same fixture, verify through buildReport result):
   - Verify merchants match expected via `buildReport(db, userId, { period: 'monthly', key: ... }).topMerchants`

6. **getForecast burnRes**:
   - Manual expense: in expense AND discretionary
   - Recurring expense (`source = 'recurring'`): in expense but NOT discretionary
   - Transfer: excluded
   - Opening: excluded
   - Credit card inflow: excluded from income (D4)
   - **Split expense** (bank, manual, -10000 parent): expense=10000, discretionary=10000 (parent amount)
   - Compute expected from legacy SQL
   - Call `getForecast(db, redis, userId)` and check `avgMonthlyBurnPaise` / derived values (or inspect internal via a known 90-day range)

7. **suggestSubscriptions**:
   - 3 monthly charges (same merchant, ~30 day gaps, same amount ±10%): produces a suggestion
   - Transfer: excluded
   - Opening: excluded
   - Templated merchant: excluded

8. **evaluateLargeTransactions**:
   - Transaction above threshold: alert fired (once)
   - Below threshold: no alert
   - Transfer above threshold: no alert
   - Opening above threshold: no alert
   - Split above threshold (parent amount): exactly ONE alert
   - Verify alert count

9. **mappedContributionRate (via getGoalProgress or direct):**
   - Savings bank account with positive inflows: counted
   - Transfer IN to savings account: counted (no exclusion)
   - Opening row on savings account: counted (no exclusion)
   - Negative transaction on savings account: excluded
   - Soft-deleted positive: excluded
   - Future-dated positive: excluded
   - Compute expected: `sum(t.amount_paise WHERE account_id IN (...) AND amount_paise > 0 AND deleted_at IS NULL AND date IN range)`
   - Call `mappedContributionRate` — but it's private (not exported). Instead, call `getGoalProgress(db, userId, goalId)` and check `.monthlyContributionPaise` (which is the return value of mappedContributionRate * 12 or similar). OR: export `mappedContributionRate` as a named export temporarily — but that changes the API surface. Better: test it indirectly through `getGoalProgress` if a goal with mapped accounts exists; or simply verify the SQL works by checking against legacy query directly inside the test by querying postings yourself and comparing with the legacy `transactions.amount_paise` sum.
   
   Actually the cleanest approach: create a helper inside the test that runs the same legacy SQL (`sum(t.amount_paise)` on transactions) and the new postings SQL on the same fixture and asserts they match. This doesn't require calling `mappedContributionRate` directly.

10. **Tenant isolation**: user B's data absent from user A results for every converted function.

11. **findInconsistentPostings(db, userId) == []** for the fixture user at end.

**Test harness notes:**
- Import and call service-layer functions for creating transactions (which dual-write to postings): use `createTransaction`, `setSplits`, `createTransfer` from the ledger module, or use direct DB inserts following the pattern in `postings-periods-parity.test.ts`.
- For the expected values, compute directly from legacy tables using raw SQL: `db.execute(sql\`...\`)`.
- Skip DB-backed tests gracefully when DATABASE_URL is not set (use requireDatabaseUrl pattern from reconciliation-writes.test.ts).

## Commands
1. `cd /work/personal/compass && npm run typecheck 2>&1 | tail -30`
2. `cd /work/personal/compass && npm run lint 2>&1 | tail -20`
3. `cd /work/personal/compass && npm run test -w apps/api 2>&1 | tail -60`
4. Check that only scoped files are changed: `git diff --name-only`

## Acceptance Criteria (from PLAN-pr-d.md)
- AC1: All seven service files use postings-based queries with no `transfer_links`, `is_opening`, or `transaction_splits` references.
- AC2: Transfer exclusion uses NOT EXISTS (Clearing posting). Opening rows excluded naturally (spend functions) or via NOT EXISTS (Opening posting) (income/expense functions). Exception: `mappedContributionRate` deliberately omits exclusion (PD12).
- AC3: `cashAndLiabilities` uses `accountBalancesAtDate` — no raw `opening_balance_paise` SQL in insights.ts.
- AC4: `evaluateLargeTransactions` uses real-posting grain — exactly one alert per transaction (D20).
- AC5: Range-checked per PB6 pattern on every new Number() call including PD3 JS sums and PD12 branch total.
- AC6: DB-backed parity test exists and passes for all 11 cases (or skips gracefully when DATABASE_URL is unset).
- AC7: `npm run typecheck` exit 0 across all workspaces. `npm run lint` exit 0. `npm run test -w apps/api` green; `insights.test.ts` and `reports.test.ts` pass unchanged.
- AC8: No `notTransfer` variable or `is_opening`/`transfer_links`/`transaction_splits` references in the seven changed files.

## Required Evidence
- Complete `git diff` of all modified and new files
- `git diff --name-only` output (must list only the 7 service files + 1 new test)
- `npm run typecheck` exact output and exit code (must be 0)
- `npm run lint` exact output and exit code (must be 0)
- `npm run test -w apps/api` exact output with pass/fail counts and exit code
- Any deviations from the plan (with justification)
