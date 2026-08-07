Overall verdict: **BLOCKING — revise the plan before implementation.** Design 1 is correct for normal, internally generated archives restored after the original rows are gone, and Design 2’s system-account remap is unnecessary for that supported flow. However, the plan overstates this as “no remap is ever needed,” omits important archive-integrity/tenant validation, and its proposed tests do not exercise several acceptance criteria.

## 1. Primary-key preservation and possible dangling references

**Finding 1A — NON-BLOCKING: primary-key IDs are preserved.**

The claim is correct. Per-user restore spreads each archived row, rewrites only the owning `user_id`, passes the row through `firstPassRow`, and inserts every supplied column—including `id`—verbatim:

- `insertRow` inserts all object entries without replacing `id`: `apps/api/src/modules/system/services/restore-user.ts:28-36`.
- Only the table’s configured user column is rewritten: `apps/api/src/modules/system/services/restore-user.ts:122-131`.
- `firstPassRow` merely nulls deferred columns and omits explicitly generated columns; it does not remap IDs: `apps/api/src/db/restore.ts:29-36`.

The existing tests explicitly document the operational limitation: IDs are globally unique, so the source user’s rows must be removed before restoring into another user in the same database: `apps/api/src/modules/system/services/backup.test.ts:351-360`.

For the intended disaster-recovery flow, where all archived accounts, categories, transactions, and postings are restored together after the original rows have gone, Design 2’s system-account remap is indeed unnecessary.

**Finding 1B — BLOCKING: “no remap is ever needed” is too broad; same-database cloning remains impossible.**

If the source user’s rows still exist, restoring the archive into another user collides on the globally unique primary keys. This is not a dangling-FK outcome—the transaction fails—but it is an important qualification omitted from the plan’s rejection rationale. The repository’s current test works around this by deleting the source first and expressly says restore is not a clone operation: `apps/api/src/modules/system/services/backup.test.ts:351-358`.

The plan should state that Design 1 supports recovery/migration where archived IDs are free, not cloning into a second live account. Design 2 would not solve all global-ID collisions either, so this does not justify Design 2, but it invalidates “no remap is ever needed” as an unconditional claim.

**Finding 1C — BLOCKING: the schema does not guarantee that an exported posting’s references belong to the exported user.**

`postings` has ordinary single-column FKs to transactions, accounts, and categories, with no `user_id` and no composite same-tenant constraint: `apps/api/src/db/shared/ledger.ts:132-152`. Its export scope is proposed to follow only `posting.transaction_id → transactions.user_id`, using the generic linked-table join at `apps/api/src/modules/system/services/backup.ts:92-101`.

Consequently, a database row can be structurally valid while:

- its transaction belongs to user A,
- its `account_id` or `category_id` belongs to user B.

The proposed export would include that posting because the transaction belongs to A, but would not necessarily include B’s referenced account/category. On restore into a database without those foreign rows, insertion fails; if matching foreign IDs happen to exist, the posting can retain a cross-user reference.

Normal writers defend against this: `replacePostings` verifies transaction ownership and every posting draft’s account/category ownership before writing: `apps/api/src/modules/ledger/services/post-entry.ts:40-68`. Raw archive insertion bypasses those checks.

A genuine dangling row cannot survive a successful restore because PostgreSQL FKs reject it. The failure mode is instead an all-or-nothing restore failure or a cross-tenant reference to an already-existing row. The plan needs an archive-integrity validation or a clearly documented trust boundary plus a negative test. Because the route accepts a user-uploaded archive, relying solely on “our writers would never produce this” is not sufficient.

## 2. Fresh-account guard

**Finding 2A — NON-BLOCKING: seeded system accounts are the genuine immediate blocker.**

Registration seeds the system accounts through `seedSystemAccounts`: `apps/api/src/modules/system/services/auth.ts:46`. The restore guard currently counts every account row: `apps/api/src/modules/system/services/restore-user.ts:67-75`. It repeats the same query inside the transaction: `apps/api/src/modules/system/services/restore-user.ts:93-103`. Thus a freshly registered post-migration user fails both checks solely because those seeded accounts exist.

**Finding 2B — NON-BLOCKING: applying `system_kind is null` only to accounts, in both checks, fully fixes that blocker without weakening ordinary-account protection.**

Ordinary accounts have nullable `system_kind`, while system accounts carry a non-null kind: `apps/api/src/db/shared/hubs.ts:113-125`. Therefore:

```sql
where user_id = $1 and system_kind is null
```

continues to reject any ordinary account while ignoring the four registration-seeded system accounts. Leaving the other `MUST_BE_EMPTY` tables unchanged preserves their existing protection. Both the fast pre-check and authoritative in-transaction re-check must receive exactly the same condition.

