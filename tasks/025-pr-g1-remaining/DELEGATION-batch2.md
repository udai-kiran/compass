# Delegation: Batch 2 — Complex production fixes (R4, R5, R6)

## Task
025 — PR-G1 remaining (batch 2 of 3)

## Context
Branch: `feat/postings-pr-g1`. The PR-G1 conversion made `postings` the authority.
This batch handles the three complex remaining production changes that require
careful postings-based query construction.

## Background facts (verified, do not re-derive)
- Opening transactions are identified by having a posting on an account with `system_kind = 'opening'`
  AND a posting on the real account. The real-leg posting amount IS the opening balance.
- `buildOpeningPostings({ accountId, amountPaise, systemOpeningAccountId })` builds the two drafts.
- `postTransaction(db, txnId, userId, drafts)` applies them atomically.
- `planOpeningBalanceChange({ type, requestedPaise, existing, earliestTxnDate, today })` determines
  the action: insert | update | delete | none.
- `carriesOpeningAsTransaction` currently returns `true` only for bank/cash. After PR-G1,
  ALL account types carry their opening balance as an Opening transaction (D10: "all types unified").
- `ledgerDuesAtDates` currently takes `openingBalancePaise: number` as a 4th parameter.
  After the fix, it must drop that parameter — the Opening posting is already in the
  postings sum, so passing the column addend would double-count it.

## Files and Required Changes

### R1b — `accounts.ts:218` `listAccounts` balance computation

Read the file. Find `listAccounts` (or `accountBalancesAtDate`) around line 218 that
computes `const balancePaise = account.openingBalancePaise + sum`. Change this to
`const balancePaise = sum`. The column is always 0 after PR-G1.

### R4 — Opening model completion in `accounts.ts`

**Read the full file: `apps/api/src/modules/ledger/services/accounts.ts`**

**(a) `carriesOpeningAsTransaction` (line ~22):**
Change from:
```typescript
function carriesOpeningAsTransaction(type: AccountType): boolean {
  return type === "bank" || type === "cash";
}
```
To:
```typescript
function carriesOpeningAsTransaction(_type: AccountType): boolean {
  return true;
}
```
All account types now produce an Opening transaction when `openingBalancePaise !== 0`.

**(b) `updateAccount` Opening transaction discovery (lines ~441-460):**
Currently uses `eq(transactions.accountId, id)` and `eq(transactions.isOpening, true/false)`.
These are forbidden legacy-column reads. Replace with postings-based EXISTS predicates.

Replace the `existingRow` query:
```typescript
const existingRow = await tx.query.transactions.findFirst({
  where: and(
    eq(transactions.accountId, id),
    eq(transactions.userId, userId),
    eq(transactions.isOpening, true),
    isNull(transactions.deletedAt),
  ),
  orderBy: (t, { asc }) => [asc(t.date), asc(t.id)],
  columns: { id: true, amountPaise: true },
});
```
With:
```typescript
const [existingRow] = await tx.execute(sql`
  select t.id, t.amount_paise
  from transactions t
  where t.user_id = ${userId}
    and t.deleted_at is null
    and exists (
      select 1 from postings p
      join accounts a_sys on a_sys.id = p.account_id and a_sys.system_kind = 'opening'
      where p.transaction_id = t.id
    )
    and exists (
      select 1 from postings p2
      where p2.transaction_id = t.id and p2.account_id = ${id}
    )
  order by t.date asc, t.id asc
  limit 1
`) as { rows: Array<{ id: string; amount_paise: number }> };
```
Then adapt the rest of the code to use `existingRow?.id` and `existingRow?.amount_paise`.

Replace the `earliest` date query:
```typescript
const earliest = await tx
  .select({ min: sql<string | null>`min(${transactions.date})` })
  .from(transactions)
  .where(
    and(
      eq(transactions.accountId, id),
      eq(transactions.userId, userId),
      eq(transactions.isOpening, false),
      isNull(transactions.deletedAt),
    ),
  );
```
With:
```typescript
const [earliest] = await tx.execute(sql`
  select min(t.date)::text as min_date
  from transactions t
  where t.user_id = ${userId}
    and t.deleted_at is null
    and not exists (
      select 1 from postings p
      join accounts a_sys on a_sys.id = p.account_id and a_sys.system_kind = 'opening'
      where p.transaction_id = t.id
    )
    and exists (
      select 1 from postings p2
      where p2.transaction_id = t.id and p2.account_id = ${id}
    )
`) as { rows: Array<{ min_date: string | null }> };
```
Then adapt the usage: `earliest[0]?.min_date ?? null` instead of `earliest[0]?.min ?? null`.

