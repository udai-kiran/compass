# PLAN-A6 — backup/restore posting round-trip (dual-write PR-A, slice A6)

## Status
COMPLETE ✓ — 2026-08-06. Design 1b fully implemented, reviewed, and proven green.
Migration 0067 applied; backup.test.ts 19/19 pass, postings.test.ts 20/20 pass, typecheck clean.
review-16 approved production code; review-17 approved B1–B5 test closure. All ACs proven.

### review-17 disposition (test-only follow-up review, validated by coordinator against source)
APPROVED / NON-BLOCKING. B1–B5 all genuinely CLOSED and non-vacuous (I re-read each cite):
- B1 OLD-style archive test (backup.test.ts:870): postings=[], no system-account rows, all 5
  shapes; asserts synth repaired>0/failed==0, zero-sum, findInconsistentPostings==[].
- B2 concrete per-shape leg multisets with LITERAL {account_id,amount_paise} resolved by
  system_kind, in BOTH AC3+AC4 (797-851) and OLD-style (997-1051); no computePostingDrafts/
  build*Postings used → common-mode broken; literals are correct double-entry paise.
- B3 mocked restoreDump (244-265): parses SQL column order + deep-equals column→value map for
  all 8 columns incl category_id(null)/necessity(null)/created_at.
- B4 foreign AC5 (1111-1160): foreign account_id AND foreign non-null category_id, both asserted
  never referenced.
- B5 NON-VACUOUS via foreign AC5 (P=1): summary.rows===2, summary.tables===2 with the 1 archived
  posting excluded (1126-1170). The OLD-style P=0 B5 assertion is retained but harmless/vacuous;
  the P=1 site is decisive.
No existing assertion weakened/deleted (only import-reformat lines removed). Test-only; money
integer paise throughout.

### OPEN PRECONDITION (not a code defect) — DB migration 0067 state
The DB-backed tests (AC11, misc-05 ×2, all A6 DB tests) require migration 0067 (postings table +
accounts.system_kind) applied to whatever DATABASE_URL the test process uses. EVIDENCE CONFLICT:
the two implementer runs reported `npm run db:migrate` exit 0 (host 192.168.2.196) + backup.test.ts
19 pass/0 fail; a later INDEPENDENT verifier saw 8 fails, all `relation "postings" does not exist`
/ `column "system_kind" does not exist` (0067 not applied to ITS DB). Codex could not run either
(no DATABASE_URL). => This is an environment/migration-state inconsistency, NOT a code defect:
every failure is pure schema-not-migrated. A6 is code-complete + review-approved; the DB-backed
GREEN proof is deferred to CONVERGE (live `npm run db:migrate` against the canonical DB, then
re-run) so all runners agree. Do NOT mark A6 COMPLETE until one env shows db:migrate applied +
backup.test.ts fully green under independent verification.

### review-16 disposition (impl review of backend-11/12) — B1–B5 gaps NOW CLOSED (see above)

### review-16 disposition (impl review, validated by coordinator against source)
PRODUCTION CODE IS SOUND — review-16 §1–§10 all PASS (registration, narrow freshness guard via
shared countBlockingRows, posting-skip trust boundary before counts, post-commit reconcile
control flow outside all cleanup scopes, injectable seam default, reconcile tenant-safety,
whole-DB restore verbatim, no PR-A guardrail violation). BLOCKING only on 5 TEST-coverage gaps,
each tracing to an explicit plan/AC requirement (I re-read the cited test lines to confirm):
- B1 (AC3): no OLD-style archive branch. The AC3+AC4 test builds via buildUserBackupStream AFTER
  source reconcile (backup.test.ts:717,739) → NEW-style only (postings + source system accounts
  present). Need an archive with postings=[] AND no system-account rows → proves synth branch.
- B2 (AC3/AC4): only repaired>0/ids-not-reused/zero-sum/findInconsistentPostings==[] asserted;
  no CONCRETE per-shape (account,amount,category) legs → common-mode with findInconsistentPostings
  (both use computePostingDraftsForTransaction). Must assert hardcoded expected legs.
- B3 (AC6): mocked test (backup.test.ts:251-256) asserts only id/transaction_id/account_id/
  amount_paise/note via .includes(); omits category_id/necessity/created_at + no ordered
  column→value correspondence.
