# Task 2.1 Postings Model — Investigation 1

Investigation date: 2026-08-05. Read-only; no files changed.

---

## 1. SCHEMA

### `transactions` table — `apps/api/src/db/shared/ledger.ts:23-124`

| Column | Type | Nullable | Notes |
|---|---|---|---|
| `id` | uuid PK | NOT NULL | |
| `userId` | uuid FK→users | NOT NULL | |
| `accountId` | uuid FK→accounts | NOT NULL | **target of removal** |
| `date` | date | NOT NULL | |
| `occurredAt` | timestamptz | NULL | precise instant when known |
| `amountPaise` | bigint | NOT NULL | **target of removal**; outflow negative |
| `merchant` | text | NOT NULL default '' | |
| `categoryId` | uuid FK→categories | NULL | **target of removal** (moves to posting) |
| `necessity` | enum | NULL | **target of removal** (moves to posting) |
| `notes` | text | NOT NULL | stays on header |
| `tags` | text[] | NOT NULL | stays on header |
| `source` | enum | NOT NULL | stays on header |
| `isOpening` | boolean | NOT NULL default false | `apps/api/src/db/shared/ledger.ts:66` — **disappears entirely in 2.1** |
| `policyId` | uuid FK→insurance_policies | NULL | stays (header-level link) |
| `resourceId` | uuid FK→resources | NULL | stays |
| `sipId` | uuid FK→sips | NULL | stays |
| `recurringTemplateId` | uuid FK→recurring_templates | NULL | stays |
| `reconciledStatementId` | uuid FK→statement_reconciliations | NULL | stays |
| `deletedAt` | timestamptz | NULL | stays |
| `createdAt` / `updatedAt` | timestamptz | NOT NULL | stays |

Indexes: `transactions_user_date_idx(userId, date desc, createdAt desc, id desc)`, `transactions_account_idx(accountId)`, `transactions_category_idx(categoryId)`, `transactions_sip_date_idx(sipId, date)` partial.

### `accounts` table — `apps/api/src/db/shared/hubs.ts:48-99`

`openingBalancePaise` at line 82: `bigint("opening_balance_paise", { mode: "number" }).notNull().default(0)`. No `isOpening` flag on `accounts` — that flag lives on `transactions`. **Both disappear in 2.1.**

### `transactionSplits` — `apps/api/src/modules/ledger/schema.ts:40-55`

Columns: `id`, `transactionId` FK→transactions (CASCADE), `categoryId` FK→categories, `amountPaise`, `note`, `createdAt`. This table is superseded by `postings` in task 2.3 but remains in scope for 2.1 (it still exists during 2.1 and must be listed in `ALL_TABLES`).

### `transferLinks` — `apps/api/src/modules/ledger/schema.ts:57-76`

Columns: `id`, `userId` FK→users, `outTransactionId` FK→transactions (CASCADE, unique), `inTransactionId` FK→transactions (CASCADE, unique), `auto`, `createdAt`. Superseded in task 2.2 but remains in scope for 2.1.

---

## 2. WRITE PATH

Every site that inserts or updates `accountId`/`amountPaise`/`isOpening` on `transactions`, or writes `accounts.openingBalancePaise`:

### `transactions` INSERT with `accountId`/`amountPaise`

| File | Lines | How triggered |
|---|---|---|
| `modules/ledger/services/transactions.ts` | 282-284 | `createTransaction` — main write path; called everywhere below |
| `modules/ledger/services/accounts.ts` | 225 | `createAccount` — inserts `isOpening` row for bank/cash via `tx.insert(transactions).values(row)` |
| `modules/ledger/services/accounts.ts` | 425-432 | `updateAccount` — inserts corrected `isOpening` row (`amountPaise`, `isOpening: true`) |
| `modules/ledger/services/recurring.ts` | 287, 303, 330 | `fireRecurringDue` — direct `tx.insert(transactions).values({accountId, amountPaise})` (bypasses `createTransaction` for performance, inserts recurring+principal legs) |
| `modules/ingest/services/imports.ts` | 704-710 | `commitImport` — direct bulk `tx.insert(transactions)` with `accountId`, `amountPaise` |
| `modules/system/services/demo.ts` | 177, 179, 183-184, 209 | Demo seed — direct bulk insert with `accountId`, `amountPaise`, `isOpening: true` |

