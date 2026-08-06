# Plan review: task 2.1 — Postings model & balance invariant

## Verdict

The zero-sum conversion itself is correctly identified as an atomic schema/consumer cutover: transfers cannot remain two independently balanced transaction rows, splits must become multiple counter-postings, and removing the header money columns before converting consumers would break both compiled ORM queries and raw SQL.

However, the current plan is not implementation-ready. There are several blocking issues:

1. The proposed compatibility `Transaction` projection is not well-defined for transfers, split notes, or bulk edits.
2. The proposed system-account aggregation does not preserve current liability-inflow semantics.
3. SP0 is neither behavior-neutral nor independently green as written.
4. SP0/SP1 conflicts with the “exactly one `0067_*` migration” verification.
5. Several production consumers are missing from Scope, including the extractor, category merge, review queue, backup CSV, and restore paths.
6. Integer-paise safety is not established because the model continues to use PostgreSQL `bigint` through JavaScript `number`.
7. Leaving legacy tables present is safe only if every route/service capable of populating them is removed or rewritten during SP1.

---

## 1. Incorrect or incomplete assumptions about current behavior

### Opening balance is a dual mechanism, but not a duplicated amount

The plan correctly says both `transactions.is_opening` and `accounts.opening_balance_paise` must disappear, but the investigation’s wording can be read as if an account currently carries the same balance in both places. It does not.

Current behavior is type-dependent:

- Bank and cash accounts carry a non-zero opening balance in an `is_opening` transaction. The account column is forced to zero: [accounts.ts:15](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:15), [accounts.ts:207](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:207), [accounts.ts:210](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:210), [accounts.ts:214](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:214), [accounts.ts:225](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:225).
- Credit cards, loans, investments, and schemes carry the opening balance only in `accounts.opening_balance_paise`, with no opening transaction: [accounts.ts:15](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:15), [accounts.ts:22](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:22), [accounts.ts:88](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:88).
- The invariant is explicitly “column plus transaction sum,” with exactly one source holding the non-zero opening amount: [accounts.ts:66](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:66).

The plan’s target—one opening transaction with an account posting and an Opening Balances posting—does handle both current storage cases conceptually. But it does not describe the existing type-change behavior that must be preserved. `updateAccount` currently moves the opening amount between the two storage mechanisms when account type changes, including choosing the existing opening row over the zeroed column and dating a new row before the earliest ordinary transaction: [accounts.ts:116](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:116), [accounts.ts:124](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:124), [accounts.ts:381](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:381), [accounts.ts:392](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:392), [accounts.ts:402](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:402).

Recommendation: explicitly replace `planOpeningBalanceChange` with a posting-based equivalent that:

- finds the account’s existing opening transaction by its Opening Balances posting;
- updates, inserts, or soft-deletes that whole transaction;
- preserves the existing effective-date rule;
- does nothing merely because an account changes type, since all types will use the same mechanism after cutover.

### Transfer signs are already mechanically derived

The roadmap says the old sign convention stops being something callers must remember. For ordinary transactions that is broadly true, but transfer creation already derives signs rather than accepting two signed amounts:

- the public amount must be a positive integer: [transfers.ts:153](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:153), [transfers.ts:156](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:156);
- the source leg is derived as `-amountPaise` and destination as `+amountPaise`: [transfers.ts:166](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:166);
- linking independently verifies opposite signs and equal magnitude: [transfers.ts:91](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:91).

The proposed single transaction with two real-account postings is correct, but it preserves an existing server-side sign guarantee rather than introducing one.

Also, “two asset postings” is inaccurate. Transfers may involve credit cards, loans, overdrafts, or other liabilities. The correct term is “two non-system account postings.”

### Current splits use signed amounts equal to the parent amount

`setSplits` does not sum positive magnitudes. It requires the signed split amounts to sum exactly to the signed transaction amount: [transactions.ts:342](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:342), [transactions.ts:353](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:353), [transactions.ts:354](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:354).

For a ₹100 expense, current split DTO values sum to `-10000`, while the proposed Expenses-account postings must sum to `+10000`. Therefore hydration must negate system posting amounts when reconstructing legacy `splits`. The plan currently says only that splits are reconstructed; it does not define this sign inversion.

