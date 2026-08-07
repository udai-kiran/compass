# A5 design — backfill + idempotent full-shape reconciliation + boot hook + invariant checker

Slice A5 of the postings dual-write model (PR-A). Governing plan: `PLAN-dualwrite.md`
("Deployment / backfill protocol" + "Per-transaction characterization invariant").
Status: APPROVED (Codex review-12 raised 3 blockers B1/B2/B3, ALL resolved below + code-verified;
implementation must follow the "review-12 resolutions" section which OVERRIDES P1/P2/P3 where they conflict).

## review-12 resolutions (APPROVED — these OVERRIDE the original P1/P2/P3 below)
Codex review-12 verdict: directionally sound, 3 blocking design gaps. All three CONFIRMED valid by coordinator
against source and resolved as follows (Codex's own prescriptions; B1 placement code-verified). NB refinements
adopted where cheap + correctness-improving.

- **R-B1 (hook placement — quiescence).** MOVE the reconcile hook OUT of `startJobs` into `buildApp`
  (`app.ts`), placed AFTER `registerLedgerCacheSubscriber(app)` (:179) and BEFORE `await startJobs(app)`
  (:181). Verified: `db` is decorated at app.ts:165; the `system` Worker is constructed at jobs/index.ts:237
  and BullMQ workers consume on construction, so the old "after snapshotAllUsers (:402)" spot runs with
  workers LIVE → lost-mirror race. The buildApp spot is fully quiescent (no workers, no HTTP listen until
  server.ts:15). Keep it `.catch()`-guarded + logged (PR-A non-blocking; Codex NB2/Q-A5-3 confirmed served
  data is legacy-only, so a reconcile failure cannot surface posting-derived wrong data — but it MUST be
  logged loudly). P3's "after snapshotAllUsers" placement is SUPERSEDED.
- **R-B2 (structured failure aggregation — never silent).** `reconcileAllPostings(db)` returns
  `{ users: number; checked: number; repaired: number; failures: Array<{ userId: string; transactionId?: string;
  error: unknown }> }`. `reconcileUserPostings` bubbles per-transaction failures (id + error) up into that
  array (not just a local `string[]`); per-user errors also append `{ userId, error }`. The boot hook logs
  when `failures.length > 0 || repaired > 0` (a WARN/ERROR line naming counts + the failing ids/users so an
  operator sees the PR-B gate is unmet). The read-only checker applies the analogous rule: a per-transaction
  compute/query error makes that txn NONCONFORMING (structured), never aborts the all-users pass.
- **R-B3 (split-parent equality — do NOT launder corrupt data).** In the SPLIT branch of the shared
  `computePostingDraftsForTransaction`, compute `sumPaise(splitRows.map(s => s.amountPaise))` and require it to
  EQUAL `row.amountPaise`; on mismatch THROW a typed error (`PostingShapeError` or similar) — such a row is NOT
  safely repairable (no zero-sum posting set can simultaneously balance, reproduce the parent real leg, AND
  reproduce the splits). Reconciler/checker CATCH it per-transaction → record as failure/nonconforming (do NOT
  auto-repair, do NOT overwrite). `buildSplitPostings`' internal math is UNCHANGED (real leg still = sum, which
  now provably == parent when drafts are returned).
  - WRITER-PATH CONSEQUENCE (coordinator flag for the implementation review): `rebuildPostingsForTransaction`
    is also a writer primitive. The only writer that can rebuild a split txn with a diverging amount is imports
    reconciliation (commitImport updating `amountPaise` of a matched txn that happens to carry splits). Post-R-B3
    that import would FAIL ATOMICALLY rather than mint an invariant-violating posting. Judged CORRECT (refuse to
    create bad data) and extremely narrow (only when a statement correction changes the AMOUNT of a split txn to
    a value != its split sum; date/merchant-only corrections and non-split txns are unaffected). Codex
    implementation review (review-13) MUST confirm this breaks no common path; if it does, add an A4-style
    reconcile-writer guard rather than weakening R-B3.
