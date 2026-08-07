# Backend-engineer Delegation — A6 (backup/restore posting round-trip)

## Task
021-postings-model, dual-write PR-A, slice A6. Design 1b (postings are DERIVED shadow data;
per-user restore skips archived posting rows and re-synthesizes them post-commit).
Approved plan: tasks/021-postings-model/PLAN-A6.md (read it — it is authoritative).

## Iteration
backend-11.md (first A6 implementation pass).

## Files and Symbols (in scope)
- apps/api/src/modules/system/services/backup.ts — `ALL_TABLES`, `LINKED_TABLES`.
- apps/api/src/modules/system/services/restore-user.ts — `MUST_BE_EMPTY` guards, new shared
  `countBlockingRows` helper, the insert loop, `restoreUserBackup` signature + control flow,
  `RestoreSummary`.
- apps/api/src/modules/system/routes/backup.ts — optional failure logging only.
- apps/api/src/modules/system/services/backup.test.ts — new/updated assertions + DB tests.
- apps/api/src/db/restore.ts — NO code change (shared ALL_TABLES ordering suffices); the mocked
  restoreDump test lives in backup.test.ts.

## Required Changes (see PLAN-A6.md §§1–6 for full rationale)
1. backup.ts: add `"postings"` to `ALL_TABLES` immediately after `"transactions"`; add
   `postings: { fk: "transaction_id", parent: "transactions" }` to `LINKED_TABLES`. Do NOT add
   to `USER_TABLES`. Update the ALL_TABLES comment to explain postings placement.
2. restore-user.ts fresh-guard: extract `countBlockingRows(q, table, userId)` issuing
   `select count(*)::bigint from <ident(table)> where user_id = $1` plus `and system_kind is null`
   IFF `table === "accounts"`. Use it in BOTH the pre-check (on pool) and in-tx re-check (on client).
3. restore-user.ts insert loop: `if (table === "postings") continue;` placed BEFORE the
   row-count/tableCount bump (so summary counts only rows actually restored).
4. restore-user.ts post-commit reconcile with INJECTABLE seam + exact control flow (PLAN §4,
   review-15 §B): add param `reconcile = (pool, userId) => reconcileUserPostings(createDb(pool),
   userId)`. Capture `summary` after commit (no early return); after the inner tx try/catch/finally,
   the outer blob-cleanup catch, and `archive.close()` finally ALL complete, call
   `await reconcile(pool, userId)` in its OWN try/catch: success → `summary.postings = { repaired,
   failed: failures.length }`; throw → `summary.postings = { repaired: 0, failed: 1 }` (NO rollback,
   NO blob delete). Add `postings?: { repaired: number; failed: number }` to `RestoreSummary`.
   Import `createDb` from ../../../db/index.ts and `reconcileUserPostings` from
   ../../ledger/services/reconcile-postings.ts.
5. routes/backup.ts: OPTIONAL — log app.log.error when `summary.postings?.failed` > 0 (mirroring
   the boot-reconcile "PR-B gate NOT satisfied" log). Not gated by an AC.
6. backup.test.ts: FK-order assertions (accounts/categories/transactions < postings); extend the
   mocked restoreDump query-recording test with a posting row (insert after parents; all columns
   verbatim, none deferred/omitted); DB-backed tests AC2, AC3+AC4 (ONE archive covering ordinary/
   split/transfer/opening/soft-deleted, both old-style and new-style archives), AC5 negative
   (foreign-ref archived posting skipped) and AC5 post-commit-throw via the injectable seam.

## Must Not Change
- No reader/DTO/hydrate change; no packages/shared; no web; no ledger schema. Readers stay
  legacy-derived. postings stays shadow data.
- Do NOT add postings to USER_TABLES. Do NOT remap posting.account_id (Design 2 rejected).
- Do NOT change the delete loop. Do NOT insert archived posting rows in per-user restore.
- Do NOT change whole-DB restoreDump's all-tables-present contract or the envelope version.
- Node native TS: relative imports MUST include the `.ts` extension. Money is integer paise.

## Acceptance Criteria
AC1–AC7 exactly as in PLAN-A6.md.

## Commands (run and capture literal output + exit codes)
1. `npm run typecheck -w apps/api`
2. `npm run lint`
3. `node --test apps/api/src/modules/system/services/backup.test.ts`
4. `node --test apps/api/src/modules/ledger/services/postings.test.ts`

## Required Evidence
- files changed; complete diff; commands + literal output; exit codes; test pass/fail counts;
  any plan deviation or blocker (a material design change returns to plan review — do NOT
  silently deviate).

---

## Iteration 2 — backend-12.md (fix: guard over-broadened + regression test gap)