**(c) `deleteAccount` guard (lines ~581-584):**
Currently:
```typescript
const used = await tx.query.transactions.findFirst({
  where: eq(transactions.accountId, id),
});
```
Replace with:
```typescript
const usedResult = await tx.execute(sql`
  select 1 from postings p where p.account_id = ${id} limit 1
`);
```
Then change the guard from `if (used)` to `if (usedResult.rows.length > 0)`.

**(d) `updateAccount` Opening-delete case (lines ~517-526):**
Find the `plan.txn.kind === "delete"` branch inside the Opening-balance section.
The `tx.update(transactions).set({...}).where(and(..., eq(transactions.accountId, id), ...))`.
Remove `eq(transactions.accountId, id)` from the WHERE clause — the transaction id
(`plan.txn.id`) and userId are sufficient guards, since the Opening transaction was already
looked up by account above. Keep `eq(transactions.id, plan.txn.id)` and `eq(transactions.userId, userId)`.

### R5 — Transfer repayment matching in `transfer-classification.ts`

**Read the file: `apps/api/src/modules/ingest/services/transfer-classification.ts`**

Find the repayment candidate query around lines 235-249. It currently uses:
- `eq(transactions.accountId, input.fromAccountId)` — forbidden
- `eq(transactions.amountPaise, -claimed.amountPaise)` — forbidden
- `eq(transactions.isOpening, false)` — forbidden
- `sql\`not exists (select 1 from ${transferLinks} tl where ...)\`` — forbidden

Rewrite this query using raw SQL `db.execute(sql\`...\`)`:
```sql
SELECT t.id
FROM transactions t
WHERE t.user_id = ${userId}
  AND t.deleted_at IS NULL
  AND abs(t.date::date - ${input.occurredAt}::date) <= ${TRANSFER_WINDOW_DAYS}
  AND EXISTS (
    SELECT 1 FROM postings p
    JOIN accounts a ON a.id = p.account_id AND a.system_kind IS NULL
    WHERE p.transaction_id = t.id
      AND p.account_id = ${input.fromAccountId}
      AND p.amount_paise = ${-claimed.amountPaise}
  )
  AND NOT EXISTS (
    SELECT 1 FROM postings p
    JOIN accounts a ON a.id = p.account_id AND a.system_kind = 'opening'
    WHERE p.transaction_id = t.id
  )
  AND 2 > (
    SELECT count(*) FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id AND a2.system_kind IS NULL
    WHERE p2.transaction_id = t.id
  )
```
The last condition excludes transactions that already have two real postings (i.e., are
already a transfer). `2 > count(real postings)` = at most 1 real posting = ordinary shape.

Replace the `candidates` variable and adapt the rest of the function accordingly.
Preserve the `TRANSFER_WINDOW_DAYS` constant. The result of the query is an array of
`{ id: string }` rows — access them as `(result.rows as { id: string }[])`.

### R6 — `ledgerDuesAtDates` + `absorbCarryover`

**Read both files:**
- `apps/api/src/modules/credit/services/reconciliation-reads.ts`
- `apps/api/src/modules/credit/services/reconciliation-writes.ts`

**(a) `reconciliation-reads.ts`: drop `openingBalancePaise` parameter**

In `ledgerDuesAtDates` (around line 110):
1. Remove the `openingBalancePaise: number` parameter from the function signature
2. Remove the 4th parameter from the function declaration export
3. Change the formula `const ledgerDuePaise = -(openingBalancePaise + sum)` to
   `const ledgerDuePaise = -sum` (the Opening posting is in the postings sum already)
4. Remove the second safe-integer check that uses `ledgerDuePaise` if it duplicates the sum check

In `listReconciliations` (around line 166), find the call to `ledgerDuesAtDates` that
passes `acc.openingBalancePaise` as the 4th argument. Remove that argument.

**(b) `reconciliation-writes.ts`: update `absorbCarryover` to use Opening transaction**

Read the `absorbCarryover` function (around lines 265-342).

Find the two calls to `ledgerDuesAtDates` (around lines 275 and 311). Each currently
passes `account.openingBalancePaise` as the 4th argument. Remove that argument from
both calls (the function signature no longer takes it).

Find the block:
```typescript
const nextOpeningBalancePaise = account.openingBalancePaise - drift;
if (!Number.isSafeInteger(nextOpeningBalancePaise)) {
  throw new HttpError(500, "...");
}
await tx.update(accounts).set({ openingBalancePaise: nextOpeningBalancePaise })
  .where(and(eq(accounts.id, accountId), eq(accounts.userId, userId)));
```