- B4 (AC5): foreign-posting test (backup.test.ts:851-862) has foreign account_id but
  category_id:null; add a foreign NON-NULL category_id, prove also skipped.
- B5 (§5/review-15 §C): no test asserts archived postings excluded from summary.rows/tables.
Also: DB-backed tests fail in some envs solely because migration 0067 (postings + accounts.
system_kind) is not applied — a DB-state condition, NOT a code defect. Must apply db:migrate and
see literal green before COMPLETE.

## Objective
`postings` participates correctly in both backup paths and both restore paths,
so a user's (or the whole DB's) posting mirror survives a backup→restore cycle
and remains consistent with the legacy ledger. Additive, PR-A: no reader/DTO/
schema/shared/web change; readers stay legacy-derived.

## Decisive verified facts (read in source this session)

- `postings` (db/shared/ledger.ts:132): columns `id, transaction_id (FK→transactions,
  onDelete cascade), account_id (FK→accounts, NOT NULL), category_id (FK→categories,
  nullable), amount_paise, necessity (nullable), note (NOT NULL default ''), created_at`.
  **No `user_id`** → it is a LINKED table, scoped through `transaction_id → transactions`.
- `accounts` (db/shared/hubs.ts:65): `system_kind` (enum, nullable) with partial-unique
  `accounts_system_kind_idx` on `(user_id, system_kind) where system_kind is not null`.
  System accounts carry `type="system"`, `system_kind∈{expenses,income,opening,clearing}`.
- backup.test.ts gating assertions:
  - :38 every schema table must be in `ALL_TABLES`.
  - :47 `sips` before `holding_events`.
  - :55 `exportGaps()` must be `[]` (every table in USER_TABLES or LINKED_TABLES or `users`).
  - :58 no table in BOTH USER_TABLES and LINKED_TABLES.
  - :105 `restorableTables()` == USER_TABLES∪LINKED_TABLES, with FK-order spot-checks.
- backup.ts `ALL_TABLES` (:28) is the SINGLE ordering, shared by db/restore.ts (:67)
  and restore-user.ts (`restorableTables`). `dumpUserTable` (:92) joins a LINKED table
  to its parent and filters `p.user_id = userId`.
- restore-user.ts:
  - `MUST_BE_EMPTY` (:14) = accounts, transactions, insurance_policies, goals, holdings.
    Guard query (:69, :96) is `count(*) where user_id = $1` — **no system_kind filter**.
    Registration seeds 4 system accounts, so today this guard would reject EVERY restore
    once system accounts exist. **This is the one real pre-existing bug A6 must fix.**
  - `insertRow` (:28) inserts the row **verbatim including `id`** — restore PRESERVES
    primary keys. `user_id` is rewritten only when the table is in `USER_TABLES` (:122,125).
  - delete loop (:107) deletes every `USER_TABLES` table `where user_id=$1` (incl. system
    accounts, since `accounts` is in USER_TABLES). LINKED tables (incl. postings) are NOT
    deleted — harmless because the fresh-guard proves the account has no real data (and a
    txn-free fresh account has no postings; postings FK is `onDelete cascade` anyway).
  - old-vs-new archive discriminator: `if (!Array.isArray(rows)) continue;` (:120) — an
    older archive lacking a table is skipped.
  - restore runs on a raw `pg.PoolClient` in one `begin…commit` (:93–:151); a Drizzle `Db`
    on its own pool connections would NOT see uncommitted rows → **reconcile must run AFTER
    commit** (investigation-3 conclusion).
- restore-user.ts route call (routes/backup.ts:97): `restoreUserBackup(app.pg, app.storage,
  userId, plaintextPath)`. Test callers (backup.test.ts:360,418,462) pass `(pool, stubStorage,
  destUserId, path)`. No `Db`/logger currently passed.
- Reconcile primitives (reconcile-postings.ts): `reconcileUserPostings(db, userId)` SEEDS
  system accounts (idempotent), resolves once, then per-txn compare-first replace inside a
  per-row `db.transaction`; returns `{checked, repaired, failures[]}`. `computePostingDrafts…`
  returns `null` for a missing/rowless txn. `findInconsistentPostings` NEVER seeds/writes.
