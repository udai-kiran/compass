# Implementation Report — Task 022 PR-F(1), Iteration 1

## Files Changed

- `apps/extractor/src/db.ts` — `loadCardLedgerTxns` SQL, result mapping, doc comment
- `apps/extractor/src/statement-duplicate.test.ts` — fixture update + new AC2–AC10 tests

## Files Inspected (read-only)

- `tasks/022-pr-f-extractor-postings/TASK.md`
- `tasks/022-pr-f-extractor-postings/DELEGATION.md`
- `apps/api/src/db/shared/hubs.ts` (accounts schema — system_kind enum)
- `apps/api/src/db/shared/ledger.ts` (postings + transactions schema)
- `apps/api/src/lib/periods.ts` (safe-integer check reference)
- `apps/api/src/modules/credit/services/reconciliation-reads.ts` (safe-integer check reference)
- `apps/extractor/src/statement-duplicates.ts` (caller of loadCardLedgerTxns)
- `apps/extractor/package.json`

---

## Complete Diff

```diff
diff --git a/apps/extractor/src/db.ts b/apps/extractor/src/db.ts
index 247a0b3..c2a4c38 100644
--- a/apps/extractor/src/db.ts
+++ b/apps/extractor/src/db.ts
@@ -228,6 +228,12 @@ export interface LedgerTxnRow {
  * The card's ledger transactions in a date range — the pool the statement
  * matcher checks each line against. Range is the lines' own dates padded by the
  * posting-lag window (see matchLinesToLedger), never the statement period.
+ *
+ * The signed amount and the account scope both come from the `postings` table
+ * (D1-D3, TASK.md §design-rulings). Transfer legs and opening rows on the card
+ * account are deliberately INCLUDED — a card repayment booked as a transfer
+ * must still match its statement payment line (D1). The `transactions.account_id`
+ * and `transactions.amount_paise` legacy columns are not read here.
  */
 export async function loadCardLedgerTxns(
   pool: pg.Pool,
@@ -243,20 +249,35 @@ export async function loadCardLedgerTxns(
     occurred_at_ts: string | null;
     merchant: string;
   }>(
-    `select id, amount_paise, to_char(date, 'YYYY-MM-DD') as date,
-            to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as occurred_at_ts, merchant
-       from transactions
-      where user_id = $1 and account_id = $2 and deleted_at is null
-        and date between $3 and $4`,
+    `select t.id,
+            sum(p.amount_paise)::bigint as amount_paise,
+            to_char(t.date, 'YYYY-MM-DD') as date,
+            to_char(t.occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as occurred_at_ts,
+            t.merchant
+       from postings p
+       join transactions t on t.id = p.transaction_id
+      where t.user_id = $1
+        and p.account_id = $2
+        and t.deleted_at is null
+        and t.date between $3 and $4
+      group by t.id, t.date, t.occurred_at, t.merchant`,
     [userId, accountId, fromDate, toDate],
   );
-  return res.rows.map((r) => ({
-    id: r.id,
-    amountPaise: Number(r.amount_paise),
-    date: r.date,
-    occurredAtTs: r.occurred_at_ts,
-    merchant: r.merchant,
-  }));
+  return res.rows.map((r) => {
+    const amountPaise = Number(r.amount_paise);
+    if (!Number.isSafeInteger(amountPaise)) {
+      throw new Error(
+        "Card ledger aggregate exceeded a safe integer — refusing to lose paise",
+      );
+    }
+    return {
+      id: r.id,
+      amountPaise,
+      date: r.date,
+      occurredAtTs: r.occurred_at_ts,
+      merchant: r.merchant,
+    };
+  });
 }
```

```diff
diff --git a/apps/extractor/src/statement-duplicate.test.ts b/apps/extractor/src/statement-duplicate.test.ts
index 207916b..58f8c07 100644
--- a/apps/extractor/src/statement-duplicate.test.ts
+++ b/apps/extractor/src/statement-duplicate.test.ts
@@ -1,7 +1,7 @@
 import { test, after } from "node:test";
 import assert from "node:assert/strict";
 import { randomUUID } from "node:crypto";
-import { createPool, saveResults, type IngestionRecord } from "./db.ts";
+import { createPool, loadCardLedgerTxns, saveResults, type IngestionRecord } from "./db.ts";
 import { annotateStatementDuplicates } from "./statement-duplicates.ts";
 import type { InboxRow } from "./extract.ts";
 
@@ -18,6 +18,10 @@ import type { InboxRow } from "./extract.ts";
 // here, not in the API's inbox.test.ts, because `index.ts` itself starts a
 // BullMQ worker on import and cannot be imported directly by a test.
 //
+// AC2-AC10: characterization tests for loadCardLedgerTxns after the
+// postings-model conversion (PR-F, task 022). Each test asserts a specific
+// design ruling from TASK.md to prevent regression.
+//
 // Needs a real Postgres connection (DATABASE_URL) — this repo has no
 // DB-mocking infrastructure for this path (same convention as
 // apps/api/src/services/inbox.test.ts's DB-backed tests): real Postgres, a
@@ -57,6 +61,29 @@ async function createAccount(userId: string, type: string): Promise<string> {
   return res.rows[0]!.id;
 }
 
+async function createSystemAccount(userId: string, systemKind: string): Promise<string> {
+  const res = await pool.query<{ id: string }>(
+    `insert into accounts (user_id, name, type, system_kind, opening_balance_paise)
+     values ($1, $2, 'system', $3, 0) returning id`,
+    [userId, `test ${systemKind} account`, systemKind],
+  );
+  return res.rows[0]!.id;
+}
+
+async function createPosting(txnId: string, accountId: string, amountPaise: number): Promise<void> {
+  await pool.query(
+    `insert into postings (transaction_id, account_id, amount_paise) values ($1, $2, $3)`,
+    [txnId, accountId, amountPaise],
+  );
+}
+
+[createIngestion unchanged]
+
+[createLedgerTxn — updated to also call createPosting after the INSERT]
+  const id = res.rows[0]!.id;
+  await createPosting(id, accountId, opts.amountPaise);
+  return id;
+
+[AC9 test — unchanged]
+
+[AC2–AC10 tests added — see full file]
```

---

## Implementation Details

### `apps/extractor/src/db.ts`

**P1 (SQL rewrite):** Replaced the `from transactions` query with a `from postings p join transactions t` query. Filter is now `p.account_id = $2` (not `t.account_id`). Amount is `sum(p.amount_paise)::bigint` grouped by `t.id, t.date, t.occurred_at, t.merchant`. No `system_kind` filter added (D1 compliance).

**P2 (D6 safe-integer check):** After `Number(r.amount_paise)`, check `Number.isSafeInteger(amountPaise)`; throw `"Card ledger aggregate exceeded a safe integer — refusing to lose paise"` if it fails. Matches the convention at `periods.ts:228-230` and `reconciliation-reads.ts:140-141`.

**P5 (doc comment):** Updated to state that amount and account scope come from `postings`, and that transfer legs and opening rows are deliberately included (D1). Also notes that legacy columns are not read.

`LedgerTxnRow`, the exported signature, and all callers are unchanged (D5).

### `apps/extractor/src/statement-duplicate.test.ts`

**P3 (fixture):** Added `createPosting` and `createSystemAccount` helpers. Updated `createLedgerTxn` to also insert a posting on the card account with the same `amountPaise` after inserting the transaction. The existing AC9 test is unchanged.

**P4 (new tests):**
- **AC2**: ordinary spend, negative amountPaise returned from posting
- **AC3**: decoy on `transactions.amount_paise`; posting's value wins — the decisive postings-source proof
- **AC4**: transfer leg with card posting (+500000) and same-user Clearing counter-posting (-500000); row is returned (D1 regression guard; D7 Clearing fixture)
- **AC5**: posting on a different account; not returned for the card query
- **AC6**: soft-deleted transaction with card posting; not returned (F8)
- **AC7**: cross-tenant posting — user B's transaction carries a posting on user A's card account; `t.user_id = $1` excludes it
- **AC8**: two same-account postings collapse to one row with their sum (D2)
- **AC10**: two postings summing to `MAX_SAFE_INTEGER + 1` cause `loadCardLedgerTxns` to throw matching `/safe integer/i`

---

## Commands and Output

### 1. `npm run typecheck`

```
> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present

> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit

EXIT_CODE: 0
```

PASS.

### 2. `npm run lint`

```
> compass@0.1.0 lint
> eslint .

EXIT_CODE: 0
```

PASS.

### 3. `node --test apps/extractor/src/extract.test.ts`

```
✔ decideStatus routes each class (2.884754ms)
... [59 tests] ...
ℹ tests 59
ℹ suites 0
ℹ pass 59
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 427.275636

EXIT_CODE: 0
```

PASS. 59/59.

### 4. `node --test apps/extractor/src/statement-duplicate.test.ts`

**BLOCKED — `DATABASE_URL` is not set in this environment.**

```
file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:34
    throw new Error(
          ^

Error: statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before running `npm run test -w apps/extractor`.
    at requireDatabaseUrl (file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:34:11)
    at file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:43:25
    at ModuleJob.run (node:internal/modules/esm/module_job:439:25)
    at async node:internal/modules/esm/loader:643:26
    at async asyncRunEntryPointWithESMLoader (node:internal/modules/run_main:101:5)

Node.js v24.18.0
✖ apps/extractor/src/statement-duplicate.test.ts (371.134364ms)
ℹ tests 1
ℹ suites 0
ℹ pass 0
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 383.088308

EXIT_CODE: 1
```

Per TASK.md T1 and the delegation note: this file throws (not skips) without `DATABASE_URL`. DB-backed tests did NOT execute. This is expected in this environment and is not caused by any defect in the implementation.

### 5. `npm run test -w apps/extractor`

```
> @compass/extractor@0.1.0 test
> node --test "src/**/*.test.ts"

✔ saveResults: the extracted_transactions INSERT carries `intent` in both its column list and its value mapping (2.316773ms)
✔ saveResults: a null intent is passed through unchanged, not coerced or dropped (0.423115ms)
✔ saveResults: refund and cashback intents also round-trip into the INSERT params (0.418081ms)
[... 59 extract.test.ts tests passing ...]
file:///home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts:34
    throw new Error(
          ^

Error: statement-duplicate.test.ts needs DATABASE_URL set ...
    ...
✖ src/statement-duplicate.test.ts (366.659132ms)
ℹ tests 63
ℹ suites 0
ℹ pass 62
ℹ fail 1
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 448.547732

npm error Lifecycle script `test` failed with error:
npm error code 1

EXIT_CODE: 1
```

62 non-DB tests pass. The 1 failure is `statement-duplicate.test.ts` throwing at module load due to missing `DATABASE_URL` — same behavior as before the change (pre-existing environment constraint).

---

## Acceptance Criteria Status (static analysis)

- **AC1** ✓ `loadCardLedgerTxns` contains no reference to `transactions.amount_paise` or `transactions.account_id`
- **AC2–AC10** ✓ Tests written; cannot execute without DB
- **AC9** ✓ Existing test updated to use postings-sourced fixture (createLedgerTxn now inserts posting)

---

## Plan Deviations

None. All five plan steps (P1-P5) implemented as specified.

## Assumptions

- `npm install` was needed before typecheck could run (node_modules was empty). Ran it; resulted in exit 0.
- The `postings` table FK (`transaction_id` → `transactions.id ON DELETE CASCADE`) means `cleanupUser` still works without explicitly deleting postings.
- `Number.MAX_SAFE_INTEGER` (9007199254740991) inserted as a raw integer literal to Postgres bigint — fits within `bigint` max (~9.2e18).

## Unresolved Risks

- DB-backed tests (AC9, AC2-AC10) not executed in this environment due to missing `DATABASE_URL`. Need a Postgres instance to confirm the full AC suite.
- The `accounts.system_kind` unique index (`accounts_system_kind_idx`) is partial (`WHERE system_kind IS NOT NULL`) and scoped per `(user_id, system_kind)`. Each test creates a fresh user so there is no uniqueness conflict between test runs.
