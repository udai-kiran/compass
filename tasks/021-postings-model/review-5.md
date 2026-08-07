# FINAL VERDICT: STILL-BLOCKING

The incremental direction is viable, and the Clearing representation can provide exact reporting parity during migration. The current plan is not yet implementation-ready because PR-A omits several state transitions and deployment/restore requirements that can leave legacy rows and postings permanently divergent.

## Genuine blockers

1. **The opening-column synthesis described in the plan double-counts legacy balances.**

   The plan creates a synthetic transaction carrying `[A: opening] + [Opening: -opening]` while retaining `accounts.opening_balance_paise` as the legacy source of truth ([PLAN-dualwrite.md:17](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:17)). Current balances are explicitly:

   `accounts.opening_balance_paise + sum(transactions.amount_paise)`

   in [balances.ts:27](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:27), [accounts.ts:163](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:163), and [accounts.ts:197](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:197).

   If the synthetic legacy transaction has `amount_paise = opening_balance_paise`, every legacy reader doubles the opening balance immediately. If it instead has zero legacy amount, it is an intentional exception to the claimed row-local mapping and must be specified as such.

   The proposed date is also wrong for exact historical parity. The plan says “earliest activity” ([PLAN-dualwrite.md:17](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:17)), while the existing opening-row rule is the day **before** earliest ordinary activity ([accounts.ts:75](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:75), [accounts.ts:111](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:111)). More fundamentally, a column opening balance currently applies to every queried as-of date; reconciliation explicitly treats it as effective from account creation/history ([reconciliation-writes.ts:215](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:215)). Dating the posting near earliest activity changes balances for earlier as-of dates.

   **Required amendment:** keep `opening_balance_paise` as an explicit addend in postings-based balance readers through PR-F, and synthesize opening transactions only in PR-G while zeroing/dropping the column atomically. If early synthesis is retained, define a zero-amount legacy header, use an account-creation effective date, document the row-local exception, and mirror every later column mutation.

2. **PR-A cannot safely deploy alongside the old application without a write-gap protocol.**

   A migration that backfills postings and a new binary that begins dual-writing cannot be made race-free merely by being in the same PR. In the normal migration-first deployment:

   1. Migration adds and backfills postings.
   2. Old application remains live briefly.
   3. Old application inserts or updates legacy rows without postings.
   4. New dual-writing application starts.

   Those intervening writes are permanently missing. The application has many high-volume direct writers, including import reconciliation and bulk insert ([imports.ts:641](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:641), [imports.ts:703](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:703)) and recurring materialization ([recurring.ts:287](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:287), [recurring.ts:303](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:303), [recurring.ts:330](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:330)).

   **Required amendment:** specify a real expand/backfill protocol, such as:

   - additive schema migration;
   - deploy compatible dual-writers;
   - idempotent catch-up backfill after deployment, under a suitable lock or repeatedly until no unmapped rows remain;
   - enforce/monitor “every applicable transaction has the expected posting shape” before converting readers.

   A maintenance window or temporary DB trigger would also close the gap, but the current plan has no mechanism.

3. **Transfer link lifecycle is not fully mapped; several real paths would leave stale Clearing postings.**

   Linking and unlinking are not metadata-only under this model. They change a row between ordinary/split system postings and Clearing postings. Current operations only insert/delete `transfer_links` ([transfers.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:68), [transfers.ts:98](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:98), [transfers.ts:134](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:134)). PR-A must atomically replace postings for **both** legs with the link mutation.

   Two less-obvious paths are missing:

   - Import reconciliation deletes auto-links when it edits one leg ([imports.ts:641](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:641), [imports.ts:669](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:669)). It must reconstruct ordinary or split postings for both formerly linked legs, including the untouched counterpart, before auto-linking again.
   - Import rollback hard-deletes transaction rows ([imports.ts:830](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:830)). The FK cascades away the link ([schema.ts:64](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:64), [schema.ts:68](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:68)), but the surviving counterpart would retain Clearing postings and remain falsely transfer-excluded.

   Linking or unlinking a transaction with `transaction_splits` also must restore the split posting shape, not blindly build an ordinary pair; splits are retained and replaceable today ([transactions.ts:342](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:342)).

   **Required amendment:** enumerate explicit posting transitions for manual link, auto-link, unlink, auto-link invalidation, hard deletion of either leg, and rollback restoration, all atomically with the corresponding legacy/link operation.

