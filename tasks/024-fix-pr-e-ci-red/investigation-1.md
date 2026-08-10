# PR-E CI Red — Root Cause Investigation

## Files Inspected
- `apps/api/src/modules/ledger/services/user-tasks.ts`
- `apps/api/src/modules/credit/services/card-due-tasks.ts`
- `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
- `apps/api/src/modules/credit/services/cards.ts` (diff only)
- `apps/api/src/modules/credit/services/reconciliation-reads.ts`
- `apps/api/src/modules/credit/services/reconciliation-writes.test.ts`
- `apps/api/src/modules/credit/services/emis.ts`
- `apps/api/src/modules/credit/services/emis.test.ts`
- `git diff 11ecb3c 2253623` for all four files above

## Files Changed
None — investigation only.

## Commands Run

```
node --test apps/api/src/modules/ledger/services/user-tasks.test.ts
node --test apps/api/src/modules/credit/services/reconciliation-writes.test.ts
node --test apps/api/src/modules/credit/services/emis.test.ts
node --test apps/api/src/modules/credit/services/card-due-tasks.test.ts
git diff 11ecb3c 2253623 -- <each file>
git log -2 --stat -- apps/api/src/modules/ledger/services/user-tasks.ts
```

All run with `DATABASE_URL=postgresql://postgres:<redacted>@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789`.

---

## GROUP 1 — user-tasks TypeError

### Root Cause (proved)
`db.execute(sql...)` (raw SQL, not a typed Drizzle select) returns all timestamp columns as JavaScript `string`, not `Date`. `TaskRawRow` declares `created_at: Date`, `updated_at: Date`, and `completed_at: Date | null`, so `row.created_at.toISOString()` throws `TypeError: row.created_at.toISOString is not a function` at `user-tasks.ts:55`.

### Decisive file:line
`apps/api/src/modules/ledger/services/user-tasks.ts:55` — `createdAt: row.created_at.toISOString()` (and line 42 `row.completed_at.toISOString()`, line 56 `row.updated_at.toISOString()`).

### PR-E introduced the bug
The diff shows PR-E replaced a typed Drizzle select builder (`taskQuery`) with `TASK_LATERAL_QUERY` / `db.execute()`. The old path returned `task: UserTaskRow` (a fully-typed Drizzle row where `createdAt` etc. are already `Date`). The new path returns raw pg driver rows where timestamps are strings.

### Other mis-declared fields in TaskRawRow
- `created_at: Date` — driver returns `string`. **Bug.**
- `updated_at: Date` — driver returns `string`. **Bug.**
- `completed_at: Date | null` — driver returns `string | null`. **Bug** (line 42 also calls `.toISOString()`).
- `txn_amount_paise: string | null` — correctly declared as `string` (the code calls `Number(row.txn_amount_paise)`). No bug.
- No bigint or boolean columns in `TaskRawRow` that would cause additional mis-typing beyond the three Date fields above.

### Production vs Test
**Production code defect.** The bug is in `user-tasks.ts`'s `TaskRawRow` type declaration and `toUserTask`'s use of `.toISOString()` on values that are strings at runtime. The tests correctly exercise the service.

### Minimal Fix
Change `TaskRawRow` to declare `created_at: string`, `updated_at: string`, `completed_at: string | null`. In `toUserTask`, coerce with `new Date(row.created_at).toISOString()` etc., or (simpler) just call `row.created_at` directly since it is already an ISO string from the pg driver. The simplest correct fix is to drop the `.toISOString()` calls and change the declared types to `string`/`string | null`; or equivalently wrap with `new Date(...)` so the interface stays `Date`-shaped. Prefer declaring them `string` and dropping the `.toISOString()` — one-line changes at three sites, no data conversion needed since the pg driver already returns ISO-8601 strings.

---

## GROUP 2 — card-due-tasks: 0 tasks created

### Root Cause (proved)
`listCardHolders` (called by `materializeCardDueTasks`) now sums from `postings` via `join postings p on p.transaction_id = t.id where p.account_id = ...` (PR-E diff to `cards.ts`). The test fixture helper `createTxn` inserts into `transactions` only — no `postings` rows are created. With no postings, the aggregate returns `total = 0`, `at_close = 0`, `current_spend = 0`. For an opening balance of 0, `balance = 0`, so `amountDuePaise = max(0, -(opening + at_close)) = 0`. The guard at `card-due-tasks.ts:85` — `if (card.dueDate === null || card.amountDuePaise <= 0) continue` — skips every card, creating 0 tasks.

### Decisive file:line
`apps/api/src/modules/credit/services/card-due-tasks.test.ts:168-182` — `createTxn` inserts only `transactions`, no `postings`.
`apps/api/src/modules/credit/services/cards.ts` — the postings-based aggregate (PR-E change).

### Confirmed output
```
assert.ok(created >= 1)
at card-due-tasks.test.ts:217:10
```

### Production vs Test
**Test fixture defect.** The production query is correct (it should read postings). The test fixture `createTxn` must also insert the matching `postings` row(s) for the transaction to be visible to the new query.

### Minimal Fix
Update `createTxn` in `card-due-tasks.test.ts` to also insert a `postings` row for the new transaction (same `account_id`, same `amount_paise`). This mirrors the fix needed in `reconciliation-writes.test.ts` below.

