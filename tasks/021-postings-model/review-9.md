## Review findings

### A3 blockers

1. Linked transfer legs can be edited into an invalid pair.

`updateTransaction` allows `accountId` and `amountPaise` to change, then rebuilds only the edited row ([transactions.ts:389](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:389), [transactions.ts:412](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:412), [transactions.ts:423](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:423)). Because the canonical rebuild sees `transfer_links` membership, it retains Clearing shape using the edited row’s new signed amount ([transactions.ts:209](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:209), [transactions.ts:213](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:213)).

For example, editing the out leg from `-100` to `-80` produces:

- out row: `[A:-80] + [Clearing:+80]`
- unchanged in row: `[B:+100] + [Clearing:-100]`

Both rows remain locally zero-sum, but Clearing totals `-20`; the pair no longer represents a transfer of one amount. Changing one leg’s account similarly mutates the transfer’s identity without coordinated validation.

This violates the plan’s paired Clearing invariant ([PLAN-dualwrite.md:14](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:14)) and is reachable through a normal A3 writer. The writer must either reject posting-affecting edits of linked legs, atomically update/revalidate both legs, or unlink/invalidate the transfer and rebuild both rows. This cannot wait for A4 because `updateTransaction` itself ships in A3.

2. `linkTransfer` does not make validation and link creation atomic, and admits incompatible legacy shapes.

The two rows are validated before entering the transaction that inserts the link and rebuilds postings ([transfers.ts:75](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:75), [transfers.ts:92](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:92), [transfers.ts:103](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:103)). Another writer can change a leg after validation and before the link insert. The resulting link can therefore join rows that are no longer opposite/equal or are now in the same account. Re-reading and locking both rows inside the link transaction is required.

In addition:

- There is no `isOpening` rejection. An opening row can be inserted into `transfer_links`, but canonical branch priority keeps Opening postings ([transactions.ts:202](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:202)) while the legacy DTO treats transfer-link membership as a transfer. That creates a link whose postings are not Clearing and disproves branch mutual exclusivity for real writable data.
- The schema makes `out_transaction_id` and `in_transaction_id` separately unique ([schema.ts:64](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:64), [schema.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:68)), but does not stop a transaction already used as an out leg from being reused as an in leg of another link, or vice versa. `linkTransfer` does not perform the cross-role membership check.
- Split rows are accepted. This part is supportable: transfer membership correctly overrides split shape, and unlinking restores split shape. It needs an explicit behavioral test, not necessarily rejection.

These are A3 blockers because `linkTransfer`, manual linking, `autoLinkTransfers`, `createTransfer`, and auto-covered ingest writers all depend on this primitive.

## Shape correctness

For rows that satisfy the intended shape invariants, the generated postings are correct:

- Ordinary: the real leg copies the legacy signed amount and the Expenses/Income counter negates it, carrying category and necessity ([postings.ts:74](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:74), [postings.ts:82](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:82), [postings.ts:90](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:90)).
- Split: the real leg is the exact BigInt-safe sum of the splits, with one signed Expenses/Income counter per split, including category, parent necessity, and note ([postings.ts:110](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:110), [postings.ts:121](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:121), [transactions.ts:225](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:225)). `setSplits` still requires the split total to equal the parent amount ([transactions.ts:465](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:465)).
- Opening row: `[A:amount] + [Opening:-amount]` is exact ([postings.ts:185](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:185)).
- Transfer leg: it uses that row’s own signed legacy amount, not a magnitude derived from its counterpart ([transactions.ts:213](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:213), [postings.ts:218](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:218)). Thus each row balances locally and a valid opposite/equal pair nets Clearing to zero.
- Zero amounts select Income rather than Expenses ([postings.ts:91](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:91)); that matches the implemented builder policy, although public ordinary creation currently rejects zero.

The canonical rebuild order is exactly opening → transfer-link membership → split → ordinary ([transactions.ts:202](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:202), [transactions.ts:209](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:209), [transactions.ts:220](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:220), [transactions.ts:236](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:236)).

That order is appropriate, but the branches are not inherently mutually exclusive:

- A split row can deliberately become a transfer leg; transfer priority is correct, and unlink restores its splits.
- An opening row can currently be linked, which is invalid and mishandled as described above.
- Cross-role link reuse can give one row membership in multiple links.

## Atomicity

The implemented happy-path transaction boundaries are otherwise correct:

- `createTransaction` puts the legacy insert and ordinary mirror in one transaction; a `Tx` caller gets nested/savepoint behavior ([transactions.ts:364](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:364), [transactions.ts:368](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:368), [transactions.ts:383](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:383)).
- `updateTransaction` updates and rebuilds within the same transaction ([transactions.ts:410](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:410)).
- `setSplits` replaces split rows and postings within one transaction ([transactions.ts:469](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:469)).
- Bulk restore and set-category rebuild in their enclosing transactions ([transactions.ts:487](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:487), [transactions.ts:518](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:518)).
- Opening-row insertion/update and posting rebuild occur within the account transaction ([accounts.ts:213](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:213), [accounts.ts:228](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:228), [accounts.ts:438](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:438), [accounts.ts:451](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:451)).
- Link insertion and both posting replacements are in one transaction ([transfers.ts:103](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:103)); unlink deletion and both rebuilds are likewise atomic ([transfers.ts:147](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:147)).
- `createTransfer` opens an outer transaction, creates two ordinary mirrored rows, then calls nested `linkTransfer`, which replaces both ordinary shapes with Clearing shapes before the outer commit ([transfers.ts:201](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:201)). No intermediate ordinary state is externally committed.

`replacePostings` itself does not open a transaction; delete and insert would be separate autocommits if called with bare `Db` ([post-entry.ts:41](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:41), [post-entry.ts:60](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:60)). All reviewed A3 callers correctly pass a transactional handle. The primitive remains a convention foot-gun for A4–A7 and should have tests or a transaction-only type/API if practical.

## Writer completeness in the three A3 files

Correctly covered:

- `createTransaction`: ordinary mirror.
- `updateTransaction`: re-reads current row, transfer membership, and current splits after the update, so mutable account, amount, category, and necessity are reflected ([transactions.ts:198](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:198), [transactions.ts:220](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:220)).
- `setSplits`: split creation/replacement and split→ordinary transition.
- `softDeleteTransaction`: intentionally retains postings; readers exclude through the parent ([transactions.ts:441](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:441)).
- Bulk delete, add-tag, and remove-tag: correctly write no postings ([transactions.ts:543](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:543), [transactions.ts:553](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:553), [transactions.ts:560](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:560)).
- Bulk restore rebuilds resulting shape.
- Bulk set-category rebuilds every affected row. For linked/opening rows this does not actually touch Clearing/Opening: branch priority regenerates the same category-free system leg. For split rows, parent `categoryId` changes but split-derived categories correctly remain those of the split rows.
- Account opening-row creation and update mirror postings; opening-row deletion is soft-delete with no posting mutation ([accounts.ts:463](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:463)).
- Column-opening account paths create no postings. `createAccount` only creates an opening transaction when `seedsOpeningTransaction` selects the row model ([accounts.ts:212](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:212)); `updateAccount` applies the planned row/column representation and only rebuilds row operations ([accounts.ts:394](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:394)).
- `deleteAccount` requires no A3 posting operation under the existing rule that referenced transactions prevent deletion.
- `suggestTransfers` is read-only ([transfers.ts:37](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:37)); `autoLinkTransfers` routes mutations through `linkTransfer` ([transfers.ts:121](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:121)).

One concurrency weakness outside the principal blockers: `setSplits` reads and validates the parent before entering its write transaction ([transactions.ts:460](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:460)). A concurrent amount update can make the validated total stale. The subsequent builder remains safe and locally balanced, but the mirrored real leg can then disagree with the parent amount. The parent should be re-read/locked inside the transaction. Because the plan’s characterization invariant requires the real leg to equal the parent, this should be fixed with A3 rather than left solely to A7 tests.

## Auto-covered and header-only writers

Confirmed auto-covered:

- `review-actions.ts` creates accepted ledger rows through `createTransaction` ([review-actions.ts:95](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-actions.ts:95)); it has no direct transaction insert.
- `insurance.ts` logs premiums through `createTransaction` ([insurance.ts:323](/home/udai/PennyPilot/apps/api/src/modules/protection/services/insurance.ts:323)).
- `epf-contributions.ts` uses `createTransaction` inside its surrounding category transaction ([epf-contributions.ts:51](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/epf-contributions.ts:51), [epf-contributions.ts:54](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/epf-contributions.ts:54)).
- `transfer-classification.ts` creates rows through `createTransaction` and links them through `linkTransfer` ([transfer-classification.ts:90](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:90), [transfer-classification.ts:101](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:101), [transfer-classification.ts:112](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:112)). Repayment acceptance likewise uses `createTransaction` and `linkTransfer` ([transfer-classification.ts:260](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:260), [transfer-classification.ts:273](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/transfer-classification.ts:273)). It inherits both correct mirroring and the `linkTransfer` blockers.

Confirmed header/FK-only:

- `merchants.ts` changes only `merchant` and `updatedAt` ([merchants.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/merchants.ts:57)).
- `sip-lifecycle.ts` clears only `sipId` and updates timestamps ([sip-lifecycle.ts:503](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:503), [sip-lifecycle.ts:517](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:517)).
- `sip-installments.ts` links/unlinks only `sipId` ([sip-installments.ts:319](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:319), [sip-installments.ts:385](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-installments.ts:385)).
- `reconciliation-writes.ts` changes only `reconciledStatementId` on transaction rows ([reconciliation-writes.ts:129](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:129), [reconciliation-writes.ts:140](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:140)). Its carryover adjustment is the opening column model and correctly has no postings during dual-write.

None of these header-only paths changes account, amount, category, necessity, splits, opening status, or transfer membership.

