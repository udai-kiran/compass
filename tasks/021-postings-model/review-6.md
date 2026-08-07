# Closure re-review: DUAL-WRITE iteration 2

## Five previous blockers

### 1. Opening-column double-count — RESOLVED for dual-write; PR-G cutover still has a separate defect

The revised plan no longer synthesizes postings for `accounts.opening_balance_paise` during dual-write. It explicitly keeps that column as an addend through PR-F and creates the Opening transaction only when the column is removed ([PLAN-dualwrite.md:17](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:17), [PLAN-dualwrite.md:53](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:53), [PLAN-dualwrite.md:65](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:65)).

That correctly preserves the existing formula:

- `opening_balance_paise + Σ transactions` in the common balance service ([balances.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:27)).
- The same formula in dated account balances ([accounts.ts:163](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:163)).
- The same formula in account listing ([accounts.ts:186](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:186), [accounts.ts:197](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:197)).

Consequently:

- PR-A remains correct because legacy readers remain unchanged.
- PR-B remains correct because postings-based balances explicitly add the column.
- No opening amount is counted twice during dual-write.

The PR-G effective-date problem is addressed under “New blockers.”

### 2. Deployment write-gap — PARTIAL

The revised plan now has the correct high-level ordering: additive schema, deploy dual-writers, run a post-deployment catch-up, and gate reader conversion on the per-transaction invariant ([PLAN-dualwrite.md:19](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:19)-[24](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:24)). That closes the gap for old-binary **inserts** that have no postings.

It does not close the gap for old-binary mutations of transactions that already have postings. The stated catch-up maps only “every legacy row lacking postings” ([PLAN-dualwrite.md:22](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:22)). During migration-first deployment, the old binary can:

- Change account, amount, category, or necessity on an existing row ([transactions.ts:288](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:288)-[transactions.ts:313](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:313)).
- Reconcile and change an existing imported transaction’s date/amount ([imports.ts:641](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:641)-[imports.ts:658](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:658)).
- Delete an auto-transfer link without changing whether either transaction already has postings ([imports.ts:669](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:669)-[imports.ts:683](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:683)).
- Restore previous transaction values during import rollback ([imports.ts:837](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:837)-[imports.ts:849](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:849)).

Those rows are not “unmapped”; they have stale or wrongly shaped postings. The gate will detect them, but the specified catch-up will never repair them, so repeating it cannot reach the gate.

Required amendment: the post-deployment reconciliation must idempotently rebuild/compare the expected posting shape for **every applicable transaction**, not merely rows having zero postings. Alternatively, use a mutation watermark, database trigger, write freeze, or maintenance window that covers inserts, updates, link changes, and deletes.

### 3. Transfer-link lifecycle — RESOLVED

The revised writer graph expressly covers:

- Manual link.
- Auto-link.
- Unlink.
- Import reconciliation’s auto-link invalidation.
- Hard deletion of either leg.
- Import rollback restoration.
- Restoration of split posting shape rather than blindly producing an ordinary pair.

These transitions are required to occur atomically with the corresponding legacy/link mutation ([PLAN-dualwrite.md:36](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:36)-[40](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:40)).

That directly covers the currently dangerous paths:

- Link creation and deletion are separate legacy operations today ([transfers.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:68), [transfers.ts:98](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:98), [transfers.ts:134](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:134)).
- Import reconciliation removes auto-links after editing one leg ([imports.ts:641](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:641)-[imports.ts:683](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:683)).
- Rollback hard-deletes imported rows and subsequently restores reconciled rows ([imports.ts:830](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:830)-[imports.ts:860](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:860)).

Implementation will need to move or restructure the currently post-commit `autoLinkTransfers` call at [imports.ts:858](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:858)-[860](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:860) to satisfy the plan’s atomicity requirement, but the revised plan specifies that requirement adequately.

### 4. PR-A restore compatibility — PARTIAL

The revision correctly moves the core restore work into PR-A:

- Ignore system accounts in the fresh-account guard.
- Retain or regenerate seeded system accounts.
- Map archived system-account IDs by `system_kind`.
- Rewrite restored posting account IDs.
- Avoid restoring archived system accounts as ordinary accounts.
- Round-trip postings in new JSON archives.

These are explicit at [PLAN-dualwrite.md:45](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:45)-[47](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:47).

They address the current implementation, whose guard counts every account ([restore-user.ts:13](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:13)-[restore-user.ts:14](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:14), [restore-user.ts:67](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:67)-[restore-user.ts:75](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:75)) and whose cleanup deletes all user-owned seeded rows ([restore-user.ts:105](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:105)-[restore-user.ts:114](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:114)).