### Defect found by coordinator (reading restore-user.ts + auth.ts myself)
backend-11 SILENTLY DEVIATED from the approved plan: instead of keeping the narrow
`MUST_BE_EMPTY = [accounts, transactions, insurance_policies, goals, holdings]` guard and only
adding the `system_kind is null` filter for accounts (PLAN §2), it REPLACED the guard with a
scan of EVERY `USER_TABLES` table (restore-user.ts:96–102 pre-check and :122–128 in-tx).
Registration seeds default CATEGORIES (auth.ts:45 `seedDefaultCategories`) into `categories`
(a USER_TABLES table) plus system accounts (auth.ts:46). The over-broad guard therefore counts
the seeded default categories → `categories` count > 0 → throws 409 → **restore is rejected for
EVERY freshly-registered production user.** BLOCKING production regression.
Tests passed only because the AC2 test (backup.test.ts:559) seeds ONLY `seedSystemAccounts` on
the fresh dest, never `seedDefaultCategories` — so the guard never trips in the test.

### Required fix
1. restore-user.ts: reinstate the narrow guard. Re-add
   `const MUST_BE_EMPTY = ["accounts", "transactions", "insurance_policies", "goals", "holdings"] as const;`
   and make BOTH the pre-check and the in-tx re-check iterate `MUST_BE_EMPTY` (NOT
   `restorableTables()`/all USER_TABLES), each calling the existing `countBlockingRows(q, table,
   userId)` helper (which keeps the `system_kind is null` filter for accounts). Everything else
   in restore-user.ts stays as-is.
2. backup.test.ts AC2 (the test that should have caught this): on the fresh dest user, seed BOTH
   `seedDefaultCategories(db, destFresh)` AND `seedSystemAccounts(db, destFresh)` (mirroring real
   registration), and assert restore STILL succeeds (rows committed). Keep the real-non-system-
   account → 409 assertion. Import `seedDefaultCategories` from `../../ledger/services/categories.ts`.

### Must not change
- Do NOT touch the postings skip, the countBlockingRows helper body (system_kind filter stays),
  the injectable reconcile seam, the post-commit control flow, backup.ts, or routes/backup.ts.

### Commands / evidence: same as Iteration 1.

---

## Iteration 3 — backend-13.md (TEST-ONLY: close review-16 blocking gaps B1–B5)

review-16 confirmed the PRODUCTION code is sound (no code change needed). The ONLY blockers are 5
acceptance-test gaps in `apps/api/src/modules/system/services/backup.test.ts`. This iteration is
TEST-ONLY: **do NOT modify any non-test file** (backup.ts, restore-user.ts, routes/backup.ts,
reconcile-postings.ts, transactions.ts, db/restore.ts, schema — all frozen). If you believe a
production change is required, STOP and report a plan deviation instead of making it.

### Setup (required so DB-backed tests actually run)
- First run `npm run db:migrate` from repo root to apply migration 0067 (adds `postings` table +
  `accounts.system_kind`). Capture its literal output + exit code. If it errors, report and stop.
- Report the DATABASE_URL HOST ONLY (mask credentials) so we know which DB was migrated.

### Required test changes (all in backup.test.ts)

B1 (AC3 — OLD-style archive branch, currently MISSING). Add a NEW test that restores a
hand-built OLD-style `ArchiveHeader` (like the AC5 foreign test constructs one): representative
shapes present (ordinary + split + transfer pair + opening + soft-deleted), but
`header.tables.postings = []` AND NO system-account rows in `header.tables.accounts` (only the real
bank/wallet accounts). Restore into a dest that has `seedSystemAccounts(db, dest)`. Assert postings
are synthesized (repaired>0, failed==0), every txn's legs zero-sum, and
`findInconsistentPostings(db, dest) == []`. This proves the synth-from-legacy branch when the
archive carries no postings.

B2 (AC3/AC4 — CONCRETE per-shape legs, break common-mode). In BOTH the existing AC3+AC4 test and
the new B1 test, add explicit assertions of the EXACT leg multiset per shape, using LITERAL
hardcoded expected values (do NOT compute expectations via computePostingDraftsForTransaction or
the build*Postings helpers — that is the common-mode we must avoid). Resolve the dest system
accounts by querying `accounts` where `user_id = dest and system_kind = '<kind>'`. Expected legs
(double-entry, integer paise, must sum to 0 per txn):
  - Ordinary expense (amount −5000, account=bank, category=food): exactly 2 legs —
    { account_id: bank, amount_paise: −5000 } and { account_id: <system expenses>, amount_paise: +5000 }.
  - Split (amount −10000, account=bank; splits food −6000, transport −4000): exactly 3 legs —
    { bank, −10000 }, { <system expenses>, +6000 }, { <system expenses>, +4000 }.
  - Transfer OUT leg (amount −20000, account=bank): exactly 2 legs —
    { bank, −20000 } and { <system clearing>, +20000 }. Transfer IN leg (amount +20000,
    account=wallet): { wallet, +20000 } and { <system clearing>, −20000 }.
  - Opening (amount +100000, account=bank, isOpening): exactly 2 legs —
    { bank, +100000 } and { <system opening>, −100000 }.
  Assert by account_id + amount_paise multiset (order-independent). Do NOT assert id/created_at.
  If any actual leg's account_id/amount does not match these literals, report it as a plan
  deviation/finding — do NOT rewrite the expected literals to match the code.