### `createTransaction` callers (all pass `accountId` + `amountPaise`)

| Caller file | Lines | Purpose |
|---|---|---|
| `modules/ledger/routes/transactions.ts` | 48 | Route handler — manual user entry |
| `modules/ledger/services/transfers.ts` | 186-187 | `createTransfer` — two legs |
| `modules/ledger/services/epf-contributions.ts` | 53-56 | EPF income booking |
| `modules/ingest/services/review-actions.ts` | 95-100 | Accepting extracted transaction from inbox |
| `modules/ingest/services/transfer-classification.ts` | 90, 101, 260, 273 | Auto-classification of transfer pairs from inbox |
| `modules/protection/services/insurance.ts` | 323-326 | Insurance premium booking |

### `transactions` UPDATE with `amountPaise`

| File | Lines | Purpose |
|---|---|---|
| `modules/ledger/services/transactions.ts` | 309-327 | `updateTransaction` — spreads `input` which may carry `accountId`/`amountPaise` |
| `modules/ledger/services/accounts.ts` | 434 | `updateAccount` — updates `is_opening` row amount |
| `modules/ledger/services/accounts.ts` | 443-459 | `updateAccount` — soft-deletes `is_opening` row |

### `accounts.openingBalancePaise` writes

| File | Lines | Purpose |
|---|---|---|
| `modules/ledger/services/accounts.ts` | 214, 424 | `createAccount` and `updateAccount` — sets column to 0 for bank/cash or to `requestedPaise` for other types |
| `modules/credit/services/reconciliation-writes.ts` | 304 | `recomputeReconciliation` — drift correction writes `openingBalancePaise` directly: `.set({ openingBalancePaise: nextOpeningBalancePaise })` |
| `modules/system/services/demo.ts` | 120-127 | Demo accounts seeded with explicit `openingBalancePaise` |

---

## 3. READ PATH (exhaustive)

All service reads of `transactions.accountId`, `transactions.amountPaise`, `accounts.openingBalancePaise`, `is_opening`, `transfer_links`, `transaction_splits`. Grouped by computing domain.

### Balance / Net Worth

| File | Lines | Computes |
|---|---|---|
| `modules/ledger/services/balances.ts` | 27-35 | `bankCashBalances`: raw SQL `opening_balance_paise + sum(amount_paise)` for bank/cash accounts |
| `modules/ledger/services/accounts.ts` | 163-176 | `accountBalancesAtDate`: raw SQL `opening_balance_paise + sum(amount_paise)` for all account types (used by net worth) |
| `modules/ledger/services/accounts.ts` | 186-197 | `listAccounts`: ORM join `transactions.amountPaise` + `account.openingBalancePaise` → `balancePaise` in response |
| `modules/ledger/services/average-balance.ts` | 207-255 | AMB: raw SQL `opening_balance_paise + carried_in_delta` + daily deltas from `amount_paise` |
| `modules/credit/services/cards.ts` | 231-245, 327-331 | Card balances: raw SQL `sum(amount_paise)` + `acc.openingBalancePaise` |
| `modules/credit/services/reconciliation-reads.ts` | 114, 140, 178 | Statement due: `openingBalancePaise + sum(amount_paise)` at a date |
| `modules/credit/services/reconciliation-writes.ts` | 157, 163, 279, 297, 304 | Reads `acc.openingBalancePaise` to compute drift and writes corrected value |

### Transaction List / Search / Filter

| File | Lines | Computes |
|---|---|---|
| `modules/ledger/services/transactions.ts` | 56, 60, 63 | `filterWhere`: `transactions.accountId`, `transactions.amountPaise` as ORM filter columns |
| `modules/ledger/services/transactions.ts` | 139-150 | `hydrate`: reads `accountId` of counterpart transactions for transfer display |
| `modules/ledger/services/transactions.ts` | 205-208 | `listTransactions` totals: `sum(amountPaise)`, inflow/outflow aggregation |
| `modules/ledger/services/transactions.ts` | 39-42 | `isTransferSql`: EXISTS subquery against `transfer_links` |
| `modules/ledger/services/search.ts` | 27 | Search results: reads `amount_paise` |

