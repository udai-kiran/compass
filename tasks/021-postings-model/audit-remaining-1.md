# PR-G1 remaining-work audit — 2026-08-10

Files inspected (all read directly; no commands run except `find`):

- `tasks/021-postings-model/PLAN-pr-g.md`
- `tasks/021-postings-model/STATUS-pr-g1.md`
- `apps/api/src/modules/credit/services/reconciliation-writes.ts` (lines 280-320)
- `apps/api/src/modules/credit/services/reconciliation-reads.ts` (lines 1-250)
- `apps/api/src/modules/credit/services/cards.ts` (full, 396 lines)
- `apps/api/src/modules/ledger/services/balances.ts` (full)
- `apps/api/src/modules/ledger/services/accounts.ts` (full, 605 lines)
- `apps/api/src/modules/ledger/services/average-balance.ts` (full, 293 lines)
- `apps/api/src/modules/ledger/services/user-tasks.ts` (lines 85-130)
- `apps/api/src/modules/system/services/backup.ts` (lines 145-185)
- `apps/api/src/modules/investments/services/sip-installments.ts` (lines 430-465)
- `apps/api/src/modules/ingest/services/transfer-classification.ts` (lines 1-310)
- `apps/api/src/modules/ingest/services/review-queue.ts` (lines 160-200)
- `apps/api/src/modules/planning/services/bills.ts` (lines 85-115)
- `apps/api/src/modules/automation/services/categorize.ts` (lines 40-90)

---

## Item 1 — `absorbCarryover` (W8): still writes `accounts.opening_balance_paise`

**Status: OUTSTANDING**

`apps/api/src/modules/credit/services/reconciliation-writes.ts:297-305`

```
const nextOpeningBalancePaise = account.openingBalancePaise - drift;
...
await tx
  .update(accounts)
  .set({ openingBalancePaise: nextOpeningBalancePaise })
  .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
```

The carryover logic computes a drift between the issuer's stated total-due and the
ledger's own due, then patches the column. After PR-G1 the column is forced to zero
by the boot check; the carryover amount must instead adjust the credit card's Opening
transaction (same `planOpeningBalanceChange` / `postTransaction` / `buildOpeningPostings`
path that `updateAccount` now uses for bank/cash accounts).

**Coupled read in `reconciliation-reads.ts:110-143` (`ledgerDuesAtDates`)**

```typescript
export async function ledgerDuesAtDates(
  db: DbOrTx,
  userId: string,
  accountId: string,
  openingBalancePaise: number,   // <-- explicit addend parameter
  dates: readonly string[],
): Promise<Map<string, number>> {
  ...
  const ledgerDuePaise = -(openingBalancePaise + sum);  // line 143
  ...
}
```

This function accepts `openingBalancePaise` as a caller-supplied addend and adds it to
the postings sum. After the Opening transaction is moved into postings, this addend is
wrong (double-counts the opening). The signature must drop the parameter and the
caller at `reconciliation-reads.ts:181` must stop passing `acc.openingBalancePaise`.

What it should do (per plan W8 / item 4 deployment note): adjust the account's Opening
TRANSACTION via `postTransaction` + `buildOpeningPostings`, and let
`ledgerDuesAtDates` derive the full balance from postings alone.

---

## Item 2 — `opening_balance_paise` readers: all still present

**Status: OUTSTANDING (five files)**

### 2a. `balances.ts:37`
`apps/api/src/modules/ledger/services/balances.ts`

```sql
select a.id, a.name,
       a.opening_balance_paise as opening,     -- line 37
       coalesce(p.total, 0) as posting_total
from accounts a ...
```

Line 56: `const balancePaise = Number(r.opening) + postingTotal;`

The column is always 0 after PR-G1 (bank/cash already pin it there; other types will
have their opening in postings too). Remove the addend; balance = `posting_total`.

### 2b. `accounts.ts:167,218`
`apps/api/src/modules/ledger/services/accounts.ts`

`accountBalancesAtDate` (line 167): raw SQL `a.opening_balance_paise as opening`;
line 186: `Number(r.opening) + postingTotal`.