More importantly, `Split` includes `note`: [ledger.ts:370](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:370), and `setSplits` writes it: [transactions.ts:346](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:346), [transactions.ts:360](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:360). The proposed postings schema has no `note`. That makes lossless reconstruction of the retained `splits` DTO impossible.

**Blocking:** either add a posting-level note field in 2.1 or explicitly change/remove the split-note API and web surface.

### “Empty legacy tables” requires eliminating all writers

It is not enough to stop the principal create paths from writing `transfer_links` and `transaction_splits`. Current public/service operations can still populate them:

- `linkTransfer` inserts `transfer_links`: [transfers.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:68), [transfers.ts:98](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:98).
- `autoLinkTransfers` calls it: [transfers.ts:112](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:112), [transfers.ts:125](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:125).
- `setSplits` deletes and reinserts `transaction_splits`: [transactions.ts:357](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:357).
- The shared transfer contract still exposes two transaction IDs and a transfer-link ID: [ledger.ts:539](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:539), [ledger.ts:581](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:581).

SP1 must rewrite or disable these routes and services. Otherwise the tables will not remain empty and the old exclusion predicates will incorrectly classify new transactions.

---

## 2. Missing read/write consumers

The plan’s Scope list is not exhaustive, and investigation sections 2 and 3 also missed production consumers.

### Missing from the plan and investigation

- `modules/ledger/services/categories.ts`: category merge updates both `transactions.category_id` and `transaction_splits.category_id`; it must update posting categories instead: [categories.ts:135](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/categories.ts:135), [categories.ts:153](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/categories.ts:153), [categories.ts:159](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/categories.ts:159).
- `modules/ingest/services/review-queue.ts`: reads `transactions.categoryId` and joins through it: [review-queue.ts:179](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-queue.ts:179), [review-queue.ts:184](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/review-queue.ts:184).
- `apps/extractor/src/db.ts`: direct raw SQL reads `transactions.amount_paise` and `account_id` for statement matching: [db.ts:232](/home/udai/PennyPilot/apps/extractor/src/db.ts:232), [db.ts:246](/home/udai/PennyPilot/apps/extractor/src/db.ts:246), [db.ts:249](/home/udai/PennyPilot/apps/extractor/src/db.ts:249). This is outside `apps/api`, so API-only typecheck/testing can easily miss it.
- `modules/system/services/backup.ts` transaction CSV export selects header amount/account/category columns: [backup.ts:121](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:121), [backup.ts:124](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:124), [backup.ts:134](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:134). The Scope mentions table registration but not CSV behavior.
- `modules/system/services/restore-user.ts` depends on table ordering and user scoping from `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES`: [restore-user.ts:8](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:8), [restore-user.ts:105](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:105), [restore-user.ts:118](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:118).
- `db/restore.ts` restores in `ALL_TABLES` order: [restore.ts:58](/home/udai/PennyPilot/apps/api/src/db/restore.ts:58), [restore.ts:67](/home/udai/PennyPilot/apps/api/src/db/restore.ts:67). `postings` must occur after both `transactions` and `accounts`.

### Present in investigation but absent from Scope

- `modules/ingest/services/import-reconciliation.ts`, which compares signed amounts during exact and nearby matching: [import-reconciliation.ts:35](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/import-reconciliation.ts:35), [import-reconciliation.ts:45](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/import-reconciliation.ts:45), [import-reconciliation.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/import-reconciliation.ts:57).
- Transfer suggestion/link/unlink behavior is nominally covered by `transfers.ts`, but the Scope calls it only part of the write path and does not state that suggestion semantics and the public link/unlink API must be retired or remodeled.
- Tests throughout API and extractor directly insert accounts and legacy transaction columns. AC8 requires converting those fixtures. Examples include the extractor’s direct transaction insert noted by repository search and many API database tests; the plan should explicitly include fixture/test conversion, not only the new property test.

### Account-deletion consumer

`deleteAccount` determines whether an account has ever been used by querying `transactions.accountId`: [accounts.ts:496](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:496), [accounts.ts:509](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:509), [accounts.ts:512](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:512). Under postings this must query postings, including postings belonging to soft-deleted transactions.

