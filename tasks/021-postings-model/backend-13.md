# backend-13 — A6 Iteration 3: TEST-ONLY close of review-16 gaps B1–B5

## Files inspected
- `tasks/021-postings-model/DELEGATION-A6.md` (brief, Iteration 3 section)
- `tasks/021-postings-model/PLAN-A6.md` (review-16 disposition)
- `apps/api/src/modules/system/services/backup.test.ts` (modified file, read in full)

## Files changed
- `apps/api/src/modules/system/services/backup.test.ts` — TEST-ONLY. All B1–B5 changes were already present in the working tree at start of this session (the file is marked `M` in git status from prior work). No production/source files were modified.

No other file was touched.

## Setup: db:migrate

Command:
```
npm run db:migrate
```

Output (literal):
```
> compass@0.1.0 db:migrate
> npm run db:migrate -w apps/api


> @compass/api@0.1.0 db:migrate
> node --env-file-if-exists=../../.env ../../node_modules/drizzle-kit/bin.cjs migrate

No config path provided, using default 'drizzle.config.ts'
Reading config file '/home/udai/PennyPilot/apps/api/drizzle.config.ts'
Using 'pg' driver for database querying
[✓] migrations applied successfully!
```

Exit code: **0**

DATABASE_URL host: `192.168.2.196` (credentials masked)

## Implementation details

All five review-16 gaps were already closed in the working tree. No new edits were required beyond what a prior session had written. The changes present are:

**B1** — New test "A6 AC3 OLD-style (B1)" (backup.test.ts:870–1064): hand-built `ArchiveHeader` with `postings=[]` and only real bank/wallet accounts (no system accounts). Dest has `seedSystemAccounts(db, dest)` called before restore. Asserts `summary.postings.repaired > 0`, `failed == 0`, all txn legs zero-sum, and `findInconsistentPostings(db, dest) == []`.

**B2** — Literal per-shape leg multiset assertions added in BOTH AC3+AC4 test (backup.test.ts:797–851) and B1 test (backup.test.ts:997–1051). System accounts resolved by querying `accounts where user_id=dest and system_kind is not null`. Hardcoded paise amounts:
- ordinary (−5000 bank,food): `{bank, −5000}`, `{sysExpenses, +5000}`
- split (−10000 bank; food −6000, transport −4000): `{bank, −10000}`, `{sysExpenses, +6000}`, `{sysExpenses, +4000}`
- transfer OUT (−20000 bank): `{bank, −20000}`, `{sysClearing, +20000}`
- transfer IN (+20000 wallet): `{wallet, +20000}`, `{sysClearing, −20000}`
- opening (+100000 bank, isOpening): `{bank, +100000}`, `{sysOpening, −100000}`
- soft-deleted (−7000 bank, food): `{bank, −7000}`, `{sysExpenses, +7000}`
No `computePostingDraftsForTransaction` or `build*Postings` helpers used in assertions.

**B3** — New test "the mocked restoreDump records postings every column, positioned after FK parents" (backup.test.ts:197–266): mock-pool test records every SQL call. Parses column order from `insert into "postings" (...)` SQL, maps each column to its positional param, and asserts `deepEqual` against fixture for all 8 columns: `id`, `transaction_id`, `account_id`, `category_id` (null), `amount_paise`, `necessity` (null), `note` (""), `created_at`. Also asserts `idxAccounts < idxPostings`, `idxCategories < idxPostings`, `idxTransactions < idxPostings`.

**B4** — In the foreign-account AC5 test (backup.test.ts:1066–1157): added `foreignCategoryId = randomUUID()` set as `category_id` on the archived posting. Assertions verify no dest posting references `foreignCategoryId` (in addition to `foreignAccountId`).

**B5** — In the B1 test (backup.test.ts:1053–1063): counts `nonPostingRows` (sum of non-postings table row counts) and `nonPostingTables` (count of non-postings tables with at least one row) pre-restore from the archive header. Asserts `summary.rows === nonPostingRows` and `summary.tables === nonPostingTables`.

