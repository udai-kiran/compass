# PR-D Implementation Findings

## Files Changed (7 service files + 1 new test file)

### Service files converted from legacy SQL to postings-based queries

1. **`apps/api/src/modules/planning/services/dashboard.ts`**
   - `getTrends`: replaced legacy `transactions t` totals query with real-posting grain (`postings p JOIN accounts a JOIN transactions t WHERE a.system_kind IS NULL AND NOT EXISTS (Clearing/Opening posting)`). Added isSafeInteger guards on `income`, `expense`, `spent`.
   - `getTrends`: replaced two-query `nonSplitCat`/`splitCat` pattern with single Expenses-posting grain query (`WHERE a.system_kind = 'expenses' AND p.amount_paise > 0 AND NOT EXISTS (Clearing posting)`).

2. **`apps/api/src/modules/planning/services/cashflow.ts`**
   - `getForecast`: replaced legacy `burnRes` query with real-posting grain; `expense`, `income`, `discretionary` aggregates. `t.source` stays on the header join. isSafeInteger guards on all three aggregates.

3. **`apps/api/src/modules/planning/services/insights.ts`**
   - `cashAndLiabilities`: replaced inline SQL with call to `accountBalancesAtDate()` (already postings-based from PR-B); groups by type in JS; isSafeInteger guards on `cash` and `liabilities`.
   - `topMerchants`: replaced legacy query with real-posting grain (`p.amount_paise < 0, t.merchant <> ''`); isSafeInteger guard on sum.
   - `getInsights` (largest): real-posting grain, no `t.merchant <> ''` filter (per PD5 — largest expense may have no merchant).

4. **`apps/api/src/modules/planning/services/reports.ts`**
   - `buildReport` merchants query: real-posting grain, LIMIT 15; `spentPaise` computed and isSafeInteger-guarded in `.map()`.

5. **`apps/api/src/modules/planning/services/bills.ts`**
   - `suggestSubscriptions`: real-posting grain (`p.amount_paise < 0, t.merchant <> '', a.system_kind IS NULL, NOT EXISTS (Clearing/Opening)`); field names unchanged (`t.merchant, t.date, p.amount_paise, a.id as account_id, t.category_id`).

6. **`apps/api/src/modules/system/services/prefs.ts`**
   - `evaluateLargeTransactions`: real-posting grain; `a.id = ${pref.accountId}` replaces `t.account_id`; `abs(p.amount_paise)` filter; NOT EXISTS (Clearing/Opening); isSafeInteger guard on `amount`.

7. **`apps/api/src/modules/planning/services/goals.ts`**
   - `mappedContributionRate` (accountIds branch): replaced Drizzle ORM query with raw `db.execute(sql`...`)` using `sql.join()` for the IN clause; isSafeInteger guard on `branchTotal`. No Clearing/Opening exclusion (PD12: transfers into savings count as contributions).
   - Removed unused imports `gt` (drizzle-orm) and `transactions` (db/schema) — linter requires this (AC7).

### New test file

8. **`apps/api/src/modules/planning/services/postings-planning-parity.test.ts`** (new, ~850 lines)
   - 11 DB-backed parity test cases covering: getTrends totals, getTrends byCategory, cashAndLiabilities, topMerchants, largest transaction, buildReport, getForecast, suggestSubscriptions, evaluateLargeTransactions, getGoalProgress contributions, full fixture.
   - `makeRedisStub()`: in-memory Map-based Redis stub for `cached()`.
   - `requireDatabaseUrl()` at module load; `cleanupUser()` tears down per-user rows in correct FK order.
   - All `setSplits` calls use real `categoryId` strings (not null) — TypeScript requires this.

## Deviations from Plan

- **`gt` and `transactions` imports in goals.ts**: Delegation said "keep them (used elsewhere)" but they were only used in the replaced branch. Removed both to satisfy ESLint `@typescript-eslint/no-unused-vars` (error level, per AC7). Documented deviation.
- `"mutual_fund"` is not a valid `AccountType`; test case 3 uses `"investment"` instead, with assertions updated accordingly.

## Verification Results

```
npm run typecheck   → exit 0 (all 6 workspaces)
npm run lint        → exit 0
npm run test -w apps/api:
  insights.test.ts  4/4 pass
  reports.test.ts  20/20 pass
  DB-backed tests (including new parity test): skip/fail — DATABASE_URL not set (expected; same behavior as all pre-existing DB tests)
```

## Files Inspected (not changed)

- `tasks/021-postings-model/DELEGATION-pr-d.md`
- `tasks/021-postings-model/PLAN-pr-d.md`
- `apps/api/src/modules/ledger/services/accounts.ts` (`accountBalancesAtDate` signature)
- `apps/api/src/modules/ledger/services/transactions.ts` (`createTransfer`, `setSplits` signatures)
- `apps/api/src/modules/planning/services/insights.test.ts`, `reports.test.ts`

## Unresolved Risks

- Parity tests require a live DATABASE_URL to run; correctness of the 11 cases against a real DB is unverified in this session.
- `goals.ts` accountIds branch has no Clearing/Opening exclusion (intentional per PD12); a transfer into a savings account will count as a contribution. This is the spec'd behavior.