- **NB adoptions (fold in):** (1) multiset key = `JSON.stringify([accountId, amountPaise, categoryId, necessity,
  note])` occurrence-counted (NOT a `|`-join — split notes may contain the delimiter). (2) The shared computer's
  row lookup is TENANT-SCOPED: `where: and(eq(transactions.id, id), eq(transactions.userId, userId))` (enforce
  its own contract). (3) The optional pre-resolved `systemAccounts` param uses a named concrete type, stays
  internal/trusted (reconciler resolves ONCE per user and passes it). (4) Rename the checker to
  `findInconsistentPostings(db, userId?): Promise<Array<{ userId: string; transactionId: string; reason: string }>>`
  — enumerates users, resolves system accounts per user, includes soft-deleted, treats compute/query errors as
  nonconforming, and NEVER writes/seeds (read-only). (5) If, after `seedSystemAccounts`, a user still lacks any
  of the 4 kinds, record that user as a FAILURE (not silently skipped). (6) Out-of-safe-range historical paise
  surface as a failure (builder `assertSafePaise`/number-mode loss → caught per-transaction), not a normal
  mismatch. (7) Per-transaction top-level `db.transaction` per row is confirmed appropriate (failure isolation);
  do NOT parallelize; do NOT wrap a whole user in one tx.

Everything ELSE in review-12 was NON-BLOCKING and confirms the plan (boot ordering facts, PR-A non-blocking
boot, five-field multiset sufficiency, null/'' normalization safe, P1 extraction behavior-preserving for valid
shapes, coverage of soft-deleted/transfer-leg/opening/column-only, tenant checks valid at unauthenticated boot).

## Goal
At boot, BEFORE the app serves traffic, ensure every existing transaction carries its correct
posting shape (opening / transfer-leg / split / ordinary), repairing missing OR stale/wrong/duplicate
postings; idempotent (a second run performs ZERO writes); INCLUDING soft-deleted parents; seeding the
4 system accounts per user first. Also ship a READ-ONLY per-transaction characterization checker for
A7 tests and the PR-B pre-cutover gate.

## Verified boot facts (coordinator-read)
- `server.ts:5` `await buildApp(config)` (runs `startJobs`) precedes `app.listen()` at `server.ts:15` →
  everything in `startJobs` completes before traffic is served.
- `jobs/index.ts` boot catch-up sequence (materialize recurring → bill reminders → card-due tasks →
  `snapshotAllUsers` at :398-402) — each step `.catch()`-guarded so a failure LOGS but never blocks boot;
  `onClose` hook at :404. New reconcile step slots in AFTER :402, before :404.
- Builders `buildOrdinary/Split/Opening/TransferLegPostings` exported (`postings.ts:74/110/185/218`);
  `rebuildPostingsForTransaction` exported (`transactions.ts:198`). `postings` table (`ledger.ts:132`) has
  `transactionId, accountId, amountPaise, categoryId, necessity, note` + `postings_tx_idx`.
- `resolveSystemAccounts` (`post-entry.ts:160`) THROWS if any of the 4 system accounts is missing;
  `seedSystemAccounts` (`post-entry.ts:126`) is idempotent (select-then-insert-missing, unique-violation
  tolerant). Pre-PR-A users have NO system accounts.
- All-users / all-transactions batch pattern to reuse: `db.select({id}).from(users)` then per-user
  try/catch (networth.ts:191-217, autopilot.ts). All transactions incl soft-deleted = same select on
  `transactions` with NO `isNull(deletedAt)` filter (PLAN line 33: postings retained on soft-delete).

## PR-A gate semantics (decision — needs Codex confirmation)
In PR-A NO reader is postings-backed (readers convert in PR-B+), so served data comes from legacy columns
regardless of posting state. Therefore a reconciliation FAILURE must NOT block boot in PR-A — the boot step
is `.catch()`-guarded + logged, consistent with its neighbors. The GATE that "every applicable transaction
has its expected posting shape" becomes load-bearing at the PR-B cutover; A5 ships the CHECKER
(`assertPostingsConsistent`, read-only) that A7 exercises and PR-B will run as its pre-cutover gate. A5 does
NOT hard-block PR-A boot.

## Design

### P1 — extract a drafts computer (behavior-preserving refactor of transactions.ts)
Extract `computePostingDraftsForTransaction(t, userId, id): Promise<PostingDraft[] | null>` from the shape
branching currently inlined in `rebuildPostingsForTransaction` (transactions.ts:198-244): resolves system
accounts, reads the row (return `null` if absent), branches opening → transfer-link membership → splits →
ordinary, returns the drafts. `rebuildPostingsForTransaction` becomes: `const drafts = await compute(...);
if (!drafts) return; await replacePostings(t, id, userId, drafts);` — identical behavior. Both the reconciler
and the checker reuse `compute` so shape logic never forks. (Optional perf: `compute` accepts an optional
pre-resolved `systemAccounts` to avoid re-resolving per transaction; the reconciler resolves once per user.)