This is safe for valid application-created data. A malformed database could label an ordinary account with a non-null `system_kind`, but those values are reserved by the schema/application for system accounts and protected by a per-user partial unique index: `apps/api/src/db/shared/hubs.ts:53-63`, `apps/api/src/db/shared/hubs.ts:121-126`.

**Finding 2C — NON-BLOCKING: calling it the “ONLY blocking bug” ignores existing restore limitations.**

The fresh guard is the only immediate blocker for a normal fresh registered destination. It is not the only way restore can fail: global ID collisions and malformed/cross-tenant linked references remain possible. The plan should narrow the statement accordingly.

There is also a pre-existing concurrency window: the in-transaction count does not lock the user or otherwise prevent a concurrent writer from inserting after the count and before deletion/insertion. That is outside the narrow postings registration bug, but a test should at least ensure both guard checks use the same predicate.

## 3. Post-commit reconcile

**Finding 3A — NON-BLOCKING: reconcile must run after commit, and a fresh `createDb(pool)` wrapper is correct.**

Restore uses a checked-out raw `PoolClient` and explicitly starts and commits a transaction: `apps/api/src/modules/system/services/restore-user.ts:91-157`. A Drizzle database wrapper using the pool would normally acquire a different connection and could not reliably see those uncommitted rows.

`createDb(pool)` only wraps the existing pool with Drizzle; it does not create another PostgreSQL pool: `apps/api/src/db/index.ts:14-16`. Therefore it does not independently consume or reserve connections. Once the raw client is released, reconcile can acquire connections from the same pool normally. There is no inherent second-instance or connection-exhaustion problem.

**Finding 3B — BLOCKING: control-flow placement must be specified precisely to avoid treating a committed restore as rolled back.**

The current function returns from immediately after `commit`: `apps/api/src/modules/system/services/restore-user.ts:151-152`. Its inner catch always issues `rollback`, while the outer catch deletes uploaded blobs: `apps/api/src/modules/system/services/restore-user.ts:153-162`.

Reconcile must be placed outside both failure-cleanup regions—or the function must track that the database transaction committed. If reconcile is simply inserted after `commit` inside the existing inner `try`, a thrown reconcile error would:

1. enter the inner catch and attempt rollback after commit;
2. propagate to the outer catch;
3. delete uploaded storage objects even though rows referencing them have committed.

The plan says “after the client transaction commits and the client is released,” which points in the right direction, but this is important enough to make explicit in the implementation plan and test. Capture the committed restore summary, leave the transaction/client scope, then perform best-effort reconcile without entering rollback/blob-cleanup handling.

**Finding 3C — NON-BLOCKING: awaited post-commit reconcile is sufficient and remains tenant-scoped.**

`reconcileUserPostings`:

- seeds accounts for exactly `userId`: `apps/api/src/modules/ledger/services/reconcile-postings.ts:69-77`;
- selects only transactions owned by that user: `apps/api/src/modules/ledger/services/reconcile-postings.ts:82`;
- computes each draft using transaction plus user ownership: `apps/api/src/modules/ledger/services/reconcile-postings.ts:87-104`;
- and `computePostingDraftsForTransaction` independently filters by transaction ID and user ID: `apps/api/src/modules/ledger/services/transactions.ts:201-211`.

Its replacement primitive rechecks transaction, account, and category ownership: `apps/api/src/modules/ledger/services/post-entry.ts:49-68`. Reconcile therefore does not introduce cross-user writes.

If the route `await`s `restoreUserBackup`, reconcile completes before the summary is returned; the concern that it writes after the user-facing summary has already been returned does not apply unless implementation deliberately detaches the promise. The plan should say it is best-effort but awaited, not fire-and-forget.

**Finding 3D — NON-BLOCKING: non-fatal reconciliation failure is acceptable for PR-A, provided it is surfaced accurately.**

The restored legacy rows are committed first, and postings remain shadow data. The postings schema itself says readers are not posting-derived in PR-A: `apps/api/src/db/shared/ledger.ts:127-130`. Reconciliation already isolates per-transaction failures and returns them rather than throwing: `apps/api/src/modules/ledger/services/reconcile-postings.ts:84-113`.

Thus it is reasonable not to fail the completed restore because posting repair failed. The route currently returns the service result directly: `apps/api/src/modules/system/routes/backup.ts:76-102`; logging an explicit failure count there is appropriate.

The outer call can still throw before returning its structured result—most notably `seedSystemAccounts` at `apps/api/src/modules/ledger/services/reconcile-postings.ts:73`. The proposed catch must convert that into a failed posting outcome without triggering database/blob rollback cleanup.

## 4. Unmodified delete loop and system accounts

**Finding 4A — NON-BLOCKING: a new archive will not violate `accounts_system_kind_idx`.**

