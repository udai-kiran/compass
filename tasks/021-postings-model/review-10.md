## Verdict

PR-A writer graph has **2 blocking findings**. The ordinary/opening/transfer paths are generally atomic and tenant-scoped, but split rebuilding can diverge from the legacy parent amount, and the transfer-leg edit guard is raceable.

No files were modified during this review.

## BLOCKING findings

### 1. Split rebuild can produce a real posting that does not match the legacy transaction amount

[transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:221) rebuilds split rows through `buildSplitPostings`, but that builder derives its real-account leg from the sum of the splits:

- [postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:121): `assetAmount = sumPaise(splits...)`
- [postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:125): real leg uses `assetAmount`
- [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:225): the rebuild passes no parent `row.amountPaise`

`setSplits` correctly verifies the total against the locked parent at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:480), but `updateTransaction` permits an amount edit on an existing split transaction and then invokes the rebuild at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:438). It does not revalidate that the retained splits still sum to the new parent amount.

Concrete failure:

1. Parent is `-100`, splits total `-100`.
2. `updateTransaction(..., { amountPaise: -120 })` succeeds.
3. Legacy parent becomes `-120`.
4. Rebuild emits a real posting of `-100`, derived from the old splits.
5. The posting family is zero-sum but does not reproduce the legacy row.

That violates the required per-row shape and the stated split invariant that the real posting equals the parent amount. The rebuild must either reject an inconsistent parent/split shape inside the locked write transaction or build against the parent amount and fail zero-sum when counters do not match. An amount-changing `updateTransaction` also needs serialization compatible with `setSplits`.

### 2. `updateTransaction`’s transfer-linked account/amount guard is outside the write transaction and is raceable

The membership check occurs before `db.transaction(...)`:

- Check: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:409)
- Legacy update transaction begins: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:426)

It neither locks the transaction row nor rechecks link membership inside the write transaction. A concurrent `linkTransfer` locks and validates both rows at [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:82), but the update path does not participate correctly in that locking protocol.

A valid interleaving is:

1. `updateTransaction` observes no link.
2. `linkTransfer` locks the row, validates it, creates the link and commits.
3. `updateTransaction` then updates account or amount.
4. Its rebuild sees the new link and emits Clearing postings using the edited value.
5. The surviving counterpart retains the amount/account validated before the edit.

The request specifically requires account/amount edits of a transfer-linked leg to be rejected. This race defeats that guarantee and can leave a linked pair with unequal legacy amounts. The transfer membership check needs to run after locking the target row inside the same transaction as the update and rebuild.

## Verified correct

### Atomicity

All inspected posting-affecting legacy mutations place the legacy write and posting replacement on the same transaction/savepoint handle:

- `createTransaction`: insert and replacement at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:369)
- `updateTransaction`: update and rebuild at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:426)
- `setSplits`: split delete/insert and rebuild at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:476)
- Bulk restore and recategorize: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:510) and [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:541)
- `linkTransfer`: link insert and both rebuilds at [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:82)
- `unlinkTransfer`: delete and both rebuilds at [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:169)
- `createTransfer`: both nested leg creations and link operation share the outer transaction at [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:223)
- Account opening-row insert/update: [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:213) and [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:332)
- Import reconciliation, link invalidation, and bulk inserts: [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:566)
- Import rollback deletion/restoration/rebuild: [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:835)
- Recurring materialization: [recurring.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:224)
- Demo seeding: insert and rebuild use the seed transaction at [demo.ts](/home/udai/PennyPilot/apps/api/src/modules/system/services/demo.ts:216)
- Category merge: legacy category rewrites and rebuilds share the transaction at [categories.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/categories.ts:154)

`replacePostings` does not open or commit its own transaction; delete and insert operate on the supplied handle at [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:41).

The post-commit calls to `autoLinkTransfers` in imports do not split a link mutation from its mirror: each actual link and both posting transitions are atomic inside `linkTransfer`. Moving the scan itself into the import transaction is therefore not required by the stated atomicity law.

### Canonical branch order and normal shapes

`rebuildPostingsForTransaction` has the required priority:

1. Opening: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:203)
2. Transfer-link membership: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:210)
3. Splits: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:221)
4. Ordinary fallback: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:237)

Opening, ordinary and transfer-leg builders emit zero-sum real/system pairs. Transfer legs are `[real: amount] + [Clearing: -amount]` at [postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:218).

The split builder is internally zero-sum, but has the parent-amount divergence described in blocker 1.

### EMI shape

EMI source and principal are inserted as separate transaction rows and independently rebuilt as ordinary families:

- Source family: [recurring.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:288)
- Principal family: [recurring.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:309)

No `transfer_links` row is created, so D21 is respected.

### Correct no-posting paths

The following correctly make no posting write:

- Soft delete: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:456)
- Bulk tag additions/removals: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:566)
- Bulk soft delete: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:583)
- Account opening-row soft delete retains postings: [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:463)
- Card/loan and other column-based openings do not create a transaction or postings: [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:90)
- Merchant-only updates remain posting-free: [merchants.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/merchants.ts:49)
- SIP linkage/header changes only alter `sip_id` and correctly do not rebuild postings, e.g. [sip-installments.ts](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:319)
- Reconciliation stamps only change `reconciled_statement_id`: [reconciliation-writes.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:128)
- `absorbCarryover` only changes `accounts.opening_balance_paise` and correctly writes no postings: [reconciliation-writes.ts](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:302)
- `updateTransactionHeader` remains header-only: [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:79)

Bulk restore appropriately rebuilds because it can restore category-bearing counters as well as undelete a row.

### Import counterpart handling

The reconciliation path correctly:

- Captures both sides of affected auto-links before deletion at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:674)
- Deletes those links at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:697)
- Rebuilds the union of updated rows and severed legs after deletion at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:713)

Thus severed legs become ordinary, while an updated leg retaining a manual link is rebuilt as Clearing.

Rollback correctly:

- Captures surviving partners before hard deletion at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:870)
- Hard-deletes imported rows at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:894)
- Restores snapshot rows at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:901)
- Rebuilds only surviving partners plus restored snapshots at [imports.ts](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:920)

Deleted rows are not manually rebuilt. Their postings cascade through `postings.transaction_id` at [ledger.ts](/home/udai/PennyPilot/apps/api/src/db/shared/ledger.ts:136).

Both `transfer_links` transaction FKs are explicitly `ON DELETE CASCADE` at [schema.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:64) and [schema.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:68).

### Other A3-fix requirements

Verified:

- `linkTransfer` locks both rows inside its transaction: [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:83)
- It validates signs/equal amount: [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:108)
- It validates different accounts: [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:111)
- It rejects opening rows: [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:114)
- It checks both transactions in both transfer-link roles: [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:117)
- `setSplits` locks the parent `FOR UPDATE`: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:480)
- `setSplits` uses the BigInt-backed `sumPaise`: [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:489)
- `buildTransferLegs` uses `Number.isSafeInteger`: [transfers.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:194)

The transfer-edit rejection exists functionally but is not concurrency-safe, as described in blocker 2.

### Tenant scope

`replacePostings` verifies:

- Transaction ownership: [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:49)
- Every posting account: [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:55)
- Every non-null category: [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:57)

`resolveSystemAccounts` selects by `userId`: [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:160).

Although `rebuildPostingsForTransaction` initially reads by transaction ID alone at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:199), it cannot replace another tenant’s postings because `replacePostings` subsequently verifies transaction ownership before deletion. The earlier tenant-scoped account/category checks also reject foreign draft references. Adding `userId` to the initial query would be clearer and cheaper on failure, but this is not presently an authorization escape.

`mergeCategory` establishes that both source and target categories belong to the user before entering the transaction at [categories.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/categories.ts:144). Given category FK ownership consistency, collecting rows by the already-owned source category ID is safe.

## Non-blocking observations

### Reader guardrail was touched only for required internal-account narrowing

Two existing reader queries were changed:

- `accountBalancesAtDate`: [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:159)
- `listAccounts`: [accounts.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:181)

The balance formulas remain legacy-derived; the only behavioral change is excluding internal `system_kind` accounts, as explicitly required by the governing PR-A plan. This is not a postings-reader conversion.

`hydrate` remains legacy-derived, including legacy splits and transfer links. No dashboard, report, period, balance formula, web, extractor, or `packages/shared` file is changed. Served DTO shape is unchanged, and all legacy transaction/account columns remain present. The additive migration contains no drop statements.

### `replacePostings` performs ownership queries per draft

[post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:55) performs account and category ownership checks one draft at a time. Large split families and bulk reconciliation can therefore cause substantial query multiplication. Batched unique-ID validation would be simpler operationally and faster, but the current code is correct.

### Cross-module unique-violation dependency

[post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:6) imports `isUniqueViolation` from an investments service solely to seed system accounts. That is unnecessary coupling for a ledger primitive and risks future dependency cycles. A neutral database-error helper would be cleaner, but it does not affect the writer graph’s correctness.

### Transfer suggestion conversion is not safe-integer checked

[suggestTransfers](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:63) converts a database bigint amount with `Number(...)` without a safe-integer range check. This predates and is separate from the specifically required `buildTransferLegs` guard, which is correct. It should eventually follow the plan’s general bigint boundary rule but is not a dual-write atomicity blocker.

## Explicitly deferred work

The current branch state does not yet contain the A5 full-shape reconciliation/backfill gate, A6 restore/archive compatibility, or A7 DB-backed invariant/parity coverage described by the roadmap. Those are named later PR-A slices and are not defects in iterations 7–12 themselves. PR-A as a whole should not be considered complete or merge-ready until those slices land and convergence testing passes.

PR-B+ reader conversion, PR-G collapse/legacy removal, and full postings-native reader parity remain correctly out of scope for this review.