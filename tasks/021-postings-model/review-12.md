## Verdict

PLAN-A5 is directionally sound, and the core compare-first reconciliation approach is appropriate. However, I found three blocking design gaps that should be corrected in the plan before implementation:

1. The proposed `startJobs()` insertion point permits BullMQ workers to mutate ledger state concurrently with reconciliation.
2. Per-transaction failures are swallowed below `reconcileAllPostings()` and therefore may never be logged.
3. The extracted shape computer can characterize a split transaction as “consistent” even when its split total differs from the legacy parent amount, violating the governing invariant.

The PR-A non-blocking boot decision itself is sound: no production reader or DTO is postings-backed on this branch.

## BLOCKING findings

### B1 — `startJobs()` is not a safely quiescent home for the backfill

The claimed HTTP ordering is correct:

- [server.ts](/home/udai/PennyPilot/apps/api/src/server.ts:5) awaits `buildApp()`.
- [app.ts](/home/udai/PennyPilot/apps/api/src/app.ts:181) awaits `startJobs(app)`.
- `app.listen()` happens only after `buildApp()` returns at [server.ts](/home/udai/PennyPilot/apps/api/src/server.ts:15).

The individual boot catch-up operations are also `.catch()`-guarded as claimed, and inserting after `snapshotAllUsers()` would place reconciliation before HTTP traffic and before the `onClose` hook registration.

But `startJobs()` creates active `Worker` instances well before the catch-up sequence:

- The system worker is constructed at [jobs/index.ts](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:230).
- The alerts worker is constructed later in the same function.
- Only after both workers are live does the boot catch-up sequence begin.

BullMQ workers begin consuming once instantiated. Consequently, a queued recurring-materialization or another ledger-mutating job can overlap the compare-and-repair loop even though HTTP is not listening.

That creates a real lost-mirror race under the proposed per-transaction `READ COMMITTED` transaction:

1. Reconciler reads a transaction’s old legacy shape.
2. A worker commits a legacy mutation and its correct new postings.
3. Reconciler compares or replaces using drafts computed from the old shape.
4. Reconciler can overwrite the worker’s correct postings with the stale shape.

The writer’s transaction lock does not protect the reconciler because the proposed computer merely reads the parent; it does not acquire `FOR UPDATE`, and the reconciliation transaction can span several independent reads.

This also weakens `assertPostingsConsistent`: without a transactionally stable view, it can observe legacy shape and postings from different commits and report a false mismatch.

Required plan correction: run reconciliation before workers are created or activated. The cleanest application startup hook is in `buildApp()` after the DB is decorated and before `startJobs(app)`. It can retain the PR-A best-effort `.catch()` there. Alternatively, refactor `startJobs()` so the reconciliation runs before any `Worker` construction, but then it is no longer accurately “after `snapshotAllUsers`.”

The proposed “after snapshot” ordering is not intrinsically important: snapshotting remains legacy-derived in PR-A and does not require posting reconciliation. Quiescence matters more than adjacency to the existing catch-up steps.

There is also a deploy-time option: [bootstrap.ts](/home/udai/PennyPilot/apps/api/src/db/bootstrap.ts:53) is a real application-owned post-migration sequence used by the compose `migrate` service. It applies migrations and then calls `ensureOwner`. A reconciler could be invoked there after `ensureOwner`, before the API starts. This is safer than running behind live workers, although keeping a guarded application-start catch-up may still be desirable for manual installations that run `db:migrate` directly.

The narrower plan assertion that "`db:migrate` has no usable post-migrate hook" is correct: the workspace script is only a direct `drizzle-kit migrate` command. But the repository’s production `db:bootstrap` path is a usable explicit post-migration integration point and should not be overlooked.

### B2 — Transaction-level reconciliation failures disappear from the all-users summary

`reconcileUserPostings()` is planned to catch each row error, append the transaction ID to `failures`, and then return normally.

But `reconcileAllPostings()` is specified to return only:

```ts
{ users, checked, repaired, failedUsers }
```

Its per-user catch only sees failures thrown out of `reconcileUserPostings()`. A user with 999 successful transactions and one failed transaction returns successfully, so:

- `failedUsers` remains zero;
- no failure is thrown to the boot `.catch()`;
- the proposed boot logging condition only checks `repaired > 0` or `failedUsers > 0`;
- the unreconciled transaction can therefore be completely silent.

This directly defeats the backfill’s operational purpose. PR-A may continue booting, but it must prominently report that the future reader-conversion gate is not satisfied.