However, compatibility with **old archives that contain transactions but no postings** is not specified. The restore loop currently skips tables absent from an older archive ([restore-user.ts:118](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:118)-[restore-user.ts:121](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:121)). Under the revised plan, such an archive would restore legacy transactions with no postings, immediately violating the PR-A invariant.

Required amendment: PR-A restore must synthesize/rebuild postings from restored legacy transactions, splits, opening flags, and transfer links when the archive lacks postings. This rebuilding must occur before the restore commits or before the restored account becomes usable. It should also validate rather than blindly trust posting shapes in newer archives.

### 5. Per-transaction safety net — RESOLVED

The revised invariant is now correctly row-local and shape-specific:

- Exact ordinary shape.
- Exact split counters and metadata.
- Exact linked-transfer Clearing shape.
- Exact opening-row shape.
- Explicit absence for column-based openings.
- Defined soft-delete behavior.
- Detection of missing, duplicate, and unexpected postings.

This is specified at [PLAN-dualwrite.md:26](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:26)-[34](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:34).

The account/report parity check is also correctly retained only as an end-to-end check, with real-account scoping, non-deleted parents, matching date cutoffs, explicit column openings, and bigint safety ([PLAN-dualwrite.md:34](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:34)).

That is sufficient to catch errors which account-level totals could conceal.

## Mutation-path coverage

The revised plan adequately specifies the requested mutation graph:

- `updateTransaction`: complete resulting legacy shape is locked/read and postings rebuilt inside the same outer transaction ([PLAN-dualwrite.md:37](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:37)-[38](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:38)). This is necessary because the current update spreads all mutable fields into one update ([transactions.ts:288](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:288)-[transactions.ts:313](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:313)).

- `replacePostings`: outer transaction handle plus `userId` and ownership checks are explicit ([PLAN-dualwrite.md:37](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:37)). That corrects the present helper, which accepts no user and opens its own transaction ([post-entry.ts:81](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:81)-[post-entry.ts:103](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:103)).

- `setSplits`: same callback, BigInt-safe total, and reject-or-explicit-allocation policy are specified ([PLAN-dualwrite.md:39](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:39)).

- Transfer link, unlink, auto-link, invalidation, hard-delete, counterpart restoration, rollback, and split restoration are all explicitly covered ([PLAN-dualwrite.md:40](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:40)).

- Category merge updates both parent-derived and split-derived counter postings ([PLAN-dualwrite.md:41](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:41)).

- Bulk recategorization refreshes only Income/Expenses counter-postings, leaving Clearing and Opening intact ([PLAN-dualwrite.md:38](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:38)).

- Import bulk creation, reconciliation mutation, rollback deletion/restoration, and both reconstruction directions are named ([PLAN-dualwrite.md:40](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:40)-[42](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:42)). These correspond to the current direct insert at [imports.ts:700](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:700)-[imports.ts:717](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:717), reconciliation update at [imports.ts:641](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:641)-[imports.ts:658](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:658), and rollback at [imports.ts:830](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:830)-[imports.ts:849](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:849).

- Recurring EMI remains two independent posting families and is expressly not converted into a transfer ([PLAN-dualwrite.md:42](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:42)).

- Account-opening insert, update, and soft-delete are explicitly covered ([PLAN-dualwrite.md:42](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:42)). The three corresponding current paths are [accounts.ts:425](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:425)-[accounts.ts:460](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:460).

- Reconciliation drift remains column-only during dual-write and preserves account-first locking ([PLAN-dualwrite.md:42](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:42)). That matches the existing lock at [reconciliation-writes.ts:243](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:243)-[reconciliation-writes.ts:250](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:250) and column mutation at [reconciliation-writes.ts:295](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:295)-[reconciliation-writes.ts:305](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:305).

The mutation-path specification is therefore adequate, subject to the deployment reconciliation and old-archive restore gaps above.

## Scoping and security notes

These are now adequately specified:

- `"system"` is narrowed in PR-A at generic account boundaries, with `system_kind IS NULL`, rather than waiting for later reader conversion ([PLAN-dualwrite.md:48](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:48)-[49](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:49)). This fixes the current unfiltered generic list and cast at [accounts.ts:171](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:171)-[accounts.ts:175](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:175) and [accounts.ts:189](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:189)-[accounts.ts:197](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:197).

- Posting replacement takes `userId` and verifies transaction, accounts, and category ownership ([PLAN-dualwrite.md:37](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:37)).

- SQL aggregates are range-checked before conversion to `number` in every PR touching them ([PLAN-dualwrite.md:60](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:60)). This is needed because current paths directly call `Number`, for example [balances.ts:37](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:37)-[balances.ts:40](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:40) and [periods.ts:204](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:204)-[periods.ts:205](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:205).

