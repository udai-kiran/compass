# PR-E Implementation Report

## Files Changed

1. `apps/api/src/modules/ledger/services/search.ts`
2. `apps/api/src/modules/automation/services/categorize.ts`
3. `apps/api/src/modules/credit/services/reconciliation-reads.ts`
4. `apps/api/src/modules/credit/services/emis.ts`
5. `apps/api/src/modules/protection/services/insurance.ts`
6. `apps/api/src/modules/ingest/services/imports.ts`
7. `apps/api/src/modules/credit/services/cards.ts`
8. `apps/api/src/modules/investments/services/sip-installments.ts`
9. `apps/api/src/modules/ledger/services/user-tasks.ts`

## Per-file Summary

### 1. search.ts (PE7)
- Replaced `SELECT id, merchant, amount_paise, date FROM transactions WHERE ...` with postings-joined query using Pattern B + Pattern C (transfer/opening exclusion via NOT EXISTS).
- Adds `JOIN accounts a`, `JOIN transactions t`, `system_kind IS NULL` filter, and NOT EXISTS subquery.
- Result type and mapping unchanged.

### 2. categorize.ts (PE5)
- Replaced `SELECT id, merchant, notes, amount_paise FROM transactions WHERE ...` with postings-joined query.
- Added `JOIN accounts a`, `JOIN transactions t`, `system_kind IS NULL` filter, NOT EXISTS (clearing/opening) exclusion.
- Changed `AND t.id IN ${transactionIds}` to use `sql.join` with typed `::uuid` casts for the restrict filter.

### 3. reconciliation-reads.ts (PE3)
- Changed raw SQL `ledgerDuesAtDates` to use a postings subquery instead of direct `LEFT JOIN transactions ... ON t.account_id = $accountId`.
- Added pre-filtering subquery `(SELECT p.amount_paise, t.date FROM postings p JOIN transactions t ...)` with outer `LEFT JOIN ... ON sub.date < ds.stmt_date`.
- `openingBalancePaise` addend preserved.

### 4. emis.ts (PE2)
- Added `postings` to imports from `"../../../db/schema.ts"`.
- `upsertEmiDetails` existence check: replaced `eq(transactions.accountId, ...)` + `lt(transactions.amountPaise, 0)` in WHERE with `INNER JOIN postings` on `(transactionId, accountId, amountPaise < 0)`. Added explicit `userId` filter.
- `listEmiInstallments`: same JOIN pattern, removed `eq(transactions.accountId, ...)` + `lt(transactions.amountPaise, 0)` from WHERE, changed `amountPaise: transactions.amountPaise` → `amountPaise: postings.amountPaise` in SELECT.

### 5. insurance.ts (PE9)
- Added `accounts`, `postings` to imports from `"../../../db/schema.ts"`.
- Replaced `db.query.transactions.findMany` with Drizzle `.select().from(transactions).innerJoin(postings, ...).innerJoin(accounts, and(..., isNull(accounts.systemKind)))`.
- `amountPaise` and `accountId` now come from `postings`. Field `note` renamed from `r.notes` → `r.note` to match the select alias.

### 6. imports.ts (PE8)
- Added `postings` to imports from `"../../../db/schema.ts"`.
- `applyMapping` dedup read: removed `eq(transactions.accountId, batch.accountId)` from WHERE, added `INNER JOIN postings ON (transactionId, accountId = batch.accountId)`. `amountPaise` now from `postings.amountPaise`.
- `commitImport` CC reconciliation read: same pattern — removed `eq(transactions.accountId, batch.accountId)` from WHERE, added `INNER JOIN postings`. The UPDATE guard at ~line 657 (`eq(transactions.accountId, batch.accountId)` in write-path) left untouched.