Required plan correction: aggregate transaction failures explicitly, preferably with both transaction ID and error information. For example:

```ts
{
  users: number;
  checked: number;
  repaired: number;
  failures: Array<{ userId: string; transactionId?: string; error: unknown }>;
}
```

At minimum, return `failedTransactions` and ensure boot logs it. A bare `string[]` of IDs is also insufficient for diagnosing why a row could not be computed or repaired.

The checker needs the analogous rule: any per-transaction computation/query error must make that transaction nonconforming or be returned through a structured error result. It must not abort the entire all-users check, and it must not disappear.

### B3 — Split-parent equality is absent from the computed invariant

The governing invariant requires a split transaction to have:

- one real posting equal to the legacy parent’s `accountId` and `amountPaise`;
- counter-postings reproducing every split.

The current builder does not take the parent amount. `buildSplitPostings()` computes the real leg from the sum of split rows at [postings.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/postings.ts:121).

The current writers prevent new mismatches:

- `setSplits()` verifies the split total equals the locked parent at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:515).
- Parent amount changes are guarded against existing split totals at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:436).

But A5 is explicitly a historical/full-shape reconciler. It must characterize pre-existing, manually altered, restored, or otherwise corrupt data. If a legacy parent says `-1000` while its splits sum to `-900`, the proposed computer will produce a balanced posting set with a real leg of `-900`. After inserting that set, compare-first will declare the transaction consistent forever, even though postings do not reproduce the parent row.

That violates both the governing plan and A5’s stated checker semantics.

Required plan correction: in the split branch, calculate the split sum with `sumPaise()` and require it to equal `row.amountPaise` before returning drafts. A mismatch is not safely repairable by rebuilding postings because there is no posting shape that simultaneously balances, reproduces the parent real leg, and reproduces the splits. It must be recorded as a reconciliation/checker failure requiring legacy-data repair.

This validation belongs in the shared drafts computer so both rebuilding and checking use the same rule. It preserves current behavior for all valid writer-produced data but intentionally rejects invalid historical state rather than laundering it into a different “expected” shape.

## Non-blocking findings

### NB1 — Boot catch-up factual premises are otherwise correct

The existing catch-up sequence is:

1. Recurring materialization
2. Bill reminders
3. Card-due task materialization
4. Net-worth snapshot

Each operation has its own error guard. `snapshotAllUsers()` is the last existing catch-up before the `onClose` registration.

The proposed location is therefore factually described, but it is not sound because workers are already active, as covered by B1.

### NB2 — PR-A boot may remain non-blocking

No production read path on this branch imports or queries the `postings` table. The only postings consumers are:

- dual-write services;
- schema/decomposition code;
- posting helper tests and projections.

Transaction hydration is still entirely legacy-derived:

- Parent fields come from `transactions`.
- Splits come from `transaction_splits`.
- Transfer identity comes from `transfer_links`.
- DTO `accountId`, `amountPaise`, `categoryId`, and `necessity` are copied from the legacy row at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:154).

The shared DTO remains legacy-shaped at [ledger.ts](/home/udai/PennyPilot/packages/shared/src/schemas/ledger.ts:378). No reader conversion is present.

A failed reconciliation therefore cannot make PR-A return posting-derived wrong balances, reports, transactions, or DTOs. It can affect write availability for a pre-existing user if system-account seeding failed—new dual-write operations call `resolveSystemAccounts()` and will fail atomically—but that is an availability failure, not silent legacy-data corruption. Logging it clearly is essential.

Thus PR-A boot need not hard-fail. PR-B must introduce a blocking, quiescent consistency gate before enabling postings-backed readers.

### NB3 — Compare fields and null normalization are otherwise correct

The five tuple fields are exactly the posting draft’s persisted semantic fields:

- `accountId`
- `amountPaise`
- `categoryId`
- `necessity`
- `note`

The stored fields deliberately excluded from comparison are generated/relational metadata:

- posting `id`
- `transactionId`
- `createdAt`

Normalization is safe given the actual schema and builders:

- `postings.note` is `NOT NULL DEFAULT ''`.
- `transaction_splits.note` is also `NOT NULL DEFAULT ''`.
- Every builder explicitly emits a string note.
- Ordinary/opening real and counter legs use `""`.
- Transfer-leg rebuilds use `""`.
- `categoryId` and `necessity` are genuinely nullable on both draft and stored row and should compare as `null`.
- Drizzle’s `bigint(..., { mode: "number" })` exposes both draft and selected `amountPaise` as numbers. Within the project’s safe-integer contract, strict numeric equality is exact.