- db/restore.ts `restoreDump` (:67) iterates `ALL_TABLES`, `throw`s if `dump[table]` absent
  (hard-requires every table — same-version whole-DB contract; NOT the per-user lenient path).

## Design decision — Design 1b (postings are DERIVED: per-user restore skips archived posting rows and re-synthesizes them post-commit)

`postings` is shadow/derived data (readers are legacy-derived in PR-A). The cleanest, most
secure model is: **per-user restore does NOT trust archived posting rows** — it skips inserting
them and lets the post-commit `reconcileUserPostings` re-derive every posting from the restored
legacy rows (which are D-owned after the `user_id` rewrite). This unifies old- and new-archive
handling (both synthesize), needs no id remap, and closes the archive-trust gap (review-14 §1C):
a hand-crafted archive can no longer inject a posting shape, because no archived posting shape
is ever inserted in the per-user path. Restore already PRESERVES ids (`insertRow` inserts `id`
verbatim) and backs up all accounts incl. system, so archived accounts/transactions round-trip
with original ids and the synthesized postings reference D's own (restored) accounts.

1. **backup.ts registration**
   - `ALL_TABLES`: insert `"postings"` immediately after `"transactions"` (after accounts/
     categories/transactions, all of which it FKs; before user_tasks — no dependency).
   - `LINKED_TABLES`: add `postings: { fk: "transaction_id", parent: "transactions" }`.
   - Keep `postings` OUT of `USER_TABLES` (no user_id column). `exportGaps()` stays `[]`;
     no double-scope. postings is still EXPORTED (dumpUserTable LINKED join scopes by
     transaction owner) — export is unchanged; only per-user RE-INSERT is skipped.

2. **restore-user.ts — fresh-guard fix via a SHARED helper (review-14 §2A/2B; review-15 §E.6)**
   - Extract one helper both call sites use, so the two predicates CANNOT drift:
     `async function countBlockingRows(q: pg.PoolClient | pg.Pool, table: string, userId: string)`
     issuing `select count(*)::bigint from <ident(table)> where user_id = $1` plus
     `and system_kind is null` **iff** `table === "accounts"`. The pre-check (:69, on `pool`)
     and the in-tx re-check (:96, on `client`) both call it. This structurally guarantees
     identical predicates (satisfies review-15 §E.6 without a separate query-recording test,
     though a focused unit test on the helper is welcome).
   - This is the only *immediate* blocker for a fresh registered destination. It does NOT
     claim to be the only way restore can fail — global-id collisions (restore is recovery/
     migration, not same-DB cloning) and the pre-existing non-locking guard concurrency
     window remain, both out of scope (review-14 §1B/§2C).

3. **restore-user.ts — skip archived postings on insert (review-14 §1C/§9B)**
   - In the insert loop (:118), `if (table === "postings") continue;` — never raw-insert an
     archived posting row. (postings has no DEFERRED columns, so the second pass is unaffected.)
   - This applies to BOTH old archives (already skipped via `!Array.isArray`) and new archives
     (now skipped explicitly) — one code path. Archived system accounts ARE still reinserted
     verbatim (they are proper `type="system"` rows), so reconcile's system-account resolution
     finds them; for old archives lacking them, reconcile seeds fresh ones.

4. **restore-user.ts — post-commit reconcile, placed OUTSIDE all failure-cleanup scopes, via an INJECTABLE seam (review-14 §3B/§3C/§3D; review-15 §B/§E.1)**
   - Add an injectable last parameter with a production default:
     `reconcile: (pool: pg.Pool, userId: string) => Promise<{ repaired: number; failures: unknown[] }>
     = (pool, userId) => reconcileUserPostings(createDb(pool), userId)`.
     Tests pass a stub that THROWS to deterministically exercise the post-commit failure
     boundary (review-15 §E.1) without needing a real DB fault. The route keeps the default.
   - Control flow MUST match review-15 §B exactly: capture `let summary` inside the inner tx
     block AFTER `commit` (do NOT `return` there); let the inner
     `try/catch(rollback)/finally(release)` complete; let the OUTER blob-cleanup `catch` and the
     `archive.close()` `finally` complete; ONLY THEN, outside all three scopes, call
     `await reconcile(pool, userId)` inside its OWN `try/catch`. A throw here (incl. a top-level
     `seedSystemAccounts` throw, §3D) is caught and recorded as `postings = { repaired: 0,
     failed: 1 }` — it must NEVER issue rollback or delete uploaded blobs (restore already
     committed). Otherwise `postings = { repaired, failed: failures.length }`.
   - Best-effort but AWAITED (not fire-and-forget) so the returned summary is accurate.
   - `RestoreSummary` gains `postings?: { repaired: number; failed: number }` (optional →
     tests not asserting summary shape are unaffected).
   - **Route logging is an implementation detail, NOT an AC** (review-15 §E.5): routes/backup.ts
     MAY log `app.log.error` when `summary.postings.failed > 0` (mirroring the boot-reconcile
     "PR-B gate NOT satisfied" log), but the *contract* A6 gates is that failures are SURFACED
     on `RestoreSummary.postings.failed` — which is asserted at the service level.
   - Imports added to restore-user.ts: `createDb` from `../../../db/index.ts`,
     `reconcileUserPostings` from `../../ledger/services/reconcile-postings.ts`. `createDb(pool)`
     only wraps the existing pool (no new PG pool; no connection exhaustion — review-14 §3A).

