# PR-F Investigation 2

**Date:** 2026-08-10  
**Scope:** `loadCardLedgerTxns` in apps/extractor and the backup CSV projection; plus restore compatibility and extractor architecture constraints.

---

## A. `loadCardLedgerTxns` — call sites, downstream use, sign convention, tests

### Definition

`apps/extractor/src/db.ts` lines 232–260:

```typescript
export async function loadCardLedgerTxns(
  pool: pg.Pool,
  userId: string,
  accountId: string,
  fromDate: string,
  toDate: string,
): Promise<LedgerTxnRow[]> {
  const res = await pool.query<{
    id: string;
    amount_paise: string;
    date: string;
    occurred_at_ts: string | null;
    merchant: string;
  }>(
    `select id, amount_paise, to_char(date, 'YYYY-MM-DD') as date,
            to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as occurred_at_ts, merchant
       from transactions
      where user_id = $1 and account_id = $2 and deleted_at is null
        and date between $3 and $4`,
    [userId, accountId, fromDate, toDate],
  );
  return res.rows.map((r) => ({
    id: r.id,
    amountPaise: Number(r.amount_paise),
    date: r.date,
    occurredAtTs: r.occurred_at_ts,
    merchant: r.merchant,
  }));
}
```

Columns read from `transactions`: `id`, `amount_paise`, `date`, `occurred_at`, `merchant`.  
Filter columns used: `user_id`, `account_id`, `deleted_at`, `date`.

### Call sites

1. **`apps/extractor/src/statement-duplicates.ts` line 30** — the only production call site:

```typescript
const ledger = await loadCardLedgerTxns(pool, userId, accountId, from, to);
```

Called inside `annotateStatementDuplicates`. The date range is the lines' own date span ±`STATEMENT_MATCH_WINDOW_DAYS` (4 days), never the statement period.

### Downstream use in `matchLinesToLedger`

`statement-duplicates.ts:32–41` passes the returned `LedgerTxnRow[]` as `ledger: LedgerTxn[]` to `matchLinesToLedger` from `extract.ts`.

Inside `matchLinesToLedger` (extract.ts lines 833–836):

```typescript
const signed = line.direction === "debit" ? -line.amountPaise : line.amountPaise;
ledger.forEach((t, j) => {
  if (t.amountPaise !== signed) return;
```

