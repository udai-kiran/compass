# Implementation D — P8: restore SSI cycle tests in reconciliation-writes.test.ts

## Files inspected
- `tasks/024-fix-pr-e-ci-red/TASK.md` (Amendment 2 / D7 ruling)
- `tasks/024-fix-pr-e-ci-red/DELEGATION.md` (Iteration 3 — Worker D section)
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts` (owned file)
- `apps/api/src/db/shared/ledger.ts` (postings schema, lines 130-153)
- `apps/api/src/modules/ledger/services/transactions.ts` (createTransaction signature)
- `apps/api/src/modules/ledger/services/postings.ts` (buildOrdinaryPostings, lines 90-106)
- `apps/api/src/modules/ledger/services/post-entry.ts` (resolveSystemAccounts — auto-seeds)
- `packages/shared/src/schemas/ledger.ts` (CreateTransactionSchema, lines 410-425)

## Files changed
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`

## Complete diff

```diff
--- a/apps/api/src/modules/credit/services/reconciliation-writes.test.ts
+++ b/apps/api/src/modules/credit/services/reconciliation-writes.test.ts
@@ -4 +4 @@
-import { and, eq } from "drizzle-orm";
+import { and, eq, sql } from "drizzle-orm";

@@ -7 +7 @@
-import { accounts, emailIngestions, transactions, users } from "../../../db/schema.ts";
+import { accounts, emailIngestions, postings, transactions, users } from "../../../db/schema.ts";

@@ -690-693 +690 @@
-  const [seed] = await db
-    .insert(transactions)
-    .values({ userId, accountId, date: "2029-05-05", amountPaise: -100000 })
-    .returning({ id: transactions.id });
+  const seed = await createTransaction(db, userId, { accountId, date: "2029-05-05", amountPaise: -100000 });

@@ -715-719 +712-721 @@
-        await txB
-            .update(transactions)
-            .set({ amountPaise: -150000 })
-            .where(eq(transactions.id, seed!.id));
+        await txB
+            .update(transactions)
+            .set({ amountPaise: -150000 })
+            .where(eq(transactions.id, seed.id));
+          const updatedPostings = await txB
+            .update(postings)
+            .set({ amountPaise: sql`(CASE WHEN ${postings.accountId} = ${accountId} THEN ${-150000} ELSE ${150000} END)::bigint` })
+            .where(eq(postings.transactionId, seed.id))
+            .returning();
+          assert.equal(updatedPostings.length, 2, "exactly two posting rows updated (card leg + counter-leg), keeping the family zero-sum");

@@ -742-745 +745 @@
-  const [seed] = await db
-    .insert(transactions)
-    .values({ userId, accountId, date: "2029-06-05", amountPaise: -100000 })
-    .returning({ id: transactions.id });
+  const seed = await createTransaction(db, userId, { accountId, date: "2029-06-05", amountPaise: -100000 });

@@ -764-768 +764-775 @@
-        await txB
-            .update(transactions)
-            .set({ amountPaise: -100000 - hookCalls * 1000 })
-            .where(eq(transactions.id, seed!.id));
+          const newAmount = -100000 - hookCalls * 1000;
+          await txB
+            .update(transactions)
+            .set({ amountPaise: newAmount })
+            .where(eq(transactions.id, seed.id));
+          const updatedPostings = await txB
+            .update(postings)
+            .set({ amountPaise: sql`(CASE WHEN ${postings.accountId} = ${accountId} THEN ${newAmount} ELSE ${-newAmount} END)::bigint` })
+            .where(eq(postings.transactionId, seed.id))
+            .returning();
+          assert.equal(updatedPostings.length, 2, "exactly two posting rows updated (card leg + counter-leg), keeping the family zero-sum");
```

## Implementation details

1. **Import additions.** Added `sql` to the `drizzle-orm` import and `postings` to the
   `../../../db/schema.ts` import.

2. **Seeds replaced.** Both bare `db.insert(transactions)` seeds (lines 690-693 and
   742-745) replaced with `createTransaction(db, userId, { ... })`. This creates the
   transactions row AND its balanced posting pair via the production dual-write path.
   `createTransaction` calls `resolveSystemAccounts` internally (which auto-seeds system
   accounts), so no explicit `seedSystemAccounts` call is needed. The return value is a
   `Transaction` object; `.id` replaces the previous `seed!.id` pattern.