### Budget / Spend / Reports

| File | Lines | Computes |
|---|---|---|
| `lib/periods.ts` | 58-82 | `spentByCategory`: raw SQL `amount_paise`, `is_opening`, `transfer_links`, `transaction_splits` |
| `lib/periods.ts` | 132-181 | `spendByNecessity`: same tables, also reads `necessity` from transactions |
| `lib/periods.ts` | 184-206 | `incomeExpense`: raw SQL `amount_paise`, `is_opening`, `transfer_links`, joins `accounts.type` |
| `modules/planning/services/dashboard.ts` | 62, 82, 88 | Trends: `is_opening`, `transfer_links`, `transaction_splits` in raw SQL |
| `modules/planning/services/reports.ts` | 101-106 | Top merchants: raw SQL `amount_paise`, `is_opening`, `transfer_links` |
| `modules/planning/services/insights.ts` | 106, 131, 134, 178-183 | Balance trend, top merchants, biggest spend: raw SQL `amount_paise`, `account_id`, `is_opening`, `transfer_links` |

### Cashflow / Forecast

| File | Lines | Computes |
|---|---|---|
| `modules/planning/services/cashflow.ts` | 63-78 | Forecast burn: `is_opening`, `transfer_links`, raw SQL `amount_paise`, joins `accounts.type` |
| `modules/planning/services/cashflow.ts` | 88-141 | Forecast schedule: builds obligations using `recurringTemplates.amountPaise` and `sips.amountPaise` (not transactions) |
| `modules/system/services/prefs.ts` | 97-99 | Salary detection: raw SQL `is_opening`, `transfer_links` |

### Goals / Planning

| File | Lines | Computes |
|---|---|---|
| `modules/planning/services/goals.ts` | 200, 205-206 | Goal funding: ORM `transactions.amountPaise`, `transactions.accountId` — sums inflows on goal-earmarked investment accounts |
| `modules/planning/services/bills.ts` | 36, 76, 98-99 | Bill activity: `amountPaise`, `is_opening`, `transfer_links` |

### Credit / EMI

| File | Lines | Computes |
|---|---|---|
| `modules/credit/services/emis.ts` | 377-380, 472-492 | EMI payment history: ORM `transactions.accountId`, `transactions.amountPaise` — selects outflow transactions on the loan account |
| `modules/credit/services/cards.ts` | 336, 347-364 | Card activity: ORM `transactions.accountId`, `transactions.amountPaise` — filters by account, computes spend |

### Imports / Ingest

| File | Lines | Computes |
|---|---|---|
| `modules/ingest/services/imports.ts` | 360, 367, 373, 398, 620, 629, 656 | Import dedup hash and existing-tx lookup: ORM `transactions.amountPaise`, `transactions.accountId` |
| `modules/ingest/services/transfer-classification.ts` | 239-242 | Finding the bank-side leg: ORM `transactions.accountId`, `transactions.amountPaise`, `transactions.isOpening` |
| `modules/ingest/services/import-reconciliation.ts` | 45, 57, 61 | Matching import rows to ledger: reads `amountPaise` of candidates |

### SIP Installments

| File | Lines | Computes |
|---|---|---|
| `modules/investments/services/sip-installments.ts` | 84, 91, 94, 291-294, 426, 453, 461, 464-465 | Installment linking: ORM `transactions.accountId`, `transactions.amountPaise`, `transactions.isOpening` — guards and candidate queries |

### AI / Automation

| File | Lines | Computes |
|---|---|---|
| `modules/automation/services/categorize.ts` | 79, 92 | Category suggestions: raw SQL `amount_paise` |
| `modules/automation/services/tools.ts` | 118 | AI tools: reads `t.amountPaise` for formatting |

### User Tasks / Other

| File | Lines | Computes |
|---|---|---|
| `modules/ledger/services/user-tasks.ts` | 83, 86 | ORM `transactions.accountId`, `transactions.amountPaise` — joined to user tasks |
| `modules/protection/services/insurance.ts` | 301-303, 306 | Premium history: reads `amountPaise`, `accountId` from transaction rows |