## Tenant scope and numeric safety

`replacePostings` re-verifies that the transaction belongs to `userId`, then checks every posting account and category before deleting anything ([post-entry.ts:49](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:49), [post-entry.ts:55](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:55)). The canonical rebuild reads the row by ID without `userId` ([transactions.ts:198](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:198)), but a foreign row cannot be mutated because `replacePostings` rejects it before deletion. There is no cross-tenant write gap in the reviewed callers, though tenant-scoping the initial read would be clearer and avoid doing foreign-row-derived work.

System accounts are resolved by user and all four kinds are required ([post-entry.ts:160](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:160)). Builder callers choose the correct resolved kind. `replacePostings` verifies ownership but not that a supplied system account has the expected kind; that is acceptable for these typed builder call sites but must be addressed by A6 restore validation and A7 invariant checks.

Posting arithmetic itself is sound:

- Every posting amount must be a safe integer.
- Sums and zero-sum validation use `BigInt` ([postings.ts:26](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:26), [postings.ts:36](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:36), [postings.ts:51](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:51)).
- `replacePostings` repeats zero-sum validation before writes ([post-entry.ts:47](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:47)).

However, input conventions remain weaker:

- `buildTransferLegs` uses `Number.isInteger`, not the plan-mandated `Number.isSafeInteger` ([transfers.ts:172](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:172)).
- The shared transaction, split, and transfer schemas also use `.int()` without a safe-integer refinement ([ledger.ts:413](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:413), [ledger.ts:474](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:474), [ledger.ts:570](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:570)).
- `setSplits` validates the total using Number addition ([transactions.ts:465](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:465)).
- `linkTransfer` validates equality with `out.amountPaise + inn.amountPaise` ([transfers.ts:92](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:92)).

The builders prevent unsafe postings from committing, so these do not create a committed non-zero-sum posting set. Nevertheless, `buildTransferLegs` directly violates the stated D12 convention and should be changed now; shared `SafePaiseSchema` adoption belongs to the relevant broader A4/A7 boundary unless already in another assigned slice.

## Transfer/opening deletion edges and deferrals

- Unlink correctly restores a surviving split leg because it deletes the link before canonical rebuild; the split branch then becomes visible ([transfers.ts:152](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:152), [transactions.ts:220](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:220)).
- If a transfer counterpart is hard-deleted, the FK cascades the link ([schema.ts:67](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:67)). Nothing in A3 then rebuilds the surviving row from Clearing to ordinary. The plan explicitly assigns hard-delete/import rollback and auto-link invalidation to later writer work. This is an A4/A5 follow-up, provided no reviewed A3 API hard-deletes transaction rows.
- Calling `unlinkTransfer` after one leg has already been hard-deleted yields 404 because the link has cascaded away; it cannot repair the survivor. A4 rollback/hard-delete handling must explicitly capture and rebuild the counterpart before or as part of deletion.
- Full stale-shape reconciliation, idempotency, and pruning belong to A5.
- Full per-row invariant/parity/property coverage belongs to A7.
- Clearing-aware reader classification remains PR-B; the existing classifier currently labels one-real/one-Clearing as ordinary ([postings.ts:266](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:266), [postings.ts:268](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:268)). It is unused by A3 writers and is therefore deferred.

## Tests and regressions

TypeScript typecheck passed.

The focused pure posting-builder test passed 20/20, including ordinary, split, opening, both transfer-leg signs, safe-integer boundaries, and zero-sum properties.

There are no DB-backed A3 writer tests demonstrating:

- create/update/setSplits rollback if posting replacement fails;
- ordinary↔split transitions;
- opening insert/update/delete behavior;
- createTransfer’s temporary ordinary postings being replaced by Clearing;
- link/unlink split restoration;
- linked-leg edit handling;
- opening-row link rejection;
- cross-role duplicate-link rejection;
- validation/link concurrency;
- setSplits versus concurrent amount update;
- tenant-scope rejection by `replacePostings`.

A7 owns the full matrix, but regression tests for the two blocking transfer rules and transactional writer behavior should accompany the A3 fixes.

The attempted broad API test command failed because the local database has not applied the additive migration (`accounts.system_kind` is absent). It also exposed the expected pre-A6 backup coverage failure (`postings` missing from `ALL_TABLES`). Those are environment/A6 matters, not evidence against the focused A3 implementation.

## Verdict

**A3-HAS-BLOCKERS**

Must fix before A4–A7:

1. Preserve or invalidate transfer-pair invariants when `updateTransaction` changes a linked leg’s account or amount.
2. Move `linkTransfer` row validation into its transaction with locking/re-read; reject opening rows and any existing transfer membership across either role.
3. Move `setSplits` parent read/validation into the transaction and serialize it against concurrent posting-affecting transaction edits.

Deferred: import hard-delete/rollback/auto-link invalidation in A4, full reconciliation in A5, restore/system-kind validation in A6, and the full invariant/parity/concurrency matrix in A7.