Replace this entire block with logic that adjusts the Opening TRANSACTION:
1. Find the current Opening transaction for the card (via postings):
   ```typescript
   const [openingTxnRow] = await tx.execute(sql`
     select t.id, t.date
     from transactions t
     where t.user_id = ${userId}
       and t.deleted_at is null
       and exists (
         select 1 from postings p
         join accounts a_sys on a_sys.id = p.account_id and a_sys.system_kind = 'opening'
         where p.transaction_id = t.id
       )
       and exists (
         select 1 from postings p2
         where p2.transaction_id = t.id and p2.account_id = ${accountId}
       )
     order by t.date asc, t.id asc
     limit 1
   `) as { rows: Array<{ id: string; date: string }> };
   ```

2. Find the current Opening paise from the real-leg posting:
   ```typescript
   let currentOpeningPaise = 0;
   if (openingTxnRow.rows.length > 0) {
     const [realLeg] = await tx.execute(sql`
       select p.amount_paise from postings p
       join accounts a on a.id = p.account_id and a.system_kind is null
       where p.transaction_id = ${openingTxnRow.rows[0]!.id}
       limit 1
     `) as { rows: Array<{ amount_paise: number }> };
     currentOpeningPaise = Number(realLeg.rows[0]?.amount_paise ?? 0);
   }
   ```

3. Compute `nextOpeningPaise = currentOpeningPaise - drift` with safe-integer check.

4. Find the "earliest non-opening date" for the card (needed for insert positioning):
   ```typescript
   const [earliestDateRow] = await tx.execute(sql`
     select min(t.date)::text as min_date
     from transactions t
     where t.user_id = ${userId}
       and t.deleted_at is null
       and not exists (
         select 1 from postings p
         join accounts a_sys on a_sys.id = p.account_id and a_sys.system_kind = 'opening'
         where p.transaction_id = t.id
       )
       and exists (
         select 1 from postings p2
         where p2.transaction_id = t.id and p2.account_id = ${accountId}
       )
   `) as { rows: Array<{ min_date: string | null }> };
   const earliestTxnDate = earliestDateRow.rows[0]?.min_date ?? null;
   ```

5. Use `planOpeningBalanceChange` to get the action:
   ```typescript
   const plan = planOpeningBalanceChange({
     type: account.type as AccountType,
     requestedPaise: nextOpeningPaise,
     existing: openingTxnRow.rows.length > 0
       ? { id: openingTxnRow.rows[0]!.id, amountPaise: currentOpeningPaise }
       : null,
     earliestTxnDate,
     today: new Date().toISOString().slice(0, 10),
   });
   ```

6. Execute the plan:
   - If `plan.txn.kind === 'insert'`: create a new Opening transaction + postings
   - If `plan.txn.kind === 'update'`: call `postTransaction` + `buildOpeningPostings` with new amount
   - If `plan.txn.kind === 'delete'`: soft-delete the Opening transaction
   - If `plan.txn.kind === 'none'`: no-op

   For insert and update, import `buildOpeningPostings`, `postTransaction`, `resolveSystemAccounts`
   from `post-entry.ts` (check what's already imported at the top of the file).

7. Update the second `ledgerDuesAtDates` call (after the account update) similarly —
   remove the `nextOpeningBalancePaise` argument (the Opening posting is now part of
   the postings sum).

You will need to import:
- `planOpeningBalanceChange` from `../../ledger/services/accounts.ts`
  (check if it's already exported — if not, the `planOpeningBalanceChange` function
  is defined around accounts.ts:56-110 and needs an `export` keyword added)
- `buildOpeningPostings`, `resolveSystemAccounts`, `postTransaction` from `post-entry.ts`
  (check what's already imported)
- `AccountType` from `@compass/shared` if not already imported
- `sql` from `drizzle-orm` if not already imported

**IMPORTANT:** This change must also remove `account.openingBalancePaise` from the
`ledgerDuesAtDates` calls — that's the FIRST thing to change to unlock the rest.

## Must Not Change
- Test files
- Any other file not listed above
- The logic of `absorbCarryover` beyond what's described (don't change drift calculation
  or the SSI-retry semantics)

## Acceptance Criteria
- `npm run typecheck` exits 0 after your changes
- `npm run lint` exits 0
- `ledgerDuesAtDates` has 4 parameters total (db, userId, accountId, dates) — no `openingBalancePaise`
- `absorbCarryover` writes no `opening_balance_paise` column

## Commands
1. Read each file before editing
2. Make the changes described
3. Run `npm run typecheck` and capture output + exit code
4. Run `npm run lint` and capture output + exit code

## Required Evidence
- List of files changed
- Complete diff for each file
- Exact typecheck output + exit code
- Exact lint output + exit code
- Confirm that `planOpeningBalanceChange` is accessible (show where it's imported from)
