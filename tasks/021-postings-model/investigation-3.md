# Investigation 3 — A6 scope: backup/restore round-trip for `postings`

## 1. Backup registration

### ALL_TABLES (backup.ts:28–41)
`const ALL_TABLES` is a 44-element string literal array. Current order around the insertion point:
```
"users", "accounts", "categories", "resources", "transactions", "user_tasks",
"transaction_splits", "transfer_links", ...
```
`postings` is **absent**. It must be inserted immediately after `"transactions"` (index 4 → new index 5), satisfying FK order: `accounts.id` ← `transactions.account_id` precedes `transactions.id`, and `postings.transaction_id` → `transactions.id` + `postings.account_id` → `accounts.id` are both satisfied.

### USER_TABLES (backup.ts:44–59)
A `Record<string, string>` mapping table → user_id column. `postings` has no `user_id`; it must remain **absent** from this record.

### LINKED_TABLES (backup.ts:66–74)
A `Record<string, { fk: string; parent: string }>`. Must add:
```
postings: { fk: "transaction_id", parent: "transactions" },
```
The `dumpUserTable` function (backup.ts:92–103) uses this to join `postings` through `transactions` and scope by `transactions.user_id`. `buildUserBackupStream` (backup.ts:182) iterates `Object.keys(USER_TABLES)` then `Object.keys(LINKED_TABLES)` — `postings` rows appear in the archive only if it is in LINKED_TABLES.

### exportGaps() (backup.ts:82–85)
```ts
const covered = new Set([...Object.keys(USER_TABLES), ...Object.keys(LINKED_TABLES), "users"]);
return ALL_TABLES.filter((t) => !covered.has(t));
```
If `postings` is in `ALL_TABLES` but not in `LINKED_TABLES`, `exportGaps()` returns `["postings"]` → test at backup.test.ts:55 fails.

### backup.test.ts assertion shapes

**Test "the full backup covers every table in the schema" (backup.test.ts:38–45):**
```ts
const missing = [...inSchema].filter((t) => !inBackup.has(t));
const stale = [...inBackup].filter((t) => !inSchema.has(t));
assert.deepEqual(missing, [], `tables missing from ALL_TABLES: ...`);
assert.deepEqual(stale, [], `ALL_TABLES lists tables not in the schema: ...`);
```
Fails with `missing = ["postings"]` if `postings` is in the schema but not in `ALL_TABLES`.

**Test "the per-user export reconstructs every table (no coverage gaps)" (backup.test.ts:51–56):**
```ts
assert.deepEqual(exportGaps(), []);
```
Fails if `postings` is in `ALL_TABLES` but absent from both `USER_TABLES` and `LINKED_TABLES`.

**Test "no table is scoped both directly and through a parent" (backup.test.ts:58–61):**
```ts
const both = Object.keys(USER_TABLES).filter((t) => t in LINKED_TABLES);
assert.deepEqual(both, [], `tables scoped twice: ...`);
```
Fails if `postings` is added to both; enforces it belongs only in `LINKED_TABLES`.

**Test "the per-user restore covers exactly the exported tables, in parent-first order" (backup.test.ts:105–122):**
Calls `restorableTables()` (which filters `ALL_TABLES` to those in `USER_TABLES | LINKED_TABLES`) and spot-checks ordering. Adding `postings` to `ALL_TABLES` + `LINKED_TABLES` means it will appear in `restorableTables()`. The spot-check `at("accounts") < at("transactions")` already holds; there is no existing spot-check for `postings`. A new spot-check `at("transactions") < at("postings")` should be added alongside the others.

---

## 2. restore-user.ts analysis

### (a) Fresh-account precondition guard (restore-user.ts:14, 68–75, 95–103)
```ts
const MUST_BE_EMPTY = ["accounts", "transactions", "insurance_policies", "goals", "holdings"] as const;
// ...
const res = await pool.query<{ count: string }>(
  `select count(*)::bigint as count from ${ident(table)} where user_id = $1`,
  [userId],
);
if (Number(res.rows[0]?.count ?? 0) !== 0) {
  throw new HttpError(409, "This account already has data — restore needs a fresh account");
}
```
The guard runs `WHERE user_id = $1` with **no filter on `system_kind`**. After system accounts are seeded at registration (`seedSystemAccounts` in auth.ts), a freshly registered target user has 4 rows in `accounts` with `type = 'system'` and `system_kind IS NOT NULL`. The current guard will count those and throw 409 even for a fresh account. **Must change to `WHERE user_id = $1 AND system_kind IS NULL`** (both the pre-check pool.query at lines 68–75 and the inside-tx re-check at lines 95–103).

