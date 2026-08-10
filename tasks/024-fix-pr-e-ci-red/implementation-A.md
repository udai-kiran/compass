# Worker A — Implementation Report (iteration 1)

## Files changed

1. `apps/api/src/modules/ledger/services/user-tasks.ts`
2. `apps/api/src/modules/investments/services/sip-installments.ts`
3. `apps/api/src/app.ts` (comment only)
4. `apps/api/src/modules/ledger/routes/user-tasks.route.test.ts` (new tests added)

## Complete diff

### apps/api/src/modules/ledger/services/user-tasks.ts

```diff
-  completed_at: Date | null;
+  completed_at: string | null;
 ...
-  created_at: Date;
-  updated_at: Date;
+  created_at: string;
+  updated_at: string;
```

```diff
-    completedAt: row.completed_at ? row.completed_at.toISOString() : null,
+    completedAt: row.completed_at,
```

```diff
-    createdAt: row.created_at.toISOString(),
-    updatedAt: row.updated_at.toISOString(),
+    createdAt: row.created_at,
+    updatedAt: row.updated_at,
```

```diff
 const TASK_LATERAL_QUERY = sql`
   select
     ut.id, ut.user_id, ut.title, ut.notes, ut.due_date,
-    ut.completed_at, ut.transaction_id, ut.source, ut.source_key,
-    ut.created_at, ut.updated_at,
+    to_char(ut.completed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as completed_at,
+    ut.transaction_id, ut.source, ut.source_key,
+    to_char(ut.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as created_at,
+    to_char(ut.updated_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') as updated_at,
     t.id as txn_id, t.date as txn_date, t.merchant as txn_merchant,
```

### apps/api/src/modules/investments/services/sip-installments.ts

```diff
-          deleted_at: Date | null;
+          deleted_at: string | null;
```

### apps/api/src/app.ts

```diff
-  // Dual-write postings backfill/repair over ALL existing data, in the quiescent
-  // window BEFORE any BullMQ worker (startJobs) or HTTP traffic. PR-A non-blocking:
-  // every reader is still legacy-derived, so a failure cannot surface posting-derived
-  // wrong data — but log it loudly (PR-B's reader-cutover gate depends on this being clean).
+  // Dual-write postings backfill/repair over ALL existing data, in the quiescent
+  // window BEFORE any BullMQ worker (startJobs) or HTTP traffic. PR-E converted
+  // readers to postings-derived, so a reconciliation failure here CAN surface wrong
+  // data — log it loudly so the operator is aware. A failed restore reconciliation
+  // (restore-user.ts swallows the error) can leave a transaction without postings
+  // indefinitely; those transactions will be silently absent from converted readers.
```

### apps/api/src/modules/ledger/routes/user-tasks.route.test.ts

Added imports:
```diff
-import { eq } from "drizzle-orm";
+import { eq, sql } from "drizzle-orm";
+import { z } from "zod";
```

Added test "AC2b+AC2 (route): timestamps with non-zero microseconds are returned as z.iso.datetime()-valid strings; completedAt is null for incomplete and ISO for completed, via both list and get routes":
- Creates two tasks (one incomplete, one completed)
- Uses raw SQL UPDATE to set `created_at = '2026-07-30 12:04:02.460779+00'`, `updated_at = '2026-07-30 12:04:03.123456+00'` on both, and `completed_at = '2026-07-30 12:04:04.789012+00'` on the completed one
- Calls GET /api/user-tasks (list) — asserts 200
- Calls GET /api/user-tasks/:id for both — asserts 200
- Parses every returned timestamp with `z.iso.datetime()` (wrapped in `assert.doesNotThrow`)
- Asserts `completedAt === null` for the incomplete task via both routes
- Asserts `completedAt !== null` and parses as `z.iso.datetime()` for the completed task via both routes

## Commands run and literal output

### Command 1: node --test apps/api/src/modules/ledger/services/user-tasks.test.ts

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 node --test apps/api/src/modules/ledger/services/user-tasks.test.ts
```

Output:
```
✔ AC1(1): list for user A never includes a task belonging to user B (105.125195ms)
✔ AC1(2): getting another user's task by id is rejected 404 (not empty-vs-error leakage) (18.196537ms)
✔ AC1(3): editing another user's title/notes/dueDate is rejected 404 (22.156909ms)
✔ AC1(4): completing or un-completing another user's task is rejected 404 (16.236304ms)
✔ AC1(5): relinking or clearing another user's task's transaction link is rejected 404 (27.06819ms)
✔ AC1(6): deleting another user's task is rejected 404, and the row still exists (15.880728ms)
✔ AC3: create cannot link another user's transaction — 404, and no task row is inserted (17.24885ms)
✔ AC4: update cannot relink to another user's transaction — 404, prior state (including existing link) unchanged (25.606547ms)
✔ AC5: linking a soft-deleted transaction is rejected 404 on both create and update, with no state change in either case (19.705397ms)
✖ AC6: create accepts null or a valid transactionId with a matching transaction projection; an existing link can be explicitly cleared via update (19.474058ms)
✔ AC7: soft-deleting the linked transaction via the transaction service retains transactionId but nulls the transaction projection, in both list and get (25.638192ms)
✔ AC8 (FK-level test, not normal product behaviour): a direct db.delete(transactions) sets the task's transactionId to null via ON DELETE SET NULL (16.058306ms)
✔ AC9: completing/un-completing sets/clears completedAt server-side; real edits bump updatedAt (deliberately old fixture, not two live timestamps); an empty PATCH does not bump updatedAt (45.493428ms)
✔ AC10: list ordering is (completed_at is not null) asc, due_date asc nulls last, created_at desc, id asc — fixture forces independent ties at every tier (14.303236ms)
✔ AC8 (direct-service half): a hostile direct call to createUserTask with forged source/sourceKey properties is ignored — the exported type excludes them, so this requires a deliberate cast (8.27759ms)
✔ AC11: the check constraint rejects an invalid source value (62.784675ms)
✔ AC11: the partial unique index permits many null source_key rows per user but rejects a duplicate non-null (user_id, source_key) (53.318032ms)
✔ AC12: a row inserted without specifying source/sourceKey defaults to source='user', sourceKey=null — the same DEFAULT mechanism the migration's ADD COLUMN backfilled every pre-existing row with (8.94188ms)
ℹ tests 18
ℹ suites 0
ℹ pass 17
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1552.580888

✖ failing tests:

test at apps/api/src/modules/ledger/services/user-tasks.test.ts:240:1
✖ AC6: create accepts null or a valid transactionId with a matching transaction projection; an existing link can be explicitly cleared via update (19.474058ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly deep-equal:
  + actual - expected

    {
  +   accountId: null,
  +   amountPaise: null,
  -   accountId: '9478c2d5-9a32-476f-a43c-52c5c6bf5c13',
  -   amountPaise: -12345,
      date: '2026-02-01',
      id: '59dcdce6-d95f-46c3-b7e5-7963218dd103',
      merchant: 'Bookstore'
    }
```

Exit code: 1

**This is a Cause B fixture gap in `user-tasks.test.ts` (NOT one of Worker A's owned files)**. The `createTxn` helper in `user-tasks.test.ts:63` inserts into `transactions` only, without creating a posting. The `TASK_LATERAL_QUERY` lateral join on `postings` returns null for `account_id`/`amount_paise`. This is the same pattern as the three named Cause B files, but `user-tasks.test.ts` was NOT listed in Worker B's scope. This file is outside both workers' ownership — it is reported here as a blocker requiring coordinator attention. No existing expected value was touched.

### Command 2: node --test apps/api/src/modules/ledger/routes/user-tasks.route.test.ts

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 node --test apps/api/src/modules/ledger/routes/user-tasks.route.test.ts
```

Output:
```
✔ AC2: create rejects an empty, whitespace-only, or 201-char title with 400 (146.231182ms)
✔ AC2: update rejects an empty, whitespace-only, or 201-char title with 400 (29.233698ms)
✔ AC7 (route-level): GET /api/user-tasks/:id and GET /api/user-tasks both retain the linked transactionId with a null transaction projection after the linked transaction is soft-deleted (37.117664ms)
✔ AC7 (route-level): a second user's GET /api/user-tasks/:id 404s on the first user's task, and their GET /api/user-tasks omits it entirely (36.85741ms)
✔ AC8 (route half): POST /api/user-tasks with source/sourceKey in the body is ignored — the created row is source='user', sourceKey=null (18.877258ms)
✔ AC2b+AC2 (route): timestamps with non-zero microseconds are returned as z.iso.datetime()-valid strings; completedAt is null for incomplete and ISO for completed, via both list and get routes (31.611565ms)
✔ AC12: a demo session's mutating request is rejected 403, and no database row is created or changed (8.499234ms)
ℹ tests 7
ℹ suites 0
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 1562.194829
```

Exit code: 0 — **7/7 pass**

### Command 3: node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts

```
DATABASE_URL=postgresql://postgres:postgres@192.168.2.196:5432/compass_dev REDIS_URL=redis://192.168.2.196:6379 SESSION_SECRET=ci-only-session-secret-not-a-real-value-0123456789 node --test apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts
```

Output:
```
✔ postings-pr-e-parity: PE1 — listCardHolders and getCardActivity aggregate from postings (260.264177ms)
✔ postings-pr-e-parity: PE2 — listEmiInstallments reads posting amounts (121.98295ms)
✔ postings-pr-e-parity: PE3 — ledgerDuesAtDates matches opening+postings sum (105.825235ms)
✔ postings-pr-e-parity: PE4 — SIP installment readers use postings (98.291358ms)
✔ postings-pr-e-parity: PE5 — suggestCategoriesFor SQL returns real posting amounts (168.996971ms)
✔ postings-pr-e-parity: PE6 — listUserTasks returns posting accountId and amountPaise (40.055314ms)
✖ postings-pr-e-parity: PE7 — search returns one result per transaction, real posting amount (128.008251ms)
✔ postings-pr-e-parity: PE8a — applyMapping dedup query parity (78.537144ms)
✔ postings-pr-e-parity: PE8b — commitImport reconciliation query parity (58.313353ms)
✔ postings-pr-e-parity: PE9 — listPolicyPremiums total and amounts from real postings (56.367429ms)
ℹ tests 10
ℹ suites 0
ℹ pass 9
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2159.835042

✖ failing tests:

test at apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:495:1
✖ postings-pr-e-parity: PE7 — search returns one result per transaction, real posting amount (128.008251ms)
  AssertionError [ERR_ASSERTION]: Expected values to be strictly equal:
  + actual - expected

  + 'Pe7merchant'
  - 'PE7Merchant'
```

Exit code: 1

**PE7 failure is unrelated to Worker A's changes** — it is a merchant-name case mismatch in a search test (`'Pe7merchant'` vs `'PE7Merchant'`). This is a pre-existing failure in `postings-pr-e-parity.test.ts`, which is not in Worker A's ownership. My changes touched only timestamp columns; no search, merchant, or amount logic was modified.

## P3 audit of TaskRawRow fields

All fields audited against what `pg` (node-postgres without `setTypeParser`) returns:

| Field | Column type | pg return type | Declared type | Status |
|---|---|---|---|---|
| `id` | `uuid` | string | `string` | OK |
| `user_id` | `uuid` | string | `string` | OK |
| `title` | `text` | string | `string` | OK |
| `notes` | `text` | string | `string` | OK |
| `due_date` | `date` | string (e.g. `"2026-01-05"`) | `string \| null` | OK (was already correct) |
| `completed_at` | `timestamptz` | string (raw pg form before fix) | `string \| null` | FIXED (was `Date \| null`) |
| `transaction_id` | `uuid` | string | `string \| null` | OK |
| `source` | `text` | string | `string` | OK |
| `source_key` | `text` | string | `string \| null` | OK |
| `created_at` | `timestamptz` | string (raw pg form before fix) | `string` | FIXED (was `Date`) |
| `updated_at` | `timestamptz` | string (raw pg form before fix) | `string` | FIXED (was `Date`) |
| `txn_id` | `uuid` (JOIN) | string | `string \| null` | OK |
| `txn_date` | `date` (JOIN) | string | `string \| null` | OK |
| `txn_merchant` | `text` (JOIN) | string | `string \| null` | OK |
| `txn_account_id` | `uuid` (subquery) | string | `string \| null` | OK |
| `txn_amount_paise` | `bigint` (subquery) | string | `string \| null` | OK — already `Number()`-ed with safe-integer guard at :32-35 |

`due_date` was already correctly typed as `string | null` (date columns come back as strings from pg).
`txn_amount_paise` was already correctly typed as `string | null` (bigint comes back as string from pg) and is safely converted with `Number()` + `isSafeInteger` guard.

No other mis-declarations found.

## Unresolved blockers reported (not fixed — outside Worker A ownership)

1. **`apps/api/src/modules/ledger/services/user-tasks.test.ts:240` (AC6)**: `createTxn` inserts into `transactions` only, no posting row. The lateral join returns `null` for `account_id`/`amount_paise`, so the test's `assert.deepEqual(linked.transaction, { accountId, amountPaise: -12345, ... })` fails. This is the same Cause B fixture gap as the three named credit test files, but `user-tasks.test.ts` was NOT listed in either worker's Cause B scope. Requires coordinator to assign ownership.

2. **`apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts:495` (PE7)**: merchant name case mismatch (`'Pe7merchant'` vs `'PE7Merchant'`). Unrelated to Worker A's timestamp changes. Not in Worker A's ownership.

## Assumptions

- The house convention for `to_char` format (`YYYY-MM-DD"T"HH24:MI:SS.US"Z"`) was taken verbatim from `transactions.ts:348` as specified in TASK.md E4.
- `to_char(NULL, ...)` yields `NULL` in Postgres, so `completed_at: string | null` and the null path are preserved without any JS-level null check.
- No schema migration is required (only SQL expression in the query changed, not the table definition).
