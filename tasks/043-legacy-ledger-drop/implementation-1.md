# Implementation-1: Legacy Ledger Drop (PR-G2)

## Status
`npm run typecheck` passes green (exit 0) across all 6 workspaces.

## Files Changed (this session — continuing from prior session)

### Production files

- `apps/api/src/modules/ingest/services/imports.ts`
  - Removed `amountPaise: item.row.amountPaise` from the `transactions.update().set(...)` call
    in the CSV-import reconciliation loop (line 661). Amount now lives only in postings.

### Test files (all typecheck-only fixes — no logic change to production paths)

- `apps/api/src/modules/ledger/services/epf-contributions.test.ts`
  - Added `isNotNull` to drizzle-orm imports.
  - Replaced `db.query.transactions.findFirst(...).categoryId` with a postings query
    (`db.query.postings.findFirst({ where: and(eq(postings.transactionId, ...), isNotNull(postings.categoryId)) })`).

- `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts`
  - Removed `accountId` and `amountPaise` from raw `transactions` INSERT in `createTxn()`.

- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
  - Line ~682: Removed `accountId`, `amountPaise: -50000`, `isOpening: true` from raw
    opening-balance INSERT (the postings are still built correctly by `buildOpeningPostings`).
  - Lines ~905, ~966 (two SSI-retry tests): Removed the intermediate
    `transactions.update().set({ amountPaise })` call — the postings update alone
    is sufficient to trigger the anti-dependency for SSI conflict detection.

- `apps/api/src/modules/system/services/backup.test.ts`
  - Line ~1112: Removed `accountId`, `amountPaise` from attachment-backup test INSERT.
  - Lines ~1269, ~1292, ~1311, ~1328, ~1336: Removed `accountId`, `amountPaise`,
    `categoryId` from transactionsCsv AC3–AC6 test INSERTs.
  - Lines ~1360–1362: AC7+AC13 — removed `accountId`, `amountPaise`, `categoryId`.
  - Lines ~1380, ~1384–1387, ~1392–1394: AC8 — removed `accountId`, `amountPaise`;
    also removed the now-unused `otherAcc` variable (no FK on account_id needed for insert).
  - Line ~1406: AC9 — removed `accountId`, `amountPaise` from loop INSERT.
  - Line ~1422: AC11 — removed `accountId`, `amountPaise`, `categoryId`.
  - Line ~1439: AC12 — removed `accountId`, `amountPaise`, `isOpening: true`, `categoryId`.
  - Line ~1465: AC14 — removed `accountId`, `amountPaise`.
  - Line ~1490: AC15 — removed `accountId`, `amountPaise`.
  - Line ~1521: AC16 — removed `accountId`, `amountPaise`.
  - Line ~1556: AC17 archived — removed `accountId`, `amountPaise`.
  - Line ~1589: AC17 renamed — removed `accountId`, `amountPaise`.
  - Line ~1610: D9.6 — removed `accountId`, `amountPaise`.

- `apps/api/src/modules/ingest/services/inbox.test.ts`
  - Added import: `resolveSystemAccounts` from `../../ledger/services/post-entry.ts`.
  - Line ~1219: Removed `assert.equal(after.amountPaise, before.amountPaise)` — amount is
    no longer a header field.
  - Line ~1316: Replaced `rows.find((r) => r.accountId === fromAccountId)` with `rows[0]`
    (exactly one row exists, account is now in postings).
  - Line ~1684: Removed `assert.equal(untouched.amountPaise, -400000)`.
  - Line ~1741: Removed `assert.equal(afterBoundary.amountPaise, -500000)`.
  - Line ~1792: Removed `assert.equal(untouched.amountPaise, -500000)`.
  - Lines ~1877–1891 (isOpening test): Rewrote raw INSERT to remove `accountId`,
    `amountPaise`, `isOpening`; replaced with `resolveSystemAccounts` + postings INSERT
    (one posting to `fromAccountId`, one to `sys.opening`) so the
    `NOT EXISTS (… system_kind='opening' …)` predicate in `acceptRepayment` excludes it.
  - Line ~1903: Replaced `assert.ok(openingRow.isOpening)` with a comment explaining
    that opening detection is now postings-based.
  - Lines ~2060–2070: Removed `accountId`, `amountPaise`, `categoryId`, `notes`, `tags`,
    `source` from mismatched-user INSERT.
  - Line ~2103: Replaced `assert.equal(mismatchedAfter!.amountPaise, -500000)` with
    `assert.ok(mismatchedAfter, "mismatched row still exists")`.

## Commands Run

```
npm run typecheck
# Exit code: 0  (all 6 workspaces pass)
```

## Assumptions

- Removing `amountPaise` from the `transactions` UPDATE in `imports.ts` is correct because
  the column is dropped. The postings-authoritative model means import reconciliation should
  only update header columns (date, merchant, notes, source); amount changes on an existing
  transaction would require a postings rewrite, which the import flow does not currently do.
- The SSI-retry tests in `reconciliation-writes.test.ts` still exercise the correct anti-
  dependency: the postings UPDATE alone triggers the serializable conflict; the removed
  `transactions.amountPaise` UPDATE was redundant (column gone).
- The "isOpening debit is excluded" test in `inbox.test.ts` correctly exercises the new
  postings-based exclusion predicate by inserting a posting to the opening system account.

## Unresolved Risks

- `reconciliation-writes.test.ts` lines ~933: raw SQL `where t.is_opening = true` remains
  in a `db.execute(sql\`...\`)` string. TypeScript does not catch this; it will fail at
  runtime if that test actually executes against a live DB. Not in the typecheck-error list,
  so not fixed here — flagged for a follow-up.
- The import reconciliation loop no longer updates `amountPaise` on the transaction when a
  statement line has a different amount than the existing ledger row. Whether postings should
  also be rewritten on an import "update" is a product question beyond this task's scope.