Additional changes also present from prior sessions (not B1–B5 but related):
- FK-order spot-checks for `accounts < postings`, `categories < postings`, `transactions < postings` in the restorableTables test.
- `cleanupUser` extended to also delete `categories` rows.
- `HttpError`, `seedSystemAccounts`, `seedDefaultCategories`, `findInconsistentPostings`, `reconcileUserPostings` imports added.
- Additional schema imports: `and`, `isNotNull`, `sql`, `attachments`, `categories`, `postings`, `transactionSplits`, `transferLinks`.

## Commands run and literal output

### 1. npm run db:migrate (setup)
(already shown above — exit 0)

### 2. npm run typecheck -w apps/api
```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```
Exit code: **0**

### 3. npm run lint
```
> compass@0.1.0 lint
> eslint .
```
Exit code: **0**

### 4. node --test apps/api/src/modules/system/services/backup.test.ts
(run with `--env-file=.env` to supply DATABASE_URL)

```
✔ the full backup covers every table in the schema (2.467988ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.268169ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.277481ms)
✔ no table is scoped both directly and through a parent (0.234909ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.712085ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.502006ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.448405ms)
✔ restore defers cyclic and self-referencing foreign keys (0.512932ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.496273ms)
✔ the mocked restoreDump records postings every column, positioned after FK parents (1.267619ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (0.754659ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (413.014338ms)
✔ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (196.919136ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (44.671265ms)
✔ A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 (304.962207ms)
✔ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (304.69568ms)
✔ A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings and no system accounts (130.706657ms)
✔ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (38.739434ms)
✔ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs (172.777668ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2960.757299
```
Exit code: **0**

Pass: 19 / Fail: 0 / Skip: 0

### 5. node --test apps/api/src/modules/ledger/services/postings.test.ts
(run with `--env-file=.env`)

```
✔ assertSafePaise rejects non-safe integers (3.853938ms)
✔ sumPaise sums exactly via BigInt and rejects unsafe results (0.375188ms)
✔ assertZeroSum: random balanced sets pass, perturbed sets throw (seeded PRNG) (8.557533ms)
✔ assertZeroSum: boundary legs near ±MAX_SAFE_INTEGER (0.325437ms)
✔ buildOrdinaryPostings: -200000 expense → asset -200000 + Expenses +200000 (1.190961ms)
✔ buildOrdinaryPostings: +300000 income → asset +300000 + Income -300000 (0.241004ms)
✔ buildSplitPostings: -200000 into -150000/-50000 → asset -200000 + Expenses +150000 + Expenses +50000 (0.397777ms)
✔ buildSplitPostings: mixed-sign splits pick the correct system accounts (0.286077ms)
✔ buildTransferPostings: 200000 → from -200000 / to +200000 (0.322875ms)
✔ buildTransferPostings: rejects non-positive amounts (0.425309ms)
✔ buildOpeningPostings: 500000 → asset +500000 / opening -500000 (0.311541ms)
✔ buildTransferLegPostings: outflow leg → real -X / Clearing +X, zero-sum (0.251129ms)
✔ buildTransferLegPostings: inflow leg → real +X / Clearing -X, zero-sum (0.184546ms)
✔ buildTransferLegPostings: safe-integer boundary value zero-sums both signs (0.33513ms)
✔ classifyShape + projections round-trip: ordinary (0.432055ms)
✔ classifyShape + projections round-trip: split (0.406501ms)  
✔ classifyShape + projections round-trip: mixed-sign split (0.214356ms)
✔ classifyShape + projections round-trip: opening (0.26954ms)
✔ classifyShape: transfer classifies as 'transfer' (0.410079ms)
✔ classifyShape: degenerate shapes throw (0.299774ms)
ℹ tests 20
ℹ suites 0
ℹ pass 20
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 211.894484
```
Exit code: **0**

Pass: 20 / Fail: 0 / Skip: 0

## Complete diff of backup.test.ts (vs HEAD)