### 7. cards.ts (PE1)
- Removed `desc`, `gte`, `isNull`, `lte` from drizzle-orm imports (no longer used after findMany removed).
- Removed `postings`, `transactions` from schema imports (only used as SQL text, not as ORM objects; `accounts` still needed as ORM reference).
- `listCardHolders` aggregate: rewrote raw SQL to `FROM postings p JOIN transactions t`. Added `Number.isSafeInteger` guards on all three aggregate values.
- `getCardActivity` aggregate: same rewrite. Added `Number.isSafeInteger` guards.
- `getCardActivity` per-row: replaced `db.query.transactions.findMany(...)` with `db.execute(sql`...`)` raw SQL joining postings. `toTxn` maps snake_case raw row to `CardActivityTxn` with `Number.isSafeInteger` guard on `amount_paise`.

### 8. sip-installments.ts (PE4)
- Added `sql` to drizzle-orm imports; added `postings` to schema imports (removed `accounts` — only used as SQL text).
- `linkSipInstallment` validation: replaced Drizzle select with `tx.execute(sql`...`)` raw SQL using `LEFT JOIN postings p ON (transaction_id, account_id = sip.targetAccountId)` and EXISTS subquery for `is_opening`. Built `ledgerTx` shape from `rawRow`. Changed update WHERE to use `rawRow.id`.
- `unlinkedInstallmentRows`: removed `eq(transactions.accountId, ...)`, `eq(transactions.isOpening, false)`, `gt(transactions.amountPaise, 0)` from WHERE. Added `INNER JOIN postings` on `(transactionId, accountId, amountPaise > 0)`. Added NOT EXISTS opening exclusion via `sql` template. Changed `amountPaise: transactions.amountPaise` → `amountPaise: postings.amountPaise`.
- `linkedInstallmentRows`: replaced Drizzle select with `db.execute(sql`...`)` LATERAL join on ANY real posting. `Number.isSafeInteger` guard on `amount_paise` string cast.

### 9. user-tasks.ts (PE6)
- Removed `TASK_ORDER`, `TaskJoinRow`, `taskQuery`.
- Added `UserTaskRow` type alias (kept for `updateUserTask`), new `TaskRawRow` interface with snake_case fields.
- New `toUserTask(row: TaskRawRow)` maps raw SQL row to `UserTask`; includes `Number.isSafeInteger` guard on `txn_amount_paise`.
- `listUserTasks`: `db.execute(sql`...`)` with LATERAL join on real posting. ORDER BY embedded in SQL.
- `getUserTask`: same LATERAL SQL with additional `AND ut.id = ${id}` predicate.
- `TASK_LATERAL_QUERY` constant holds the shared CTE-like SQL fragment.

## Typecheck Output + Exit Code

```
npm run typecheck
Exit: 0
(all workspaces: api, docs, extractor, ingestor, web, ai, shared — clean)
```

## Lint Output + Exit Code

```
npm run lint
Exit: 0
(no errors, no warnings)
```

## Test Output + Exit Code

```
npm run test -w apps/api
ℹ tests 668
ℹ pass 643
ℹ fail 24
ℹ cancelled 0
ℹ skipped 1
Exit: 1 (due to 24 pre-existing failures)
```

All 24 failures are pre-existing — each fails at module load time with `requireDatabaseUrl` or `requireEnv` because `DATABASE_URL`/Redis is not configured in this environment. These test files include: `app.test.ts`, `postings-periods-parity.test.ts`, route tests (automation, ingest, investments, ledger, planning, protection, system), and DB-backed service tests (emis, reconciliation-writes, rewards, inbox, epf-contributions, postings-balance-parity, reconcile-postings, recurring, user-tasks, projection-settings, backup). None of these failures are caused by my changes.

## Deviations from Plan

- `cards.ts`: Added `Number.isSafeInteger` guards per plan's "Range-check all Number() casts" requirement. The `listCardHolders` aggregate SQL change also adds the guards before use (not just after fetching). 
- `sip-installments.ts`: `accounts` not imported as Drizzle ORM object (only used as SQL text); removed from import to satisfy lint.
- `cards.ts`: `transactions` and `postings` similarly not needed as ORM imports; removed.
- `user-tasks.ts`: Preserved `UserTaskRow = typeof userTasks.$inferSelect` type alias because `updateUserTask` still uses `Partial<UserTaskRow>` — this is consistent with the plan's guidance to update `TaskJoinRow` while keeping write-path code untouched.