---

## GROUP 3 — reconciliation-writes: value mismatches (actual 2000000 vs expected 2540475)

### Root Cause (proved)
`ledgerDuesAtDates` (in `reconciliation-reads.ts`) was rewritten by PR-E to join against `postings` instead of `transactions` directly. The test fixture `createTxn` in `reconciliation-writes.test.ts` (line 59-73) inserts rows into `transactions` only — no `postings` rows. The aggregate `coalesce(sum(sub.amount_paise), 0)` returns 0 because the inner subquery finds no matching postings. Result: `ledgerDuePaise = -(openingBalancePaise + 0) = -(-2000000) = 2000000`, not the expected 2540475.

### Decisive diff (reconciliation-reads.ts)
```diff
-    left join transactions t
-      on t.account_id = ${accountId}
-      and t.user_id = ${userId}
-      and t.deleted_at is null
-      and t.date < ds.stmt_date
+    left join (
+      select p.amount_paise, t.date
+      from postings p
+      join transactions t on t.id = p.transaction_id
+      where p.account_id = ${accountId}
+        and t.user_id = ${userId}
+        and t.deleted_at is null
+    ) sub on sub.date < ds.stmt_date
```

### Production vs Test
**Test fixture defect.** `createTxn` in `reconciliation-writes.test.ts` must also insert matching `postings` rows. The production query correctly reads from postings.

### Minimal Fix
Update `createTxn` in `reconciliation-writes.test.ts` to also insert a `postings` row for each transaction (matching `account_id` and `amount_paise`).

---

## GROUP 4 — emis: null->non-null with real history not rejected (400 not thrown)

### Root Cause (proved)
`upsertEmiDetails`'s null→non-null guard (line 374-398) now queries history via an `innerJoin(postings, ...)` filter instead of `eq(transactions.accountId, ...)`. The test helper `insertInstallmentHistory` (emis.test.ts:275-288) inserts a row into `transactions` only — no `postings` row. The `innerJoin` finds no matching posting, so `history.length === 0`, and the `throw new HttpError(400, ...)` is never reached. `assert.rejects` finds no rejection and fails with "Missing expected rejection".

### Decisive diff (emis.ts)
```diff
+          .innerJoin(
+            postings,
+            and(
+              eq(postings.transactionId, transactions.id),
+              eq(postings.accountId, template.accountId),
+              lt(postings.amountPaise, 0),
+            ),
+          )
           .where(
             and(
               eq(transactions.recurringTemplateId, templateId),
-              eq(transactions.accountId, template.accountId),
-              lt(transactions.amountPaise, 0),
+              eq(transactions.userId, userId),
               isNull(transactions.deletedAt),
             ),
           )
```

### Production vs Test
**Test fixture defect.** `insertInstallmentHistory` in `emis.test.ts` must also insert a `postings` row (`account_id = sourceId`, `amount_paise < 0`) to satisfy the new inner join.

### Minimal Fix
Update `insertInstallmentHistory` in `emis.test.ts` to also insert into `postings` with `transactionId = <the new transaction's id>`, `accountId = accountId`, `amountPaise = -34000`.

---

## Common Underlying Cause?

**Partially.** There are TWO independent root causes:

1. **GROUP 1 only** — production code bug: `db.execute()` raw SQL returns timestamps as strings, but `TaskRawRow` declares them `Date`, causing `.toISOString()` to throw at runtime. This was introduced by PR-E replacing the typed Drizzle select with a raw SQL lateral query.

2. **GROUPS 2, 3, and 4** — test fixture bug: all three test files share the same `createTxn` / `insertInstallmentHistory` helper that inserts into `transactions` without inserting the corresponding `postings` row. PR-E rewrote all three production readers to join against `postings` — correct production code — but the test fixtures were not updated to populate `postings`. The three failures are therefore a single missed step repeated across three test files.

So: one production defect (GROUP 1), one category of fixture defect repeated three times (GROUPS 2, 3, 4).

---

## Summary Table

| Group | Root cause (one sentence) | Defect in | Minimal fix |
|---|---|---|---|
| 1 user-tasks | `db.execute()` returns timestamps as `string` but `TaskRawRow` declares them `Date`, so `.toISOString()` throws | **Production** (`user-tasks.ts:19,20,15`) | Change `created_at`, `updated_at`, `completed_at` to `string`/`string | null` in `TaskRawRow` and drop or inline the `.toISOString()` calls (the driver already returns ISO-8601 strings) |
| 2 card-due-tasks | `listCardHolders` now reads `postings` but test `createTxn` inserts only `transactions`, so `amountDuePaise` is always 0 and every card is skipped | **Test** (`card-due-tasks.test.ts:168-182`) | Also insert a matching `postings` row in `createTxn` |
| 3 reconciliation-writes | `ledgerDuesAtDates` now joins `postings` but test `createTxn` inserts only `transactions`, so the aggregate is always 0 | **Test** (`reconciliation-writes.test.ts:59-73`) | Also insert a matching `postings` row in `createTxn` |
| 4 emis | History check now uses `innerJoin(postings, ...)` but `insertInstallmentHistory` inserts only into `transactions`, so history is always empty and the 400 guard never fires | **Test** (`emis.test.ts:275-288`) | Also insert a matching `postings` row in `insertInstallmentHistory` |
