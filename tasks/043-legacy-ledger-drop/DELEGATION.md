# Sonnet Worker Delegation — Iteration 1

## Task
043 — Legacy Ledger Drop (PR-G2), Core Schema + Services

## Approved Plan
P1-P7, P11-P13, P17 from TASK.md

## Files and Symbols

### Delete entirely
- `apps/api/src/modules/ledger/services/legacy-projection.ts`

### Schema changes
- `apps/api/src/db/shared/ledger.ts` — Remove from `transactions`: `accountId` (line 30-32), `amountPaise` (line 41), `categoryId` (line 43-44), `necessity` (line 52), `isOpening` (line 60-66), and remove indexes: `transactions_account_idx` (line 109), `transactions_category_idx` (line 110). Keep all other columns.
- `apps/api/src/modules/ledger/schema.ts` — Remove `transactionSplits` table (lines 40-55) and `transferLinks` table (lines 57-76). Keep all other exports and tables.
- `apps/api/src/db/schema.ts` — Remove `transactionSplits`, `transferLinks` from the barrel exports (lines 35-36).

### Service changes
- `apps/api/src/modules/ledger/services/post-entry.ts`:
  - Remove import of `transactionSplits` from `"../schema.ts"` (line 3)
  - Remove import of `projectLegacyColumns, projectLegacySplits` from `"./legacy-projection.ts"` (line 7)
  - Simplify `postTransaction()` (lines 100-127): remove the legacy column `.set({...})` update (lines 109-120) and the transaction_splits delete+insert (lines 122-126). Keep only: `await replacePostings(...)` + `await db.update(transactions).set({ updatedAt: new Date() }).where(...)`.

- `apps/api/src/modules/ledger/services/transactions.ts`:
  - Remove `reprojectLegacyColumns()` function (around line 290).
  - Fix `createTransaction()` (~line 458): The INSERT `.values({ ...input, merchant, userId })` spreads `input` which includes `accountId`, `amountPaise`, `categoryId`, `necessity`. Change to explicitly list only valid columns: `{ userId, date: input.date, merchant, notes: input.notes ?? '', tags: input.tags ?? [], source: input.source ?? 'manual', occurredAt: input.occurredAt, policyId: input.policyId, resourceId: input.resourceId, recurringTemplateId: input.recurringTemplateId }`.
  - Fix `transactions.ts:671` (bulk-action snapshot): Replace `transactions.categoryId` read with a postings-derived query. Use: `SELECT postings.category_id FROM postings JOIN accounts ON accounts.id = postings.account_id WHERE postings.transaction_id = transactions.id AND accounts.system_kind IS NOT NULL LIMIT 1`.

- `apps/api/src/modules/ledger/services/transfers.ts`:
  - Fix `createTransfer()` (~line 363): Remove `accountId: legs.out.accountId` and `amountPaise: legs.out.amountPaise` from `.values()`. The INSERT becomes: `{ userId, date: legs.out.date, merchant: legs.out.merchant, notes: legs.out.notes, tags: legs.out.tags }`.
  - Fix `unlinkTransfer()` (~line 282): Remove `accountId: inLeg.accountId` and `amountPaise: inLeg.amountPaise` from `.values()`. Keep: `{ userId, date: row.date, occurredAt: row.occurredAt, merchant: row.merchant, notes: row.notes, tags: row.tags, source: row.source }`.

- `apps/api/src/modules/ledger/services/accounts.ts`:
  - Line 201: Replace `eq(transactions.isOpening, true)` filter with EXISTS subquery on postings: `EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.transaction_id = transactions.id AND a2.system_kind = 'opening')`. Same pattern as sip-installments.ts:296.

- `apps/api/src/modules/credit/services/cards.ts` (or wherever cards.ts is in the module layout):
  - Line 356: Replace `AND NOT t.is_opening` with `AND NOT EXISTS (SELECT 1 FROM postings p2 JOIN accounts a2 ON a2.id = p2.account_id WHERE p2.transaction_id = t.id AND a2.system_kind = 'opening')`.

- `apps/api/src/modules/credit/services/reconciliation-writes.ts`:
  - Line 372: Remove `isOpening: true` from the transaction INSERT `.values()`.

- `apps/api/src/modules/system/services/demo.ts`:
  - Lines 191-192: Remove `isOpening: true` from `txns[]` entries.
  - Line 229: The conditional `if (seed.isOpening)` needs to be replaced. Look at how the posting builder is selected — if it checks `seed.isOpening` to decide between `buildOpeningPostings` and `buildOrdinaryPostings`, replace with an inline check like `seed.merchant === 'Opening balance'` or add a `kind: 'opening' | 'ordinary'` discriminator that is NOT a DB column.

- `apps/api/src/modules/ledger/services/reconcile-postings.ts`:
  - Gut `assertNoLegacyShapes()` body — it reads `transfer_links` count and `accounts.opening_balance_paise`. Either delete the function entirely or make it a no-op. If there's a call site in app.ts, update or remove.

### Import cleanup (P17)
After all the above, grep for any remaining imports of `transactionSplits` or `transferLinks` and remove them. Also remove any import of `legacy-projection.ts`.

## Must Not Change
- `postings` table definition
- `TransactionSchema` / `SplitSchema` / `CreateTransactionSchema` / `CreateTransferSchema` in packages/shared (DTO shapes stay identical)
- `hydrate()` function logic (already postings-native)
- `accounts.openingBalancePaise` column or any web app files
- Anything in `apps/web/`

## Acceptance Criteria
- `legacy-projection.ts` does not exist
- `transactionSplits` and `transferLinks` are not defined, exported, or imported anywhere
- Five dropped columns are gone from `transactions` in `db/shared/ledger.ts`
- All transaction INSERTs compile without the dropped columns
- `npm run typecheck` passes
- No runtime references to `is_opening` as a column read (postings-based alternatives used)

## Commands
1. Make all edits
2. `npm run typecheck` (report full output)
3. If typecheck fails, fix until it passes
4. Report: files changed (list), commands run with exit codes, any blockers

## Required Evidence
- Complete list of files changed
- `npm run typecheck` literal output and exit code
- Any plan deviations or blockers encountered
