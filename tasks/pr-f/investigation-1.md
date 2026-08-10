# PR-F Investigation: Postings Model as it exists on main (2026-08-10)

## Files Inspected

- `apps/api/src/db/shared/ledger.ts` — postings + transactions schema
- `apps/api/src/db/shared/hubs.ts` — accounts schema (system_kind, opening_balance_paise)
- `apps/api/drizzle/0067_illegal_shocker.sql` — migration that added postings
- `apps/api/src/modules/ledger/services/postings.ts` — shared builder/classifier helpers
- `apps/api/src/modules/ledger/services/post-entry.ts` — replacePostings, seedSystemAccounts, resolveSystemAccounts
- `apps/api/src/modules/ledger/services/transactions.ts` — createTransaction, updateTransaction, computePostingDraftsForTransaction, rebuildPostingsForTransaction
- `apps/api/src/modules/ledger/services/transfers.ts` — linkTransfer, createTransfer
- `apps/api/src/modules/ledger/services/reconcile-postings.ts` — reconcileUserPostings
- `apps/api/src/modules/ledger/services/balances.ts` — bankCashBalances (PR-B reader)
- `apps/api/src/lib/periods.ts` — spentByCategory, spendByNecessity, incomeExpense (PR-C readers)
- `apps/api/src/modules/planning/services/dashboard.ts` — getTrends (PR-D reader)
- `apps/api/src/modules/ledger/services/user-tasks.ts` — TASK_LATERAL_QUERY (PR-E reader)
- `apps/api/src/modules/investments/services/sip-installments.ts` — linkedInstallmentRows / unlinkedInstallmentRows (PR-E readers)
- `apps/api/src/modules/credit/services/reconciliation-reads.ts` — ledgerDuesAtDates (PR-E reader)
- `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES, LINKED_TABLES, transactionsCsv
- `apps/api/src/modules/system/services/prefs.ts` — evaluateLargeTransactions (PR-E reader)
- `apps/extractor/src/db.ts` — still reads legacy transactions.amount_paise / account_id (PR-F target)
- `tasks/021-postings-model/TASK.md` — postings model task + PR-A..PR-E status
- `tasks/021-postings-model/PLAN-dualwrite.md` — dual-write strategy and PR-F / PR-G plan

---

## Q1 — The `postings` table definition

**Physical definition:** `apps/api/src/db/shared/ledger.ts` lines 132–153

```
postings (
  id                uuid    PRIMARY KEY DEFAULT gen_random_uuid()   NOT NULL
  transaction_id    uuid    NOT NULL   FK → transactions(id) ON DELETE CASCADE
  account_id        uuid    NOT NULL   FK → accounts(id)
  category_id       uuid    nullable   FK → categories(id)
  amount_paise      bigint  NOT NULL
  necessity         expense_necessity  nullable  (enum: 'need'/'want')
  note              text    NOT NULL  DEFAULT ''
  created_at        timestamptz NOT NULL DEFAULT now()
)
```

**Indexes** (from migration `0067_illegal_shocker.sql`):
- `postings_tx_idx` btree on `(transaction_id)`
- `postings_account_idx` btree on `(account_id)`
- `postings_category_idx` btree on `(category_id)`

No unique constraint on postings themselves. No `user_id` column (scoped through parent `transactions.user_id`).

**Related enum added in same migration:**
```sql
CREATE TYPE "public"."account_system_kind" AS ENUM('expenses', 'income', 'opening', 'clearing');
ALTER TYPE "public"."account_type" ADD VALUE 'system';
```

The `accounts` table gained a `system_kind account_system_kind` nullable column, with a unique partial index `accounts_system_kind_idx` on `(user_id, system_kind) WHERE system_kind IS NOT NULL`.

---

## Q2 — The `transactions` table definition today

**Physical definition:** `apps/api/src/db/shared/ledger.ts` lines 23–125

All legacy columns **still exist** and are **NOT NULL** (dual-write is still active; columns not dropped until PR-G):

| Column | Type | Nullability | Notes |
|---|---|---|---|
| `id` | uuid | NOT NULL PK | |
| `user_id` | uuid | NOT NULL | FK → users |
| `account_id` | uuid | NOT NULL | FK → accounts — LEGACY, still NOT NULL |
| `date` | date | NOT NULL | |
| `occurred_at` | timestamptz | nullable | |
| `amount_paise` | bigint | NOT NULL | LEGACY, still NOT NULL |
| `merchant` | text | NOT NULL DEFAULT '' | |
| `category_id` | uuid | nullable | FK → categories |
| `necessity` | expense_necessity | nullable | |
| `notes` | text | NOT NULL DEFAULT '' | |
| `tags` | text[] | NOT NULL DEFAULT '{}' | |
| `source` | transaction_source | NOT NULL DEFAULT 'manual' | |
| `is_opening` | boolean | NOT NULL DEFAULT false | LEGACY marker |
| `policy_id` | uuid | nullable | FK → insurance_policies ON DELETE SET NULL |
| `resource_id` | uuid | nullable | FK → resources ON DELETE SET NULL |
| `sip_id` | uuid | nullable | FK → sips ON DELETE SET NULL |
| `recurring_template_id` | uuid | nullable | FK → recurring_templates ON DELETE SET NULL |
| `reconciled_statement_id` | uuid | nullable | FK → statement_reconciliations ON DELETE SET NULL |
| `deleted_at` | timestamptz | nullable | soft-delete timestamp |
| `created_at` | timestamptz | NOT NULL DEFAULT now() | |
| `updated_at` | timestamptz | NOT NULL DEFAULT now() | |

No comment in code marks `amount_paise` or `account_id` as deprecated — they are still the primary write surface, with postings mirroring them atomically. No column has been dropped.

Similarly, `accounts.opening_balance_paise` (bigint NOT NULL DEFAULT 0, `apps/api/src/db/shared/hubs.ts` line 99–101) still exists and is used as an explicit addend in balance readers through PR-F (per Q3 ruling in PLAN-dualwrite.md).

---

## Q3 — Dual-write writers

### How dual-write works

Every legacy write goes through one of two paths in `apps/api/src/modules/ledger/services/`:

**Path A — `replacePostings`** (`post-entry.ts:49–82`): called with a pre-computed `PostingDraft[]`. Verifies zero-sum, verifies transaction + account + category ownership, deletes all existing postings for the transaction, inserts the new set. Must be called on the SAME `DbOrTx` handle as the legacy write (ATOMICITY LAW).

**Path B — `rebuildPostingsForTransaction`** (`transactions.ts:282–286`): re-reads the transaction row + splits from DB, calls `computePostingDraftsForTransaction` to derive the canonical shape, then calls `replacePostings`. Used by `updateTransaction`, `setSplits`, `bulkAction` after the legacy write.

### `computePostingDraftsForTransaction` (`transactions.ts:201–264`)

The shape-selection logic (line 213–263):
1. If `row.isOpening === true` → `buildOpeningPostings` (1 real + 1 Opening system posting)
2. Else if row has a `transfer_links` membership → `buildTransferLegPostings` (1 real + 1 Clearing posting per legacy leg)
3. Else if `transaction_splits` rows exist → `buildSplitPostings` (1 real + N Expenses/Income postings)
4. Else → `buildOrdinaryPostings` (1 real + 1 Expenses or Income posting)

### `createTransaction` (`transactions.ts:376–426`)

Lines 407–424 (dual-write pattern):
```typescript
// line 407–424 (decisive excerpt)
const rows = await db.transaction(async (t) => {
  const inserted = await t.insert(transactions).values({ ...input, merchant, userId }).returning();
  const newRow = inserted[0]!;
  const systemAccounts = await resolveSystemAccounts(t, userId);
  const drafts = buildOrdinaryPostings({
    accountId: newRow.accountId,
    amountPaise: newRow.amountPaise,
    categoryId: newRow.categoryId,
    necessity: newRow.necessity,
    systemExpensesAccountId: systemAccounts.expenses,
    systemIncomeAccountId: systemAccounts.income,
  });
  await replacePostings(t, newRow.id, userId, drafts);
  return inserted;
});
```

**Invariant for ordinary transaction:** 2 posting rows. Real posting = `[accountId: +/- amountPaise]`. System counter posting = `[expenses|income: -(amountPaise), categoryId, necessity]`. Sum = 0.

### `updateTransaction` (`transactions.ts:428–518`)

Lines 491–502 (decisive excerpt): after the legacy update, calls `await rebuildPostingsForTransaction(t, userId, id)` inside the same `db.transaction()` — covers account/amount/category/necessity changes uniformly.

### Transfer writers (`transfers.ts`)

`linkTransfer` and `createTransfer` call `rebuildPostingsForTransaction` on both legs inside one transaction, so each leg gets a `[real: ±X] + [Clearing: ∓X]` pair. Two legacy rows remain; their postings each balance independently at zero; the Clearing account nets to zero across the pair.

### Other confirmed dual-write points

- `setSplits` → `rebuildPostingsForTransaction`
- `bulkAction` (restore/setCategory) → `rebuildPostingsForTransaction`
- `recurring.ts` EMI materialization → `createTransaction` (two separate calls → two independent posting families; NOT collapsed to a transfer)
- `accounts.ts` createAccount/updateAccount → `rebuildPostingsForTransaction` for opening-balance transactions
- `insurance.ts`, `epf-contributions.ts`, `imports.ts` (commit), `review-actions.ts`, `demo.ts`, `seed.ts` — all route through `createTransaction` or explicit `replacePostings`

---

## Q4 — Already-converted readers (PR-B/C/D/E canonical shapes)

### Shape 1: Expense spend and necessity (PR-C — `lib/periods.ts`)

`spentByCategory` (lines 64–94) — canonical expense query:
```sql
select p.category_id as cid, sum(p.amount_paise)::bigint as spent
from postings p
join accounts a on a.id = p.account_id
join transactions t on t.id = p.transaction_id
where t.user_id = ${userId}
  and t.deleted_at is null
  and t.date >= ${from} and t.date <= ${to}
  and a.system_kind = 'expenses'        -- Expenses system account postings only
  and p.amount_paise > 0                -- positive = spend (Expenses counter is negated)
  and not exists (                       -- exclude transfers (Clearing leg present)
    select 1 from postings p2
    join accounts a2 on a2.id = p2.account_id
    where p2.transaction_id = t.id and a2.system_kind = 'clearing'
  )