3. **Hooks updated.** In both `txB` transactions, after the existing `transactions`
   `amountPaise` update, a second UPDATE sets both posting legs in a single statement:
   ```sql
   (CASE WHEN "postings"."account_id" = $1 THEN $2 ELSE $3 END)::bigint
   ```
   The `::bigint` cast is required because Drizzle's `sql` template parameterizes JS
   numbers as `text` parameters; without the cast Postgres rejects with code `42804`
   ("column is of type bigint but expression is of type text"). The CASE targets the card
   account leg with the new negative amount and the system counter-leg with its positive
   mirror, keeping the posting family zero-sum (consistent with `buildOrdinaryPostings`).
   `.returning()` is called and an `assert.equal(updatedPostings.length, 2, ...)` verifies
   exactly two rows were touched (AC12b).

4. **Ordering preserved.** Both hooks read the `accounts` row first (reverse edge), then
   write `transactions`, then write `postings`. No FK column appears in any SET list.

5. **All four expected values unchanged:**
   - `openingBalancePaise === -350000` at line 737
   - `40001` code assertion at lines 785-787
   - `hookCalls === 2` at line 789
   - `openingBalancePaise === 0` at line 792

6. **Comment at lines 660-684 unmodified.** It describes why B UPDATEs a pre-existing row
   (no FK re-check, no `FOR KEY SHARE` lock on `accounts`). This is still accurate: the
   new postings UPDATE also modifies only `amount_paise`, never `account_id`.

## Commands and literal output

### Run 1 (after first attempt — bigint type error observed, then fixed)

Initial attempt failed with `column "amount_paise" is of type bigint but expression is of
type text` (Postgres code 42804). Added `::bigint` cast and re-ran.

```
$ DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev \
  REDIS_URL=redis://192.168.2.196:6379 \
  SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 \
  node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts
✔ listReconciliations/recomputeReconciliation: Diners-shaped constituent rows (purchases, a payment, a refund) net the signed ledger due and drift (226.356711ms)
✔ listReconciliations/recomputeReconciliation: a soft-deleted transaction is excluded from the ledger due (57.873153ms)
✔ listReconciliations: a second card of the SAME user does not leak into the aggregate (account predicate) (49.264053ms)
✔ listReconciliations: a second user's identical card does not leak (user predicate) (71.896613ms)
✔ listReconciliations: boundary — close−1 counts, close and close+1 do not (70.011889ms)
✔ listReconciliations: statement_date null → both fields null; total_due_paise null with a date → ledgerDue computed, drift null (27.892952ms)
✔ listReconciliations: an individually-safe opening balance plus an individually-safe transaction sum that together overflow Number.MAX_SAFE_INTEGER is refused (500), not silently truncated (27.738426ms)
✔ recomputeReconciliation: the same opening-balance overflow is refused (500) via the recompute path (35.621661ms)
✔ absorbCarryover: Diners numbers — opening_balance_paise becomes −4559125, returned dueDriftPaise is 0, and card activity's totalDuePaise matches the bank (48.439316ms)
✔ absorbCarryover: a second identical call 409s once drift has been absorbed, and changes nothing further (45.394787ms)
✔ absorbCarryover: sequential absorbs of two different reconciliation rows on one card — the second sees the post-seed ledger due and 409s at zero drift (39.446793ms)
✔ absorbCarryover: absorbing one reconciliation shifts every other row's drift too (a global opening-balance change, not an isolated per-cycle one) (57.107849ms)
✔ absorbCarryover: a nonzero preexisting opening balance (33.691529ms)
✔ absorbCarryover: a negative-drift fixture 409s and changes nothing (27.850004ms)
✔ absorbCarryover: a null total_due_paise 409s (12.107318ms)
✔ absorbCarryover: a null statement_date 409s (11.591131ms)
✔ absorbCarryover: an archived card 409s (22.953508ms)
✔ absorbCarryover: a non-credit-card account 400s (10.346485ms)
✔ absorbCarryover: a foreign (nonexistent) account id 404s (6.920435ms)
✔ absorbCarryover: a reconciliation belonging to another account of the SAME user 404s (10.019443ms)
✔ absorbCarryover: only transactions strictly before statement_date count toward the drift (54.409059ms)
✔ absorbCarryover: listAccounts reflects the new opening balance (32.921182ms)
✔ absorbCarryover: post-commit, a best-effort net-worth snapshot repair is triggered for this user (AC6) (29.742172ms)
✔ absorbCarryover: a concurrent account-row lock (an opening-balance edit in progress) blocks absorb until it commits — the final state matches a serial order (305.451975ms)
✔ absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger (45.871267ms)
✔ absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change (38.590656ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2400.302412
```
Exit code: 0