`listAccounts` (line 218): `const balancePaise = account.openingBalancePaise + sum;`

Both use the addend pattern. Remove the column read; balance = posting sum only.

### 2c. `average-balance.ts:215`
`apps/api/src/modules/ledger/services/average-balance.ts`

```sql
a.opening_balance_paise as opening_balance_paise,   -- line 215
```

Lines 263-271: `const openingBalancePaise = Number(row.opening_balance_paise);`
then `const carriedInPaise = openingBalancePaise + carriedInDelta;`

After PR-G1, `carried_in_delta` already includes the Opening transaction posting (if
any), so `openingBalancePaise` is always 0. Remove the SQL column and the addend.

### 2d. `cards.ts:242,249,338,339`
`apps/api/src/modules/credit/services/cards.ts`

`listCardHolders` lines 242, 249:
```typescript
const balance = acc.openingBalancePaise + Number(row.total);       // 242
const owedAtClose = -(acc.openingBalancePaise + Number(row.at_close)); // 249
```

`getCardActivity` lines 338-339:
```typescript
const balancePaise = acc.openingBalancePaise + Number(agg.total);        // 338
const owedAtClose = -(acc.openingBalancePaise + Number(agg.at_close));   // 339
```

Remove the `acc.openingBalancePaise` addend in all four expressions.

### 2e. `reconciliation-reads.ts:143,181`
(Covered in Item 1 above — the `openingBalancePaise` parameter to `ledgerDuesAtDates`.)

---

## Item 3 — Posting-grain projection: `order by p.id limit 1` in three files

**Status: OUTSTANDING**

### 3a. `user-tasks.ts:99-106`
`apps/api/src/modules/ledger/services/user-tasks.ts`

```sql
left join lateral (
  select p.account_id, p.amount_paise
  from postings p
  join accounts a on a.id = p.account_id
  where p.transaction_id = t.id and a.system_kind is null
  order by p.id        -- arbitrary for a transfer
  limit 1
) rp on t.id is not null
```

For a transfer (two real postings), `p.id` ordering is arbitrary — picks whichever leg
was inserted first. Per plan item 5, a global list must project the **primary real
posting** (non-system account; for a transfer, the outflow/negative leg).
Fix: add `order by p.id` → `order by (p.amount_paise < 0) desc, p.id` or use
`primaryRealLeg`-equivalent SQL (system_kind is null, then negative-first).

### 3b. `backup.ts:157-165`
`apps/api/src/modules/system/services/backup.ts`

```sql
left join lateral (
  select p.amount_paise, a.name as account
  from postings p
  join accounts a on a.id = p.account_id
                 and a.user_id = t.user_id
                 and a.system_kind is null
  where p.transaction_id = t.id
  order by p.id        -- arbitrary for a transfer
  limit 1
) rp on true
```

Same problem as user-tasks.ts. CSV export of a transfer would show either the debit
or the credit leg depending on insertion order, not the outflow. Fix: primary real
posting projection (negative-first tiebreak).

### 3c. `sip-installments.ts:444-451`
`apps/api/src/modules/investments/services/sip-installments.ts`

```sql
join lateral (
  select p.amount_paise
  from postings p
  join accounts a on a.id = p.account_id
  where p.transaction_id = t.id and a.system_kind is null
  order by p.id        -- arbitrary for a transfer
  limit 1
) rp on true
```

SIP installment amounts are used to populate the installment history panel.  
Per plan item 5: account-scoped readers should use `legForAccount` — filter on the
SIP's target account — rather than a global non-system limit. The current query does
not restrict to the SIP's account, so a SIP installment that was transferred in
could show the wrong leg.
Fix: add `and p.account_id = <sip_target_account_id>` (requires the target account
id to be available in this query — it is accessible via the SIP row's
`target_account_id`).

---

## Item 4 — Legacy-column readers still to convert

**Status: OUTSTANDING (five locations)**

### 4a. `transfer-classification.ts` repayment candidate query (lines 235-249)
`apps/api/src/modules/ingest/services/transfer-classification.ts`

