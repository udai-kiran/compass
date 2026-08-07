Overall verdict: **BLOCKING — Design 1b is sound and the prior trust/control-flow blockers are resolved in the design, but the verification plan still does not adequately gate the critical post-commit failure boundary or complete posting coverage.** No new architectural or security flaw is introduced by skipping per-user archived postings.

## A) Per-user trust/tenant gap and posting completeness

**Trust/tenant gap: RESOLVED — NON-BLOCKING.**

Skipping the `postings` table before its row loop fully closes the prior raw-archive injection gap for per-user restore:

```ts
for (const table of tables) {
  if (table === "postings") continue;
  const rows = header.tables[table];
  // ...
}
```

No archived posting row reaches `firstPassRow` or `insertRow`. Therefore a crafted posting containing another user’s `account_id` or `category_id` cannot be inserted, regardless of whether that foreign ID exists in the destination database.

The replacement path is tenant-safe:

- `reconcileUserPostings` selects transactions using `transactions.userId = userId`, with no `deleted_at` filter.
- `computePostingDraftsForTransaction` rechecks both transaction ID and user ID.
- `replacePostings` rechecks ownership of the transaction and every account/category before writing.
- Restored accounts, categories, transactions, splits, and transfer links have been restored before reconciliation, with direct-table `user_id` rewritten to the destination user.

Thus synthesized postings can reference only destination-owned rows.

**Soft-deleted coverage: RESOLVED — NON-BLOCKING in implementation design.**

Soft-deleted transactions are explicitly included:

```ts
db.select({ id: transactions.id })
  .from(transactions)
  .where(eq(transactions.userId, userId));
```

There is no `deleted_at is null` predicate. `computePostingDraftsForTransaction` likewise retrieves soft-deleted rows. Ordinary, opening, split, and transfer-linked transaction shapes are all supported by the existing derivation code.

**No orphaned archived postings: RESOLVED — NON-BLOCKING.**

Because no archived posting is inserted, it cannot survive as an orphan. Existing destination postings are also not a normal concern:

- the freshness guard requires no destination transactions;
- deleting a destination transaction cascades its postings;
- the acknowledged non-locking concurrency window is pre-existing and outside A6.

**Absolute “no missing postings for every D transaction”: qualified — NON-BLOCKING for the design, but test-blocking under E.**

Reconcile attempts every D-owned transaction, including soft-deleted rows. It does not guarantee successful synthesis for malformed legacy data. For example, a split transaction whose splits do not sum to the transaction amount throws `PostingShapeError`; `reconcileUserPostings` records a per-transaction failure and continues, leaving that transaction without postings after the skip.

That is consistent with A6’s stated best-effort PR-A model and surfaced failure count, but the plan should avoid promising unconditional complete postings for corrupt/unrepairable legacy rows. For valid application-produced legacy data, coverage is complete.

## B) Exact post-commit control-flow placement

**RESOLVED — NON-BLOCKING. The plan is implementable, but placement must be literal.**

The reconcile call cannot remain anywhere inside the current outer `try`, because that outer catch deletes uploaded blobs. It also cannot remain inside the client transaction’s inner `try`, because that inner catch always attempts rollback.

The safe structure is:

```ts
const archive = await openArchive(archivePath);
const uploaded: string[] = [];
let summary: RestoreSummary;

try {
  try {
    // pre-check
    // upload blobs

    const client = await pool.connect();
    try {
      await client.query("begin");
      // re-check, delete, restore
      await client.query("commit");
      summary = { tables, rows, files };
    } catch (error) {
      await client.query("rollback");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    for (const key of uploaded) {
      await storage.delete(key).catch(() => {});
    }
    throw error;
  }
} finally {
  await archive.close();
}

// Only here: outside rollback, blob-cleanup, and archive-finalization scopes.
try {
  const result = await reconcileUserPostings(createDb(pool), userId);
  summary.postings = {
    repaired: result.repaired,
    failed: result.failures.length,
  };
} catch {
  summary.postings = { repaired: 0, failed: 1 };
}

return summary;
```