```diff
diff --git a/apps/api/src/modules/system/services/backup.test.ts b/apps/api/src/modules/system/services/backup.test.ts
index f3cb05c..d740069 100644
--- a/apps/api/src/modules/system/services/backup.test.ts
+++ b/apps/api/src/modules/system/services/backup.test.ts
@@ -7,9 +7,9 @@ import { tmpdir } from "node:os";
 import { join } from "node:path";
 import { Readable } from "node:stream";
 import { pipeline } from "node:stream/promises";
-import { eq, getTableColumns, getTableName, is, Table } from "drizzle-orm";
+import { and, eq, getTableColumns, getTableName, is, isNotNull, sql, Table } from "drizzle-orm";
 import * as schema from "../../../db/schema.ts";
-import { accounts, transactions, userTasks, users } from "../../../db/schema.ts";
+import { accounts, attachments, categories, postings, transactions, transactionSplits, transferLinks, userTasks, users } from "../../../db/schema.ts";
 import {
   ALL_TABLES,
   buildUserBackupStream,
@@ -27,6 +27,10 @@ import { writeArchive, type ArchiveHeader } from "../../../lib/backup-archive.ts
 import type { Storage } from "../../../lib/storage.ts";
 import { createDb } from "../../../db/index.ts";
 import { createPool } from "../../../infra/db.ts";
+import { HttpError } from "../../../lib/errors.ts";
+import { seedSystemAccounts } from "../../ledger/services/post-entry.ts";
+import { seedDefaultCategories } from "../../ledger/services/categories.ts";
+import { findInconsistentPostings, reconcileUserPostings } from "../../ledger/services/reconcile-postings.ts";
 
 /** Every pgTable defined in the schema, by its SQL name. */
 function schemaTableNames(): string[] {
@@ -119,6 +123,10 @@ test("the per-user restore covers exactly the exported tables, in parent-first o
   // sips FKs both goals and holdings (for an mf_folio target) — must restore after both.
   assert.ok(at("goals") < at("sips"));
   assert.ok(at("holdings") < at("sips"));
+  // postings FKs accounts, categories, AND transactions — must restore after all three.
+  assert.ok(at("accounts") < at("postings"));
+  assert.ok(at("categories") < at("postings"));
+  assert.ok(at("transactions") < at("postings"));
 });
 
 test("restore defers cyclic and self-referencing foreign keys", () => {
@@ -186,6 +194,77 @@ test("restoreDump's second pass issues an update for every column in DEFERRED_RE
   assert.deepEqual(sipUpdate?.params, ["sip1", "txn1"]);
 });
 
+test("the mocked restoreDump records postings every column, positioned after FK parents", async () => {
+  const calls: { sql: string; params: unknown[] }[] = [];
+  const client = {
+    query: async (sql: string, params: unknown[] = []) => {
+      calls.push({ sql, params });
+      if (sql.includes("count(*)::bigint as count from users")) return { rows: [{ count: "0" }] };
+      return { rows: [] };
+    },
+    release: () => {},
+  };
+  const pool = { connect: async () => client } as unknown as pg.Pool;
+
+  const dump: Record<string, Array<Record<string, unknown>>> = Object.fromEntries(ALL_TABLES.map((t) => [t, []]));
+  dump.accounts = [{ id: "acc1", name: "Bank", type: "bank", user_id: "u1" }];
+  dump.categories = [{ id: "cat1", name: "Food", kind: "expense", user_id: "u1" }];
+  dump.transactions = [{ id: "txn1", user_id: "u1", account_id: "acc1", date: "2026-01-15", amount_paise: -1000, merchant: "Cafe", category_id: "cat1" }];
+  dump.postings = [{
+    id: "p1", transaction_id: "txn1", account_id: "acc1", category_id: null,
+    amount_paise: 1000, necessity: null, note: "", created_at: "2026-01-15T12:00:00Z",
+  }];
+
+  await restoreDump(pool, dump);
+
+  const insertCalls = calls.filter((c) => c.sql.startsWith("insert into "));
+  const insertTables = insertCalls.map((c) => {
+    const m = c.sql.match(/insert into "([a-z_]+)"/);
+    return m ? m[1] : "";
+  });
+
+  // postings must appear after accounts, categories, and transactions
+  const idxAccounts = insertTables.indexOf("accounts");
+  const idxCategories = insertTables.indexOf("categories");
+  const idxTransactions = insertTables.indexOf("transactions");
+  const idxPostings = insertTables.indexOf("postings");
+  assert.ok(idxAccounts >= 0, "accounts insert must be present");
+  assert.ok(idxCategories >= 0, "categories insert must be present");
+  assert.ok(idxTransactions >= 0, "transactions insert must be present");
+  assert.ok(idxPostings >= 0, "postings insert must be present");
+  assert.ok(idxAccounts < idxPostings, "accounts must insert before postings");
+  assert.ok(idxCategories < idxPostings, "categories must insert before postings");
+  assert.ok(idxTransactions < idxPostings, "transactions must insert before postings");
+
+  // Every posting column is carried through the insert (none deferred, none omitted) —
+  // verify by parsing the column order from the SQL and mapping to positional params.
+  const postingInsert = insertCalls.find((c) => c.sql.includes('"postings"'));
+  assert.ok(postingInsert, "postings insert call must exist");
+
+  const columnMatch = postingInsert!.sql.match(/insert into "postings" \(([^)]+)\)/);
+  assert.ok(columnMatch, "postings insert SQL must have a column list");
+  const columns = columnMatch![1]!.split(", ").map((c) => c.replace(/"/g, ""));
+  assert.deepEqual(columns, ["id", "transaction_id", "account_id", "category_id", "amount_paise", "necessity", "note", "created_at"],
+    "postings insert must carry all 8 columns in the expected order",
+  );
+
+  // Build a column→value map from the positional params and assert against the fixture.
+  const paramMap: Record<string, unknown> = {};
+  for (let i = 0; i < columns.length; i++) {
+    paramMap[columns[i]!] = postingInsert!.params[i];
+  }
+  assert.deepEqual(paramMap, {
+    id: dump.postings[0]!.id,
+    transaction_id: dump.postings[0]!.transaction_id,
+    account_id: dump.postings[0]!.account_id,
+    category_id: null,
+    amount_paise: dump.postings[0]!.amount_paise,
+    necessity: null,
+    note: dump.postings[0]!.note,
+    created_at: dump.postings[0]!.created_at,
+  }, "postings insert must carry every column verbatim, none deferred/omitted/reordered");
+});
+
 test("misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched...
 ...
@@ -300,6 +379,7 @@ async function cleanupUser(userId: string): Promise<void> {
   await db.delete(userTasks).where(eq(userTasks.userId, userId));
   await db.delete(transactions).where(eq(transactions.userId, userId));
   await db.delete(accounts).where(eq(accounts.userId, userId));
+  await db.delete(categories).where(eq(categories.userId, userId));
   await db.delete(users).where(eq(users.id, userId));
 }

+// ---------- A6: postings backup/restore round-trip ----------
+// (693 added lines: AC2, AC3+AC4, B1/AC3-OLD-style, AC5 foreign, AC5 post-commit-throw)
```