It must also reject system accounts before ordinary “used account” logic.

---

## 3. Correctness risks in reported numbers

### Liability-account inflows are a blocking semantic mismatch

Current `incomeExpense` behavior is:

- all negative ordinary transaction amounts count as expense;
- positive amounts count as income only when the account is not a liability type;
- opening rows and linked transfers are excluded.

That is explicit in [periods.ts:10](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:10), [periods.ts:191](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:191), [periods.ts:193](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:193), [periods.ts:195](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:195), [periods.ts:200](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:200).

The proposed rule “positive real-account posting gets an Income posting” changes that behavior. For example, an unlinked positive credit-card or loan transaction currently contributes neither income nor expense. Under the proposed shape it would get an Income posting and be counted as income.

This matters for card refunds and repayments that were not linked as transfers. The existing comment explicitly calls a positive liability amount a repayment or reversal, “never income”: [periods.ts:10](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:10).

**Blocking recommendation:** do not define `incomeExpense` as an unconditional sum of Income/Expenses system-account postings. Preserve the legacy classification rule by either:

- classifying positive liability transactions into a distinct clearing/system equity account, which would expand the three-account roadmap model; or
- allowing an Income counterpart but excluding it in reporting when the corresponding non-system positive posting is on a liability account.

The latter preserves current totals but means “sum the Income account” is not itself the reported-income definition. That distinction must be in the plan and parity tests.

Mapping a positive liability posting to Expenses would also change numbers: current spend queries ignore positive transactions rather than treating them as negative expense/refund.

### Spend category and necessity need explicit sign and category semantics

Current `spentByCategory` counts only negative parent/split amounts and returns their negated magnitude: [periods.ts:58](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:58), [periods.ts:63](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:63), [periods.ts:70](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:70), [periods.ts:76](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:76).

Therefore Expenses postings for ordinary negative transactions will be positive. The replacement query must sum positive Expenses postings, not blindly preserve the old `amount < 0` predicate or negate them.

`spendByNecessity` currently implements transaction-level override precedence, while each split falls back to its own category: [periods.ts:115](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:115), [periods.ts:138](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:138), [periods.ts:152](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:152). Moving necessity to each posting can reproduce this, but split creation must copy the prior transaction override onto every split posting. If it instead stores null and relies only on each category, reported necessity changes.

Category joins must remain tenant-scoped. Current necessity queries intentionally join categories using both category ID and transaction user: [periods.ts:119](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:119), [periods.ts:142](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:142), [periods.ts:157](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:157). A postings table with independent `user_id`, `account_id`, and `category_id` does not by itself guarantee those rows all belong to the same user.

### Merchant/report counts can change when splits become postings

Queries such as top merchants currently count transaction rows, not split rows: the investigation points to `reports.ts`, and the query uses `count(*)` over transactions. If converted by joining Expenses postings, a split transaction will appear N times unless the query counts distinct transaction IDs while summing posting amounts.

The same risk applies to “biggest spend,” recurring detection, bill grouping, and any query where transaction cardinality is meaningful. The plan says “convert every aggregation” but does not state the required header-versus-posting cardinality rules.

### Transfers collapse two visible rows into one

Current transfers produce two transaction rows and return two IDs: [transfers.ts:179](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:179), [transfers.ts:185](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:185), [transfers.ts:190](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:190). The web determines transfer status from `transferLinkId` and treats each transaction as one account leg: [TransactionsPage.tsx:372](/home/udai/PennyPilot/apps/web/src/routes/transactions/TransactionsPage.tsx:372), [AccountLedgerPage.tsx:148](/home/udai/PennyPilot/apps/web/src/routes/accounts/AccountLedgerPage.tsx:148).

One header with two real-account postings has no unique `accountId` or `amountPaise` projection in a global transaction list. It also has only one ID, while `TransferResult` requires `outTransactionId` and `inTransactionId`: [ledger.ts:581](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:581).

Thus central claim (b)—retain the old DTO purely through `hydrate()` and leave web largely untouched—is false for transfers unless an explicit compatibility view emits two synthetic leg DTOs. Synthetic leg IDs introduce their own problems for edit/delete/link/attachment operations.