**Sign convention:** `t.amountPaise` (the ledger row's value, read directly from `transactions.amount_paise`) is expected to be **signed**. Specifically:
- A card spend (debit) → **negative paise** in `transactions.amount_paise` (e.g., -50000)
- A credit (refund/repayment) → **positive paise** in `transactions.amount_paise` (e.g., +500000)

A `MatchableLine` carries `direction` + a positive `amountPaise` magnitude. The function converts the line to signed paise and compares against the ledger's already-signed value. The test at extract.test.ts:395–398 confirms this:

```typescript
const lines = [line(50000, "debit", "2026-07-10", "Swiggy")];
const ledger = [ledgerTxn("t1", -50000, "2026-07-11", "SWIGGY LTD")];
assert.deepEqual(matchLinesToLedger(lines, ledger), ["t1"]);
```

And extract.test.ts:407–415 explicitly confirms a debit line NEVER matches a positive ledger row.

### Tests

**Pure-unit tests (no DB):**
- `apps/extractor/src/extract.test.ts` — tests `matchLinesToLedger` exhaustively with mock `LedgerTxn` fixtures (lines 395–479). Does NOT test `loadCardLedgerTxns` itself (the SQL). Uses `node --test`, no Postgres needed.

**DB integration test:**
- `apps/extractor/src/statement-duplicate.test.ts` — the single test (lines 123–203) exercises `annotateStatementDuplicates` → `loadCardLedgerTxns` → `matchLinesToLedger` end-to-end against a **real Postgres connection** (`DATABASE_URL`). Creates throwaway users/accounts/transactions and cleans up in `t.after()`. This test directly inserts rows into `transactions` using raw SQL including `amount_paise` and `account_id` (lines 92–105).

The `db.test.ts` tests only cover `saveResults` (the `extracted_transactions` INSERT); they do NOT exercise `loadCardLedgerTxns`.

---

## B. Other raw SQL touching `transactions` in the extractor

All locations scanned: `apps/extractor/src/*.ts`.

### Known (already identified)

`apps/extractor/src/db.ts` lines 457–466 — `upsertReconciliation`:

```typescript
await client.query(
  `update transactions set reconciled_statement_id = null where reconciled_statement_id = $1`,
  [id],
);
// ...
await client.query(
  `update transactions set reconciled_statement_id = $1
    where user_id = $2 and id = any($3::uuid[]) and deleted_at is null`,
  [id, args.userId, stats.matchedTxnIds],
);
```

**These two UPDATE statements are NOT in PR-F scope.** They touch only `reconciled_statement_id`, which is not `amount_paise` or `account_id`. They do not read or write any column that the postings migration touches.

### Everything else

No other production file under `apps/extractor/src/` references `transactions.amount_paise` or `transactions.account_id` in SQL.

**Test-only SQL** (not production code, but noted):

- `apps/extractor/src/statement-duplicate.test.ts` lines 92–105 (`createLedgerTxn`): raw INSERT into `transactions` with `account_id`, `amount_paise` — used only to set up test fixtures. This is a test helper, not production code, but PR-F must ensure the fixture remains valid (or the test must be updated if `loadCardLedgerTxns` is migrated to read from `postings` instead).
- `apps/extractor/src/statement-duplicate.test.ts` lines 107–113 (`countLedgerRows`): `select count(*) from transactions where user_id = $1` — no `amount_paise`/`account_id`.
- `apps/extractor/src/statement-duplicate.test.ts` lines 118–120 (cleanup): `delete from transactions where user_id = $1` — no `amount_paise`/`account_id`.

---

## C. Backup service — exact path and CSV projection

**Exact path:** `/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts`

### `transactionsCsv` (the CSV export)

Lines 127–144:

```typescript
export async function transactionsCsv(db: Db, userId: string): Promise<string> {
  const res = await db.execute(sql`
    select t.date, t.merchant, t.amount_paise, c.name as category, a.name as account, t.notes
    from transactions t
    left join categories c on c.id = t.category_id
    left join accounts a on a.id = t.account_id
    where t.user_id = ${userId} and t.deleted_at is null
    order by t.date desc
  `);
  const rows: Array<Array<string | number>> = [["Date", "Merchant", "Amount (paise)", "Category", "Account", "Notes"]];
  for (const r of res.rows as Array<Record<string, unknown>>) {
    rows.push([
      String(r.date), String(r.merchant ?? ""), Number(r.amount_paise),
      String(r.category ?? ""), String(r.account ?? ""), String(r.notes ?? ""),
    ]);
  }
  return toCsv(rows);
}
```

**CSV header (exact):** `Date, Merchant, Amount (paise), Category, Account, Notes`

**Columns from `transactions`:** `t.date`, `t.merchant`, `t.amount_paise` (directly), `t.notes`, plus `t.category_id` and `t.account_id` used in JOINs.

**How rows are fetched:** Drizzle ORM's `db.execute(sql\`...\`)` — raw SQL template tag, not a generic table dumper. The query is hardcoded (not generic). It reads `amount_paise` and joins via `account_id` explicitly.

### Generic table dump (for encrypted backup)

`dumpTable` (line 92–95) and `dumpUserTable` (lines 97–108) use `select *` via Drizzle — all columns including `amount_paise` and `account_id` are dumped verbatim. These back the full JSON dump (`dumpDatabase`) and the per-user encrypted archive (`buildUserBackupStream`).

---

## D. Backup RESTORE — counterpart, CSV vs. JSON, compatibility

**IMPORTANT: The CSV from `transactionsCsv` is NOT what restore reads.** It is a one-way user-download export only. There is no CSV importer.

### Full-database restore

Path: `/home/udai/common/compass/apps/api/src/db/restore.ts`

Function `restoreDump` (lines 58–94):
- Reads a JSON dump (the `dumpDatabase` / v1 format encrypted backup).
- Iterates `ALL_TABLES` in order, calling `insertRow` which builds `INSERT INTO <table> (<all columns from the row's own keys>) VALUES (...)` dynamically from `Object.entries(row)`.
- Column list is derived from whatever keys the dump row has — NOT hardcoded (except `OMITTED_RESTORE_COLUMNS.transactions = ["search"]` is stripped and `DEFERRED_RESTORE_COLUMNS.transactions = ["policy_id", "recurring_template_id", "reconciled_statement_id", "sip_id"]` are nulled on first pass).
- If PR-F adds a `postings` row for each transaction (already done in previous PRs) and the `transactions` table loses `amount_paise`/`account_id` column in a future migration, `restoreDump` would need those columns to exist when restoring an old backup. But the current schema retains those columns (PR-F only adds a new reader, not a schema change).

### Per-user restore

Path: `/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts`

Function `restoreUserBackup` (lines 86–211):
- Reads a v2 archive (JSON-based, not CSV).
- **Deliberately skips `postings` rows** (line 151: `if (table === "postings") continue;`) and re-synthesizes them post-commit via `reconcileUserPostings`.
- Row insert is also generic (same `insertRow` pattern with `Object.entries`).
- **CSV column changes do NOT affect restore at all.** The CSV path and the restore path are completely independent.

**Conclusion on D:** Changing or removing `amount_paise`/`account_id` from `transactionsCsv`'s SELECT will break the CSV download for users. It will NOT break restore (which reads JSON dumps, not CSV). The JSON dump from `dumpUserTable` uses `select *` and will continue to export whatever columns the schema has.

---

## E. `backup.test.ts` — exact path, assertions, CSV coverage

**Exact path:** `/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts`

### What it tests (complete list of test cases)

1. `"the full backup covers every table in the schema"` (line 42) — asserts `ALL_TABLES` matches schema table names exactly. Pure fixture, no DB.
2. `"sips precedes holding_events in ALL_TABLES"` (line 51) — ordering assertion. Pure fixture.
3. `"the per-user export reconstructs every table"` (line 55) — `exportGaps()` must be `[]`. Pure fixture.
4. `"no table is scoped both directly and through a parent"` (line 62) — pure fixture.
5. `"every storage-key column in the schema is covered by FILE_COLUMNS"` (line 67) — pure fixture.
6. `"collectFileRefs pulls every non-empty storage key"` (line 87) — pure fixture.
7. `"the per-user restore covers exactly the exported tables, in parent-first order"` (line 109) — tests `restorableTables()` ordering. Pure fixture.
8. `"restore defers cyclic and self-referencing foreign keys"` (line 132) — tests `firstPassRow`. Pure fixture.
9. `"restoreDump's second pass issues an update for every column in DEFERRED_RESTORE_COLUMNS"` (line 154) — mocked pg.Pool. Pure fixture.
10. `"the mocked restoreDump records postings every column, positioned after FK parents"` (line 197) — mocked pg.Pool.
11. `"misc-05 AC14: restoreDump's first pass carries user_tasks.source/source_key..."` (line 268) — mocked pg.Pool.
12. `"AC11: a task linked to an owned transaction..."` (line 386) — **DB-backed** (needs `DATABASE_URL`).
13. `"misc-05 AC14: the per-user archive round-trips a card-due task's source/sourceKey..."` (line 467) — DB-backed.
14. `"misc-05 AC14: a per-user archive predating source/sourceKey..."` (line 511) — DB-backed.
15. `"A6 AC2: a dest user with seeded categories + system accounts restores..."` (line 557) — DB-backed.
16. `"A6 AC3+AC4: restore re-synthesizes postings (never trusts archived rows)"` (line 610) — DB-backed.
17. `"A6 AC3 OLD-style (B1): restore re-synthesizes postings from an archive with no postings..."` (line 870) — DB-backed.
18. `"A6 AC5: a posting with a foreign account_id is skipped"` (line 1066) — DB-backed.
19. `"A6 AC5 post-commit throw: reconcile failure does not roll back committed restore"` (line 1180) — DB-backed.

### CSV assertions

**`transactionsCsv` is NOT tested anywhere in `backup.test.ts`.** No test checks CSV header or CSV column content. A PR-F change to `transactionsCsv`'s SELECT or header would NOT cause any existing test to fail.

### Assertions that would need to change in PR-F (if `transactions.amount_paise`/`account_id` are removed from schema)

Test at line 197 (mocked restoreDump for postings) builds a fixture row at line 212:

```typescript
dump.transactions = [{ id: "txn1", user_id: "u1", account_id: "acc1", date: "2026-01-15", amount_paise: -1000, merchant: "Cafe", category_id: "cat1" }];
```

Test at line 268 (`DEFERRED_RESTORE_COLUMNS` loop) has similar fixture rows at lines 177–179.

DB-backed tests (AC11, A6 series) insert transactions via Drizzle ORM using `amountPaise` / `accountId` camelCase fields — these would need updating only if the Drizzle schema columns are renamed/removed.

If PR-F only changes the `transactionsCsv` query (reading from `postings` instead), none of the existing backup.test.ts assertions would fail. The schema coverage test (test 1) would only fail if a new table were added without being listed in `ALL_TABLES`.

---

## F. Extractor architecture — shared code and Drizzle constraint

### What the extractor shares with apps/api

The extractor imports:
- **`@compass/shared`**: types only (`EmailIngestStatus`, `RedactionIdentity`, `EXTRACT_QUEUE`, `ExtractJobSchema`, `TxnDirectionSchema`, `TxnDirection`, `EmailClassSchema`, `EmailClass`, `redactPii`). No Drizzle schema.
- **`@compass/ai`**: AI provider abstraction.
- **`pg`**: direct pg.Pool, no Drizzle.

### What it does NOT have

The extractor has **NO access to Drizzle schema**. There is no `import from "@compass/api"` or `import ... from "../../db/schema.ts"`. The extractor package's `package.json` lists only `@compass/ai`, `@compass/shared`, `bullmq`, `mailparser`, `pdfjs-dist`, `pg`, and `zod` as dependencies.

**Implication for PR-F:** `loadCardLedgerTxns` MUST be rewritten using hand-written raw SQL (the same `pool.query(...)` pattern that exists today). It cannot use Drizzle's type-safe query builder. Any join against `postings` must be expressed as a raw SQL string.

The new query would need to:
1. Remove `account_id = $2` from the `transactions` WHERE clause (since the filter should come from `postings.account_id`).
2. Join `postings` to get the account-scoped amount — but `postings` rows have their own `amount_paise` per leg, signed per the double-entry convention. The "asset leg" of a transaction is the posting where `account_id` matches the card account; its `amount_paise` IS the signed amount the matcher expects (negative for a spend, positive for a credit/repayment).
3. The `LedgerTxnRow` interface and its downstream use of `amountPaise` (signed) stays unchanged — only the SQL source changes.

---

## Files inspected

- `/home/udai/common/compass/apps/extractor/src/db.ts`
- `/home/udai/common/compass/apps/extractor/src/db.test.ts`
- `/home/udai/common/compass/apps/extractor/src/extract.ts`
- `/home/udai/common/compass/apps/extractor/src/extract.test.ts`
- `/home/udai/common/compass/apps/extractor/src/statement-duplicates.ts`
- `/home/udai/common/compass/apps/extractor/src/statement-duplicate.test.ts`
- `/home/udai/common/compass/apps/extractor/src/index.ts` (grep only)
- `/home/udai/common/compass/apps/extractor/package.json`
- `/home/udai/common/compass/apps/api/src/modules/system/services/backup.ts`
- `/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts`
- `/home/udai/common/compass/apps/api/src/db/restore.ts`
- `/home/udai/common/compass/apps/api/src/modules/system/services/restore-user.ts`

## Files changed

None. Read-only investigation.
