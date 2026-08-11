# Delegation: Batch 1 — Simple production fixes (R1, R2, R3)

## Task
025 — PR-G1 remaining (batch 1 of 3)

## Context
Branch: `feat/postings-pr-g1`. The PR-G1 conversion made `postings` the authority.
`accounts.opening_balance_paise` is forced to 0 by the boot check — any read of it
is therefore dead weight and must be removed. Three groups of simple changes.

## Approved Plan
R1, R2, R3 from TASK.md (tasks/025-pr-g1-remaining/TASK.md).

## Files and Required Changes

### R1 — Remove `opening_balance_paise` addends (column is always 0 after recreate)

**`apps/api/src/modules/ledger/services/balances.ts`**

Read the file first. Find the SQL that reads `a.opening_balance_paise as opening` and
the TypeScript that computes `Number(r.opening) + postingTotal`. The column is always
0, so:
- Remove `a.opening_balance_paise as opening` from the SQL SELECT
- Change the balance computation to `Number(r.posting_total)` only (no addend)
- Remove the `opening` field from the raw-result type if it exists

**`apps/api/src/modules/ledger/services/average-balance.ts`**

Read the file. Find the SQL that reads `a.opening_balance_paise as opening_balance_paise`
and the code that uses it as `openingBalancePaise` in a `carriedIn` computation.
- Remove that SQL column from the SELECT
- Change the `carriedInPaise` (or equivalent) computation to not add `openingBalancePaise`
- The column is always 0, so removing the addend leaves the logic correct

**`apps/api/src/modules/credit/services/cards.ts`**

Read the file. Find all four expressions involving `acc.openingBalancePaise`:
- `listCardHolders` ~line 242: `acc.openingBalancePaise + Number(row.total)` → `Number(row.total)`
- `listCardHolders` ~line 249: `-(acc.openingBalancePaise + Number(row.at_close))` → `-Number(row.at_close)`
- `getCardActivity` ~line 338: `acc.openingBalancePaise + Number(agg.total)` → `Number(agg.total)`
- `getCardActivity` ~line 339: `-(acc.openingBalancePaise + Number(agg.at_close))` → `-Number(agg.at_close)`

Remove all four addends. If `acc.openingBalancePaise` is no longer used anywhere in
those functions, you may also remove its field from any query that fetches it (but only
if no other code in the same function still uses it).

### R2 — Posting-grain projection: primary-real-posting ordering

**`apps/api/src/modules/ledger/services/user-tasks.ts`**

Read the file. Find the `left join lateral` that picks a posting with
`order by p.id limit 1`. Change the order to:
`ORDER BY (p.amount_paise < 0) DESC, p.id`
(negative-first so a transfer shows the outflow leg; a single-real-posting transaction
is unaffected since there's only one non-system posting to pick).

**`apps/api/src/modules/system/services/backup.ts`**

Read the file. Find the `left join lateral` for `rp` (real posting) in `transactionsCsv`.
It currently has `order by p.id limit 1`. Change to:
`ORDER BY (p.amount_paise < 0) DESC, p.id`
Same rationale as user-tasks.ts.

**`apps/api/src/modules/investments/services/sip-installments.ts`**

Read the file. Find `linkedInstallmentRows` (around line 436). It has signature
`(db, userId, sipId)` and a `join lateral` that picks a posting with
`where p.transaction_id = t.id and a.system_kind is null order by p.id limit 1`.

The SIP's target account is available at the call site (`listSipInstallmentCandidates`
around line 524), which calls `ownedSip(db, userId, sipId)` to get `sip.targetAccountId`.

Fix:
1. Add `targetAccountId: string` as a fourth parameter to `linkedInstallmentRows`
2. Add `and p.account_id = ${targetAccountId}` to the lateral's WHERE clause
   (this restricts to the SIP's own account, so a transfer's wrong leg is never picked)
3. Remove the `order by p.id` entirely — after the account filter there is at most one
   matching posting per transaction, so the ORDER BY is unnecessary
4. Update the call site at `listSipInstallmentCandidates` (around line 544):
   `linkedInstallmentRows(db, userId, sipId)` →
   `linkedInstallmentRows(db, userId, sipId, sip.targetAccountId!)`.
   `sip.targetAccountId` is available via the `ownedSip` call just above.

### R3 — Legacy-category readers (must use counter posting, not `t.category_id`)

**`apps/api/src/modules/ingest/services/review-queue.ts`**

Read the file. Find `applyHistoryCategory` function which reads `transactions.categoryId`
and does an inner join with `categories`. The `transactions.category_id` column is always
null after PR-G1 (the category lives on the COUNTER posting, not the header). Rewrite
the query to:
- Join `postings cp` on `cp.transaction_id = t.id`
- Join `accounts ca` on `ca.id = cp.account_id AND ca.system_kind IS NOT NULL`
  (counter postings are on system accounts: Expenses or Income)
- Join `categories c` on `c.id = cp.category_id AND c.user_id = t.user_id`
- The WHERE clause stays the same (same merchant/user/date filters)
- The SELECT picks `c.id as categoryId, c.kind as kind` from the category join

If this is raw SQL (db.execute), rewrite the SQL. If it's Drizzle ORM, rewrite the
joins. Preserve the existing WHERE conditions (merchant, userId, date, deletedAt).
Add `AND ca.user_id = t.user_id` to the accounts join for tenant safety.

**`apps/api/src/modules/planning/services/bills.ts`**

Read the file. Find `suggestSubscriptions` or similar function that contains raw SQL
with `t.category_id` in the SELECT clause. Replace `t.category_id` with a subquery or
join to get the category from the counter posting:

Add to the query:
```sql
left join lateral (
  select c.id as category_id, c.name as category_name
  from postings cp
  join accounts ca on ca.id = cp.account_id and ca.system_kind is not null and ca.user_id = t.user_id
  join categories c on c.id = cp.category_id and c.user_id = t.user_id
  where cp.transaction_id = t.id
  limit 1
) cat on true
```
Then replace `t.category_id` references with `cat.category_id`.
The query already has `hasCategoryDimension()` as a filter, so this lateral won't be null.

**`apps/api/src/modules/automation/services/categorize.ts`**

Read the file. Find the raw SQL with `t.category_id is null` as a filter.
Replace that filter with:
```sql
not exists (
  select 1 from postings cp
  join accounts ca on ca.id = cp.account_id and ca.system_kind is not null
  where cp.transaction_id = t.id and cp.category_id is not null
)
```
This selects transactions whose counter posting has no category (i.e., uncategorized).

## Must Not Change
- `accounts.ts` lines other than the `listAccounts` balance computation
- `reconciliation-reads.ts` or `reconciliation-writes.ts`
- `transfer-classification.ts`
- Any test files
- Any files not listed above

## Acceptance Criteria
- `npm run typecheck` exits 0 after your changes
- `npm run lint` exits 0
- The 4 changed production files compile cleanly

## Commands
1. Read each file before editing it
2. Make the specific changes described
3. Run `npm run typecheck` and capture output + exit code
4. Run `npm run lint` and capture output + exit code

## Required Evidence
- List of files changed with a brief description of what changed
- Complete diff (`git diff`) for each changed file
- Exact output of `npm run typecheck` + exit code
- Exact output of `npm run lint` + exit code