**Blocking recommendation:** choose and document one of:

- change the transfer DTO/UI in 2.1 to expose one transaction with two account postings; or
- introduce a deliberate compatibility-leg representation with stable composite IDs and define how every mutation maps back to the header.

The former is substantially simpler and more honest about the forced 2.2/2.5 scope absorption.

### Opening transactions may become user-visible differently

Current bank/cash opening balances are real transaction rows and can appear in transaction/account ledgers, though reporting excludes them using `is_opening`: [accounts.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:27), [ledger.ts:60](/home/udai/PennyPilot/apps/api/src/db/shared/ledger.ts:60). Other account types have no opening row.

After cutover every non-zero opening balance becomes a transaction, so card/loan/investment ledgers can gain a visible “Opening balance” row that did not exist before. This may change transaction counts, search results, CSV export, and account-ledger display even if financial totals remain equal.

The plan should decide whether opening transactions are included in generic transaction lists and counts. “No `is_opening`” does not mean the semantic distinction disappears; it can be recognized by the Opening Balances posting.

---

## 4. Recommendations on Q1–Q5

### Q1: `postings.user_id` versus scope through parent

Recommendation: omit `postings.user_id` and put postings in `LINKED_TABLES`.

Reasons:

- `transaction_splits` already establishes exactly this backup precedent: [backup.ts:61](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:61), [backup.ts:67](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:67).
- Balance queries must join transactions anyway to apply date and soft-delete filters; the proposed balance definition explicitly depends on `transactions.date` and `deleted_at`.
- A denormalized user ID can disagree with both the parent transaction’s user and account’s user. Separate foreign keys do not enforce equality.
- Every user-facing table must be tenant-scoped: [CLAUDE.md:45](/home/udai/PennyPilot/CLAUDE.md:45). Scoping through a user-owned parent satisfies that without redundant mutable identity.
- Account-scoped lookup performance comes from an index on `postings.account_id`; it does not require `user_id`.

If denormalized `user_id` is retained, the plan must add database-enforced composite ownership constraints or a trigger, not merely service assertions. Otherwise backup/export isolation and query scoping can diverge.

### Q2: Is SP0 green and behavior-neutral?

No.

First, seeded system accounts leak immediately because existing account reads do not filter `system_kind`:

- `listAccounts` filters only by user ID and returns every account: [accounts.ts:179](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:179), [accounts.ts:192](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:192).
- Net worth reads every unarchived account: [accounts.ts:157](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:157), [accounts.ts:171](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:171), then requires every account type to have a classification: [networth.ts:30](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:30), [networth.ts:70](/home/udai/PennyPilot/apps/api/src/modules/investments/services/networth.ts:70).
- `accounts.type` is non-null, so every system account must masquerade as a real account type unless the account type enum is also extended: [hubs.ts:55](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:55), [hubs.ts:57](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:57). Any chosen real type can leak into bank/cash, card, loan, or investment-specific queries.

Second, SP0 says to register postings only in `ALL_TABLES`. That fails backup parity: every table must be represented by `USER_TABLES` or `LINKED_TABLES`, and `exportGaps()` checks exactly that: [backup.ts:76](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:76), [backup.ts:82](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:82). SP0 must register postings in both `ALL_TABLES` and the chosen scoping map.

Third, registration currently seeds only categories: [auth.ts:19](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:19), [auth.ts:38](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:38), [auth.ts:44](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:44). Adding system accounts affects registration tests and fresh-account restore behavior. `restoreUserBackup` currently expects accounts to be empty before restore: [restore-user.ts:13](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:13), [restore-user.ts:68](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:68). If registration seeds three accounts, restore will always reject a fresh registered user before reaching its seeded-data cleanup.

Recommendation: either:

- make SP0 purely schema/helper-additive with an empty postings table and no system-account rows; seed/filter system accounts atomically in SP1; or
- expand SP0 to update every account enumerator, ownership guard, registration test, and restore guard. That is no longer “zero behavior change.”

The first option is preferable.

### Q3: Can the DTO remain projected, including mutation round-trips?

For ordinary one-real-account transactions, yes, with strict projection rules:

- `accountId` and `amountPaise` come from the single non-system posting;
- `categoryId` and `necessity` come from the single counter-posting;
- split amounts must be negated to retain current signed DTO semantics;
- split notes require storage on postings or removal from the contract.

`updateTransaction` must separate header patches from posting patches. Today it spreads the entire input directly into the header update: [transactions.ts:288](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:288), [transactions.ts:309](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:309). Under postings:

- changing `accountId` moves the real posting;
- changing `amountPaise` updates both sides while preserving exact negation;
- changing category or necessity updates the relevant system posting(s);
- changing a split transaction’s amount requires a defined policy: reject until splits are updated, proportionally rescale, or update one residual split. Silent proportional rescaling would introduce rounding and should not be used;
- transfer and opening shapes must have separate mutation rules.

Bulk category actions are also round-trips. They currently read/write `transactions.categoryId`: [transactions.ts:400](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:400), [transactions.ts:413](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:413). They must update all applicable Expenses/Income postings without touching transfers or openings.

For transfers, the old DTO cannot be uniquely projected, as discussed above. Therefore the answer to Q3 is “yes for simple transactions, no for transfers without a new compatibility representation.”

### Q4: Reconciliation adjustment target

Yes, the balancing account should be Opening Balances, but the plan should update the existing opening transaction rather than append an independently counted adjustment each time.

The actual write at line 304 is in `absorbCarryover`, not generic recomputation. It computes:

`nextOpeningBalance = currentOpeningBalance - drift`

and explicitly rejects unsafe integers: [reconciliation-writes.ts:290](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:290), [reconciliation-writes.ts:295](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:295), [reconciliation-writes.ts:298](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:298), [reconciliation-writes.ts:302](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:302).

For a credit-card drift `D`, the equivalent posting change is:

- card posting decreases by `D`;
- Opening Balances posting increases by `D`.

This pair should be inserted or merged into the account’s canonical opening transaction, dated at the account’s opening effective date. Repeated reconciliation must be idempotent: re-derive, compute only the remaining drift, and update by that delta.

The existing operation is serializable and coordinates by locking the account first: [reconciliation-writes.ts:195](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:195), [reconciliation-writes.ts:243](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:243). Moving the value out of the account row removes that natural serialization target unless the code continues locking the account row before updating opening postings. Preserve that lock order.

### Q5: Empty-but-present legacy tables

An empty `NOT EXISTS` subquery is always true, so it does not change a result relative to removing the predicate. Leaving the physical tables present is numerically harmless if they are guaranteed empty.

But that guarantee requires all writers and public operations to be converted in SP1. In particular, `linkTransfer`, `autoLinkTransfers`, `unlinkTransfer`, `suggestTransfers`, and `setSplits` cannot retain their current implementations.

There is also a contract issue: task 2.2 currently promises transfer retirement and task 2.3 promises split folding, while this plan necessarily performs their semantic conversion in 2.1. The follow-ons can still drop dead tables/routes/code, but they are cleanup tasks, not the functional remodeling described by the roadmap. Update their task descriptions and dependencies to reflect that reality.

---

## 5. SP0/SP1/SP2 assessment

### SP0 is not valid as written

In addition to account leakage and backup coverage, there is a migration-number contradiction:

- SP0 “ships” a new postings table and `system_kind`, which requires a schema migration.
- SP1 later drops transaction/account columns, which requires another schema migration.
- Verification T1 requires exactly one new `0067_*` migration: [TASK.md:43](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:43), [TASK.md:45](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:45), [TASK.md:59](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:59).

Both cannot be true. If SP0 is independently merged/shipped, SP1 should generate `0068_*`. If there must be exactly one migration, SP0 and SP1 are development sequencing inside one unshipped branch, not independently shippable changesets.

Recommendation:

- SP0: pure TypeScript posting-shape helpers and property tests only, with no schema or seeded-data change.
- SP1: one atomic schema migration plus system-account seeding, all read/write conversions, shared-contract changes, and required web changes.
- SP2: parity verification.

Alternatively, allow two migrations and remove the “exactly one `0067_*`” requirement.

### System account identity needs stronger schema design

A nullable `system_kind` enum alone does not ensure one account of each kind per user. Add a unique partial index on `(user_id, system_kind)` where `system_kind is not null`.

