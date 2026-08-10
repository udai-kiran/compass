# Implementation E — P9 comment-only fix

## Files inspected
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` (lines 660–795)

## Files changed
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`

## Diff

### Hunk 1 — lines 677-695 (big block, second half of the deviation note)

```diff
-// This test instead has B UPDATE a pre-existing pre-statement-date
-// transaction's `amount_paise` (never touching `account_id`, so no FK
-// re-check and no lock on the `accounts` row is taken). This still
-// constructs the same two-edge cycle the recipe calls for: A's earlier
-// ledger aggregate read the row's OLD amount (A rw-> B, since B later
-// overwrites what A read), and B reads the account row A will write (B rw->
-// A, the reverse edge) before committing — the same dependency shape, via a
-// write absorb's own aggregate query is equally blind to until it re-reads.
+// This test instead has B UPDATE a pre-existing pre-statement-date
+// transaction's `amount_paise` AND both legs of its posting family.
+// After PR-E, the aggregate `ledgerDuesAtDates` reads from `postings`,
+// not `transactions` — so it is the POSTING update that creates the
+// A rw-> B anti-dependency (A read the posting amounts B will overwrite).
+// The `transactions` update is kept only so the legacy row stays
+// consistent with its postings; it is NOT what triggers 40001. Both
+// posting legs are updated together via the CASE expression to keep the
+// family zero-sum (matching `buildOrdinaryPostings`'s balanced pair).
+// The deadlock-avoidance property still holds: no FK column
+// (`account_id`, `transaction_id`) appears in any SET list, so Postgres
+// performs no FK re-check and takes no `FOR KEY SHARE` lock on the
+// `accounts` row that connection A holds `FOR UPDATE`.
+// `rebuildPostingsForTransaction` must NOT be used here: it deletes and
+// re-inserts postings, and those INSERTs would perform FK checks and
+// reintroduce the deadlock. Do not "simplify" by dropping the postings
+// UPDATE — that silently makes these tests vacuous (no anti-dependency,
+// no 40001, no retry), which is exactly the regression PR-E introduced
+// and that this change repaired.
```

### Hunk 2 — inline comment in first hook (lines ~711-715 after edit)

```diff
-      // Connection B: its own serializable transaction. FIRST reads the
-      // account row (the reverse edge — B reads what A will later write),
-      // THEN overwrites the pre-existing pre-statement-date ledger row's
-      // amount (the write A's earlier aggregate read is now stale against)
-      // and commits.
+      // Connection B: its own serializable transaction. FIRST reads the
+      // account row (the reverse edge — B reads what A will later write),
+      // THEN updates the transaction's amount_paise AND both posting legs
+      // (the postings update is the anti-dependency: A's earlier postings
+      // aggregate read is now stale against B's overwrite) and commits.
```

## Command run

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev \
  REDIS_URL=redis://192.168.2.196:6379 \
  SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 \
  node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts
```

## Literal output

```
✔ listReconciliations/recomputeReconciliation: Diners-shaped constituent rows ... (211.396807ms)
✔ listReconciliations/recomputeReconciliation: a soft-deleted transaction is excluded ... (60.852674ms)
✔ listReconciliations: a second card of the SAME user does not leak ... (44.114324ms)
✔ listReconciliations: a second user's identical card does not leak ... (52.493436ms)
✔ listReconciliations: boundary — close−1 counts, close and close+1 do not (80.139085ms)
✔ listReconciliations: statement_date null → both fields null ... (32.979546ms)
✔ listReconciliations: an individually-safe opening balance ... overflow ... (29.007438ms)
✔ recomputeReconciliation: the same opening-balance overflow ... (36.164761ms)
✔ absorbCarryover: Diners numbers ... (42.297164ms)
✔ absorbCarryover: a second identical call 409s ... (34.246037ms)
✔ absorbCarryover: sequential absorbs of two different reconciliation rows ... (36.844453ms)
✔ absorbCarryover: absorbing one reconciliation shifts every other row's drift ... (50.868562ms)
✔ absorbCarryover: a nonzero preexisting opening balance (30.313621ms)
✔ absorbCarryover: a negative-drift fixture 409s ... (28.088741ms)
✔ absorbCarryover: a null total_due_paise 409s (12.030988ms)
✔ absorbCarryover: a null statement_date 409s (12.691778ms)
✔ absorbCarryover: an archived card 409s (23.73609ms)
✔ absorbCarryover: a non-credit-card account 400s (9.128082ms)
✔ absorbCarryover: a foreign (nonexistent) account id 404s (5.920063ms)
✔ absorbCarryover: a reconciliation belonging to another account of the SAME user 404s (12.699058ms)
✔ absorbCarryover: only transactions strictly before statement_date count ... (51.592286ms)
✔ absorbCarryover: listAccounts reflects the new opening balance (31.426055ms)
✔ absorbCarryover: post-commit, a best-effort net-worth snapshot repair ... (27.267203ms)
✔ absorbCarryover: a concurrent account-row lock ... (290.682222ms)
✔ absorbCarryover: a genuine SSI dependency cycle forces 40001 ... (46.559442ms)
✔ absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 ... (44.853597ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2417.541219
```

Exit code: 0

## Assumptions
- No executable code was touched; changes are comments only.
- The second hook's reference comment ("see the deviation note above the previous test") remains accurate because it still points to the now-updated deviation note.

## Unresolved risks
- None.