- `buildTransferLegs` is explicitly upgraded to `Number.isSafeInteger` ([PLAN-dualwrite.md:60](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:60)), correcting the current weaker check at [transfers.ts:149](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:149)-[transfers.ts:157](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:157).

## Opening-column behavior in PR-B and PR-C

Column-based accounts with no Opening posting are handled correctly during dual-write.

In PR-B, balances remain correct because the plan explicitly adds `opening_balance_paise` separately from posting sums ([PLAN-dualwrite.md:53](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:53)). An account with no transactions and no postings therefore still reports its column opening balance.

In PR-C, excluding transactions with an Opening posting does not accidentally include or exclude a column opening. A column opening is not a transaction and currently contributes nothing to period income or expense. Existing period queries aggregate only transactions and exclude `is_opening` rows ([periods.ts:191](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:191)-[periods.ts:202](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:202)). Thus:

- Row-based openings are excluded by the new Opening-posting predicate.
- Column-based openings have no transaction to enter the aggregation.
- They are neither double-excluded nor incorrectly counted as income or expense.

There is no PR-B/PR-C blocker on this point.

## New blockers

### 1. PR-G opening synthesis still changes dated historical balances

The plan synthesizes each column opening on the day before the earliest ordinary activity ([PLAN-dualwrite.md:17](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:17)). That matches the existing rule for creating a new **row-based bank/cash opening** ([accounts.ts:75](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:75)-[accounts.ts:77](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:77), [accounts.ts:106](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:106)-[accounts.ts:112](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:112)), but it does not preserve the semantics of a pre-existing **column opening**.

The column currently applies regardless of an `asOf` cutoff: it is added outside the date-filtered transaction subquery ([accounts.ts:163](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:163)-[accounts.ts:170](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:170), [balances.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:27)-[balances.ts:34](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:34)). Once converted into a dated posting, a query before the synthetic transaction’s date returns zero instead of the former opening balance.

The problem is especially visible for an account with no ordinary activity: the existing helper falls back to “today” ([accounts.ts:111](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:111)), which would erase that account’s opening balance from every earlier dated balance.

Reconciliation documentation confirms that the column currently reinterprets history from account creation ([reconciliation-writes.ts:215](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:215)-[reconciliation-writes.ts:220](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:220)).

Required amendment: PR-G must give synthesized column openings an account-creation effective date, or otherwise define a postings-reader rule that preserves the column’s former timeless/as-of behavior. “Day before earliest activity” is not parity-preserving for column-based openings.

### 2. PR-G is not a single normally deployable GREEN contract PR as specified

PR-G simultaneously:

- Stops legacy dual-writing.
- Collapses two-row transfers.
- Remaps identity/attachments.
- Retires Clearing creation.
- Synthesizes openings.
- Drops the opening column.
- Drops transaction splits and legacy transaction columns.
- Drops `transfer_links`.
- Changes shared DTOs and web consumers.

That scope is stated at [PLAN-dualwrite.md:58](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:58).

Under the same migration-first deployment model that motivated blocker 2, dropping those columns and changing transfer cardinality before the new binary is fully live makes the old binary incompatible. Conversely, deploying the new binary before the destructive migration makes it run against the old shape unless it contains an explicit compatibility phase. The current plan supplies an expand/backfill protocol only for PR-A, not a flip/contract deployment protocol for PR-G.

Transfer collapse also changes identities while current links explicitly identify two transaction rows, and rollback currently hard-deletes transaction IDs directly ([imports.ts:830](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:830)-[imports.ts:835](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:835)). Saying that D16 identity/attachment remapping is “contained” does not establish old/new binary compatibility during rollout.

Required amendment: split PR-G into independently deployable stages, for example:

1. Postings-native application/DTO compatibility while legacy columns and `transfer_links` still exist.
2. Idempotent transfer-collapse and opening-synthesis data migration, with an explicit write freeze or compatible transitional writer.
3. Verification gate.
4. Final contract migration dropping legacy columns/tables.

A documented maintenance-window deployment could substitute for splitting, but the present “one green releasable PR” claim is not supported.

## FINAL VERDICT: STILL-BLOCKING

Genuine remaining blockers:

1. PR-A catch-up repairs only missing postings, not stale postings produced by old-binary updates/link mutations during deployment.
2. PR-A restore does not specify rebuilding postings for older archives that contain legacy transactions but no postings.
3. PR-G dates synthesized column openings before earliest activity rather than at account creation, changing earlier as-of balances—especially for accounts with no activity.
4. PR-G combines incompatible flip, data rewrite, identity remapping, DTO change, and destructive contract migration without a staged deployment or maintenance protocol, so it is not yet a single safely releasable PR.