```typescript
const candidates = await tx
  .select({ id: transactions.id })
  .from(transactions)
  .where(
    and(
      eq(transactions.userId, userId),
      eq(transactions.accountId, input.fromAccountId),   // forbidden: account_id
      eq(transactions.amountPaise, -claimed.amountPaise), // forbidden: amount_paise
      isNull(transactions.deletedAt),
      eq(transactions.isOpening, false),                  // forbidden: is_opening
      sql`abs(${transactions.date} - ${input.occurredAt}::date) <= ${TRANSFER_WINDOW_DAYS}`,
      sql`not exists (select 1 from ${transferLinks} tl   // forbidden: transfer_links
        where tl.out_transaction_id = ${transactions.id} or tl.in_transaction_id = ${transactions.id})`,
    ),
  );
```

Four forbidden reads: `transactions.accountId`, `transactions.amountPaise`,
`transactions.isOpening`, and the `transferLinks` join.

What it should do: query via postings.  
- Replace `transactions.accountId` with `exists (select 1 from postings p where
  p.transaction_id = transactions.id and p.account_id = input.fromAccountId and
  p.amount_paise < 0)` (a debit on the paying account).
- Replace `transactions.amountPaise` with the posting's amount.
- Replace `transactions.isOpening` with `not exists (select 1 from postings p
  join accounts a on a.id = p.account_id where p.transaction_id = transactions.id
  and a.system_kind = 'opening')` (no Opening system account posting).
- Replace `transferLinks` existence check with `not exists (select 1 from postings p
  join accounts a on a.id = p.account_id where p.transaction_id = transactions.id
  and a.system_kind = 'clearing')` — or simply check that `transactions` has exactly
  two non-system postings (transfer shape) vs one (ordinary shape).
  Actually, after PR-G1 a transfer is one header, so `isTransfer` is determined by
  `classifyShape`'s two-real-posting test. The guard is "not already a transfer".

### 4b. `review-queue.ts:179`
`apps/api/src/modules/ingest/services/review-queue.ts`

```typescript
const rows = await db
  .select({
    merchant: transactions.merchant,
    categoryId: transactions.categoryId,   // line 179 — forbidden: category_id
    kind: categories.kind,
    date: transactions.date,
  })
  .from(transactions)
  .innerJoin(categories, eq(categories.id, transactions.categoryId)) // forbidden
  ...
```

`applyHistoryCategory` looks up past categories by merchant to pre-fill suggestions.
After PR-G1, `transactions.category_id` is always null (projection writer writes null
per plan). Must instead join through the counter posting's `category_id`:

```sql
select t.merchant, cp.category_id, c.kind, t.date
from transactions t
join postings cp on cp.transaction_id = t.id
join accounts ca on ca.id = cp.account_id and ca.system_kind is not null
join categories c on c.id = cp.category_id
where ...
```

### 4c. `bills.ts:95`
`apps/api/src/modules/planning/services/bills.ts`

```sql
select t.merchant, t.date, p.amount_paise, a.id as account_id, t.category_id
from postings p
join accounts a on a.id = p.account_id
join transactions t on t.id = p.transaction_id
where t.user_id = ${userId} and t.deleted_at is null
  and p.amount_paise < 0
  and t.merchant <> ''
  and t.date >= current_date - interval '400 days'
  and a.system_kind is null
  and ${hasCategoryDimension()}
```

`t.category_id` is projected but category is always null on the header after PR-G1.
The query uses `hasCategoryDimension()` as a WHERE guard (which checks counter
postings), so the intent is to return categorized spends. The `category_id` column
must be replaced by a subquery or join to the counter posting's category.

### 4d. `categorize.ts:56`
`apps/api/src/modules/automation/services/categorize.ts`

```sql
where t.user_id = ${userId} and t.deleted_at is null and t.category_id is null
  and a.system_kind is null
```

`t.category_id is null` filters for uncategorized transactions. After PR-G1
`category_id` is always null on the header, so this filter passes everything — the
gate predicate is now `not exists (select 1 from postings cp join accounts ca ...
where ca.system_kind is not null and cp.category_id is not null)`.