4. **PR-A breaks user restore unless D19 restore handling moves forward from PR-F.**

   Registration will seed system accounts in PR-A, as the current integration already illustrates ([auth.ts:39](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:39), [auth.ts:46](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:46)). But restore currently requires `accounts` to be completely empty ([restore-user.ts:13](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:13), [restore-user.ts:67](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:67)). A freshly registered user with four seeded system accounts therefore receives a 409 before restore begins.

   In addition, the current generic restore rewrites only `user_id` and file keys ([restore-user.ts:118](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:118)); it cannot remap posting `account_id` values to regenerated system accounts. The current deletion loop deletes all user-owned account rows ([restore-user.ts:105](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:105)), contrary to the proposed D19 behavior.

   Since PR-A registers postings in `ALL_TABLES`/`LINKED_TABLES`, archives produced immediately after PR-A contain postings automatically ([backup.ts:66](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:66), [backup.ts:93](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:93)). Restore compatibility cannot wait until PR-F.

   **Required amendment:** move the fresh-guard exception, seeded-account retention/regeneration, system-kind ID mapping, posting rewrite, and old-archive compatibility into PR-A. PR-F may change CSV projection, but correctness of JSON backup/restore must ship with the new tables.

5. **The proposed safety-net assertion is incorrectly defined and insufficient to detect row-local divergence.**

   The literal assertion “for every account `sum(postings) == legacy balance`” ([PLAN-dualwrite.md:22](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:22)) is not true or meaningful unless it specifies:

   - real accounts only;
   - postings joined to non-soft-deleted transactions;
   - the same date cutoff as the legacy reader;
   - how column-based openings are represented;
   - safe handling of SQL `bigint` before conversion to JavaScript.

   System-account posting sums have no legacy account balance counterpart. Soft deletion currently changes only `transactions.deleted_at` ([transactions.ts:331](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:331)); postings remain physically present and must be excluded through the parent transaction. Bulk delete/restore similarly only toggles `deleted_at` ([transactions.ts:367](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:367), [transactions.ts:435](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:435)).

   An account-level total can also hide equal-and-opposite errors across two transactions, so it does not localize divergence as claimed.

   **Required amendment:** add a per-transaction characterization check:

   - active ordinary row: one real posting exactly equal to legacy account/amount plus the correct Income/Expenses counter;
   - split row: real leg equals parent amount and counters exactly reproduce every split/category/note/necessity;
   - linked transfer leg: real leg equals the legacy row and one opposite Clearing leg;
   - opening row: real leg equals the legacy amount and Opening counter;
   - deleted rows: either retain the same posting shape but are excluded through `transactions.deleted_at`, or follow a separately stated deletion rule;
   - no applicable transaction is missing postings and no transaction has duplicate/unexpected postings.

   Keep account/report parity as an additional end-to-end check, not the primary writer invariant.

## Mutation-path assessment

The mapping itself is arithmetically sound for ordinary, split, transfer-leg, and opening-row creation. It is not yet a complete dual-write design for the real mutation graph.

- `updateTransaction` can change account, amount, category, and necessity together via the spread update at [transactions.ts:288](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:288) and [transactions.ts:309](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:309). PR-A must lock/read the complete resulting legacy shape and rebuild postings in the same outer DB transaction. Calling the existing nested `replacePostings` after the legacy update would not be atomic unless both share an explicit outer transaction; the current helper starts its own transaction ([post-entry.ts:81](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:81)).

- A split transaction’s amount cannot be changed independently without a defined policy. Current `updateTransaction` allows it, while `setSplits` only checks totals when splits are separately replaced ([transactions.ts:353](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:353)). D15’s reject-or-explicit-allocation rule still applies. The plan does not restate it.

- `setSplits` deletes and reinserts the legacy splits in one transaction ([transactions.ts:357](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:357)). Posting replacement must occur inside that same callback. Its total currently uses ordinary JavaScript addition ([transactions.ts:353](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:353)); under D12 it should use the shared BigInt-backed safe sum.

