# Implementation C — P6 + P7 (Amendment 1)

## Files changed

- `apps/api/src/modules/ledger/services/user-tasks.test.ts` (P6)
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts` (P7)

## Complete diff

### user-tasks.test.ts

```diff
--- a/apps/api/src/modules/ledger/services/user-tasks.test.ts
+++ b/apps/api/src/modules/ledger/services/user-tasks.test.ts
@@ -11,6 +11,7 @@ import { HttpError } from "../../../lib/errors.ts";
-import { softDeleteTransaction } from "./transactions.ts";
+import { softDeleteTransaction, createTransaction } from "./transactions.ts";
+import { seedSystemAccounts } from "./post-entry.ts";
 import {

@@ -63,14 +64,18 @@ async function createTxn(
   userId: string,
   accountId: string,
   overrides: Partial<{ date: string; amountPaise: number; merchant: string }> = {},
 ): Promise<string> {
-  const [t] = await db
-    .insert(transactions)
-    .values({
-      userId,
-      accountId,
-      date: overrides.date ?? "2026-01-05",
-      amountPaise: overrides.amountPaise ?? -1000,
-      merchant: overrides.merchant ?? "Test merchant",
-    })
-    .returning({ id: transactions.id });
-  return t!.id;
+  // Seed system accounts before calling createTransaction (required by the real service).
+  // createTransaction then calls resolveSystemAccounts internally (idempotent no-op if
+  // already seeded) and dual-writes the full balanced posting family alongside the
+  // transactions row — which is the production shape the TASK_LATERAL_QUERY expects.
+  await seedSystemAccounts(db, userId);
+  const txn = await createTransaction(db, userId, {
+    accountId,
+    date: overrides.date ?? "2026-01-05",
+    amountPaise: overrides.amountPaise ?? -1000,
+    merchant: overrides.merchant ?? "Test merchant",
+  });
+  return txn.id;
 }
```

### postings-pr-e-parity.test.ts

```diff
--- a/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
+++ b/apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
@@ -527,1 +527,5 @@
-  assert.equal(results.transactions[0]!.merchant, "PE7Merchant");
+  // createTransaction normalises merchant on write via normalizeMerchant/titleCase:
+  // lowercase then capitalise-after-whitespace, so "PE7Merchant" (one token, no noise
+  // filter hit) is stored as "Pe7merchant". search.ts returns the stored value verbatim.
+  // This normalisation predates PR-E and is not a postings-conversion regression.
+  assert.equal(results.transactions[0]!.merchant, "Pe7merchant");
```

## P6 approach: real `createTransaction` service

Chosen over manual raw-posting insertion because:
- `createTransaction` is idempotent with the production dual-write shape and cannot drift
- It calls `resolveSystemAccounts` → `seedSystemAccounts` internally, building the full
  balanced posting family (real leg + system counter-leg) in one atomic transaction
- The explicit `await seedSystemAccounts(db, userId)` call at the top of `createTxn`
  satisfies the review-2 binding constraint; the internal call inside `createTransaction`
  is then a no-op

The merchant default `"Test merchant"` normalises to `"Test Merchant"` (capital M) via
`titleCase`, but no test in `user-tasks.test.ts` asserts on the merchant field of those
transactions (only AC6 checks `merchant: "Bookstore"`, which IS a titleCase fixed point).

## Exact commands and literal output

### Command 1: user-tasks.test.ts
```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev \
REDIS_URL=redis://192.168.2.196:6379 \
SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 \
node --test apps/api/src/modules/ledger/services/user-tasks.test.ts
```

Output:
```
✔ AC1(1): list for user A never includes a task belonging to user B (102.468709ms)
✔ AC1(2): getting another user's task by id is rejected 404 (not empty-vs-error leakage) (21.072694ms)
✔ AC1(3): editing another user's title/notes/dueDate is rejected 404 (21.538569ms)
✔ AC1(4): completing or un-completing another user's task is rejected 404 (16.251539ms)
✔ AC1(5): relinking or clearing another user's task's transaction link is rejected 404 (90.46364ms)
✔ AC1(6): deleting another user's task is rejected 404, and the row still exists (43.504718ms)
✔ AC3: create cannot link another user's transaction — 404, and no task row is inserted (35.626257ms)
✔ AC4: update cannot relink to another user's transaction — 404, prior state (including existing link) unchanged (47.699692ms)
✔ AC5: linking a soft-deleted transaction is rejected 404 on both create and update, with no state change in either case (37.913938ms)
✔ AC6: create accepts null or a valid transactionId with a matching transaction projection; an existing link can be explicitly cleared via update (40.171546ms)
✔ AC7: soft-deleting the linked transaction via the transaction service retains transactionId but nulls the transaction projection, in both list and get (43.429008ms)
✔ AC8 (FK-level test, not normal product behaviour): a direct db.delete(transactions) sets the task's transactionId to null via ON DELETE SET NULL (61.732249ms)
✔ AC9: completing/un-completing sets/clears completedAt server-side; real edits bump updatedAt (deliberately old fixture, not two live timestamps); an empty PATCH does not bump updatedAt (59.719922ms)
✔ AC10: list ordering is (completed_at is not null) asc, due_date asc nulls last, created_at desc, id asc — fixture forces independent ties at every tier (13.994502ms)
✔ AC8 (direct-service half): a hostile direct call to createUserTask with forged source/sourceKey properties is ignored — the exported type excludes them, so this requires a deliberate cast (8.092301ms)
✔ AC11: the check constraint rejects an invalid source value (10.047698ms)
✔ AC11: the partial unique index permits many null source_key rows per user but rejects a duplicate non-null (user_id, source_key) (43.952944ms)
✔ AC12: a row inserted without specifying source/sourceKey defaults to source='user', sourceKey=null — the same DEFAULT mechanism the migration's ADD COLUMN backfilled every pre-existing row with (7.954952ms)
ℹ tests 18
ℹ suites 0
ℹ pass 18
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1700.813946
```

Exit code: 0. 18/18 pass.

### Command 2: postings-pr-e-parity.test.ts
```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev \
REDIS_URL=redis://192.168.2.196:6379 \
SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 \
node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
```

Output:
```
✔ postings-pr-e-parity: PE1 — listCardHolders and getCardActivity aggregate from postings (230.021514ms)
✔ postings-pr-e-parity: PE2 — listEmiInstallments reads posting amounts (119.20674ms)
✔ postings-pr-e-parity: PE3 — ledgerDuesAtDates matches opening+postings sum (113.444609ms)
✔ postings-pr-e-parity: PE4 — SIP installment readers use postings (108.990216ms)
✔ postings-pr-e-parity: PE5 — suggestCategoriesFor SQL returns real posting amounts (167.751817ms)
✔ postings-pr-e-parity: PE6 — listUserTasks returns posting accountId and amountPaise (40.827744ms)
✔ postings-pr-e-parity: PE7 — search returns one result per transaction, real posting amount (142.328185ms)
✔ postings-pr-e-parity: PE8a — applyMapping dedup query parity (91.022862ms)
✔ postings-pr-e-parity: PE8b — commitImport reconciliation query parity (58.029462ms)
✔ postings-pr-e-parity: PE9 — listPolicyPremiums total and amounts from real postings (59.763241ms)
ℹ tests 10
ℹ suites 0
ℹ pass 10
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2261.961905
```

Exit code: 0. 10/10 pass.

## Deviations

None. The plan was executed exactly as specified. No production code was touched.
No schema changes, no migrations, no unexpected expectation edits.

## Assumptions

- `postings.transactionId` has `{ onDelete: "cascade" }` (confirmed in
  `apps/api/src/db/shared/ledger.ts:138`), so `cleanupUser` correctly cascade-deletes
  postings when it deletes transactions — no change to cleanup was needed.
- `createTransaction` handles `resolveSystemAccounts` inside its own `db.transaction()`,
  so the explicit `seedSystemAccounts` at the top of `createTxn` is a harmless pre-seeding
  step, not a duplicate of work inside `createTransaction` in a way that could conflict.

## Unresolved risks

None introduced by this change. The pre-existing production defect (postings-less
transactions reachable via failed restore reconciliation, documented in TASK.md D4/D5)
is explicitly out of scope and unaffected.