Also define:

- the mandatory `accounts.type` value used by system accounts;
- exclusion from every generic account query, not only named user-facing lists;
- refusal by `assertOwnedAccount` when a client supplies a system-account ID;
- update/delete/archive guards;
- idempotent seeding;
- restore behavior for archives containing system accounts;
- whether imported backups use archived IDs or regenerate system accounts and remap postings.

Without those rules, a guessed system account ID can be supplied through the retained simple transaction API because current ownership checking verifies only account ownership, not account kind.

### SP2 parity is too narrow

Bank/cash, net worth, and aggregate income/expense are insufficient. Add parity fixtures for:

- positive credit-card/loan transaction not linked as transfer;
- negative liability transaction;
- card refund;
- linked bank-to-card transfer;
- split expense with per-split categories and transaction-level necessity override;
- opening balances for bank, card, loan, and investment types;
- account type change with an existing opening amount;
- reconciliation carryover applied twice;
- top-merchant count with a split transaction;
- transaction list totals and filters;
- account-ledger transaction count/visibility;
- CSV export;
- extractor statement matching.

---

## 6. Integer-paise safety

AC6 is not satisfied by the proposed plan.

The database columns use PostgreSQL `bigint` but Drizzle maps them to JavaScript `number`: [ledger.ts:41](/home/udai/PennyPilot/apps/api/src/db/shared/ledger.ts:41), [hubs.ts:82](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:82). Shared schemas require only `.int()`, not `.safe()`: [ledger.ts:413](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:413), [ledger.ts:430](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:430), [ledger.ts:479](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:479).

Current split summation uses ordinary number addition: [transactions.ts:353](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:353). The proposed `assertZeroSum(postings)` will lose the ability to detect a one-paisa perturbation when totals exceed `Number.MAX_SAFE_INTEGER`. SQL aggregates are also converted with `Number(...)`, for example [balances.ts:37](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:37), [periods.ts:204](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:204), and [backup.ts:134](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:134).

Concrete recommendation:

- Make every money input schema use `z.number().int().safe()`.
- Check `Number.isSafeInteger` after every addition, subtraction, and negation used to derive postings.
- Implement `assertZeroSum` using `bigint`, converting only already-validated safe integer inputs via `BigInt(amountPaise)`.
- Prefer PostgreSQL `bigint` as string/bigint at persistence boundaries if balances can legitimately exceed the safe-number range.
- Ensure SQL aggregates are range-checked before conversion to number.
- Generate property-test values near zero and near `±Number.MAX_SAFE_INTEGER`, not only small random amounts.
- Never proportionally rescale splits. Require the caller to submit an exact new split allocation or apply an explicitly selected residual-leg adjustment.

The reconciliation service already demonstrates the appropriate refusal pattern with `Number.isSafeInteger`: [reconciliation-writes.ts:297](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:297).

---

## 7. Acceptance criteria and conventions

### AC1: postings table; header has no account or amount

Structurally planned, but the compatibility story for transfer IDs and leg DTOs is unresolved. The DB criterion can be met; the retained public contract cannot be met as currently described.

### AC2: zero-sum invariant on write and property test

Not fully satisfied.

A pure assertion helper is insufficient unless every header/posting mutation is transactionally wrapped. Current `createTransaction` accepts `DbOrTx` and, when passed a plain `Db`, performs one insert without opening a transaction: [transactions.ts:254](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:254), [transactions.ts:281](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:281). Creating the header and postings in separate non-transactional statements could leave an orphan header.

The plan should require:

- header and postings inserted/updated/deleted in one DB transaction;
- zero-sum assertion immediately before persistence;
- no direct posting writer outside the invariant-enforcing helper;
- bulk, split, transfer, opening, import, recurring, reconciliation, and demo paths all routed through that helper.

Task 2.6’s later database trigger is acceptable, but service-level enforcement in 2.1 must actually cover every writer.

### AC3: balance solely from postings

Conceptually satisfied, provided all account queries and reconciliation arithmetic are converted and system accounts are excluded. The account-deletion “ever used” guard must also move to postings.

### AC4: system accounts seeded and not deletable