B3 (AC6 — mocked whole-DB verbatim, all columns). In the existing mocked `restoreDump`
query-recording test, replace the `.includes()` param checks with an ORDERED column→value
correspondence assertion for the postings insert: parse the column order from the recorded
`insert into "postings" (...)` SQL, map each column to its positional param, and assert the
resulting object deep-equals the fixture `dump.postings[0]` for ALL 8 columns — id,
transaction_id, account_id, category_id (null), amount_paise, necessity (null), note (""),
created_at. This proves none are dropped, deferred, reordered, or value-swapped.

B4 (AC5 — foreign category too). In the foreign-account archived-posting test, ALSO give the
archived posting a foreign NON-NULL `category_id` (a randomUUID not in the archive). Assert the
dest ends with only reconcile-derived postings and NONE reference the foreign category_id (nor the
foreign account_id). Proves the whole archived posting shape is discarded regardless of field.

B5 (§5 / review-15 §C — skipped postings excluded from summary counts). Add assertions that
`summary.rows` and `summary.tables` do NOT count the discarded archived posting rows. Easiest: in
the new B1 test OR a dedicated test, build the archive with a KNOWN count of archived posting rows
P (>0) alongside R non-posting rows; assert `summary.rows === R` (postings excluded) and that the
number of tables reflected in `summary.tables` does not include `postings`. (Note the summary is
computed pre-reconcile; the reconcile-synthesized count is reported separately in
`summary.postings.repaired`.)

### Must not change
- No production/source file edits (test file only). No new production behavior.
- Do NOT weaken/delete existing assertions; only add/strengthen. Keep existing AC2/AC3/AC4/AC5
  tests passing.
- Node native TS: `.ts` import extensions. Money is integer paise.

### Commands (capture literal output + exit codes)
1. `npm run db:migrate`  (setup; report host-masked DATABASE_URL)
2. `npm run typecheck -w apps/api`
3. `npm run lint`
4. `node --test apps/api/src/modules/system/services/backup.test.ts`  (must show all tests PASS)
5. `node --test apps/api/src/modules/ledger/services/postings.test.ts`

### Required evidence
- complete diff (test file only); every command + literal output + exit code; test pass/fail
  counts; the migrate output; any plan deviation/finding (do NOT silently deviate).

---

## Iteration 4 — B5 vacuity fix (coordinator-caught, TEST-ONLY)

Coordinator finding: backend-13 placed the ONLY B5 assertion (`summary.rows === nonPostingRows`,
`summary.tables === nonPostingTables`) inside the OLD-style test where `header.tables.postings = []`
(P=0). With zero archived posting rows to discard, that assertion is VACUOUS — it passes whether or
not the posting-skip logic works, so B5 (archived postings excluded from summary counts) is NOT
genuinely proven. B5 needs an archive with P>0 archived posting rows.

### Required fix (test-only, backup.test.ts)
- In the existing "A6 AC5: a posting with a foreign account_id is skipped" test (currently discards
  the return at the `await restoreUserBackup(...)` call), CAPTURE the returned summary and add:
  - `assert.equal(summary.rows, 2, ...)` — the archive has accounts=1 + transactions=1 = 2
    non-posting rows; the 1 archived posting row MUST be excluded (P=1>0, so this is non-vacuous).
  - assert `summary.tables` equals the number of non-posting tables with rows (accounts +
    transactions = 2), i.e. the postings table is NOT counted.
  - Compute the expected non-posting row/table counts from `header.tables` the same way the OLD-style
    test does (filter out `postings`), rather than hardcoding, so it stays correct if the fixture
    changes — but the point is P=1>0 here.
- Do NOT remove the existing (vacuous-but-harmless) B5 assertion in the OLD-style test; the new
  P>0 assertion is what makes B5 non-vacuous. Do NOT weaken any other assertion. Test-only; no
  production change.

### Commands / evidence: same as Iteration 3 (typecheck, lint, backup.test.ts, postings.test.ts).