(Full diff is 818 lines — the summary above covers the structural additions; each new test maps directly to a review-16 gap.)

## Assumptions
- `--env-file=.env` required when running test file directly (DATABASE_URL not in environment by default); `npm run test -w apps/api` uses `--env-file-if-exists=../../.env` in the script and works equivalently.
- The B5 assertion counts the archive header tables as of the moment they are built; the seeded system accounts (added to the DB before restore, not to the archive) are not in those counts and are not in `nonPostingRows`.

## Unresolved risks
None. All 5 review-16 gaps (B1–B5) are covered and all 19 backup tests pass. No production file was modified.

## Summary
- migrate exit 0, host 192.168.2.196
- typecheck exit 0
- lint exit 0
- backup.test.ts: 19 pass / 0 fail / 0 skip, exit 0
- postings.test.ts: 20 pass / 0 fail / 0 skip, exit 0
- production files modified: none
- plan deviations: none

---

# Iteration 4 — B5 vacuity fix

## Files inspected
- `tasks/021-postings-model/DELEGATION-A6.md` (brief, Iteration 4 section)
- `apps/api/src/modules/system/services/backup.test.ts` (modified file)

## Files changed
- `apps/api/src/modules/system/services/backup.test.ts` — TEST-ONLY.

No production/source file was modified.

## Implementation details

The Iteration 3 B5 assertion lived inside the OLD-style (B1) test where `header.tables.postings = []` (P=0). With zero archived posting rows, the assert is vacuous: `summary.rows === nonPostingRows` is trivially true whether or not the skip logic fires.

The fix moves the non-vacuous B5 check to the "A6 AC5: a posting with a foreign account_id is skipped" test, which already had exactly P=1 archived posting row. Three changes were made to that test:

1. After the `header.tables.postings = [...]` block, added computation of expected counts:
   ```ts
   const nonPostingRows = Object.entries(header.tables)
     .filter(([table]) => table !== "postings")
     .reduce((sum, [, rows]) => sum + (Array.isArray(rows) ? rows.length : 0), 0);
   const nonPostingTables = Object.entries(header.tables)
     .filter(([table, rows]) => table !== "postings" && Array.isArray(rows) && rows.length > 0)
     .length;
   ```
   With accounts=1 + transactions=1 and all other tables empty, `nonPostingRows = 2`, `nonPostingTables = 2`.

2. Changed `await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);` to `const summary = await restoreUserBackup(pool, stubStorage, destUserId, plaintextPath);` to capture the return value.

3. Added B5 assertions at the end of the test (before closing `});`):
   ```ts
   assert.equal(
     summary.rows,
     nonPostingRows,
     `summary.rows (${summary.rows}) must equal non-posting rows (${nonPostingRows}) — archived posting row must be excluded from summary.rows`,
   );
   assert.equal(
     summary.tables,
     nonPostingTables,
     `summary.tables (${summary.tables}) must equal non-posting tables (${nonPostingTables}) — postings table must not be counted in summary.tables`,
   );
   ```

The existing (vacuous-but-harmless) B5 assertion in the OLD-style B1 test was NOT removed, per the brief.

Exact values asserted: `summary.rows === 2`, `summary.tables === 2` (accounts=1 row + transactions=1 row; the 1 archived posting row is excluded, P=1>0 so non-vacuous).

## Commands run and literal output

### 1. npm run typecheck -w apps/api
```
> @compass/api@0.1.0 typecheck
> tsc --noEmit
```
Exit code: **0**

### 2. npm run lint
```
> compass@0.1.0 lint
> eslint .
```
Exit code: **0**

### 3. node --test apps/api/src/modules/system/services/backup.test.ts
```
✔ the full backup covers every table in the schema (2.65863ms)
✔ sips precedes holding_events in ALL_TABLES (holding_events.sip_id FKs sips) (0.259024ms)
✔ the per-user export reconstructs every table (no coverage gaps) (0.233957ms)
✔ no table is scoped both directly and through a parent (0.194333ms)
✔ every storage-key column in the schema is covered by FILE_COLUMNS (0.668306ms)
✔ collectFileRefs pulls every non-empty storage key from a dump (0.49865ms)
✔ the per-user restore covers exactly the exported tables, in parent-first order (0.444675ms)
✔ restore defers cyclic and self-referencing foreign keys (0.532843ms)
✔ restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS (1.5575ms)
✔ the mocked restoreDump records postings every column, positioned after FK parents (1.344697ms)
✔ misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key through untouched when present, and omits them (falling back to the column DEFAULT) when the dump predates the migration (0.747741ms)
✔ AC11: a task linked to an owned transaction, and an unlinked task, round-trip through per-user backup/restore (367.138777ms)
✔ misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey through restoreUserBackup, alongside an ordinary task (198.445483ms)
✔ misc-05 AC14: a per-user archive predating source/sourceKey (missing both keys entirely) restores via restoreUserBackup by falling back to the column DEFAULTs (30.406583ms)
✔ A6 AC2: a dest user with seeded categories + system accounts restores; a real non-system account blocks with 409 (291.260817ms)
✔ A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows) (386.039554ms)
✔ A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings and no system accounts (131.289206ms)
✔ A6 AC5: a posting with a foreign account_id is skipped (never inserted) (51.794277ms)
✔ A6 AC5 post-commit throw: reconcile failure does not roll back committed restore or delete blobs (195.929115ms)
ℹ tests 19
ℹ suites 0
ℹ pass 19
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2907.147679
```
Exit code: **0**

Pass: 19 / Fail: 0 / Skip: 0

## Assumptions
- `nonPostingRows = 2` and `nonPostingTables = 2` are derived from `header.tables` at runtime, not hardcoded, so the assertion stays correct if the fixture changes. The current fixture always yields 2+2 given accounts=1, transactions=1, all others empty, postings excluded.

## Unresolved risks
None. B5 is now non-vacuous (P=1>0). No production file was modified.