### Run 2 (determinism check)

```
$ DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev \
  REDIS_URL=redis://192.168.2.196:6379 \
  SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 \
  node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts
✔ listReconciliations/recomputeReconciliation: Diners-shaped constituent rows (purchases, a payment, a refund) net the signed ledger due and drift (209.662696ms)
✔ listReconciliations/recomputeReconciliation: a soft-deleted transaction is excluded from the ledger due (58.369275ms)
✔ listReconciliations: a second card of the SAME user does not leak into the aggregate (account predicate) (45.218611ms)
✔ listReconciliations: a second user's identical card does not leak (user predicate) (55.220148ms)
✔ listReconciliations: boundary — close−1 counts, close and close+1 do not 86.332014ms)
✔ listReconciliations: statement_date null → both fields null; total_due_paise null with a date → ledgerDue computed, drift null (30.63921ms)
✔ listReconciliations: an individually-safe opening balance plus an individually-safe transaction sum that together overflow Number.MAX_SAFE_INTEGER is refused (500), not silently truncated (29.366845ms)
✔ recomputeReconciliation: the same opening-balance overflow is refused (500) via the recompute path (33.499902ms)
✔ absorbCarryover: Diners numbers — opening_balance_paise becomes −4559125, returned dueDriftPaise is 0, and card activity's totalDuePaise matches the bank (41.311506ms)
✔ absorbCarryover: a second identical call 409s once drift has been absorbed, and changes nothing further (38.940624ms)
✔ absorbCarryover: sequential absorbs of two different reconciliation rows on one card — the second sees the post-seed ledger due and 409s at zero drift (35.696768ms)
✔ absorbCarryover: absorbing one reconciliation shifts every other row's drift too (a global opening-balance change, not an isolated per-cycle one) (52.280975ms)
✔ absorbCarryover: a nonzero preexisting opening balance (36.105972ms)
✔ absorbCarryover: a negative-drift fixture 409s and changes nothing (26.515878ms)
✔ absorbCarryover: a null total_due_paise 409s (10.879148ms)
✔ absorbCarryover: a null statement_date 409s (11.685128ms)
✔ absorbCarryover: an archived card 409s (23.481871ms)
✔ absorbCarryover: a non-credit-card account 400s (8.77688ms)
✔ absorbCarryover: a foreign (nonexistent) account id 404s (5.328021ms)
✔ absorbCarryover: a reconciliation belonging to another account of the SAME user 404s (10.546955ms)
✔ absorbCarryover: only transactions strictly before statement_date count toward the drift (45.330446ms)
✔ absorbCarryover: listAccounts reflects the new opening balance (33.654353ms)
✔ absorbCarryover: post-commit, a best-effort net-worth snapshot repair is triggered for this user (AC6) (30.798171ms)
✔ absorbCarryover: a concurrent account-row lock (an opening-balance edit in progress) blocks absorb until it commits — the final state matches a serial order (289.65508ms)
✔ absorbCarryover: a genuine SSI dependency cycle forces 40001, and withSerializableRetry succeeds off the fresh ledger (43.994256ms)
✔ absorbCarryover: an SSI cycle reproduced on BOTH attempts surfaces 40001 with no committed change (47.276847ms)
ℹ tests 26
ℹ suites 0
ℹ pass 26
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2419.907859
```
Exit code: 0

## Intermediate failure (first attempt, not a run counted in the report)

Before the `::bigint` cast was added, the first attempt produced:

```
✖ absorbCarryover: a genuine SSI dependency cycle forces 40001...
  Error: Failed query: update "postings" set "amount_paise" = CASE WHEN "postings"."account_id" = $1 THEN $2 ELSE $3 END ...
  cause: error: column "amount_paise" is of type bigint but expression is of type text
  code: '42804'
```

Drizzle's `sql` template sends JS number literals as `text` parameters. Adding
`::bigint` on the CASE expression resolves this.

## Assumptions

- `createTransaction` calls `resolveSystemAccounts` internally, which auto-seeds system
  accounts for any new user. Confirmed by reading `post-entry.ts:174`. No explicit
  `seedSystemAccounts` call needed in the test setup.
- `postings` is exported from `../../../db/schema.ts`. Confirmed by the existing
  `db/schema.ts` barrel re-export pattern.

## Unresolved risks

None. Both SSI tests pass 26/26 on two consecutive deterministic runs with no hang.
The four expected values are byte-unchanged. No production code was touched.