The reverse delete loop deletes all `USER_TABLES` rows belonging to the destination, including every seeded account: `apps/api/src/modules/system/services/restore-user.ts:105-114`. Because `accounts` is restored before transactions under `ALL_TABLES`: `apps/api/src/modules/system/services/backup.ts:28-41`, archived accounts—including system accounts—are then reinserted with original IDs and the destination `user_id`: `apps/api/src/modules/system/services/restore-user.ts:118-131`.

The destination’s seeded system accounts are gone before archived system accounts are inserted, so the partial unique index has no conflicting rows. The index permits exactly one non-null kind per user: `apps/api/src/db/shared/hubs.ts:121-126`.

Afterward, `seedSystemAccounts` sees all four kinds and returns without inserting: `apps/api/src/modules/ledger/services/post-entry.ts:138-148`. There should be neither leftovers nor duplicates.

**Finding 4B — NON-BLOCKING: an old archive will delete seeded accounts and reconcile will re-seed exactly one of each kind.**

An old archive lacking system-account rows does not recreate them in the insert loop. Missing tables are skipped at `apps/api/src/modules/system/services/restore-user.ts:118-120`; old account rows that predate `system_kind` are inserted without that column and therefore remain ordinary/null-kind accounts.

Post-commit reconciliation calls `seedSystemAccounts`: `apps/api/src/modules/ledger/services/reconcile-postings.ts:69-74`. The seeder inserts only missing kinds and tolerates the partial-index race: `apps/api/src/modules/ledger/services/post-entry.ts:134-163`. Therefore the expected final state is four newly generated system accounts, with no duplicate kind.

**Finding 4C — NON-BLOCKING: leaving LINKED rows undeleted is safe only under the fresh-account premise.**

The loop deletes only direct-user tables: `apps/api/src/modules/system/services/restore-user.ts:107-113`. With postings ordered after transactions, reverse traversal encounters postings but skips direct deletion; deleting destination transactions later cascades their postings because `postings.transaction_id` uses `onDelete: cascade`: `apps/api/src/db/shared/ledger.ts:135-138`.

A genuinely fresh destination has no transactions or postings anyway. This behavior is safe under the enforced fresh-account contract.

## 5. `ALL_TABLES` ordering and deferred columns

**Finding 5A — NON-BLOCKING: placing postings immediately after transactions is sufficient for both restore paths.**

The postings parents are:

- accounts via `account_id`;
- categories via nullable `category_id`;
- transactions via `transaction_id`.

They are defined at `apps/api/src/db/shared/ledger.ts:135-143`. Current `ALL_TABLES` orders accounts, categories, and transactions before the proposed insertion point: `apps/api/src/modules/system/services/backup.ts:28-30`.

Per-user `restorableTables` preserves `ALL_TABLES` order while filtering to scoped tables: `apps/api/src/modules/system/services/restore-user.ts:8-11`. Whole-database restore also iterates `ALL_TABLES` directly: `apps/api/src/db/restore.ts:67-70`. Therefore the same ordering satisfies both first passes.

**Finding 5B — NON-BLOCKING: postings needs no `DEFERRED_RESTORE_COLUMNS` entry.**

All three referenced parent tables exist before postings is inserted, and postings has no self-reference or forward reference. The deferred map exists only for known cycles/forward references: `apps/api/src/db/restore.ts:8-17`. `firstPassRow` otherwise passes posting columns through unchanged: `apps/api/src/db/restore.ts:29-36`.

The proposed order checks should include categories as well as accounts and transactions, because `category_id` is an actual FK even though it is nullable.

## 6. `exportGaps`, gating tests, and linked export scope

**Finding 6A — NON-BLOCKING: LINKED-only registration satisfies the mechanical coverage tests.**

`exportGaps` considers a table covered when it is in either `USER_TABLES` or `LINKED_TABLES`: `apps/api/src/modules/system/services/backup.ts:76-85`. The tests require:

- every schema table to be in `ALL_TABLES`: `apps/api/src/modules/system/services/backup.test.ts:38-45`;
- no per-user coverage gap: `apps/api/src/modules/system/services/backup.test.ts:51-56`;
- no table in both scope maps: `apps/api/src/modules/system/services/backup.test.ts:58-61`;
- and restored/exported tables to match: `apps/api/src/modules/system/services/backup.test.ts:105-110`.

Adding postings to `ALL_TABLES` and `LINKED_TABLES`, but not `USER_TABLES`, is exactly the correct registration.

**Finding 6B — NON-BLOCKING for normal data; see Finding 1C for the security boundary: the linked join scopes postings by transaction owner correctly.**

The generic linked dump performs:

```sql
select c.*
from child c
join parent p on p.id = c.fk
where p.user_id = userId
```