- Soft delete and bulk delete need not physically delete postings, but every posting reader must join the parent and require `deleted_at IS NULL`. Bulk restore can change category and deleted status simultaneously ([transactions.ts:373](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:373)); it must refresh category-bearing counter-postings when restoring the snapshot.

- Bulk recategorization updates legacy transaction categories at [transactions.ts:414](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:414). It must update all matching Income/Expenses counter-postings, while leaving Clearing/Opening postings untouched.

- Category merge updates both parent categories and split categories ([categories.ts:153](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/categories.ts:153)). It must also update posting categories in the same transaction. This is a direct posting-affecting writer that PR-A’s named writer list does not explicitly call out.

- Import reconciliation changes amount on an existing legacy row ([imports.ts:643](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:643)); rollback later restores the previous amount ([imports.ts:837](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:837)). Both directions must rebuild postings.

- Recurring EMI writes two independent transaction families directly ([recurring.ts:287](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:287), [recurring.ts:303](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:303)). Each row must independently receive ordinary postings, preserving D21 rather than being mistaken for a transfer.

- Account opening edits can insert, update, or soft-delete the existing opening row ([accounts.ts:425](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:425), [accounts.ts:434](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:434), [accounts.ts:445](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:445)). All three paths need matching posting handling.

- Reconciliation drift writes the opening column directly and safe-checks the derived result ([reconciliation-writes.ts:295](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:295), [reconciliation-writes.ts:298](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:298), [reconciliation-writes.ts:302](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:302)). Early synthesis would require updating the synthetic opening postings inside this same serializable transaction while preserving the existing account-first lock order ([reconciliation-writes.ts:243](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:243)). Deferring synthesis to PR-G avoids this dual source.

## Clearing model and reporting parity

The Clearing shape is sound as a **transitional** row-local representation:

- out leg: real `−X`, Clearing `+X`;
- in leg: real `+X`, Clearing `−X`;
- each transaction is zero-sum;
- the two Clearing legs net to zero when the link is consistent.

`lib/periods.ts` currently excludes a transaction whenever a `transfer_links` row references it ([periods.ts:65](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:65), [periods.ts:147](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:147), [periods.ts:201](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:201)). A postings reader can reproduce this exactly by excluding transactions having a Clearing posting—not merely excluding the Clearing posting while aggregating the real leg.

Likewise:

- Opening exclusion is reproduced by excluding any transaction with an Opening posting, matching `not t.is_opening` at [periods.ts:64](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:64) and [periods.ts:200](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:200).
- Liability-inflow exclusion must be computed from the real posting joined to the real account type, matching [periods.ts:193](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:193). Summing the Income system account would incorrectly count positive card/loan transactions as income.
- Expense remains every negative real posting, including negative liability activity, matching [periods.ts:195](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:195).
- Split spend can be read from positive Expenses postings, preserving per-split category behavior currently implemented at [periods.ts:70](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:70).
- Transaction counts over posting joins must use `count(distinct transaction_id)`.

With those predicates, no income/expense/spend number changes. Numbers do change if a reader merely filters out system accounts, merely filters out Clearing postings, or if link-state and Clearing-state diverge through one of the blocker paths above.

## PR sequencing

- **PR-A:** not independently releasable as written because of the deployment gap, opening double-count, restore failure, and incomplete transfer-link transitions.
- **PR-B:** can be independently releasable only after PR-A has exact opening representation and reader predicates for deleted parents/date cutoffs. Otherwise card/loan/investment balances change.
- **PR-C:** conceptually separable and releasable once the exact Clearing/Opening transaction-level exclusions and D4 liability rule are implemented.
- **PR-D:** scope is inconsistent: it assigns D20 large-transaction alerts here ([PLAN-dualwrite.md:29](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:29)), but `prefs` is listed in PR-E ([PLAN-dualwrite.md:30](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:30)). Put the consumer and its parity test in one PR.
- **PR-E:** very large but potentially mergeable. Ensure transaction-level consumers select exactly one real posting and exclude transfer/opening transactions, rather than aggregating both real and system legs.
- **PR-F:** CSV conversion can remain here, but JSON archive/restore compatibility cannot; that portion belongs in PR-A.
- **PR-G:** necessarily retains a broad compile coupling because shared DTOs and web consumers change together. It can still be one green PR, but it is not a small incremental step.