Not yet satisfied by the plan’s detail. “Guard in accounts service” needs to cover edit, archive, delete, and using a system account through ordinary transaction input. A uniqueness constraint and restore behavior are also missing.

### AC5: category and necessity on posting

Structurally satisfied, but split-note loss and necessity-copy semantics remain unresolved. Category merge is missing from Scope.

### AC6: integer paise throughout

Not satisfied for the reasons above. `number().int()` plus a number-based reducer is not paisa-safe over a PostgreSQL bigint domain.

### AC7: table-list parity

SP0 explicitly says only `ALL_TABLES`, which is insufficient. The current registry has separate exhaustive scoping maps: [backup.ts:28](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:28), [backup.ts:43](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:43), [backup.ts:66](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:66). Postings must be in `ALL_TABLES` and exactly one of `USER_TABLES` or `LINKED_TABLES`, in correct restore order.

### AC8: typecheck, lint, tests

The stated Scope cannot reach AC8 because omitted consumers will fail compilation or runtime tests, especially category merge, review queue, backup CSV, extractor SQL, restore behavior, and legacy fixtures.

### Schema/module conventions

The proposed physical location is correct if postings is added beside the shared `transactions` table in `db/shared/ledger.ts`. The ledger module must re-export it from `modules/ledger/schema.ts`, matching the existing re-export at [schema.ts:34](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:34). The central barrel should continue exporting `db/shared/ledger.ts` exactly once: [db/schema.ts:18](/home/udai/PennyPilot/apps/api/src/db/schema.ts:18), [db/schema.ts:22](/home/udai/PennyPilot/apps/api/src/db/schema.ts:22).

Do not define postings again in `modules/ledger/schema.ts`; that would violate the shared-layer ownership and single-export rules documented in [CLAUDE.md:49](/home/udai/PennyPilot/CLAUDE.md:49). Drizzle Kit must continue using only `db/schema.ts`, as required by [CLAUDE.md:27](/home/udai/PennyPilot/CLAUDE.md:27) and [CLAUDE.md:72](/home/udai/PennyPilot/CLAUDE.md:72).

### Unnecessary complexity / roadmap mismatch

The empty-but-present legacy tables are a reasonable transitional cleanup seam. The unnecessary complexity is claiming that the old transfer DTO can remain unchanged while collapsing two rows into one header. That compatibility layer would be more complex and fragile than updating the transfer contract and the small number of transfer-aware web consumers.

The roadmap currently places:

- transfer retirement in 2.2,
- split folding in 2.3,
- consumer conversion in 2.4,
- simple/multi-leg API work in 2.5,

as shown in [README.md:107](/home/udai/PennyPilot/tasks/README.md:107) through [README.md:113](/home/udai/PennyPilot/tasks/README.md:113). The plan correctly discovers that substantial parts of all four are forced into 2.1. That should be recorded as an explicit roadmap rescope, not described as though 2.2–2.5 remain unchanged.

## Required plan changes before approval

1. Define the transaction projection separately for ordinary, split, opening, and transfer shapes.
2. Resolve transfer API/DTO identity; do not claim one header can trivially project as two legacy transaction rows.
3. Add posting notes or explicitly remove split-note compatibility.
4. Preserve liability-inflow exclusions in every income aggregation.
5. Add category merge, review queue, import reconciliation, extractor SQL, backup CSV, restore paths, and test fixtures to Scope.
6. Make SP0 schema/data-neutral, or admit it is behavioral and update all account/restore consumers.
7. Resolve the one-migration versus independently shipped SP0/SP1 contradiction.
8. Choose `LINKED_TABLES` scoping for postings, or add database-enforced cross-user consistency for denormalized `user_id`.
9. Add unique per-user system-account constraints and complete access guards.
10. Specify transactional enforcement for every posting writer.
11. Add safe-integer/BigInt rules and boundary property tests.
12. Expand parity verification to liability inflows, refunds, splits, opening balances, reconciliation, merchant counts, transaction counts, CSV, and extractor matching.

Until those issues are addressed, AC2, AC4, AC6, AC7, and AC8 are not actually guaranteed, and the central “web largely untouched via `hydrate()`” claim is not valid for transfers.