### 4e. `accounts.ts` opening reconciliation and delete guard
`apps/api/src/modules/ledger/services/accounts.ts`

`updateAccount` lines 441-450 (opening reconciliation):
```typescript
const existingRow = await tx.query.transactions.findFirst({
  where: and(
    eq(transactions.accountId, id),     // forbidden: account_id
    eq(transactions.userId, userId),
    eq(transactions.isOpening, true),   // forbidden: is_opening
    isNull(transactions.deletedAt),
  ),
  ...
});
```

`updateAccount` lines 454-460 (earliest date for insert position):
```typescript
await tx
  .select({ min: sql<string | null>`min(${transactions.date})` })
  .from(transactions)
  .where(
    and(
      eq(transactions.accountId, id),   // forbidden: account_id
      eq(transactions.userId, userId),
      eq(transactions.isOpening, false), // forbidden: is_opening
      isNull(transactions.deletedAt),
    ),
  );
```

`deleteAccount` lines 581-584 (account-in-use guard):
```typescript
const used = await tx.query.transactions.findFirst({
  where: eq(transactions.accountId, id),  // forbidden: account_id
});
```

These must switch to posting-based lookups:
- Find the Opening transaction: query via `postings p join accounts a on a.id =
  p.account_id where a.system_kind = 'opening' and p.transaction_id in (select id
  from transactions where user_id = userId)` filtered by posting on `id`.
- Earliest non-opening date: same — find transactions that have a posting on `id`
  without an Opening system account posting.
- Delete guard: `exists (select 1 from postings p where p.account_id = id)`.

---

## Summary table

| # | File (path abbreviated) | Lines | Status | What it reads |
|---|-------------------------|-------|--------|---------------|
| 1 | `credit/services/reconciliation-writes.ts` | 297-305 | OUTSTANDING | writes `accounts.opening_balance_paise` |
| 1b | `credit/services/reconciliation-reads.ts` | 110-143, 181 | OUTSTANDING | addend param `openingBalancePaise` |
| 2a | `ledger/services/balances.ts` | 37, 56 | OUTSTANDING | reads `a.opening_balance_paise` |
| 2b | `ledger/services/accounts.ts` | 167, 218 | OUTSTANDING | reads `a.opening_balance_paise` |
| 2c | `ledger/services/average-balance.ts` | 215, 263-271 | OUTSTANDING | reads `a.opening_balance_paise` |
| 2d | `credit/services/cards.ts` | 242, 249, 338, 339 | OUTSTANDING | reads `acc.openingBalancePaise` |
| 3a | `ledger/services/user-tasks.ts` | 99-106 | OUTSTANDING | `order by p.id limit 1` |
| 3b | `system/services/backup.ts` | 157-165 | OUTSTANDING | `order by p.id limit 1` |
| 3c | `investments/services/sip-installments.ts` | 444-451 | OUTSTANDING | `order by p.id limit 1` |
| 4a | `ingest/services/transfer-classification.ts` | 235-249 | OUTSTANDING | `transactions.accountId/amountPaise/isOpening`, `transferLinks` |
| 4b | `ingest/services/review-queue.ts` | 176-184 | OUTSTANDING | `transactions.categoryId` |
| 4c | `planning/services/bills.ts` | 95 | OUTSTANDING | raw SQL `t.category_id` |
| 4d | `automation/services/categorize.ts` | 56 | OUTSTANDING | raw SQL `t.category_id is null` |
| 4e | `ledger/services/accounts.ts` | 441-460, 581-584 | OUTSTANDING | `transactions.accountId`, `transactions.isOpening` |

**Nothing in the brief was already fixed.** Every item listed in STATUS-pr-g1.md
"Remaining" §1-4 is confirmed outstanding by direct code read.

---

## One additional coupling not in the STATUS

`reconciliation-reads.ts:181` passes `acc.openingBalancePaise` to `ledgerDuesAtDates`.
This is the only external caller — once `absorbCarryover` (item 1) is fixed and
`ledgerDuesAtDates` drops its parameter, this call site changes simultaneously.
Both files must be updated in the same commit or one breaks the other.