group by p.category_id
```

Opening rows are implicitly excluded: an opening transaction uses the `Opening` system account, not `Expenses`, so no `Expenses` posting → zero rows matched.

### Shape 2: Income/expense aggregates (PR-C — `lib/periods.ts`)

`incomeExpense` (lines 198–231) — real-posting anchor:
```sql
select
  coalesce(sum(case when p.amount_paise > 0 and a.type not in (${LIABILITY_TYPES_SQL}) then p.amount_paise else 0 end), 0)::bigint as income,
  coalesce(sum(case when p.amount_paise < 0 then -p.amount_paise else 0 end), 0)::bigint as expense
from postings p
join accounts a on a.id = p.account_id
join transactions t on t.id = p.transaction_id
where t.user_id = ${userId}
  and t.deleted_at is null
  and t.date >= ${from} and t.date <= ${to}
  and a.system_kind is null             -- real accounts only (not system)
  and not exists (
    select 1 from postings p2
    join accounts a2 on a2.id = p2.account_id
    where p2.transaction_id = t.id
      and a2.system_kind in ('clearing', 'opening')  -- exclude transfers AND openings
  )
```

### Shape 3: Balance reader (PR-B — `modules/ledger/services/balances.ts`)

`bankCashBalances` (lines 35–61):
```sql
select a.id, a.name,
       a.opening_balance_paise as opening,         -- explicit addend (PR-F/PR-G boundary)
       coalesce(p.total, 0) as posting_total