### (b) Reverse-order delete loop (restore-user.ts:106–113)
```ts
for (const table of [...tables].reverse()) {
  if (table in USER_TABLES) {
    await client.query(
      `delete from ${ident(table)} where ${ident(USER_TABLES[table]!)} = $1`,
      [userId],
    );
  }
}
```
Deletes ALL rows for the user in every USER_TABLE. For `accounts`, this deletes the seeded system accounts. The plan requires: **system accounts must NOT be deleted by this loop**. Fix: for the `accounts` table, add `AND system_kind IS NULL` to the delete predicate. Other USER_TABLEs do not have system_kind.

### (c) Generic per-row rewrite/remap (restore-user.ts:116–132)
```ts
for (const table of tables) {
  const rows = header.tables[table];
  if (!Array.isArray(rows)) continue;          // ← old-archive skip (line 119–120)
  if (rows.length > 0) tableCount++;
  const userColumn = USER_TABLES[table];
  for (const row of rows) {
    const rewritten: Record<string, unknown> = { ...row };
    if (userColumn) rewritten[userColumn] = userId;                    // user_id remap (line 124–125)
    for (const [scoped, column] of fileColumns) {
      if (scoped.startsWith(`${table}.`) && typeof rewritten[column] === "string") {
        rewritten[column] = keyMap.get(rewritten[column] as string) ?? rewritten[column];
      }
    }
    await insertRow(client, table, firstPassRow(table, rewritten));
    rowCount++;
  }
}
```
The FK remap seam is the `rewritten` mutation block (lines 123–131). For `postings` rows, `account_id` references the SOURCE user's system account IDs. A new remap of the form `rewritten["account_id"] = sysAccountMap.get(rewritten["account_id"] as string) ?? rewritten["account_id"]` must be applied here when `table === "postings"` (or generally for any FK pointing at accounts, but only system accounts shift ID).

### (d) Archive rows read per table (restore-user.ts:118–120)
```ts
const rows = header.tables[table];
if (!Array.isArray(rows)) continue;
```
If `header.tables["postings"]` is `undefined`, the block is skipped silently. This is the old-archive discriminator (see item 3).

### (e) Slot for system-account regeneration + old→new map
After the reverse-order delete (line 113) and BEFORE the forward insert pass (line 116):

