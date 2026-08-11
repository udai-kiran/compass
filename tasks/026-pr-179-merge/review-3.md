## BLOCKING

### DB-backed reconciliation tests are stale and will fail

The delta moves all opening balances to postings and stops reading/writing `accounts.opening_balance_paise`, but the unchanged DB suite still constructs and asserts column-backed card balances.

Production change:

- `apps/api/src/modules/credit/services/reconciliation-reads.ts:143`

```ts
const ledgerDuePaise = -sum;
```

Tests still expect the removed addend:

- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts:227-235`

```ts
const openingBalancePaise = -(Number.MAX_SAFE_INTEGER - 1000);
...
await assert.rejects(
  listReconciliations(db, userId, accountId),
```

That call will no longer overflow or reject because the column is ignored.

Additionally, `absorbCarryover` now creates/updates an opening transaction while leaving the column zero, but numerous unchanged assertions require nonzero column values, for example:

- `reconciliation-writes.test.ts:310`

```ts
assert.equal(row!.openingBalancePaise, -4559125);
```

- `reconciliation-writes.test.ts:418`

```ts
assert.equal(row!.openingBalancePaise, -800000);
```

These assertions will fail against PostgreSQL. Therefore the DB-backed suite is not merely unverified: it is statically certain not to pass in its current form.

## IMPORTANT

### Linked SIP installments disappear after an account-changing edit

- `apps/api/src/modules/investments/services/sip-installments.ts:449`

```sql
where p.transaction_id = t.id
  and a.system_kind is null
  and p.account_id = ${targetAccountId}
```

The function documentation at lines 420–427 explicitly requires already-linked installments to remain visible after a transaction is moved to another account so the user can unlink it. The new `targetAccountId` predicate does the opposite: the lateral join produces no row, hiding the installment and removing the documented recovery path.

### Repayment race handling still targets a deleted constraint

- `apps/api/src/modules/ingest/services/transfer-classification.ts:306-313`

```ts
if (isUniqueViolation(err, "transfer_links_out_transaction_id_unique")) {
```

PR-G1’s `linkTransfer` no longer inserts into `transfer_links`; it locks and merges transaction rows. Consequently this catch cannot translate the documented concurrent-claim race. A competing merge can instead produce a `404`/`409` from `linkTransfer`, which escapes with different API behavior.

## MINOR

### Obsolete “Clearing” values remain, but touched production SQL does not use them

The actual `account_system_kind` schema values are:

```ts
["expenses", "income", "opening", "clearing"]
```

`clearing` remains in the PostgreSQL enum for compatibility. Touched production SQL uses only `opening` or null/non-null predicates, all valid.

Two touched tests still contain `clearing` SQL:

- `apps/api/src/lib/postings-periods-parity.test.ts:665`
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:404`

Those literals are schema-valid, though they describe the retired representation.

## Requested cross-checks

- Backup coverage: every `pgTable` is present in `ALL_TABLES`; there are no stale entries. Every table except `users` is covered by either `USER_TABLES` or `LINKED_TABLES`. The backup coverage and export-gap tests should pass against the current schema. I could not execute the DB-dependent restore/round-trip assertions.
- Signature/call sites: all `ledgerDuesAtDates` calls use the new four-argument signature. `createTransfer` consumers use `transactionId`; no stale `createTransfer(...).outTransactionId` access was found across `apps/` or `packages/`.
- Raw SQL: touched references to `postings.category_id`, `transactions.category_id`, `accounts.system_kind`, and the other referenced columns exist. No touched production SQL uses an invalid enum literal.
- User scoping: no cross-user result leak was found in the touched queries. Correlated subqueries are anchored to an outer user-scoped transaction; category/account joins that return user data include matching user predicates where required.
- Money: no new float-rupee conversion or rounding of paise was found. Arithmetic remains integer paise with safe-integer checks.
- Migrations: the 21-file delta touches no schema or Drizzle migration file, so it introduces no schema change requiring a migration.
- Static limitation: transaction isolation behavior, restore FK ordering, PostgreSQL planner/type behavior, and full DB-backed test outcomes beyond the definite stale assertions above could not be verified without connecting to PostgreSQL.