from accounts a
left join (
  select po.account_id, sum(po.amount_paise) as total
  from postings po
  join transactions t on t.id = po.transaction_id
  where t.user_id = ${userId} and t.deleted_at is null and t.date <= ${asOf}
  group by po.account_id
) p on p.account_id = a.id
where a.user_id = ${userId} and a.archived_at is null and a.type in ('bank', 'cash')
```
Balance = `opening_balance_paise + posting_total`. The posting sum over ALL posting rows for the account (real + system) but only postings on real account_ids are included since system accounts are different rows. NOTE: the subquery uses ALL postings for the account regardless of which account they are on — but `po.account_id = a.id` narrows to the real account's rows only, which includes the `is_opening` transaction's opening posting.

### Shape 4: Row-level real-posting LATERAL (PR-E — `modules/ledger/services/user-tasks.ts`)

`TASK_LATERAL_QUERY` (lines 84–105):
```sql
left join lateral (
  select p.account_id, p.amount_paise
  from postings p
  join accounts a on a.id = p.account_id
  where p.transaction_id = t.id and a.system_kind is null   -- first real posting
  order by p.id
  limit 1
) rp on t.id is not null
```
Derives `(accountId, amountPaise)` for the DTO from the first real (non-system) posting via LATERAL. Same pattern used in `linkedInstallmentRows` (`sip-installments.ts:441–455`).

### Shape 5: Reconciliation — account-specific postings (PR-E — `modules/credit/services/reconciliation-reads.ts`)

`ledgerDuesAtDates` (lines 124–137):
```sql
left join (
  select p.amount_paise, t.date
  from postings p
  join transactions t on t.id = p.transaction_id
  where p.account_id = ${accountId}          -- filter by specific real account
    and t.user_id = ${userId}
    and t.deleted_at is null
) sub on sub.date < ds.stmt_date
```
Sums ALL postings for a specific real account (no system_kind filter needed here because system accounts have different ids — the `p.account_id = accountId` already scopes to the real account).

### Shape 6: Planning aggregates (PR-D — `modules/planning/services/dashboard.ts`)

`getTrends` (lines 63–80):
```sql
from postings p
join accounts a on a.id = p.account_id
join transactions t on t.id = p.transaction_id
where t.user_id = ${userId} and t.deleted_at is null
  and t.date >= ${from} and t.date <= ${to}
  and a.system_kind is null                        -- real accounts only
  and not exists (
    select 1 from postings p2
    join accounts a2 on a2.id = p2.account_id
    where p2.transaction_id = t.id
      and a2.system_kind in ('clearing', 'opening')  -- exclude transfers + openings
  )
