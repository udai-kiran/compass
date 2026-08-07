## Re-review of iteration 3

Iteration 3 closes both blockers that gate PR-A. The PR-G amendments are not yet internally consistent or independently deployable, but those defects do not prevent the additive dual-write increment from being built.

### 1. PR-A full-shape reconciliation — RESOLVED

The amendment now says exactly what the previous review required: reconciliation covers every applicable transaction and rebuilds and compares the complete expected posting shape, including transactions that already have postings. It explicitly repairs missing, stale, and wrongly shaped postings and repeats until no changes are needed ([PLAN-dualwrite.md:19](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:19)-[24](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:24)).

That is sufficient for the concrete stale-posting paths identified previously:

- `updateTransaction` can spread account, amount, category, necessity, and other fields into an existing row ([transactions.ts:288](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:288)-[328](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:328)).
- Import reconciliation mutates existing transaction values.
- Import reconciliation can invalidate an auto-transfer link after changing one leg.
- Rollback restores previous date/amount/source values ([imports.ts:784](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:784)-[860](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:860)).

A zero-postings-only backfill could not repair these cases; the newly specified expected-shape replacement can.

The deployment premise is also supported by the repository’s documented operating model: deployment is a host-side `COMPASS_VERSION` bump followed by `make update`, and Compose runs migration as a one-shot dependency before the application services. In the stated single-instance restart deployment, running additive migration, reconciliation, and the gate before accepting traffic eliminates the ordinary old/new concurrent-writer window.

There is a minor wording inconsistency between “after the new binary is live” at line 22 and “before the new binary serves traffic” at line 23. It should be interpreted and implemented as “the new binary/version is installed and its startup phase is running, but request serving has not begun.” That is not blocking given the explicit maintenance/startup statement.

Implementation requirements that follow from the real source:

- “Every applicable transaction” must include soft-deleted parents. The plan expressly says their postings remain and readers exclude them through the parent’s `deleted_at` ([PLAN-dualwrite.md:27](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:27)-[35](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:35)). Reconciliation must therefore not limit its source query to `deleted_at IS NULL`.
- Column-only opening balances are not transactions and must not produce postings during PR-A.
- An `is_opening` transaction, including a soft-deleted one, does have an expected Opening-counter shape.
- Transfer shape must be determined from `transfer_links`, not category/null-category heuristics.
- Reconciliation must replace postings and validate ownership inside a transaction, rather than merely report differences.

Required PR-A tests:

- An ordinary transaction with already-present but stale account, amount, category, and necessity postings.
- Ordinary↔split and ordinary↔linked-transfer shape transitions.
- Auto-link invalidation and rollback-restored rows.
- Soft-deleted ordinary, split, opening, and formerly linked rows.
- Unexpected extra and duplicate postings.
- A second reconciliation run performing zero writes.
- Gate refusal if any malformed shape remains.

### 2. PR-A restore of old archives — RESOLVED

The amendment now explicitly requires old archives without `postings` to synthesize postings from restored legacy transactions, splits, `is_opening`, and transfer links before the restore transaction commits. It separately requires newer archives to be rebuilt-and-compared rather than trusted ([PLAN-dualwrite.md:46](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:46)-[50](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:50)).

This directly closes the real compatibility hole. The current restore loop silently skips a table missing from an older archive ([restore-user.ts:118](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:118)-[133](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:133)); without synthesis, an old archive would commit legacy transactions with no postings.

The synthesis is implementable in the existing transaction:

1. Restore real accounts and legacy transactions.
2. Restore `transaction_splits` and `transfer_links`.
3. Establish exactly one local system account for each `system_kind`.
4. If the archive lacks postings, derive every posting shape from the now-restored legacy graph.
5. If it contains postings, remap archived system-account IDs and compare the restored shape with the legacy-derived shape.
6. Commit only after the full invariant passes.

The other stated restore changes also correspond to real hazards:

- The current fresh-account guard counts every account ([restore-user.ts:67](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:67)-[75](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:75)); it must exclude `system_kind IS NOT NULL`.
- The reverse-order cleanup currently deletes all user-owned account rows ([restore-user.ts:105](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:105)-[114](/home/udai/PennyPilot/apps/api/src/modules/system/services/restore-user.ts:114)); it must deliberately retain or recreate system accounts.
- Generic `user_id` rewriting cannot remap `postings.account_id`, because postings scope through their parent and are a `LINKED_TABLES` entry rather than a `USER_TABLES` entry ([backup.ts:43](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:43)-[75](/home/udai/PennyPilot/apps/api/src/modules/system/services/backup.ts:75)).

The plan does not introduce a double-creation problem if implemented as specified. The partial unique index on `(user_id, system_kind)` makes the seeding operation idempotent, but restore must use an upsert/select-existing sequence rather than four unconditional inserts.

Clearing-leg mapping is adequately recoverable from the actual `transfer_links` schema: it explicitly records out and in transaction IDs ([schema.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:57)-[75](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:75)). The restored row’s own legacy amount should determine its opposite Clearing posting. That preserves each row’s local zero-sum invariant.

Required restore tests are missing from the plan’s explicit test list and should be mandatory in PR-A:

- Old archive with ordinary, split, opening-row, linked-transfer, soft-deleted, and column-opening accounts and no `postings` key.
- Old archive with an explicit empty `postings` array.
- New archive with valid postings and remapped system-account IDs.
- New archive with stale, missing, duplicate, cross-user, or wrong-system-kind postings, all rejected before commit.
- Restore into a freshly registered user whose four system accounts already exist.
- Failure after synthesis proving the entire database restore rolls back.

### 3. PR-G opening effective date — PARTIAL

G2 itself now specifies the correct account-creation date and explicitly covers the reasons the earlier rule was wrong ([PLAN-dualwrite.md:61](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:61)).

