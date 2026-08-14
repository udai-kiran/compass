# Task: Legacy Ledger Drop (PR-G2)

## Status
COMPLETE

## Codex Review
Codex reviewer unavailable (infrastructure: "Read-only file system" on app-server init, 2 attempts). Proceeding with coordinator-validated plan based on thorough investigation (investigation-1.md, 326 lines, 30+ files inspected).

## Objective
Drop the legacy single-entry ledger structures that postings superseded: `transfer_links` table, `transaction_splits` table, and the five legacy projection columns on `transactions` (`accountId`, `amountPaise`, `categoryId`, `necessity`, `isOpening`). Delete `legacy-projection.ts` and simplify the write path. This is the planned "PR-G2" from the postings work.

## Root Cause
PR-G1 made postings the authority for reads AND writes, but left legacy columns in place as NOT NULL stubs. They are write-only (CI gate ensures no reads), create maintenance cost (every writer must project to them), and block the migration collapse.

## Scope
### Schema (remove)
- `transactions.accountId`, `.amountPaise`, `.categoryId`, `.necessity`, `.isOpening` columns + indexes `transactions_account_idx`, `transactions_category_idx`
- `transaction_splits` table definition (`modules/ledger/schema.ts`)
- `transfer_links` table definition (`modules/ledger/schema.ts`)
- Exports from `db/schema.ts` for both tables
- DB objects: `check_split_sum()` function, both constraint triggers (become irrelevant with `transaction_splits` gone)

### Code (delete or simplify)
- **Delete** `modules/ledger/services/legacy-projection.ts`
- **Simplify** `post-entry.ts:postTransaction()` — remove legacy column writes and split writes; becomes `replacePostings()` + `updatedAt`
- **Remove** `reprojectLegacyColumns()` from `transactions.ts`
- **Fix INSERT paths** in `createTransaction()`, `createTransfer()`, `unlinkTransfer()` — strip dropped columns from `.values()`
- **Update** `backup.ts` — remove `transaction_splits` / `transfer_links` from `ALL_TABLES`, `USER_TABLES`, `LINKED_TABLES`
- **Update** `restore.ts` / `db/restore.ts` — remove dropped table/column references
- **Update** `packages/shared` — remove `TransferLinkSchema` (dead; transfers are one-header-two-postings), clean up any stale comments
- **Update** tests — remove/update tests referencing legacy columns and tables
- **Remove** all imports of `transactionSplits`, `transferLinks` across the codebase

### Keep (explicitly not touched)
- `transactions` header: `userId`, `date`, `occurredAt`, `merchant`, `notes`, `tags`, `source`, `policyId`, `resourceId`, `sipId`, `recurringTemplateId`, `reconciledStatementId`, `deletedAt`, `createdAt`, `updatedAt` + generated `search`
- `postings` table (the authority)
- `TransactionSchema` in shared (DTO shape unchanged — `accountId`, `amountPaise` etc. derived from postings in `hydrate()`)
- `SplitSchema`, `SetSplitsSchema` (user-facing split feature is postings-native)
- `CreateTransactionSchema`, `CreateTransferSchema` (input contracts stay)

## Dependencies
- None (on main, postings are authoritative)

## Plan
- P1: Remove `transactionSplits`, `transferLinks` from `modules/ledger/schema.ts`
- P2: Remove 5 legacy columns + 2 indexes from `transactions` in `db/shared/ledger.ts`
- P3: Remove barrel exports from `db/schema.ts`
- P4: Delete `legacy-projection.ts`
- P5: Simplify `post-entry.ts` — `postTransaction()` to only `replacePostings()` + update `updatedAt`; remove `transactionSplits` import and `projectLegacyColumns`/`projectLegacySplits` import
- P6: Remove `reprojectLegacyColumns()` from `transactions.ts`
- P7: Fix INSERT `.values()` in `createTransaction()` (~line 459), `createTransfer()` (~line 363), `unlinkTransfer()` (~line 282) — strip accountId/amountPaise/categoryId/necessity/isOpening from `.values()`
- P8: Update `backup.ts` ALL_TABLES / USER_TABLES / LINKED_TABLES — remove `transaction_splits`, `transfer_links`
- P9: Update `db/restore.ts` — no change needed (DEFERRED_RESTORE_COLUMNS has no legacy entries)
- P10: Update `packages/shared/src/schemas/ledger.ts` — remove `TransferLinkSchema.auto` field (or whole schema if dead)
- P11: Convert live legacy reads:
  - `accounts.ts:201`: `transactions.isOpening` filter → EXISTS on postings w/ system_kind='opening'
  - `cards.ts:356`: `NOT t.is_opening` → NOT EXISTS postings-based subquery
  - `transactions.ts:671`: `transactions.categoryId` snapshot → postings-derived category
- P12: Fix legacy writes:
  - `reconciliation-writes.ts:372`: remove `isOpening: true` from INSERT values
  - `demo.ts:191-192,229`: remove `isOpening` from txns[]; adjust posting-builder selector
- P13: Remove `assertNoLegacyShapes()` body from `reconcile-postings.ts` (reads transfer_links + is_opening)
- P14: Update `db/schema.decomposition.test.ts:65` — remove `"transactionSplits"`, `"transferLinks"` from expected
- P15: Update/remove parity tests: `postings-periods-parity.test.ts`, `postings-pr-e-parity.test.ts` legacy formula side
- P16: Fix test predicates: `backup.test.ts:679`, `recurring.test.ts`, `epf-contributions.test.ts` — replace `eq(transactions.accountId/isOpening)` with postings-based lookups
- P17: Remove all remaining imports of `transactionSplits`, `transferLinks` across the codebase

## Deferred (not in this task)
- `accounts.openingBalancePaise` column drop (always 0, boot-check enforced, harmless to keep; avoids web app churn)
- Web app changes for opening balance (cosmetic, works as-is since column is always 0)

## Acceptance Criteria
- AC1: `transactionSplits` and `transferLinks` no longer appear in any `.ts` file as live code (comments/docs OK)
- AC2: `legacy-projection.ts` is deleted
- AC3: `transactions` schema has no `accountId`, `amountPaise`, `categoryId`, `necessity`, `isOpening` columns
- AC4: `db:generate` produces a clean migration diff reflecting only the drops
- AC5: `npm run typecheck` passes across all workspaces
- AC6: `npm run test` passes (adjusting for removed tests)
- AC7: `backup.test.ts` passes (table lists updated)

## Verification
- T1: `npm run typecheck`
- T2: `npm run test`
- T3: `grep -rn 'transactionSplits\|transferLinks\|legacy-projection' apps/api/src/ packages/ --include='*.ts'` returns only comments/docs
- T4: `grep -rn 'is_opening\|isOpening' apps/api/src/db/ apps/api/src/modules/ledger/ --include='*.ts'` returns zero results in schema/service files

## Non-Goals
- Changing the API contract (TransactionSchema DTO shape stays identical)
- Changing the web app (it already consumes postings-derived data)
- Running migrations (that's task 044)