```

---

## Q5 — Transfers / multi-leg transactions

**Current dual-write shape (transitional, PR-A through PR-F):** A transfer is STILL TWO separate `transactions` rows linked by `transfer_links`. Each legacy row gets its OWN zero-sum posting pair:
- Out-leg: `[fromAccount: -X] + [Clearing: +X]`
- In-leg:  `[toAccount: +X] + [Clearing: -X]`

There is NO discriminator column on `postings` itself (no `kind`/`role`/`leg` column). Transfer detection by readers is done at the transaction level: if a transaction has ANY posting on an account with `system_kind = 'clearing'`, that transaction is treated as a transfer leg.

**How converted readers avoid double-counting:**
```sql
and not exists (
  select 1 from postings p2
  join accounts a2 on a2.id = p2.account_id
  where p2.transaction_id = t.id and a2.system_kind = 'clearing'
)
```
This NOT EXISTS guard is consistently applied in every aggregation reader (periods.ts, dashboard.ts, prefs.ts) to exclude both legs of a transfer. Account-balance readers do not need this guard because they sum ALL postings by `account_id`, and the Clearing postings on each leg cancel naturally when the Clearing account itself is excluded from the result set.

**Future shape (PR-G):** Transfers will be collapsed to ONE transaction with TWO real postings and no system posting. The Clearing account is transitional infrastructure (PLAN-dualwrite.md Q4).

---

## Q6 — Soft deletes

**`transactions.deleted_at`:** postings are RETAINED on soft-deleted transactions. Readers exclude soft-deleted transactions via `t.deleted_at is null` on the `transactions` join, which implicitly excludes their postings from aggregations. Postings themselves have no `deleted_at` column.

**Evidence from `reconcile-postings.ts:80`:**
```typescript
const ids = await db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, userId));
// NO deleted_at filter
```
The reconciler processes ALL transactions including soft-deleted ones, confirming postings are retained and reconciled even for deleted rows.

**Summary:** Postings have no `deleted_at`. All readers join back to `transactions` and filter `t.deleted_at is null`. Soft-delete only toggles the parent row's flag; postings stay for audit/restore.

---

## Q7 — Shared helper modules for postings queries

### `modules/ledger/services/postings.ts`

**Exports:**
- `interface PostingDraft` — `{ accountId, amountPaise, categoryId, necessity, note }`
- `type SystemKind = "expenses" | "income" | "opening" | "clearing"`
- `class PostingShapeError extends Error`
- `function assertSafePaise(n: number): void`
- `function sumPaise(amounts: readonly number[]): number`
- `function assertZeroSum(postings: readonly Pick<PostingDraft, "amountPaise">[]): void`
- `function buildOrdinaryPostings(input): PostingDraft[]`
- `function buildSplitPostings(input): PostingDraft[]`
- `function buildTransferPostings(input): PostingDraft[]` — future single-header shape
- `function buildOpeningPostings(input): PostingDraft[]`
- `function buildTransferLegPostings(input): PostingDraft[]` — current dual-write Clearing shape
- `function classifyShape(postings, systemKindOf): "ordinary"|"split"|"transfer"|"opening"`
- `function projectRealLeg(postings, systemKindOf): { accountId, amountPaise }`
- `function projectCounter(postings, systemKindOf): { categoryId, necessity }`
- `function projectSplits(postings, systemKindOf): Array<{ categoryId, amountPaise, note }>`

### `modules/ledger/services/post-entry.ts`

**Exports:**
- `interface ResolvedSystemAccounts` — `{ expenses, income, opening, clearing }`
- `interface PostEntryHeader` — patch shape for header-only updates
- `function replacePostings(db, transactionId, userId, drafts): Promise<void>`
- `function updateTransactionHeader(db, transactionId, patch): Promise<void>`
- `function seedSystemAccounts(db, userId): Promise<void>`
- `function resolveSystemAccounts(db, userId): Promise<ResolvedSystemAccounts>`

### `modules/ledger/services/transactions.ts`

**Exports relevant to PR-F:**
- `function computePostingDraftsForTransaction(t, userId, id, systemAccounts?): Promise<PostingDraft[] | null>`
- `function rebuildPostingsForTransaction(t, userId, id): Promise<void>`

### `modules/ledger/services/reconcile-postings.ts`

**Exports:**
- `function reconcileUserPostings(db, userId): Promise<{ checked, repaired, failures }>`
- `function reconcileAllPostings(db): Promise<...>`
- `function findInconsistentPostings(db, userId?): Promise<...>`

PR-F should reuse `replacePostings`, `resolveSystemAccounts`, `buildOrdinaryPostings`/`buildTransferLegPostings`/etc from `postings.ts` and `post-entry.ts` for any write-path changes, and follow the SQL patterns from the already-converted readers above for any read-path changes.

---

## Q8 — Roadmap / plan document for PR-F

**Primary document:** `tasks/021-postings-model/PLAN-dualwrite.md`, line 58:

> **PR-F:** extractor `apps/extractor/src/db.ts` → postings; backup CSV derives from postings.

**Also mentioned in:**
- `tasks/021-postings-model/TASK.md` lines 8 and 11 (PLAN-dualwrite.md reference)
- `tasks/021-postings-model/review-5.md` line 141: "CSV conversion can remain here [PR-F], but JSON archive/restore compatibility cannot; that portion belongs in PR-A."
- `tasks/021-postings-model/PLAN-pr-e.md` line 558: "Converting extractor DB reads (PR-F scope)."
- `tasks/021-postings-model/PLAN-pr-d.md` line 464: "No conversion of backup/restore/extractor (PR-F)."
- `tasks/021-postings-model/PLAN-dualwrite.md` Q3 (line 70): "reader special-case `opening_balance_paise` until PR-F; synthesize Opening rows + drop column atomically at PR-G."

**No dedicated `PLAN-pr-f.md` file exists yet.** The full PR-F description from PLAN-dualwrite.md line 58, verbatim:

> **PR-F:** extractor `apps/extractor/src/db.ts` → postings; backup CSV derives from postings.

This is the complete PR-F description as currently recorded. No separate `PLAN-pr-f.md` has been created.

---

## Q9 — Backfill state

**Migration `0067_illegal_shocker.sql`** is purely additive — it creates the `postings` table and adds `accounts.system_kind`, but contains **no backfill SQL**. It does not insert any posting rows for pre-existing transactions.

**Backfill mechanism:** A runtime `reconcileAllPostings` function (`reconcile-postings.ts:122–140`) was written to do compare-first repair of all transactions. This is the "idempotent full-shape reconciliation run" described in PLAN-dualwrite.md §"Deployment / backfill protocol" (step 3). It runs as a startup/maintenance step before the new binary serves traffic.

**Critical question — can a non-deleted transaction exist with zero posting rows?**

YES, this was true during the migration window. PLAN-dualwrite.md confirms (step 3): "for EVERY applicable transaction, rebuild-and-compare its EXPECTED posting shape... this repairs BOTH missing postings (old-binary inserts)." The reconciler (`reconcileUserPostings`) processes ALL transactions (no `deleted_at` filter) and calls `replacePostings` only when there is drift.

**Evidence the backfill is idempotent/required (not a one-time event):** The `reconcile-postings.ts` module is a production service, not a migration script. This means the deployment sequence — not a migration — populates backfilled postings. On a live production system where the binary has been updated and the reconciler has run, every transaction (deleted or active) should have postings. However, there is no DB-level guarantee (no NOT NULL foreign key saying "every transaction must have at least one posting") — the constraint is application-enforced.

**INFERENCE:** On a freshly migrated production system (migration applied + binary upgraded + reconciler run), every non-deleted transaction should have exactly 2+ posting rows. But the schema itself allows zero. A transaction inserted before the new binary was deployed (old-binary insert during the rolling deploy window) would have zero postings until the reconciler ran. The reconciler is the belt-and-suspenders guard for this, not a constraint.

---

## Summary of the canonical posting-read shape

The canonical shape used by all PR-B/C/D/E converted readers is:

```sql
from postings p
join accounts a on a.id = p.account_id     -- to get system_kind
join transactions t on t.id = p.transaction_id  -- for user scoping + deleted_at + date
where t.user_id = $userId
  and t.deleted_at is null                -- soft-delete filter ALWAYS on transactions
  [and a.system_kind is null]             -- for real-posting queries (balance, income/expense)
  [and a.system_kind = 'expenses']        -- for spend-category queries
  and not exists (                         -- to exclude transfers
    select 1 from postings p2
    join accounts a2 on a2.id = p2.account_id
    where p2.transaction_id = t.id and a2.system_kind = 'clearing'
  )
  [and not exists (...system_kind = 'opening')]  -- to exclude opening rows in some queries
```

For row-level (per-transaction) amount derivation, use LATERAL:
```sql
left join lateral (
  select p.account_id, p.amount_paise
  from postings p
  join accounts a on a.id = p.account_id
  where p.transaction_id = t.id and a.system_kind is null
  order by p.id
  limit 1
) rp on [condition]
```

PR-F must match this shape exactly for extractor `db.ts` and `backup.ts:transactionsCsv`.