at `apps/api/src/modules/system/services/backup.ts:92-101`. With `transaction_id` and parent `transactions`, this exports precisely postings whose transaction belongs to the user.

It does not prove posting account/category ownership. That gap requires validation or an explicit trusted-data assumption.

## 7. Old whole-database v1 backups

**Finding 7 — NON-BLOCKING, but this is an operational compatibility regression that should be explicit.**

`restoreDump` requires an array for every current `ALL_TABLES` entry and throws otherwise: `apps/api/src/db/restore.ts:67-69`. The outer backup envelope remains version `1`: `apps/api/src/modules/system/services/backup.ts:230-240`; restore accepts only version `1`: `apps/api/src/db/restore.ts:104-106`.

Therefore adding postings to `ALL_TABLES` makes previously generated whole-database version-1 backups fail against the new code despite sharing the same declared format version. That is literally a backward-compatibility regression, even if it follows the repository’s established same-schema restore contract.

Treating it as out of scope is acceptable only if whole-database backups are intentionally coupled to the exact application/schema version and restoration uses matching code before migration. The plan should describe that requirement plainly instead of implying format version 1 itself guarantees compatibility. A future format-version bump or optional-empty handling would be a separate change.

## 8. PR-A guardrails

**Finding 8 — NON-BLOCKING: no PR-A reader/DTO/schema/shared/web violation is implied.**

The planned changes are confined to backup registration, per-user restore orchestration/summary, route logging, and tests. Reconcile derives postings from legacy transactions; it does not make any reader posting-derived. The postings table already documents that it is additive shadow data in PR-A: `apps/api/src/db/shared/ledger.ts:127-130`.

Adding an optional internal `RestoreSummary.postings` field is not a ledger reader or shared DTO/schema change. The restore route currently has no declared response schema and returns the service summary directly: `apps/api/src/modules/system/routes/backup.ts:76-102`.

## 9. Missing edge cases, tests, and complexity

**Finding 9A — BLOCKING: the proposed test list does not cover its own acceptance criteria.**

The plan proposes one new DB-backed new-archive round trip plus order assertions. That does not directly exercise:

- a freshly registered destination containing four seeded system accounts;
- both the pre-check and in-transaction re-check predicates;
- an old archive with no postings and no archived system accounts;
- new-archive reconcile being compare-first/no-op rather than replacing restored postings;
- a thrown seeding/reconcile error after commit;
- preservation of committed database rows and uploaded blobs after that error;
- malformed/cross-tenant posting references;
- absence of duplicate system accounts on both old and new paths.

At minimum, add focused tests for AC2, AC3, AC4, and AC5. The post-commit error test is especially important because the current nested catch structure would delete uploaded objects if reconciliation were placed incorrectly.

**Finding 9B — BLOCKING: add archive integrity/tenant-scoping validation or an explicit rejected-archive test.**

Because restore accepts an uploaded archive and performs raw inserts, test an archive containing a posting whose transaction belongs to the destination data set but whose account/category is not part of that user’s restored rows. It should be rejected deterministically, preferably before committing anything. Existing writer ownership checks do not protect raw archive insertion: `apps/api/src/modules/ledger/services/post-entry.ts:40-68`.

The linked export itself does not leak unrelated postings: it selects by the parent transaction owner. The risk is that the selected posting row can carry foreign account/category IDs because the schema does not encode same-user ownership.

**Finding 9C — NON-BLOCKING: test exact posting identity separately from consistency.**

`findInconsistentPostings` proves semantic consistency, not verbatim round-trip of posting IDs or timestamps, because comparison intentionally ignores `id`, `transaction_id`, and `created_at`: `apps/api/src/modules/ledger/services/reconcile-postings.ts:17-50`, `apps/api/src/modules/ledger/services/reconcile-postings.ts:175-186`.

For the new-archive path, capture restored posting IDs before reconcile or assert afterward that archived `id` and `created_at` survived. Also assert `repaired === 0`. Otherwise a broken implementation could fail to restore postings, let reconcile recreate them with new IDs, and still pass `findInconsistentPostings === []`.

**Finding 9D — NON-BLOCKING: add the missing category order assertion.**

The proposed order assertions cover accounts and transactions, but postings also FKs categories: `apps/api/src/db/shared/ledger.ts:139-143`. Add:

```ts
assert.ok(at("categories") < at("postings"));
```

alongside the other parent-order checks.

**Finding 9E — NON-BLOCKING: no system-account mapping layer is warranted.**

Within the supported recovery model, a system-kind map would introduce additional state and remapping logic solely because Design 2 elects not to restore archived system-account rows. Design 1’s delete-and-verbatim-reinsert path is simpler and preserves posting IDs and references. The necessary corrections are qualification, validation, control-flow safety, and tests—not adopting Design 2.