### P2 — new service modules/ledger/services/reconcile-postings.ts
- `reconcileUserPostings(db, userId): Promise<{ checked: number; repaired: number; failures: string[] }>`:
  1. `await seedSystemAccounts(db, userId)` (idempotent — pre-PR-A users get their 4 accounts).
  2. resolve system accounts ONCE.
  3. select ALL transaction ids for the user (NO deleted_at filter).
  4. for each id, in its own `db.transaction(t)` (so one bad row doesn't abort the whole user):
     `drafts = compute(t, userId, id, systemAccounts)`; query stored postings for the tx; MULTISET-compare
     on the 5 tuple fields (accountId, amountPaise, categoryId, necessity, note), order-independent; if the
     multisets differ → `replacePostings(t, id, userId, drafts)` and `repaired++`. On per-row error push id to
     `failures` (never throw out of the user loop).
- `reconcileAllPostings(db): Promise<{ users, checked, repaired, failedUsers }>`: select all users, loop
  `reconcileUserPostings` in per-user try/catch (mirrors `snapshotAllUsers`); return a pass summary.
- `assertPostingsConsistent(db, userId?): Promise<string[]>`: READ-ONLY. Same compute + multiset compare but
  NEVER writes; returns the list of nonconforming transaction ids (empty ⇒ consistent). This IS the
  per-transaction characterization invariant (PLAN 27-34). Used by A7 tests + the PR-B gate.

### P3 — boot hook (jobs/index.ts)
After `snapshotAllUsers` (:402), add `await reconcileAllPostings(app.db).then(pass ⇒ log if repaired>0 /
failedUsers>0).catch(err ⇒ app.log.error(...))` — `.catch()`-guarded, never blocks boot (PR-A semantics).

## Idempotency / correctness argument
Builders are pure + deterministic, so recomputing yields identical drafts; after a repair (or when already
correct) the second pass finds multisets equal → 0 writes. `replacePostings` (delete-all-for-tx + insert)
inherently prunes duplicates/extras on repair. Multiset key includes categoryId + note so a split's multiple
Expenses postings compare distinctly. Soft-deleted parents are read normally (compute ignores deleted_at).
Column-only openings have no transaction row → never enumerated → correctly no postings.

## Acceptance criteria (A5)
- AC-A5-1: `reconcileAllPostings` seeds system accounts per user, then repairs each transaction (incl
  soft-deleted) to its correct shape; a second run performs ZERO writes (compare-first).
- AC-A5-2: `assertPostingsConsistent` is read-only and returns the nonconforming-txn-id list.
- AC-A5-3: boot hook runs after `snapshotAllUsers`, `.catch()`-guarded (never blocks boot in PR-A).
- AC-A5-4: `rebuildPostingsForTransaction` behavior unchanged (refactor is behavior-preserving); no reader/
  DTO/hydrate/schema/shared/web change.
- AC-A5-5: `npm run typecheck -w apps/api` exit 0; lint 0; `postings.test.ts` + `schema.decomposition.test.ts`
  still green. (DB-backed reconcile/idempotency/invariant tests are A7 + CONVERGE.)

## Non-goals (A5)
Restore/backup posting synthesis + remap (A6); DB-backed reconcile/invariant/parity tests (A7); the
`linkTransfer` lock-order hardening (A7); reader conversion (PR-B+).

## Open questions for Codex plan review
- Q-A5-1: per-transaction `db.transaction` (savepoint) for each compare+repair — acceptable for boot-time, or
  should repairs batch per user? Correctness vs boot latency for a personal-finance-scale dataset.
- Q-A5-2: should `assertPostingsConsistent` (PR-A) cover ONLY per-transaction shape, deferring the ADDITIONAL
  real-account balance/report parity check (PLAN line 35) to A7? (Lead lean: yes — shape now, e2e parity in A7.)
- Q-A5-3: is the PR-A non-blocking-boot rationale sound (readers legacy ⇒ a reconcile failure cannot corrupt
  served data; the gate turns blocking at PR-B)? Any reason A5 must hard-gate boot now?
- Q-A5-4: any correctness hole in the multiset compare (e.g. `note` normalization for null vs '' , necessity
  null handling, bigint amount equality) that would make a truly-consistent tx spuriously repair (breaking the
  zero-writes-second-run gate) or vice versa?