That choice is grounded in the real balance behavior:

- `accountBalancesAtDate` adds `opening_balance_paise` outside the date-filtered transaction sum ([accounts.ts:157](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:157)-[176](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:176)).
- `bankCashBalances` uses the same formula ([balances.ts:21](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:21)-[40](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/balances.ts:40)).
- The reconciliation service documents the column as reinterpreting history from account creation ([reconciliation-writes.ts:215](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:215)-[223](/home/udai/PennyPilot/apps/api/src/modules/credit/services/reconciliation-writes.ts:223)).
- Accounts have a non-null `created_at`, so accounts with no activity still have a usable effective date ([hubs.ts:100](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:100)-[102](/home/udai/PennyPilot/apps/api/src/db/shared/hubs.ts:102)).

However, iteration 3 left the opposite instruction in the core mapping: line 17 still says PR-G will date the synthetic transaction “day-BEFORE earliest ordinary activity” ([PLAN-dualwrite.md:17](/home/udai/PennyPilot/tasks/021-postings-model/PLAN-dualwrite.md:17)). That directly contradicts G2.

Therefore the intended fix is correct, but the plan as a whole is not unambiguous. Line 17 must be changed to account-creation date before PR-G implementation. G2 should also specify conversion of the timestamp to the application’s canonical UTC ledger date and test:

- An account with no activity.
- An account whose earliest activity is long after creation.
- An `asOf` date between creation and first activity.
- The defined behavior for an `asOf` date before account creation.

### 4. PR-G G1–G4 staging — NOT-RESOLVED

The plan now names four phases, which is an improvement over the former single destructive PR, but they are not actually independently deployable as written.

The incompatibility is between G1, G2, and G4:

- G1 says legacy dual-writing continues.
- G2 collapses each two-header legacy transfer into one header with two real postings.
- The legacy schema represents a transfer through two transaction headers referenced by `transfer_links.out_transaction_id` and `in_transaction_id` ([schema.ts:57](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:57)-[75](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:75)).
- One legacy transaction header has only one account and one amount. It cannot faithfully dual-write a collapsed two-real-account transfer.
- G4 is the first stage that says legacy dual-writing stops.

Consequently, after G2 commits and writes resume under the G1 binary, that binary has no defined representation for migrated collapsed transfers and will continue creating new two-row transfers. G2 is therefore not an independently deployable steady state. If writes instead remain stopped until G4, then G2 and G3 are maintenance steps in one indivisible G2→G4 deployment, contrary to the claim that G1–G4 are independently releasable stages.

A viable sequence needs an additional compatibility/flip boundary, for example:

- G1: readers and DTO/web consumers become postings-native while the old two-row writers remain.
- G2: deploy postings-native writers that can operate while legacy columns still exist; stop creating new two-row/Clearing transfers, but retain enough compatibility data for rollback.
- G3: maintenance migration collapses existing transfers and synthesizes openings, followed by the invariant/parity gate before traffic resumes.
- G4: after at least one successful postings-native release, drop legacy columns and tables.

Alternatively, G2–G4 can be declared one continuous maintenance deployment with no traffic or writes between them, but then they are not independently deployable increments.

G3 also needs a post-collapse invariant distinct from PR-A’s legacy-derived invariant. Once transfers have been collapsed and column openings synthesized, there is no longer a one-legacy-row-to-one-posting-family shape to compare against. The plan should state the canonical post-flip invariants explicitly.

## New or amended-plan concerns

No new PR-A blocker was introduced.

The two potentially dangerous PR-A interactions are addressed adequately in prose, provided implementation follows it literally:

- Soft-deleted parents retain postings and are excluded only by joining to a non-deleted parent. Full-shape reconciliation must include them rather than treating them as inapplicable.
- Column-based openings produce no transaction and no posting during PR-A. Reconciliation must not synthesize them merely because the account has a nonzero column.

Other PR-A requirements worth enforcing during implementation:

- System-account creation must be idempotent and transactionally safe under the unique partial index.
- Generic account queries must filter `system_kind IS NULL` before casting the database enum to public `AccountType`; current `accountBalancesAtDate` and `listAccounts` do not do so ([accounts.ts:171](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:171)-[197](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:197)).
- Simple transaction APIs must reject system-account IDs. Merely checking that an account belongs to the user is insufficient.
- Backfill and restore reconstruction must use tenant-scoped joins for transactions, real accounts, system accounts, and categories.
- A newer archive containing postings must not be allowed to inject an account belonging to another user through `postings.account_id`.
- Import auto-linking currently occurs after the import transaction commits ([imports.ts:728](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:728)-[730](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:730)), and rollback auto-link rebuilding occurs after its commit ([imports.ts:858](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:858)-[860](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/imports.ts:860)). PR-A must restructure these paths so link mutation and both affected posting replacements are atomic, as the plan requires.
- The plan’s status line claiming all blockers are already folded in is too strong: the line-17/G2 contradiction and the G2 writer-compatibility gap remain.

## PR-A judgment

Both blockers that gate PR-A are resolved:

- Full-shape startup reconciliation can repair missing and stale posting shapes and is compatible with the actual single-instance restart deployment.
- Restore now reconstructs old archives and validates newer archives before commit.

The remaining defects concern only the eventual PR-G cutover. PR-A preserves all legacy columns and readers, serves the existing DTO from legacy data, and treats postings as an additive mirror. Subject to the mandatory mutation-graph, reconciliation, restore, tenant-scope, and invariant tests described above, it is safe to begin implementation.

PR-G staging is **not yet adequately specified for later**. Its opening-date intent is correct but contradicted elsewhere in the plan, and G2 cannot be an independently deployable state while G1’s legacy dual-writers remain active.

**VERDICT: APPROVED-FOR-PR-A**