---

## 4. SHARED CONTRACT

**File:** `packages/shared/src/schemas/ledger.ts`

`TransactionSchema` (line 378-407): includes `accountId: z.uuid()`, `amountPaise: z.number().int()`, `categoryId`, `necessity`, `splits: z.array(SplitSchema)`, `transferLinkId`, `transferCounterpartAccountId`. All would need to move or be removed.

`CreateTransactionSchema` (line 410-424): `accountId: z.uuid()` (required), `amountPaise: z.number().int().refine(n !== 0)` (required), `categoryId`, `necessity`. Both required fields disappear from the header; they move to postings.

`UpdateTransactionSchema` (line 427-443): `accountId`, `amountPaise` optional. Both removed.

`AccountSchema` (line 182-197): `openingBalancePaise: z.number().int()` — disappears.

`CreateAccountSchema` (line 238-246): `openingBalancePaise: z.number().int().default(0)` — disappears.

`UpdateAccountSchema` (line 249-261): `openingBalancePaise: z.number().int().optional()` — disappears.

`SplitSchema` (line 370-376): `categoryId`, `amountPaise`, `note` — this becomes the posting shape or merges into it.

`TransactionFilterSchema` (line 445-455): `minAmountPaise`, `maxAmountPaise`, `accountId` — filter by account / amount range: needs rethinking once those leave the header.

`TransactionPageSchema` (line 462-471): `totalAmountPaise`, `totalInflowPaise`, `totalOutflowPaise` — derived from postings instead of `transactions.amountPaise`.

**Test file:** `packages/shared/src/schemas/ledger.test.ts`

Tests `CreateTransactionSchema.parse({accountId, date, amountPaise})` at line 34-39 and `UpdateTransactionSchema.parse` at line 42-44. These will need updating when those fields are removed from the schemas. The tests do NOT use `deepEqual` on the full object shape — they only assert specific fields (e.g. `parsed.necessity === null`), so fewer test lines break than a full deepEqual check would require.

---

## 5. WEB CONSUMERS

**Not being converted in 2.1**, but surface area for future tasks:

- **56** references to `.amountPaise` / `.splits` / `.openingBalancePaise` across `apps/web/src` (`.ts`/`.tsx`)
- **26** references to `.accountId` (mostly card/account routing, not transaction reads)

Top hotspots:
- `apps/web/src/routes/transactions/TransactionsPage.tsx` — reads `tx.amountPaise`, `tx.splits`, `tx.categoryId` for list display (lines 383, 468, 537)
- `apps/web/src/routes/transactions/TransactionDrawer.tsx` — reads `tx.splits` for edit form (lines 62, 87, 284)
- `apps/web/src/routes/cards/CardDetailPage.tsx:184` — reads `account.openingBalancePaise`
- `apps/web/src/routes/accounts/AccountLedgerPage.tsx:149` — reads `txn.amountPaise`
- `apps/web/src/lib/queries.ts:197-201` — `setSplits` PUT call passes `splits` array with `amountPaise`

Changing `TransactionSchema` or `AccountSchema` in `packages/shared` will immediately propagate TS errors to all these web files.

---

## 6. BACKUP / TABLES

**File:** `apps/api/src/modules/system/services/backup.ts`

`ALL_TABLES` at line 28-41: includes `"transactions"` (line 29), `"transaction_splits"` (line 29), `"transfer_links"` (line 29). A new `"postings"` table must be added here.

`USER_TABLES` at line 44-59: `transactions: "user_id"` (line 45), `transfer_links: "user_id"` (line 45). `postings` would need a user_id column and an entry here, OR it could be `LINKED_TABLES` if it links through `transactions`.

`LINKED_TABLES` at line 66-74: `transaction_splits: { fk: "transaction_id", parent: "transactions" }` at line 67. `postings` would follow the same pattern: `{ fk: "transaction_id", parent: "transactions" }`.

**Test:** `apps/api/src/modules/system/services/backup.test.ts:38-44` asserts every `pgTable()` in the schema appears in `ALL_TABLES` and vice versa. Adding `postings` to the schema without adding it to `ALL_TABLES` fails this test.

---