1. Call `seedSystemAccounts` for the target user (regenerates the 4 rows since the delete loop would have removed them — or, if the delete is changed to skip system_kind IS NOT NULL, they're already present).
2. Query `SELECT id, system_kind FROM accounts WHERE user_id = $1 AND system_kind IS NOT NULL` → build `Map<targetId, systemKind>` for the target.
3. From `header.tables["accounts"]` (the archived accounts), find rows where `system_kind IS NOT NULL` → build `Map<sourceId, systemKind>`.
4. Compose: `sourceId → systemKind → targetId` → this is the `sysAccountMap: Map<sourceId, targetId>`.
5. In the forward insert pass for `postings`, apply `rewritten["account_id"] = sysAccountMap.get(rewritten["account_id"]) ?? rewritten["account_id"]`.
6. Also: **do NOT insert archived system accounts** as regular accounts — either skip rows where `system_kind IS NOT NULL` in the accounts insert pass, or do the delete-skip approach (don't delete, don't re-insert from archive).

---

## 3. Old vs new archive discriminator

The archive is `ArchiveHeader.tables: Record<string, Array<Record<string, unknown>>>` (backup-archive.ts). `exportUserData` / `buildUserBackupStream` only write the tables in `USER_TABLES + LINKED_TABLES`. Before `postings` was registered, archives had no `postings` key.

**Discriminator (restore-user.ts:119):**
```ts
if (!Array.isArray(header.tables["postings"])) // → old archive (no postings)
```
`header.tables["postings"] === undefined` for old archives; `Array.isArray(header.tables["postings"])` is true for new archives (even if the array is empty). This existing skip-absent-table pattern IS the discriminator. No additional field needed.

---

## 4. Reuse of reconcileUserPostings / findInconsistentPostings

### reconcileUserPostings (reconcile-postings.ts:69–114)
- Signature: `(db: Db, userId: string)`.
- Internally calls `db.transaction()` per row (line 90) — Drizzle per-row savepoint isolation.
- Seeds system accounts, resolves them, iterates ALL transactions (including soft-deleted), compares-and-replaces.

### Transaction boundary caveat
`restoreUserBackup` uses a raw `pg.PoolClient` in a single `BEGIN … COMMIT` block (lines 93–151). The client holds uncommitted rows. `reconcileUserPostings` takes a Drizzle `Db` that opens its own pool connections — it would NOT see the uncommitted restore rows.

**Conclusion:** `reconcileUserPostings` **cannot** be called inside the restore's client transaction to synthesize postings for an old archive. It must be called AFTER `commit`. The plan's "BEFORE commit" intent would require either:
  - Converting restore-user.ts to accept/create a Drizzle `Db` so `db.transaction()` nesting via savepoints operates on the same connection, OR
  - Running inline `replacePostings` calls using the same `client` (bypassing the Drizzle wrapper).

For the simplest implementation: call `reconcileUserPostings(db, userId)` AFTER the `client.query("commit")` at line 151. The restore is complete (legacy data visible), system accounts exist, reconcile synthesizes all postings in separate per-row transactions. The per-transaction invariant is satisfied on first read after restore.

### findInconsistentPostings (reconcile-postings.ts:152–194)
- Signature: `(db: Db, userId?: string)` — read-only.
- Same Drizzle `Db` requirement; same constraint: must run after restore commit.
- Can be called to validate a NEW archive's restored+remapped posting rows (rebuild-and-compare, report drift). No writes.

**Reuse verdict:** YES, both functions are reusable — with the tx-boundary caveat that both run **after** `commit`, not inside the restore transaction.

---

## 5. db/restore.ts — full-dump restore ordering

`restoreDump` (db/restore.ts:58–94) iterates `ALL_TABLES` (line 67) in order. Any table missing from the dump causes `throw new Error("Backup is missing table ...")` (line 68). `postings` must be at the same position in `ALL_TABLES` as in the per-user backup — immediately after `"transactions"`.

**Insertion point:** between `"transactions"` and `"user_tasks"` in the `ALL_TABLES` array (backup.ts:29).

Old full-dump backups (created before `postings` was added to `ALL_TABLES`) will have no `"postings"` key in the dump and `restoreDump` will throw. This is the expected behavior for a schema-version mismatch — the same failure already applies to any new table added to ALL_TABLES. A forward-compatibility guard (e.g. treating missing postings as `[]` + synthesizing afterward) would be a nice-to-have but is NOT required for A6 scope.

---

## 6. Blockers / ambiguities / scope surprises

### B1 — System accounts in the accounts archive
`buildUserBackupStream` (backup.ts:182) dumps all USER_TABLE rows by `user_id`, including accounts with `system_kind IS NOT NULL`. An archive produced by the new binary thus contains 4 system account rows in `header.tables.accounts`. During restore:
- The reverse-order delete wipes them (line 109) — or must be changed NOT to.
- The forward pass inserts them from the archive (with `user_id` remapped to `userId`).
- **Source system account IDs are inserted under the target user's `user_id`**, satisfying `postings.account_id` FK without any id map.
- BUT: if the fresh-account guard is changed to skip system_kind accounts (fix in 2a), and the delete loop is changed to skip system_kind accounts (fix in 2b), then the target user's existing 4 system accounts remain, and the archived system accounts MUST NOT be re-inserted (duplicate `accounts_system_kind_idx` violation).

Two consistent approaches:
  1. **Preserve target's system accounts**: (a) guard ignores system_kind accounts, (b) delete loop skips system_kind accounts, (c) archived system account rows are skipped in the insert loop, (d) build sysAccountMap from archived→target IDs by system_kind, (e) rewrite posting.account_id through sysAccountMap.
  2. **Re-insert source's system accounts**: (a) guard ignores system_kind accounts, (b) delete loop DOES delete existing system accounts, (c) insert archived system accounts as-is (user_id remapped), (d) no sysAccountMap needed (IDs preserved from archive). Simpler, but loses the target's seeded IDs (only matters if other rows reference them, which they don't before restore).

Approach 1 is what the plan specifies ("seeded system accounts retained/regenerated + build old→new map"). Approach 2 is simpler and avoids the map, but requires the delete loop to remove system accounts (risking FK issues if any row references them before they're deleted and re-inserted — not a problem here since delete+insert is in order).

### B2 — `firstPassRow` and `DEFERRED_RESTORE_COLUMNS`
`postings.account_id` is NOT in `DEFERRED_RESTORE_COLUMNS` (no cycle). The sysAccountMap remap of `account_id` in postings must happen in the forward pass (rewrite before `firstPassRow`), not the deferred second pass. No change to `DEFERRED_RESTORE_COLUMNS` is needed.

### B3 — `OMITTED_RESTORE_COLUMNS`
`postings` has no DB-generated columns (no `search` tsvector). No entry needed in `OMITTED_RESTORE_COLUMNS`.

### B4 — Concurrent seeding race in restore
`seedSystemAccounts` has a race guard for the `accounts_system_kind_idx` unique partial index (post-entry.ts:156–161). During restore the connection is single-threaded in the client tx; no race issue. But if `seedSystemAccounts` is called with a raw `pg.PoolClient` (not Drizzle), it must be re-implemented as raw SQL or the restore must be given a Drizzle `Db` handle.

### B5 — `restorableTables()` ordering test (backup.test.ts:105–122)
Currently spot-checks `at("transactions") < at("attachments")`. Adding `postings` to LINKED_TABLES will include it in `restorableTables()`. A new spot-check line `assert.ok(at("transactions") < at("postings"))` should be added to lock in order. Not a blocker (the test doesn't fail without it), but the ordering test is explicitly a regression guard.