Equivalent nesting is acceptable, but these properties are mandatory:

- no `return` immediately after `commit`;
- the committed summary is captured before leaving the transaction scope;
- the client has been released;
- the blob-cleanup catch has completed successfully;
- the archive `finally` has completed;
- reconcile has its own catch and is awaited.

With that structure, either a top-level `seedSystemAccounts` throw or any other outer reconcile throw cannot issue rollback or delete uploaded blobs.

One minor pre-existing edge remains: if `archive.close()` itself throws after the database commit, reconciliation will not run and the completed restore will be reported as an error. That is not introduced by Design 1b and need not block A6.

## C) Insert skip, delete loop, table-set equality, and deferred pass

**RESOLVED — NON-BLOCKING.**

The interactions are correct.

- `postings` remains in `restorableTables()` because it belongs to `LINKED_TABLES`. Therefore the existing set-equality assertion at `backup.test.ts:105` still correctly requires it.
- The per-user insert loop then gives this one restorable table special derived-data treatment by skipping it. Membership in `restorableTables` does not require verbatim insertion.
- The reverse delete loop does not directly delete linked tables. That is safe under the freshness contract, and any postings attached to deleted transactions cascade through `postings.transaction_id`.
- `postings` has no entry in `DEFERRED_RESTORE_COLUMNS`, so the second pass never reads or updates archived posting rows.
- The second pass only iterates accounts, categories, and transactions. Skipping postings cannot affect it.
- `tableCount` and `rowCount` semantics should be decided explicitly: placing `continue` before reading/counting posting rows means the summary reports rows actually restored, not archived postings deliberately discarded. That is the more defensible meaning, but a small assertion would prevent accidental ambiguity.

The proposed parent-order assertions for accounts, categories, and transactions before postings are correct and sufficient for both backup ordering and whole-database restore.

## D) New correctness, security, or scope problems

**No new blocking design problem.**

The divergence between restore paths is defensible:

- Per-user restore accepts a user-supplied archive, rewrites tenant ownership, and operates in a database that can contain other tenants. Treating postings as untrusted derived data is appropriate.
- Whole-database `restoreDump` requires an empty database, restores all users and all parent rows together, preserves IDs, and runs in a single transaction. Verbatim posting restoration is appropriate there because the archive represents the complete database rather than data being transplanted into an existing multi-tenant database.
- Invalid whole-database posting references cause FK failure and roll back the entire restore. They cannot bind to pre-existing foreign tenant rows because the target must have no users and is intended to be empty/migrated.
- `ALL_TABLES` ordering puts all posting parents first; no deferred posting column is necessary.

The accepted version-1 compatibility regression is real but clearly documented. Keeping it non-blocking is reasonable if the operational contract genuinely requires matching application/schema code for whole-database restoration.

One wording correction is advisable: the whole-database target check only explicitly proves that `users` is empty. It does not prove every table is empty. Under normal FK-connected application data this is a reasonable proxy, but “empty migrated database” remains an operational precondition, not something `restoreDump` comprehensively verifies.

## E) Acceptance criteria and tests

**BLOCKING — the expanded tests are substantially better but still insufficient to gate A6.**

The proposed AC2–AC5 cases close most gaps from review-14:

- fresh user with four system accounts;
- rejection when a real account exists;
- old archive synthesis;
- new archive skip-and-synthesize behavior;
- foreign-reference archived posting ignored;
- parent-order checks;
- consistency checks after successful reconciliation.

However, critical coverage is still missing or underspecified.

### 1. The post-commit thrown-error test lacks a reliable mechanism

The plan says the test “may be a focused unit-level test if a full DB fault is impractical,” but it does not specify how `reconcileUserPostings` or `seedSystemAccounts` will be made to throw.

A malformed transaction usually produces a returned per-transaction failure, not a thrown outer reconcile error. That does not exercise the dangerous boundary identified in review-14 §3B. The test must force the awaited reconcile call itself to reject—particularly the top-level `seedSystemAccounts` path—and prove all of the following:

- `restoreUserBackup` returns a committed summary;
- legacy rows remain committed;
- uploaded blob rows and storage objects remain;
- no rollback-after-commit is attempted;
- no blob deletion is called;
- `postings.failed > 0`.

This likely needs a narrow injectable reconcile dependency/helper or a controlled database failure that occurs after commit. The plan must identify a testable seam rather than leave the core regression test aspirational.

### 2. Soft-deleted transaction coverage is not tested

The implementation does include soft-deleted transactions, but the user’s completeness requirement specifically calls them out. At least one old- or new-archive test should restore a soft-deleted transaction and assert that it receives the expected synthesized postings and is absent from `findInconsistentPostings`.

### 3. Representative derived shapes are under-covered

AC3/AC4 currently describe “a transaction” and source-shape equality. That can pass while only the ordinary branch works. Because skipping postings makes reconciliation the sole source of all per-user restored postings, the restore test should cover at least:

- ordinary transaction;
- split transaction;
- transfer-linked pair;
- opening-balance transaction;
- soft-deleted transaction.

These do not necessarily require five separate archives, but the restored archive should exercise every derivation branch on which Design 1b now depends.

### 4. AC6 lacks a meaningful whole-database posting test

Existing mocked `restoreDump` tests initialize all tables but do not populate postings. Order assertions alone do not prove that `restoreDump` inserts posting columns verbatim.

Add a focused mock test with one posting row and assert that:

- the posting insert occurs after account, category, and transaction inserts;
- `id`, `transaction_id`, `account_id`, nullable `category_id`, amount, necessity, note, and `created_at` are passed through unchanged;
- no posting field is deferred or omitted.

A real empty-database restore is unnecessary if the mocked query recording covers this precisely.

### 5. Route logging should be asserted or demoted from AC5

AC5 explicitly requires failures to be logged at the route. The plan mentions logging but proposes no route-level assertion. Either add a focused route/service-summary logging test or make route logging a non-AC implementation detail. An acceptance criterion should not be left unverified.

### 6. Both account-guard predicates should be structurally gated

A successful fresh-user test and a real-account rejection test strongly exercise the pre-check. They do not independently prove the in-transaction query uses the identical predicate. A focused query-recording/unit test, or extraction of a shared guard-query helper used in both places, would prevent the two checks from drifting.

These omissions—especially the actual reconcile-throw boundary—mean the plan is not yet ready to implement as a gated change.

## F) PR-A guardrails

**RESOLVED — NON-BLOCKING. No remaining PR-A guardrail violation.**

The proposed scope remains additive:

- no ledger reader becomes posting-derived;
- no DTO, shared schema, web, or public ledger response changes;
- postings remain shadow data;
- per-user restore orchestration and its internal summary are the only behavioral changes;
- whole-database restore only receives postings through the shared table ordering;
- route logging does not alter ledger semantics.

`RestoreSummary.postings` being optional is compatible with existing callers, although tests should verify the route continues returning the intended serialized shape.

## Prior blocking findings

- Review-14 §1B, overbroad ID/remap claim: **RESOLVED, NON-BLOCKING.**
- Review-14 §1C/§9B, raw posting archive trust/tenant gap: **RESOLVED, NON-BLOCKING.**
- Review-14 §3B, unsafe post-commit control-flow ambiguity: **RESOLVED in design, NON-BLOCKING**, provided implementation follows the exact boundary above.
- Review-14 §9A, insufficient AC coverage: **PARTIALLY RESOLVED but still BLOCKING** due to the missing concrete thrown-reconcile test and other coverage gaps.
- Review-14 §9D, missing category ordering assertion: **RESOLVED, NON-BLOCKING.**
- Review-14 §7, whole-database v1 compatibility regression: **DOCUMENTED AND ACCEPTED, NON-BLOCKING.**

**Final verdict: BLOCKING — one further plan revision is required for tests, not architecture.** Design 1b is a correct and secure implementation direction. Before implementation, specify a deterministic test seam for a post-commit reconcile/seed rejection and add explicit coverage for soft-deleted/representative posting shapes and verbatim whole-database posting restore.