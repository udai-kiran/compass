# Investigation 2 — Slice A5: idempotent backfill reconciliation

## 1. Boot/Startup sequence

**`apps/api/src/server.ts` lines 1–16:**
Top-level script: `loadConfig()` → `buildApp(config)` → signal handlers → `app.listen(...)`.
`app.listen` is the very last call. Everything in `buildApp` and `startJobs` runs **before** HTTP traffic is served.

**`apps/api/src/app.ts` lines 150–241, `buildApp()`:**
Order: decorate (pg/db/redis/storage/eventBus) → `registerLedgerCacheSubscriber` → `startJobs(app)` (line 181) → `setupAuth` → `setupSecurity` → `registerRoutes` → return.

**`apps/api/src/jobs/index.ts` lines 158–410, `startJobs()`:**
Sets up BullMQ queues + workers + schedulers, then runs boot catch-up steps in sequence (lines 368–402):
- `materializeDue(app.db)` — line 368
- `evaluateBillReminders(app.db)` — line 379
- `materializeCardDueTasks(app.db)` — line 389
- `snapshotAllUsers(app.db)` — line 398

All four catch-up calls are `.catch()`-guarded and isolated. The `onClose` hook registration (`addHook`) is at line 404. There is **no existing post-migrate or boot-once guard** (drizzle-kit `migrate` is bare with no hook; `db:seed` is a standalone script invoked separately).

**Best hook point: `apps/api/src/jobs/index.ts` after line 402** (after `snapshotAllUsers` boot catch-up, before `addHook("onClose",...)`). This follows the established pattern exactly: isolated `.catch()`, logs result, never throws so boot is unblocked, runs before `app.listen()`.

## 2. Migration runner

**`apps/api/package.json` line 10:** `"db:migrate": "node ... drizzle-kit/bin.cjs migrate"` — raw drizzle-kit CLI, no custom TS runner, no post-migration hook.

**`apps/api/package.json` line 11:** `"db:seed": "node ... src/db/seed.ts"` — standalone top-level script (demo user + default categories only). Not called from migrate or server boot.

**`apps/api/src/db/seed.ts` lines 1–31:** standalone script, not a module. No post-migration hook mechanism exists. Backfill must live in server boot.

## 3. Bulk iteration patterns

