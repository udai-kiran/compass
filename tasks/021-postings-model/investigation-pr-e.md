# PR-E investigation: legacy `transactions` column readers

Investigated 2026-08-09. All paths are under `apps/api/src/`.

---

## Per-file findings

### `modules/credit/services/cards.ts` — 382 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 229–236 (raw SQL, `listCardHolders`) | `amount_paise`, `account_id` | `SUM(amount_paise)` aggregate over `transactions` filtered by `account_id` + `user_id`; two filtered sums (at_close, current_spend) |
| Lines 322–328 (raw SQL, `getCardActivity`) | `amount_paise`, `account_id` | Same aggregate pattern for headline balances |
| Lines 334–351 (`db.query.transactions.findMany`, `getCardActivity`) | `amountPaise`, `categoryId`, `accountId`, `reconciledStatementId` | Per-row fetch for the activity line items |

**Key functions to change:** `listCardHolders` (aggregate SQL), `getCardActivity` (aggregate SQL + row fetch).
Both aggregates must move to `postings`; the per-row fetch for display columns can stay on `transactions`.

---

### `modules/credit/services/emis.ts` — 497 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 375–386 (`upsertEmiDetails`) | `amountPaise`, `accountId`, `recurringTemplateId`, `deletedAt` | Existence check: "does this EMI have any real installment history?" — filters `lt(amountPaise, 0)` |
| Lines 471–489 (`listEmiInstallments`) | `amountPaise`, `accountId`, `recurringTemplateId`, `date` | Fetches actual payment rows for `splitInstallments` |

**Key functions to change:** `upsertEmiDetails` (history check uses `amountPaise < 0`), `listEmiInstallments` (reads `amountPaise` per row).
The sign filter `lt(transactions.amountPaise, 0)` is the critical gate.

---

### `modules/credit/services/reconciliation-reads.ts` — 262 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 124–134 (`ledgerDuesAtDates`) | `amount_paise`, `account_id` | Raw SQL: `SUM(t.amount_paise)` with `LEFT JOIN transactions t ON t.account_id = … AND t.date < ds.stmt_date` over an `unnest` of statement dates |

**Key function to change:** `ledgerDuesAtDates` — the single raw-SQL aggregate is the whole point of this function; it feeds `listReconciliations` and the write-side enrichment in `reconciliation-writes.ts`.

---

### `modules/investments/services/sip-installments.ts` — 512 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 289–300 (`linkSipInstallment`) | `accountId`, `amountPaise`, `isOpening`, `sipId`, `deletedAt` | Reads these for `linkInstallmentIssue` validation |
| Lines 373–394 (`unlinkSipInstallment`) | `sipId` | Ownership / link check |
| Lines 420–433 (`linkedInstallmentRows`) | `amountPaise`, `merchant`, `notes` | Selects display columns |
| Lines 447–471 (`unlinkedInstallmentRows`) | `accountId`, `amountPaise`, `isOpening`, `sipId` | Filters: `isOpening = false`, `amountPaise > 0`, `accountId = …` |

**Key functions to change:** `linkSipInstallment` (reads `isOpening`, `amountPaise` for validation), `unlinkedInstallmentRows` (filters on `isOpening` and `amountPaise`).
`isOpening` and sign-of-`amountPaise` are the gating predicates that must translate to postings-model equivalents.

---

### `modules/investments/services/networth.ts` — 573 lines
**Legacy columns: NO**

No direct `transactions` import or query. Balance computation is entirely delegated to `accountBalancesAtDate` (imported from `modules/ledger/services/accounts.ts`) and `portfolioValue`. Nothing to change here.

---

### `modules/automation/services/categorize.ts` — 98 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 51–57 (`suggestCategoriesFor`) | `amount_paise`, `category_id` | Raw SQL: `SELECT id, merchant, notes, amount_paise FROM transactions WHERE … category_id IS NULL` |

**Key function to change:** `suggestCategoriesFor` — the `amount_paise` column is read for display only (passed to the AI for context); `category_id IS NULL` is the filter predicate. Both remain on `transactions` structurally (category is a ledger column, not a postings column), so this may only need the `amount_paise` reference updated if that column is being dropped.

---

### `modules/automation/services/tools.ts` — 162 lines
**Legacy columns: NO**

No direct `transactions` queries. All data access delegates to existing services (`buildReport`, `getUtilization`, `getInsights`, `search`, `listGoals`). Nothing to change here; any fixes needed are in the delegated services.

---

### `modules/ledger/services/user-tasks.ts` — 182 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 78–97 (`taskQuery`) | `accountId`, `amountPaise` | `LEFT JOIN transactions` selects `txnAccountId: transactions.accountId` and `txnAmountPaise: transactions.amountPaise` for the task-linked-transaction DTO |

**Key function to change:** `taskQuery` — the join selects `accountId` and `amountPaise` directly from `transactions` to hydrate the optional linked-transaction summary returned with every task.

---

### `modules/ledger/services/search.ts` — 34 lines
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 13–16 (`search`) | `amount_paise` | Raw SQL: `SELECT id, merchant, amount_paise, date FROM transactions WHERE …` |

**Key function to change:** `search` — `amount_paise` is selected for display only (returned as `amountPaise` in results).

---

### `modules/ingest/services/imports.ts` — 943 lines — read paths only
**Legacy columns: YES**

| Location | Columns | Usage |
|---|---|---|
| Lines 357–376 (`applyMapping`, dedup read) | `date`, `amountPaise`, `merchant` | Selects existing transactions in the import's date range to build the dedup hash set |
| Lines 619–636 (`commitImport`, CC reconciliation read) | `date`, `amountPaise`, `merchant`, `notes`, `source` | Reads existing ledger rows for the credit-card reconciliation window (±3 days) |
| Lines 849–854 (`rollbackImport`, guard read) | `sipId`, `deletedAt` | Checks for live SIP links before hard-deleting |

**Key functions to change:** `applyMapping` (dedup query reads `amountPaise`), `commitImport` (CC reconciliation window reads `amountPaise`).
The write paths (`t.insert(transactions)`, `t.update(transactions)`) are out of scope per the brief; only the reader functions are in scope.

---

## Summary

| File | Legacy Y/N | Lines | Functions to change |
|---|---|---|---|
| `credit/services/cards.ts` | **Y** | 382 | `listCardHolders`, `getCardActivity` |
| `credit/services/emis.ts` | **Y** | 497 | `upsertEmiDetails`, `listEmiInstallments` |
| `credit/services/reconciliation-reads.ts` | **Y** | 262 | `ledgerDuesAtDates` |
| `investments/services/sip-installments.ts` | **Y** | 512 | `linkSipInstallment`, `unlinkedInstallmentRows` |
| `investments/services/networth.ts` | **N** | 573 | — |
| `automation/services/categorize.ts` | **Y** | 98 | `suggestCategoriesFor` |
| `automation/services/tools.ts` | **N** | 162 | — |
| `ledger/services/user-tasks.ts` | **Y** | 182 | `taskQuery` |
| `ledger/services/search.ts` | **Y** | 34 | `search` |
| `ingest/services/imports.ts` | **Y** | 943 | `applyMapping`, `commitImport` (read legs) |

**8 of 10 files use legacy columns. Total source under investigation: 3,645 lines.**

The dominant pattern is `amount_paise` / `account_id` in raw SQL aggregates (cards, reconciliation, search, categorize) and in Drizzle typed selects/filters (emis, sip-installments, user-tasks, imports). The two clean files (`networth.ts`, `tools.ts`) delegate all balance computation to already-converted services and need no changes.
