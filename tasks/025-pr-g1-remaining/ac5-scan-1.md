# AC5 Legacy-Column Scan — Round 1

Scanned 13 production files for forbidden legacy reads. Findings below.

---

## VIOLATIONS

### `apps/api/src/modules/system/services/backup.ts`

**`transferLinks` table — selected via generic backup logic**

- Line 33: `"transfer_links"` appears in `ALL_TABLES`. `dumpDatabase` (line 112-114) iterates this array and calls `dumpTable(db, t)` for each, which executes `SELECT * FROM transfer_links`.
- Line 49: `transfer_links: "user_id"` appears in `USER_TABLES`. `exportUserData` (line 118-124) and `buildUserBackupStream` (line 236-238) iterate `USER_TABLES`, calling `dumpUserTable(db, "transfer_links", userId)`, which executes `SELECT * FROM transfer_links WHERE user_id = ?`.

The `SELECT * FROM transfer_links` path materialises at runtime through the generic loop; there is no dedicated import of the Drizzle `transferLinks` schema object, but the raw-SQL table name achieves the same result.

---

### `apps/api/src/modules/credit/services/reconciliation-writes.ts`

**`transactions.accountId` read in three WHERE clauses inside `recomputeReconciliation`**

- **Line 96** — SELECT WHERE:
  ```ts
  eq(transactions.accountId, accountId),   // filters the live-transaction candidates
  ```
  Full context: a `.select({ id: transactions.id }).from(transactions).where(and(..., eq(transactions.accountId, accountId), ...))` used to verify that candidate IDs still live on this card.

- **Line 137** — UPDATE WHERE (clear stale `reconciled_statement_id`):
  ```ts
  eq(transactions.accountId, accountId),
  ```
  Full context: `.update(transactions).set({ reconciledStatementId: null }).where(and(eq(transactions.reconciledStatementId, id), eq(transactions.userId, userId), eq(transactions.accountId, accountId)))`.

- **Line 148** — UPDATE WHERE (stamp matched transaction IDs):
  ```ts
  eq(transactions.accountId, accountId),
  ```
  Full context: `.update(transactions).set({ reconciledStatementId: id }).where(and(inArray(transactions.id, ...), eq(transactions.userId, userId), eq(transactions.accountId, accountId), isNull(transactions.deletedAt)))`.

All three reference `transactions.accountId` as a filter predicate (not just allowed fields like `userId`, `deletedAt`, `id`).

---

## BORDERLINE (not clear arithmetic violations — coordinator to judge)

### `apps/api/src/modules/ledger/services/accounts.ts`

- **Line 471**: `columnPaise: current.openingBalancePaise` — reads `accounts.openingBalancePaise` from the locked DB row and passes it into `openingBalanceToReconcile` as a fallback when no explicit new value and no existing ledger row exist. The result is eventually placed into `planOpeningBalanceChange.requestedPaise`. No addition or subtraction occurs; the value is compared or forwarded as a SET target. This is account-management logic, not balance arithmetic.
- **Line 148**: `openingBalancePaise: row.openingBalancePaise` in `toAccount` — reads the column and surfaces it in the API response. Boot check ensures the stored value is always 0 for the current PR, so this is cosmetic, but it does read the column.

---

## CLEAN

| File | Notes |
|---|---|
| `ledger/services/balances.ts` | All sums from `postings.amount_paise`; no legacy reads |
| `ledger/services/average-balance.ts` | AMB queries use `postings.amount_paise` exclusively |
| `credit/services/cards.ts` | Amount/category from `postings`; lateral join returns `p.amount_paise`, `cp.category_id` |
| `ledger/services/user-tasks.ts` | `txn_account_id`/`txn_amount_paise` come from a postings lateral join, not from `transactions` columns |
| `investments/services/sip-installments.ts` | `linkSipInstallment` raw SQL selects `p.account_id`/`p.amount_paise` from postings; `is_opening` derived from EXISTS on postings, not `transactions.isOpening`; `unlinkedInstallmentRows` selects `postings.amountPaise` |
| `ingest/services/review-queue.ts` | History-category join goes through `postings.categoryId → categories`; no `transactions.categoryId` read |
| `planning/services/bills.ts` | `p.amount_paise` and `cat.category_id` both come from postings/lateral |
| `automation/services/categorize.ts` | `p.amount_paise` from postings; `tx.amount_paise` in result map is the postings column aliased in the query |
| `ingest/services/transfer-classification.ts` | Candidate SQL selects only `t.id`; amount/account filters are on `p.amount_paise`/`p.account_id` (postings) |
| `credit/services/reconciliation-reads.ts` | `ledgerDuesAtDates` sums `p.amount_paise` from postings; no forbidden transaction columns |

---

## Summary

**2 true violations:**
1. `backup.ts` — selects from `transfer_links` (lines 33, 49 drive runtime SELECTs)
2. `reconciliation-writes.ts` — reads `transactions.accountId` in WHERE at lines 96, 137, 148

**2 borderline reads of `accounts.openingBalancePaise`** in `accounts.ts` (lines 148, 471) — not balance arithmetic; coordinator to decide if these require action.

All other 10 files are CLEAN.