5. **db/restore.ts (whole-DB restore) — verbatim, no code change beyond shared ordering**
   - The generic ALL_TABLES loop inserts postings after accounts/categories/transactions
     (all present first pass; postings has no deferred/omitted columns). Whole-DB restore is an
     all-or-nothing SAME-VERSION clone (every user, every account incl. system, every posting
     verbatim), so it does NOT have the per-user cross-tenant concern and needs no reconcile.
   - **Compat note (review-14 §7):** adding postings to ALL_TABLES makes previously generated
     whole-DB **version-1** backups fail (`throw "Backup is missing table postings"`) against
     new code, despite the unchanged envelope `version: 1`. This is a real backward-compat
     regression, ACCEPTED because whole-DB restore is intentionally coupled to the exact
     schema/app version (restore runs matching code pre-migration); a format-version bump or
     optional-empty handling is a separate future change, out of scope here.

   - **Summary semantics (review-15 §C):** put `if (table === "postings") continue;` BEFORE
     the row-count/`tableCount` bump, so the returned `rows`/`tables` reflect rows ACTUALLY
     restored (archived postings are deliberately discarded, not counted). Assert this in a test.

5b. **db/restore.ts empty-target wording (review-15 §D, non-blocking):** `restoreDump` only
   proves `users` is empty, not every table. "Empty migrated database" stays an operational
   precondition, not something restoreDump comprehensively verifies. Documented; no code change.

6. **backup.test.ts (review-15 §E — the remaining gate)**
   - Adding postings makes the currently-failing coverage assertions (:38 schema coverage,
     :55 exportGaps, :58 double-scope, :105 restorableTables set) PASS.
   - Add FK-order spot-checks near :122: `at("accounts") < at("postings")`,
     `at("categories") < at("postings")` (review-14 §9D), `at("transactions") < at("postings")`.
   - **AC6 whole-DB verbatim (review-15 §E.4):** extend the existing mocked `restoreDump`
     query-recording test (:146) with ONE posting row in the dump; assert (a) the posting
     INSERT is recorded AFTER the account/category/transaction inserts, and (b) every posting
     column — `id, transaction_id, account_id, category_id (nullable), amount_paise, necessity,
     note, created_at` — is passed through unchanged, none deferred/omitted. No live DB needed.
   - **DB-backed tests** (mirror the misc-05 disposable-user + `t.after` cleanup pattern):
     - **AC2:** a freshly-registered dest user (with 4 seeded system accounts) is restorable
       (guard passes); a dest user with a real (non-system) account is rejected (409).
     - **AC3+AC4 representative shapes (review-15 §E.2/§E.3):** ONE source archive exercising
       EVERY derivation branch Design 1b now depends on — ordinary, split, transfer-linked pair,
       opening-balance, AND a soft-deleted transaction. Cover both an OLD-style archive (no
       postings/system-account rows → synthesize) and a NEW-style archive (WITH archived
       postings → skipped, then synthesized). After restore assert: dest postings are the
       reconcile-synthesized set (archived posting rows NOT present verbatim), each set is
       zero-sum and matches the source-derived shape (account/amount), the soft-deleted txn also
       receives its synthesized postings, `findInconsistentPostings(db, dest)` == [], and
       `repaired > 0`. Assert SEMANTIC consistency + `repaired`, NOT verbatim id/created_at
       (review-14 §9C).
     - **AC5 / §9B negative:** archive whose posting references a FOREIGN account/category is
       harmless — that archived posting is skipped and never inserted; dest ends with only the
       reconcile-derived, D-owned postings. Asserts the trust boundary.
     - **AC5 post-commit-error (review-15 §E.1) — via the injectable seam:** call
       `restoreUserBackup(pool, storage, dest, path, /*reconcile*/ () => { throw new Error("boom") })`
       and prove: the call RETURNS a committed summary; the restored legacy rows remain committed
       (queryable); the uploaded blob storage objects remain (stub storage records no delete);
       no rollback-after-commit; and `summary.postings` == `{ repaired: 0, failed: 1 }`. This is
       the deterministic seam Codex required instead of an aspirational DB fault.