The compare implementation should nevertheless avoid ambiguous delimiter concatenation. Use either a structured tuple comparison after deterministic sorting or an unambiguous serialization such as `JSON.stringify([accountId, amountPaise, categoryId, necessity, note])`, then count occurrences in a map. A plain string joined with `|` is unsafe because arbitrary split notes may contain the delimiter.

Out-of-safe-range historical database values will be lossy when selected in number mode or will fail builder validation. They should be surfaced as failures, not treated as a normal mismatch. That is consistent with the project’s `SafePaise` direction.

### NB4 — Multiset semantics are necessary and sufficient for posting-row drift

An order-independent multiset—not a set—is the correct comparison:

- It detects duplicate identical postings.
- It detects extra or missing rows.
- It distinguishes split counters by category, amount, necessity, and note.
- It detects a posting placed on the wrong real or system account.

On mismatch, `replacePostings()` deletes all rows for the transaction and reinserts the expected drafts at [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:60), so duplicates, extras, stale categories, stale notes, and stale shape rows are pruned.

The second pass will perform zero writes if comparison uses the exact values returned by Drizzle and the split-parent issue in B3 is addressed.

### NB5 — The P1 extraction is behavior-preserving only for valid existing shapes

Extracting the current shape branches into `computePostingDraftsForTransaction()` and making `rebuildPostingsForTransaction()` call it is structurally sound. The branch precedence remains:

1. Opening
2. Transfer-link membership
3. Split
4. Ordinary

That order matches the current implementation at [transactions.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:203).

Reusing this function in writers, reconciler, and checker is preferable to duplicating the shape logic.

The optional pre-resolved system-account parameter is safe if:

- it uses a named concrete type;
- callers only pass IDs returned by `resolveSystemAccounts()` for the same `userId`;
- `replacePostings()` retains its ownership validation.

Passing another user’s IDs cannot cross tenant boundaries because `replacePostings()` checks every account and category against `userId`. It would fail before deleting existing postings. Passing same-user IDs under the wrong semantic key could still compute the wrong shape, so the parameter should remain internal/trusted rather than become a general public API.

For stricter misuse resistance, accept a small context object produced by the resolver or keep the overload/module visibility narrow.

The extracted row lookup should also be tenant-scoped:

```ts
where: and(
  eq(transactions.id, id),
  eq(transactions.userId, userId),
)
```

The reconciler’s enumeration makes an accidental cross-user row unlikely, but the shared helper should enforce its own contract. Returning a transaction merely because its globally unique ID exists is inconsistent with the ownership discipline elsewhere.

### NB6 — Coverage is broadly correct

The proposed unfiltered transaction enumeration includes soft-deleted parents. `computePostingDraftsForTransaction()` does not check `deletedAt`, so their postings are retained and reconciled as required.

Column-only openings are excluded by construction because they have no transaction row. This is correct for dual-write PR-A.

Shape coverage includes:

- opening transaction rows;
- either leg of a linked transfer;
- split transactions;
- ordinary transactions;
- soft-deleted variants of all of the above.

Hard-deleted parents need no reconciliation because their postings cascade-delete through the FK.

Link changes are reflected because the transfer-link lookup is performed from current database state. A previously linked row that is no longer linked will fall back to split or ordinary shape, and stale Clearing postings will be replaced.

System accounts are seeded before resolution, which is correct. Because `seedSystemAccounts()` tolerates a unique-index race by returning, the caller should resolve immediately afterward as proposed. If resolution still reports missing kinds, that user should be recorded as failed rather than silently skipped.

One subtle but acceptable consequence is that a structurally corrupt transaction—foreign account/category ownership, impossible split total, unsafe paise value—cannot be repaired merely by replacing postings. It should remain a reported failure.

### NB7 — Tenant checks remain valid in an unauthenticated boot process

Running across all users at boot does not weaken ownership semantics. The reconciler derives each `userId` from the `users` table and scopes transaction enumeration accordingly.

`replacePostings()` independently verifies:

- the transaction belongs to that user at [post-entry.ts](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/post-entry.ts:49);
- every posting account belongs to that user;
- every non-null posting category belongs to that user.

Those checks occur before deletion, so an ownership failure leaves existing postings intact within the transaction. This is the correct behavior for an unauthenticated maintenance process.