**Canonical all-users scan (`apps/api/src/modules/investments/services/networth.ts` lines 191–217):**
```
const allUsers = await db.select({ id: users.id }).from(users);
for (const u of allUsers) {
  try { ... } catch (error) { failures.push({ userId: u.id, ..., error }); }
}
return { processed: allUsers.length, written, failures };
```
Same pattern used in `autopilot.ts` lines 136 and 230 for `runAutopilotReview` and `runGoalReview`. No cursor/batch — loads all user IDs at once (acceptable for this app's scale).

**All transactions per user including soft-deleted:**
No existing service does a full "all transactions for this user" scan. `filterWhere()` (transactions.ts line 52–74) has an `includeDeleted` opt-in that omits `isNull(deletedAt)` when set to true, but it's used only for search. The equivalent standalone query for the backfill: `db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, userId))` with NO `isNull(deletedAt)` filter.

**Backup precedent** (`backup.ts` line 100–101): raw SQL `select * from transactions where user_id = $1` — no deleted_at filter — confirms the dump-everything-including-soft-deleted pattern is intentional.

## 4. Compare-vs-repair feasibility

**Builders exported from `apps/api/src/modules/ledger/services/postings.ts`:**
- `buildOrdinaryPostings` (line 74) — exported ✓
- `buildSplitPostings` (line 110) — exported ✓
- `buildOpeningPostings` (line 185) — exported ✓
- `buildTransferLegPostings` (line 218) — exported ✓

**`rebuildPostingsForTransaction` exported from `transactions.ts` line 198:** exported ✓. Internally: resolves system accounts, detects `isOpening`/transfer-link/splits, builds drafts, calls `replacePostings`. The draft-building logic is fully self-contained and reads the DB.

**`replacePostings` (`post-entry.ts` lines 41–74):** ALWAYS delete+insert (`db.delete(postings).where(eq(postings.transactionId, transactionId))` line 60, then `db.insert(postings)` line 63). No compare-first path exists.

**Postings table queryable by transaction_id:** `db/shared/ledger.ts` lines 132–152 — `postings` table has `transactionId`, `accountId`, `amountPaise`, `categoryId`, `necessity`, `note`. Index `postings_tx_idx` on `transactionId` (line 149). No unique partial index per posting; rows are identified by `id` (uuid). Set comparison must be multi-row.

**Compare-first diff feasibility: YES**, with the following requirements:
- A compare helper needs to: (a) run the same branch logic as `rebuildPostingsForTransaction` to produce `expectedDrafts: PostingDraft[]`; (b) query `db.select({ accountId, amountPaise, categoryId, necessity, note }).from(postings).where(eq(postings.transactionId, id))` to get stored rows; (c) compare the two sets order-independently by `{accountId, amountPaise, categoryId, necessity, note}`; (d) call `replacePostings` only when they differ.
- **Nothing missing to build this** — all builders, `resolveSystemAccounts`, and the `postings` schema are exported and accessible.
- The key helper to write: a `compareAndRebuild(db, userId, transactionId)` function that extracts the draft-building logic from `rebuildPostingsForTransaction` before the `replacePostings` call, and short-circuits if stored matches expected.

## 5. Soft-delete + scope

**PLAN-dualwrite.md line 33:** "soft-deleted rows: postings retained but EXCLUDED via parent `transactions.deleted_at IS NULL`". Postings are NOT deleted on soft-delete (`transactions.ts` line 483–487: only `deletedAt` flag is set; no posting deletion). Reconciler MUST include soft-deleted transactions.

**Enumeration:** Use `eq(transactions.userId, userId)` without `isNull(transactions.deletedAt)` to include soft-deleted rows. `filterWhere` with `{ includeDeleted: true }` (transactions.ts line 56–58) produces the same WHERE clause if `filterWhere` is reused.

**System accounts prerequisite:** `resolveSystemAccounts` (`post-entry.ts` line 160–179) throws HttpError(500) "system accounts not seeded" if any of the 4 kinds is absent. Users who existed before PR-A was deployed will have no system accounts. The reconciler MUST call `seedSystemAccounts(db, userId)` (`post-entry.ts` line 126) idempotently before iterating that user's transactions. `seedSystemAccounts` is select-then-insert and tolerates concurrent races via the unique partial index.

**Could any user lack system accounts?** Yes — all pre-PR-A users. This is not a blocker (seeding is idempotent), but the reconciler must seed-first, every run, per user.

## Summary — facts the coordinator needs

1. **Best hook point:** `apps/api/src/jobs/index.ts` after line 402 (after `snapshotAllUsers` boot catch-up) — it's the established boot-catch-up pattern, runs before `app.listen`, is `.catch()`-guarded, and is logically grouped with other maintenance steps in `startJobs`.

2. **Compare-first diff: YES, feasible.** All 4 builder functions are exported from `postings.ts`; `rebuildPostingsForTransaction` (transactions.ts:198) is exported; the `postings` table is queryable by `transactionId` (ledger.ts:149). What's needed: extract the draft-building branch from `rebuildPostingsForTransaction` into a reusable sub-step, query stored rows, set-compare `{accountId, amountPaise, categoryId, necessity, note}`, call `replacePostings` only on mismatch. No new exports needed.

3. **Users/transactions batch-iteration pattern:** `db.select({ id: users.id }).from(users)` → for-loop with per-user try/catch (networth.ts:191–217, autopilot.ts:136/230). Per-user transactions: `db.select({ id: transactions.id }).from(transactions).where(eq(transactions.userId, u.id))` with NO `isNull(deletedAt)` filter.

4. **Blockers/ambiguities:**
   - None fundamental. One ordering constraint: `seedSystemAccounts(db, userId)` must precede per-user transaction iteration or `resolveSystemAccounts` will throw for pre-PR-A users.
   - `replacePostings` does ownership re-verification on every call (assertOwnedAccount/assertOwnedCategory per draft — post-entry.ts lines 55–57). On a large dataset this may be slow. For the backfill context the ownership is guaranteed (we fetched the transaction by userId), so a compare-first skip saves those queries for already-correct rows.
   - The `postings` table has no unique constraint per `(transactionId, accountId)` — a bug that inserts duplicates would be silently accepted. The compare-first diff must compare multi-row sets, not individual rows.