## 7. TEST PATTERNS

Tests use Node's built-in `node:test` + `node:assert/strict`. No `fast-check` or property-testing library is installed anywhere in the monorepo (`grep` returned no matches in `package.json` files or imports).

The AC requires "a **property test** over generated postings" to enforce zero-sum. This means fast-check (or similar) must be added as a devDependency, or a hand-written generator loop used (simpler: Node `--test` is enough, but random generation is not built in).

Existing unit-test pattern (from `modules/ledger/services/transactions.test.ts`): pure functions are tested directly without a database. DB-backed tests (e.g. `modules/ledger/services/accounts.test.ts`) use `createPool` + `createDb` connected to the live Postgres.

---

## 8. MIGRATION MECHANICS

- **Entry point:** `apps/api/drizzle.config.ts` points to `./src/db/schema.ts`
- **Schema barrel:** `apps/api/src/db/schema.ts` re-exports every table+enum exactly once
- **Migration folder:** `apps/api/drizzle/` — latest file is `0066_eager_spectrum.sql`; new migration would be `0067_*.sql`
- **Workflow:**
  1. Edit `db/shared/ledger.ts` (drop `accountId`, `amountPaise`, `categoryId`, `necessity`, `isOpening` from `transactions`; add new `postings` table)
  2. Edit `db/shared/hubs.ts` (drop `openingBalancePaise` from `accounts`)
  3. Run `npm run db:generate` → reviews `0067_*.sql` diff
  4. Run `npm run db:migrate`
- **Note:** Since "the production database is being recreated from scratch for 2.0.0" (task spec), the migration can be destructive (no backfill path needed).

---

## SEQUENCING NOTES

**Removing `accountId`/`amountPaise` from `transactions` (and `openingBalancePaise` from `accounts`) immediately breaks the TypeScript build in:**

### API (Drizzle ORM column references — compile errors)

| File | # ORM references broken |
|---|---|
| `modules/ledger/services/accounts.ts` | 9 |
| `modules/investments/services/sip-installments.ts` | 8 |
| `modules/credit/services/emis.ts` | 5 |
| `modules/ingest/services/imports.ts` | 5 |
| `modules/ledger/services/transactions.ts` | 6 |
| `modules/credit/services/reconciliation-writes.ts` | 3 |
| `modules/planning/services/goals.ts` | 3 |
| `modules/ingest/services/transfer-classification.ts` | 3 |
| `modules/ledger/services/user-tasks.ts` | 2 |
| `modules/credit/services/cards.ts` | 1 |
| **Total ORM-column breaks** | **~45 sites across 10 files** |

Additionally, **every caller of `createTransaction`** and `updateTransaction` that passes `accountId`/`amountPaise` (7+ files) breaks because the shared `CreateTransaction`/`UpdateTransaction` types would no longer have those fields. And the shared type changes in `packages/shared` ripple into the web's 56+ references.

**Conclusion:** Removing `accountId`/`amountPaise` from `transactions` is not sequenceable against the read-path consumers in §3 — those consumers must all be converted in the same PR (or an interim dual-column state held, which the task spec explicitly rules out). The entire §3 read path and §2 write path must be updated atomically with the schema migration. The `packages/shared` type changes must land before or with the API and web simultaneously, since both import from `@compass/shared`.

The natural sequencing is therefore:
1. **2.1**: New `postings` table + `system_accounts`; strip columns from `transactions` + `accounts`; update ALL write-path callers (§2) and ALL read-path consumers (§3) in one shot; update shared types; add `postings` to `ALL_TABLES`; property test.
2. **2.2** (`transfer_links` retirement) and **2.3** (`transaction_splits` fold) become smaller follow-ons once the base model is in place.

Raw SQL queries in `lib/periods.ts`, `modules/planning/services/dashboard.ts`, `modules/planning/services/cashflow.ts`, `modules/credit/services/cards.ts`, `modules/ledger/services/balances.ts`, and `modules/ledger/services/average-balance.ts` all hardcode table/column names (`amount_paise`, `is_opening`, `transfer_links`) in template strings — these produce **runtime errors, not compile errors**, and must be part of the same changeset or they will silently return wrong numbers.