The checker should apply the same user-scoped transaction enumeration and should not trust a transaction ID without its owning user.

### NB8 — Checker result design needs more precision

`assertPostingsConsistent(db, userId?): Promise<string[]>` is workable for transaction-shape mismatches, but the plan needs to specify all-users behavior:

- enumerate users, not merely transaction IDs;
- resolve/cache system accounts per user;
- include soft-deleted transactions;
- treat compute/query failures as nonconforming rather than aborting the whole pass;
- avoid silently seeding because the checker is promised to be read-only.

A flat transaction-ID list is globally unambiguous because IDs are UUID primary keys, but structured `{userId, transactionId, reason}` results would be much more useful for a deployment gate. If the API name retains `assert...`, throwing on any mismatch would be conventional; since the proposed API returns mismatches, a name such as `findInconsistentPostings` would be clearer. This is naming/API clarity, not a correctness blocker if behavior is precisely documented.

### NB9 — Per-transaction transactions are acceptable but are not savepoints here

When invoked with the top-level `Db`, each `db.transaction()` is a real database transaction, not a savepoint. Savepoints only arise when nesting under an existing transaction handle.

One transaction per row gives the desired failure isolation and makes compare-plus-replace atomic. For personal-finance-scale data this is reasonable. It is also preferable to one user-wide transaction because one malformed transaction should not roll back hundreds of valid repairs.

Costs and considerations:

- It adds one transaction round trip per ledger row.
- Holding a user-wide transaction would be faster but increases lock duration and rollback blast radius.
- A bounded batch could be introduced later if measured boot time requires it.
- Do not parallelize transactions freely: it increases connection-pool pressure and makes lock interactions harder to reason about.

The concurrency issue is not caused by transaction granularity; it is caused by running reconciliation after active workers. Moving the hook to a quiescent phase resolves the major risk.

### NB10 — A5 scope is otherwise appropriate

A5 correctly excludes:

- A6 restore/backup synthesis and remapping;
- A7 DB-backed reconciliation/parity tests;
- A7 `linkTransfer` lock ordering;
- PR-B reader conversion.

The per-transaction read-only checker belongs in A5 because it captures the invariant and avoids duplicating shape logic later. Real-account balance/report parity is an additional end-to-end check and can remain in A7.

The governing plan says the per-transaction invariant is the primary safety net and parity cannot replace it. A5 should therefore make the checker semantically complete now, including split-parent validation, even if DB-backed exercise of that checker lands in A7.

## Answers to Q-A5-1 through Q-A5-4

### Q-A5-1 — Per-transaction transaction or batching?

Use one database transaction per transaction row. It provides good failure isolation and atomic compare-plus-repair and is acceptable for the expected scale.

Do not describe these as savepoints when called from `reconcileUserPostings(db, ...)`; they are top-level transactions. Do not run them while BullMQ workers are live. If startup performance later proves unacceptable, use bounded batches after measurement rather than one transaction for the whole user.

### Q-A5-2 — Shape only now, parity later?

Yes. A5’s checker should cover the complete per-transaction characterization invariant only. The real-account balance/report parity check is additional and can remain in A7.

“Complete” must include verifying that split rows sum to the legacy parent amount; comparing drafts generated solely from the split sum is insufficient.

### Q-A5-3 — May PR-A reconciliation failure remain non-blocking?

Yes. No PR-A production reader, hydrator, or DTO is postings-backed, so failed reconciliation cannot surface posting-derived wrong data. Existing legacy reads remain correct.

The failure can make new dual-write operations unavailable if system accounts are absent, but those writes fail atomically rather than corrupting legacy data. Therefore non-blocking boot is a defensible PR-A policy.

It must not be silent: aggregate and log every transaction/user failure. PR-B’s cutover gate must be blocking and run from a quiescent or transactionally stable context.

### Q-A5-4 — Is the five-field multiset comparison correct?

Yes, with two qualifications:

1. Use an unambiguous tuple representation and occurrence counts; do not concatenate arbitrary notes with an unescaped delimiter.
2. Validate split total equals `transactions.amountPaise` before generating split drafts.

There is no inherent `null`/`""` normalization mismatch in the real schema:

- note is non-null on both postings and splits and builders emit strings;
- category and necessity use matching nullable values;
- amount is a number on both sides under Drizzle’s bigint-number mapping and compares exactly within the safe-integer contract.

The five fields are exactly the stored semantic draft fields, and multiset comparison correctly detects missing, duplicate, extra, and stale postings.