## Rejected alternatives
- **Design 2 (skip archived system accounts + `sysAccountMap` remap of posting.account_id):**
  rejected — restore preserves ids and backs up system accounts, so a remap is a no-op; its
  system-remap only exists to compensate for a self-imposed "don't reinsert system accounts"
  choice. Codex review-14 §9E concurs no mapping layer is warranted.
- **Design 1a (insert archived postings verbatim + reconcile validates as no-op):** rejected in
  favour of 1b — 1a would raw-insert user-uploaded posting shapes (review-14 §1C trust gap) and
  requires verbatim-id semantics; 1b treats postings as the derived data they are, is simpler
  (no old/new discriminator), and removes the trusted-archive posting surface entirely.

## Acceptance Criteria
- AC1: `postings` in `ALL_TABLES` (after transactions) and in `LINKED_TABLES`, NOT in
  `USER_TABLES`; backup.test.ts coverage/gaps/double-scope/restorableTables assertions pass;
  order assertions accounts/categories/transactions < postings pass.
- AC2: fresh-account guard ignores system accounts (`system_kind is null` for accounts) in
  BOTH the pre-check and the in-tx re-check (identical predicate); a freshly-registered account
  (4 seeded system accounts) is restorable; a real-data account is still rejected (409).
- AC3: OLD-archive per-user restore synthesizes zero-sum postings post-commit (system accounts
  seeded) for ordinary/split/transfer/opening/soft-deleted shapes; `findInconsistentPostings(db,
  dest)` == []. (For VALID application data coverage is complete; unrepairable legacy rows —
  e.g. a split whose splits don't sum — are surfaced as reconcile failures, not silently
  dropped, and this is the accepted best-effort PR-A model — review-15 §A.)
- AC4: NEW-archive per-user restore does NOT insert archived posting rows verbatim; postings are
  reconcile-synthesized, match the source-derived shape, and `findInconsistentPostings(db, dest)`
  == [] across all representative shapes.
- AC5: reconcile/seed failure post-commit does NOT roll back the restore or delete uploaded
  blobs; failures are SURFACED via `RestoreSummary.postings.failed` (the gated contract),
  awaited-not-detached, PR-A non-blocking; a deterministic injectable-reconcile-throw test
  proves committed rows+blobs survive. A foreign-account archived posting is never inserted.
  (Route logging is an incidental implementation detail, not gated — review-15 §E.5.)
- AC6: whole-DB `restoreDump` restores postings verbatim via the shared ALL_TABLES ordering
  (FK-valid); v1-backup compat regression documented and accepted.
- AC7: typecheck + lint clean; focused backup/restore + postings tests pass.

## Non-Goals
- No id remap (Design 2). No delete-loop change. No reader/DTO/schema/shared/web change.
- No A7 work (invariant/mutation/concurrency suites, linkTransfer lock-order, NB1/NB2).
- No change to whole-DB backup's same-version "all tables present" contract; the fresh-guard
  concurrency (non-locking count) window is pre-existing and out of scope.

## Verification
- T1: `npm run typecheck -w apps/api`
- T2: `npm run lint`
- T3: `node --test apps/api/src/modules/system/services/backup.test.ts`
- T4: focused postings/reconcile tests (reconcile-postings + postings + schema decomposition)
- T5: read-only inspection that no USER_TABLES entry gained postings and no reader changed.