## Decisions Q1–Q4

- **Q1 — Collapse to one row at the end.** Use two rows plus Clearing only as the dual-write migration representation. Roadmap 2.2 explicitly requires “one transaction with two asset postings,” and the approved D1 decision says the same ([TASK.md:62](/home/udai/PennyPilot/tasks/021-postings-model/TASK.md:62)). Keeping two permanent headers changes transaction cardinality, identity, and the meaning of a transfer beyond what the roadmap specifies. A permanent deviation should require an explicit roadmap/product decision, not emerge from migration convenience.

- **Q2 — Retire `transfer_links` after collapse.** During dual-write it should remain the authoritative legacy transfer marker, with Clearing postings mirroring its lifecycle. Once transfers collapse to one header with two real postings, shape identifies the transfer and the pair table no longer represents anything useful. Retaining it would preserve dead two-row identity machinery.

- **Q3 — Reader special-case until the flip.** Keep `opening_balance_paise` in postings-based balance readers through PR-F. In PR-G, synthesize canonical Opening transactions and drop/zero the column atomically. This avoids legacy double-counting, reconciliation dual-write complexity, and historical effective-date drift.

- **Q4 — Accept a fourth Clearing kind as transitional infrastructure.** It is the cleanest way to make each existing transfer leg independently balanced during incremental dual-write. After one-row transfer collapse, stop creating Clearing postings/accounts. PostgreSQL enum removal is awkward, so the enum value may remain reserved even after its rows are retired; that is acceptable technical residue. It should not define the permanent transfer model.

## Schema, scoping, integer, and security notes

- Defining `postings` beside shared `transactions` is consistent with schema ownership ([ledger.ts:102](/home/udai/PennyPilot/apps/api/src/db/shared/ledger.ts:102)); the ledger module should only re-export it ([schema.ts:31](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:31), [schema.ts:38](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:38)). The single Drizzle entry remains [db/schema.ts:16](/home/udai/PennyPilot/apps/api/src/db/schema.ts:16).

- `postings` belongs in `ALL_TABLES` after both accounts and transactions and in `LINKED_TABLES`, not `USER_TABLES`. The existing ordering/registration illustrates the correct shape ([backup.ts:28](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:28), [backup.ts:43](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:43), [backup.ts:66](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:66)). Schema-coverage and export-gap tests must enforce all three collections’ parity.

- `"system"` must remain DB-internal. Generic account readers must filter `system_kind IS NULL` before casting to public `AccountType`; current generic mappings cast directly ([accounts.ts:173](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:173)) and list all user accounts without such a filter ([accounts.ts:192](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:192)). Those boundaries must be narrowed in PR-A, not only when readers later move.

- The posting table scopes through its parent transaction and has no `user_id`. Consequently, all readers must scope through `transactions.user_id`, and all posting writes must verify that the transaction, real account, system account, and category belong to the same user. The current generic `replacePostings(transactionId, replacements)` has neither a user argument nor ownership predicate ([post-entry.ts:81](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:81), [post-entry.ts:89](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:89)); it is safe only as a tightly internal helper after an owned, locked transaction has been established. Its API should make that requirement difficult to bypass.

- SQL aggregates must be range-checked before `Number(...)`. Existing code converts directly in several balance/report paths, such as [balances.ts:37](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:37) and [periods.ts:204](/home/udai/PennyPilot/apps/api/src/lib/periods.ts:204). Merely applying `SafePaiseSchema` at HTTP boundaries does not protect aggregate overflow.

- `buildTransferLegs` currently checks `Number.isInteger`, not `Number.isSafeInteger` ([transfers.ts:156](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transfers.ts:156)). Direct service callers therefore need the D12 safe-integer guard even if route schemas are safe.

Once the five blockers are incorporated—especially the deployment protocol, opening strategy, complete link-state transition table, PR-A restore compatibility, and precise per-row invariant—the dual-write approach becomes a credible green-and-releasable migration strategy.