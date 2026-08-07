# Sonnet Worker Delegation — DUAL-WRITE PR-A

Base: branch `feat/postings-model-dualwrite` off `main` (HEAD e939100). Working tree clean vs main
for all source; `post-entry.ts` present (untracked) as REFERENCE only — it will be rewritten.
Governing plan: `PLAN-dualwrite.md` (status APPROVED FOR PR-A; review-7 verdict APPROVED-FOR-PR-A).

## PR-A objective (one green, releasable, ADDITIVE increment)
Add a dual-written `postings` mirror alongside the unchanged legacy single-entry model. NO reader is
converted; the served DTO is unchanged (still from legacy columns). Every legacy column is KEPT. By
end of PR-A: additive migration + 4 system accounts (incl Clearing) seeded per user + full dual-write
writer graph + backfill/full-shape reconciliation + per-transaction characterization invariant +
restore compatibility + `"system"` narrowing at generic account boundaries.

## MUST NOT CHANGE (PR-A guardrails)
- Do NOT drop or alter any legacy column: `accounts.opening_balance_paise`, `transactions.{account_id,
  amount_paise,category_id,necessity,is_opening}`, `transaction_splits`, `transfer_links` all stay.
- Do NOT change any READER/aggregation (`balances.ts`, `accounts.ts` balance formulas, `lib/periods.ts`,
  dashboards/reports/etc.) — readers convert in PR-B+.
- Do NOT change the shared DTO (`packages/shared/src/schemas/ledger.ts`): no removing
  `openingBalancePaise` from the response, no transfer-DTO reshape. Those are PR-G.
- Do NOT change web.
- `classifyShape`/`projectRealLeg`/`projectCounter`/`projectSplits` are reader-side — leave their
  behavior for PR-B (adding the `clearing` union member is fine; do not rewire callers).
- Legacy writers keep writing legacy EXACTLY as today; postings are written IN THE SAME outer DB
  transaction, additively.

## Mandatory tests folded in from Codex review-7 (each lands with its slice; all green by end of PR-A)
Reconciliation (A5/A7): ordinary txn with stale account/amount/category/necessity postings repaired;
ordinary↔split and ordinary↔linked-transfer transitions; auto-link invalidation + rollback-restored
rows; soft-deleted ordinary/split/opening/formerly-linked rows (reconciliation must INCLUDE
soft-deleted parents — do NOT limit source query to `deleted_at IS NULL`); unexpected extra &
duplicate postings pruned; a SECOND reconciliation run performs ZERO writes; gate refuses if any
malformed shape remains. Column-only openings produce NO posting during PR-A (must not be synthesized
just because the column is nonzero).
Restore (A6/A7): old archive (no `postings` key) with ordinary/split/opening-row/linked-transfer/
soft-deleted/column-opening accounts → postings synthesized before commit; old archive with explicit
empty `postings` array; new archive with valid postings + remapped system-account IDs; new archive
with stale/missing/duplicate/cross-user/wrong-system-kind postings → REJECTED before commit; restore
into a freshly-registered user whose 4 system accounts already exist (idempotent via upsert/
select-existing, NOT 4 unconditional inserts); failure after synthesis rolls back the whole restore.
Invariant (A7): per-transaction characterization over seeded + generated data per PLAN-dualwrite.md:26-35.
Security/tenant-scope (all slices): backfill/restore/writers use tenant-scoped joins across
transactions/real-accounts/system-accounts/categories; a new archive's `postings.account_id` must not
inject another user's account; simple transaction API REJECTS system-account IDs (ownership-only check
is insufficient); generic account queries filter `system_kind IS NULL` before casting DB enum → public
`AccountType`.

## Execution log
- A4 DISPATCH STATE (current): A3-fix (iter 10) IMPLEMENTED in the working tree (coordinator-confirmed in
  source: updateTransaction transfer-leg guard transactions.ts:419; setSplits parent `.for("update")` lock
  :486 + BigInt `sumPaise` :489; transfers.ts opening-leg reject :115, already-linked reject :125,
  `isSafeInteger` :194) but NOT yet independently verified or Codex-reviewed. A4a (iter 12, imports.ts) and
  A4b (iter 11, recurring/demo/categories) DISPATCHED IN PARALLEL via backend-engineer → backend-6.md /
  backend-7.md. All three own DISJOINT files; A4a/A4b only IMPORT the exported
  `rebuildPostingsForTransaction` (no collision with A3-fix). NEXT after both land: ONE combined A4-boundary
  independent verify (typecheck/pure-tests/file-set, separate worker) then Codex writer-graph review covering
  A3-fix + A4a + A4b, then A5 (backfill/reconciliation), A6 (restore compat), A7 (invariant + DB-backed tests).
  - A4a LANDED (backend-6.md, exit 0) + COORDINATOR-VALIDATED IN SOURCE (imports.ts read at all 4 sites):
    reconcile capture-before-delete :674 + union rebuild-after-delete :713; bulk-insert rebuild loop :758;
    rollback survivingPartners capture-before-delete :870 + union rebuild (partners+snapshots) :920;
    autoLinkTransfers unchanged post-commit :932. Self-reported typecheck 0 / postings 20 / decomposition 3
    (to be RE-PROVEN by the separate A4-boundary verifier, not trusted from the engineer's report).
  - A4b LANDED (backend-7.md, exit 0) + COORDINATOR-VALIDATED IN SOURCE: recurring.ts all 3 inserts
    (EMI source :288, EMI principal :309, generic :341) `.returning({id})` + rebuild loop, EMI = two ordinary
    families (no transfer, D21); demo.ts insert :216 `.returning` + rebuild loop :220; categories.ts
    mergeCategory collects affected ids (txns ∪ splits) BEFORE updates :158-169 + rebuild loop AFTER :188.
    Self-reported typecheck 0 / postings 20 / decomposition 3 (RE-PROVEN by the A4-boundary verifier).
  - A4 BOUNDARY GATE DISPATCHED: (1) independent verifier (verification-3.md) — typecheck/lint/pure-tests/
    file-set, separate worker; (2) Codex writer-graph review (review-10.md) over A3-fix + A4a + A4b.
  - A4-BOUNDARY VERIFIER (verification-3.md) CLEAN: typecheck 0, lint 0, postings 20/20, schema.decomposition
    3/3; NO reader/DTO/packages-shared/web file touched. Two flags, BOTH resolved as non-issues by coordinator:
    (a) epf-contributions.ts modified = the A1n narrowing site (assertPublicAccountType ~:21), pre-existing
    from A1n, not an A4 change — legitimate; (b) db/schema.ts zero diff from main = correct: postings is
    re-exported via the shared/ledger STAR export, so no barrel edit is needed (per TASK.md A1 note). Awaiting
    Codex review-10 (writer-graph) before closing the A4 boundary.
- A1 UNIT COMPLETE + Codex-cleared (review-8 blockers closed by Iteration 4). Migration 0067_illegal_
  shocker.sql (additive, zero DROP). typecheck -w apps/api = 0; root lint = 0; postings.test.ts 20/20;
  schema.decomposition.test.ts 3/3 (now 51 tables + 39 enums). Coordinator-validated in source. Live
  db:migrate + full DB-backed suite deferred to CONVERGE. NEXT: A2.

## Sub-slice roadmap (workers own non-overlapping files)
IMPORTANT CORRECTION (post-A1a): appending `"system"` to the `account_type` pgEnum is additive at the
DB level but WIDENS the Drizzle-inferred `accounts.type` union, breaking the public `AccountType` cast
at 8 consumer files. So schema + `"system"` narrowing are TYPE-COUPLED and cannot be green in isolation.
The FIRST green checkpoint is therefore `A1a + A1n + A1b` together (A1n and A1b touch disjoint files and
run in PARALLEL). `AC-A1a-1` (typecheck exit 0) is RE-ASSIGNED to that checkpoint, not to A1a alone —
A1a's own gate is only: additive-only migration + `db:generate` clean + exports-once (all met).
- A1a — additive schema + migration. DONE (0067_illegal_shocker.sql; validated additive, zero DROP).
- A1n — `"system"` narrowing to unbreak typecheck: add ONE narrowing helper
  `assertPublicAccountType(type): AccountType` (throws HttpError 500 on `"system"`) and apply it at all
  8 DB→public `AccountType` boundaries (accounts.ts toAccount + lines 357/365/414, bank-details.ts:29,
  emis.ts:206, overdraft-details.ts:24, sip-commitments.ts:89, sip-lifecycle.ts:139,
  epf-contributions.ts:21, retirement.ts:26); ALSO exclude system accounts (`system_kind IS NULL`) from
  the two GENERIC account queries in accounts.ts (`listAccounts`, `accountBalancesAtDate`). NO runtime
  guard/seed logic here.
- A1b — posting builders + writer primitive: `postings.ts` (add `"clearing"` to `SystemKind`; add a
  per-leg transfer builder `[real ±X] + [Clearing ∓X]` + test) and rewrite `post-entry.ts` to the
  dual-write primitive set (see Iteration 3): `replacePostings` takes an OUTER `Db|Tx` handle + `userId`
  + verifies txn/account/category ownership + asserts zero-sum, NO self-opened transaction; drop the
  header-creating `postEntry` (legacy owns header creation in dual-write); `seedSystemAccounts` seeds 4
  kinds incl `clearing` idempotently via select-existing-then-insert-missing; `resolveSystemAccounts`
  returns all 4; `updateTransactionHeader` stays header-only.
- A2 — seed wiring (registration/demo/restore) + edit/delete/archive guards + `assertOwnedRealAccount` +
  reject system IDs in simple API. (Runtime guards; ships before/with dual-write writers.)
- A3 — dual-write ledger writers: `transactions.ts`, `accounts.ts` (opening 3 paths), `transfers.ts`
  (Clearing legs, link/unlink/auto-link/suggest).
- A4 — dual-write ingest/other writers: `imports.ts`, `review-actions.ts`, `transfer-classification.ts`,
  `import-reconciliation.ts`, `recurring.ts` (EMI two families, NOT a transfer), `epf-contributions.ts`,
  `insurance.ts`, `categories.ts` (merge), `merchants.ts` (header-only), `reconciliation-writes.ts`
  (column-only drift), `sip-lifecycle.ts` (header-only audit). Move post-commit `autoLinkTransfers`
  (imports.ts:728-730, 858-860) so link mutation + posting replacement are atomic.
- A5 — backfill + idempotent full-shape reconciliation + gate; startup/maintenance hook.
- A6 — restore compat (`restore-user.ts` D19 remap + old-archive synthesis + new-archive validation),
  backup registration (`backup.ts` postings in `ALL_TABLES` after accounts+transactions + `LINKED_TABLES`;
  JSON archive round-trips posting rows), `db/restore.ts` ordering.
- A7 — per-transaction invariant test + the mandatory reconciliation/restore/mutation-graph tests.
- CONVERGE — `db:migrate` (live), `typecheck` (6 ws), `lint`, `test` (api) via a SEPARATE verifier;
  then Codex implementation review(s); then coordinator validation.

---

# Iteration 1 — Slice A1a: additive schema + migration

## Files and symbols (own ONLY these)
- `apps/api/src/db/shared/hubs.ts`
- `apps/api/src/db/shared/ledger.ts`
- `apps/api/src/modules/ledger/schema.ts`
- `apps/api/src/db/schema.ts` (barrel)
- generated: `apps/api/drizzle/0067_*.sql` + `apps/api/drizzle/meta/0067_snapshot.json` + `meta/_journal.json`

## Required changes (ADDITIVE ONLY — keep every existing column/enum value/index)
1. `hubs.ts`:
   - Append `"system"` as a NEW value at the END of the `account_type` pgEnum (Postgres cannot reorder;
     append only — do NOT remove `insurance`).
   - Add `export const accountSystemKind = pgEnum("account_system_kind", ["expenses","income","opening","clearing"]);`
     (NOTE the 4th value `clearing` — differs from the abandoned atomic version which had only 3).
   - Add nullable column to `accounts`: `systemKind: accountSystemKind("system_kind")` (no default, nullable).
   - Add a UNIQUE PARTIAL index in the `accounts` index list:
     `uniqueIndex("accounts_system_kind_idx").on(t.userId, t.systemKind).where(sql`system_kind is not null`)`.
   - KEEP `openingBalancePaise` and every other column/index exactly as-is.
2. `ledger.ts`:
   - Add a `postings` pgTable BESIDE `transactions` (same file). Columns: `id` uuid pk defaultRandom;
     `transactionId` uuid notNull references `transactions.id` `onDelete: "cascade"`; `accountId` uuid
     notNull references `accounts.id`; `categoryId` uuid references `categories.id` (nullable);
     `amountPaise` bigint({mode:"number"}) notNull; `necessity` expenseNecessity("necessity") (nullable);
     `note` text notNull default `''`; `createdAt` timestamptz notNull defaultNow.
   - Indexes: `postings_tx_idx` on (transactionId); `postings_account_idx` on (accountId);
     `postings_category_idx` on (categoryId).
   - KEEP all `transactions` columns (accountId/amountPaise/categoryId/necessity/isOpening) and indexes.
3. `modules/ledger/schema.ts`: add `postings` to this module's re-export surface, following the EXISTING
   re-export pattern in that file (read it first). It must NOT redefine `postings` (that lives in
   `db/shared/ledger.ts`); it re-exports the shared table like the other resident/shared tables.
4. `db/schema.ts` barrel: ensure `postings` is exported EXACTLY ONCE (the barrel must re-export every
   table+enum exactly once and remain the single Drizzle Kit entry point). Verify no duplicate-export
   TS error. Also ensure the new `account_system_kind` enum is exported once.
5. Generate the migration: run `npm run db:generate`. It MUST produce exactly ONE new `0067_*` migration
   whose SQL is PURELY ADDITIVE: CREATE TYPE account_system_kind; ALTER TYPE account_type ADD VALUE
   'system'; CREATE TABLE postings (+ 3 FKs + 3 indexes); ALTER TABLE accounts ADD COLUMN system_kind;
   CREATE UNIQUE INDEX accounts_system_kind_idx ... WHERE system_kind is not null. There must be ZERO
   `DROP COLUMN` / `DROP TABLE` / `DROP CONSTRAINT` / `DROP INDEX` statements. If ANY DROP appears, STOP
   and report — do not hand-edit the migration; the schema still contains a subtractive change.

## Acceptance criteria (A1a)
- AC-A1a-1: schema compiles; `npm run typecheck -w apps/api` exit 0.
- AC-A1a-2: `npm run db:generate` yields exactly one new `0067_*.sql` that is purely additive (no DROP of
  any kind), plus its snapshot + `_journal.json` update.
- AC-A1a-3: barrel exports `postings` and `account_system_kind` exactly once (no duplicate-symbol error).
- AC-A1a-4: no legacy column/enum value/index removed anywhere (`git diff main -- apps/api/src/db` shows
  only additions in the schema files).
- Do NOT run `db:migrate` in this slice (convergence step runs it against the live DB later).

## Commands
1. Read `modules/ledger/schema.ts` and `db/schema.ts` first to match the existing re-export/barrel pattern.
2. Make the edits above.
3. `npm run db:generate`
4. `npm run typecheck -w apps/api`
5. `git status --porcelain` and `git diff --stat main -- apps/api/src/db`

## Required evidence (report literally)
- Files changed + the COMPLETE diff of the three schema files + the FULL generated `0067_*.sql` verbatim.
- The literal output + exit code of `db:generate` and `typecheck -w apps/api`.
- Explicit confirmation: zero DROP statements in the generated SQL; `postings`/`account_system_kind`
  each exported once; no legacy column removed.
- Any deviation or blocker.

---

# Iteration 2 — Slice A1n: `"system"` narrowing (unbreak typecheck)

## Cause
A1a appended `"system"` to the `account_type` pgEnum (required). This widens `accounts.$inferSelect.type`
to include `"system"`, which is not a member of the public `AccountType` (from `@compass/shared`), so 8
files that project a DB account row's `.type` into an `AccountType`-typed shape now fail typecheck.

## Files and symbols (own ONLY these)
- NEW helper file `apps/api/src/lib/account-type.ts` (domain-neutral narrowing helper).
- `apps/api/src/modules/ledger/services/accounts.ts` (toAccount line ~139; lines ~357, ~365, ~414;
  + `listAccounts`, `accountBalancesAtDate` system exclusion).
- `apps/api/src/modules/credit/services/emis.ts` (line ~206).
- `apps/api/src/modules/credit/services/bank-details.ts` (line ~29).
- `apps/api/src/modules/credit/services/overdraft-details.ts` (line ~24).
- `apps/api/src/modules/investments/services/sip-commitments.ts` (line ~89).
- `apps/api/src/modules/investments/services/sip-lifecycle.ts` (line ~139).
- `apps/api/src/modules/ledger/services/epf-contributions.ts` (line ~21).
- `apps/api/src/modules/protection/services/retirement.ts` (line ~26).

## Required changes
1. Create `apps/api/src/lib/account-type.ts`:
   ```ts
   import type { AccountType } from "@compass/shared";
   import { HttpError } from "./errors.ts";
   /** The DB `account_type` enum carries an internal `"system"` value (postings model) that must
    * never surface as a public AccountType. Narrow at every DB→public boundary. */
   export function assertPublicAccountType(type: string): AccountType {
     if (type === "system") throw new HttpError(500, "system account leaked into a public projection");
     return type as AccountType;
   }
   ```
   (Confirm the relative import path to `errors.ts` is correct for `lib/`.)
2. At EACH of the 8 sites, wrap the DB row's `.type` with `assertPublicAccountType(row.type)` where it is
   placed into an `AccountType`-typed field (e.g. `toAccount`: `type: assertPublicAccountType(row.type)`;
   emis `Map` build: `{ type: assertPublicAccountType(r.type), ... }`). Do NOT change any other logic,
   signature, or behavior. Read each cited line first to apply the minimal wrap.
3. In `accounts.ts`, exclude system accounts from the two GENERIC account queries so system rows never
   reach these projections at runtime:
   - `listAccounts`: add `isNull(accounts.systemKind)` to the `.where(...)` (alongside the userId eq).
   - `accountBalancesAtDate` (raw SQL): add `and a.system_kind is null` to the WHERE clause.
   (These are latent no-ops now — no system account exists until seeding — but keep the boundary correct.)

## Must NOT change
- No other reader/aggregation. No DTO change. No seeding, no runtime guards for edit/delete/archive, no
  simple-API rejection (those are A2). Do not touch `post-entry.ts`/`postings.ts` (A1b owns them).

## Acceptance criteria
- The 8 `"system"`-widening type errors are gone. (Full typecheck green is the A1a+A1n+A1b CHECKPOINT,
  verified after A1b lands — A1n alone still leaves `post-entry.ts` errors, which A1b fixes.)
- `git diff main -- apps/api/src` shows ONLY the helper + minimal narrowing wraps + the 2 exclusion
  predicates. No behavioral change beyond system-row exclusion in the 2 generic queries.

## Commands / evidence
1. Read each cited line before editing.
2. `npm run typecheck -w apps/api 2>&1 | grep -E "system|AccountType"` — report remaining matches (expect
   the 8 AccountType-widening errors GONE; `post-entry.ts` errors may remain — that's A1b).
3. Report the complete diff of every file, the literal grep output + exit code, and any deviation.

---

# Iteration 3 — Slice A1b: posting builders + dual-write writer primitive

## Files and symbols (own ONLY these)
- `apps/api/src/modules/ledger/services/postings.ts` (+ `postings.test.ts`).
- `apps/api/src/modules/ledger/services/post-entry.ts`.

## Required changes
1. `postings.ts`:
   - Add `"clearing"` to the `SystemKind` union: `"expenses" | "income" | "opening" | "clearing"`.
   - Add a per-leg transfer builder for the DUAL-WRITE Clearing model (each legacy transfer leg → its own
     zero-sum pair):
     ```ts
     export function buildTransferLegPostings(input: {
       accountId: string;         // this leg's real account
       amountPaise: number;       // signed legacy amount (outflow <0, inflow >0)
       clearingAccountId: string;
       note: string;
     }): PostingDraft[]  // returns [ {real: amountPaise}, {clearing: -amountPaise} ], assertZeroSum
     ```
   - Do NOT modify `classifyShape`/`projectRealLeg`/`projectCounter`/`projectSplits` behavior (reader-side,
     PR-B). Add a code comment on `classifyShape` noting a 1-real+1-clearing leg is a PR-B concern (it is
     not called in PR-A). Keep existing `buildOrdinary/Split/Transfer/Opening` builders as-is.
   - Add a `postings.test.ts` case for `buildTransferLegPostings`: outflow leg (real -X, clearing +X) and
     inflow leg (real +X, clearing -X) both zero-sum; safe-integer boundary.
2. `post-entry.ts` — refactor to the dual-write primitive set (the reference version opens its own
   transaction and creates a header, which would DUPLICATE the legacy header in dual-write — fix that):
   - `replacePostings(tx: DbOrTx, transactionId: string, userId: string, drafts: PostingDraft[]): Promise<void>`
     — operates on the PASSED handle (NO `tx.transaction(...)` of its own; the caller owns the tx);
     `assertZeroSum(drafts)`; verify ownership BEFORE writing: the `transactionId` belongs to `userId`, and
     every `draft.accountId` is an account of `userId`, and every non-null `draft.categoryId` is a category
     of `userId` (tenant-scoped SELECTs; throw HttpError 404/403 on mismatch); then delete existing postings
     for `transactionId` and insert `drafts`.
   - REMOVE the header-creating `postEntry` export (legacy writers own header creation in dual-write; the
     mirror primitive is `replacePostings`). If any tracked file imports `postEntry`, STOP and report (none
     should — it was never wired).
   - `seedSystemAccounts(tx: DbOrTx, userId: string)` — idempotent for all 4 kinds incl `clearing`, via
     SELECT existing `system_kind`s for the user then INSERT only the missing ones (NOT 4 unconditional
     inserts, NOT the broken `onConflictDoNothing({ targetWhere })`). Names: Expenses/Income/Opening
     Balances/Clearing.
   - `resolveSystemAccounts(tx, userId)` returns `{ expenses, income, opening, clearing }` (add clearing;
     throw if any of the 4 missing).
   - `updateTransactionHeader` stays header-only (unchanged; must NOT touch postings).

## Must NOT change
- Do not wire any of these into writers yet (that is A3/A4). Do not touch the 8 A1n files. No reader/DTO change.

## Acceptance criteria
- `postings.test.ts` green (incl the new transfer-leg cases): `npm run test -w apps/api -- ...postings.test.ts`
  (report exact command + literal pass/fail counts + exit code).
- `post-entry.ts` no longer produces its previous typecheck errors (targetWhere / clearing / systemKind /
  `"system"`); it compiles against the A1a schema.
- No tracked file imports the removed `postEntry` (grep and confirm).

## Commands / evidence
1. `npm run test -w apps/api -- --test-name-pattern` or run the postings test file directly; report literal output.
2. `grep -rn "postEntry" apps/api/src` — confirm no remaining import of the removed symbol.
3. Report complete diffs of `postings.ts`, `postings.test.ts`, `post-entry.ts`; test output + exit codes;
   any deviation/blocker.

## CHECKPOINT (after A1n + A1b both land — run by a SEPARATE verifier, not either implementer)
`npm run typecheck -w apps/api` MUST exit 0; `npm run test -w apps/api` (at least the postings + schema-
coverage tests) green. This is the re-assigned AC-A1a-1 green gate for the A1 unit.

---

# Codex review-8 (A1 foundation) — verdict A1-HAS-BLOCKERS → Iteration 4 fix; carry-forwards recorded

Coordinator-validated. Migration/schema/Clearing-builder/post-entry primitives judged SOUND. Two A1
blockers to fix now (Iteration 4). `replacePostings` NOT filtering `deleted_at` confirmed CORRECT (soft-
deleted-parent reconciliation). Carry-forwards (do NOT lose — fold into the named slice):
- BEFORE A2: `seedSystemAccounts` is NOT concurrency-safe (two concurrent seeds race the partial unique
  index) — A2 must serialize (advisory lock / user-row lock) OR catch the unique violation and re-resolve.
  A2 must ALSO exclude system accounts from `search.ts:19` (global account search would surface Expenses/
  Income/Opening/Clearing) and from the demo fresh-data guard `demo.ts:68` (else an empty demo user looks
  populated and suppresses recovery seeding), and add edit/delete/archive guards (`accounts.ts:334,507`)
  + simple-API system-id rejection.
- BEFORE PR-B: teach `classifyShape` to distinguish a 1-real+1-Clearing transfer leg (currently
  MISCLASSIFIES as `ordinary` via the realCount===1&&systemCount===1 branch); the postings.ts:252 comment
  ("not one of the four shapes") is technically inaccurate — correct it + add classifier/projection tests
  when the fix lands. (Not an A1 blocker: no PR-A caller.)
- BY A6: register `postings` in backup `ALL_TABLES`+`LINKED_TABLES`; restore remap/synthesis/validation;
  preserve/regenerate system accounts.
- BY A7: tests for replacePostings tenant-scope rejection, soft-deleted-parent replacement, delete/insert
  rollback (inject failure after delete → assert outer rollback), reconciliation, restore, full-shape
  invariant, duplicate/extra-posting pruning, second-run-zero-write.
- BEFORE ANY A3–A7 caller ships: the `Db` foot-gun — `replacePostings` on a bare `Db` runs delete+insert as
  separate autocommits; every legacy-mutation + replacePostings pair MUST share ONE outer `tx`.
- PR-D: add explicit `"system"` exclusion to `insights.ts:103` aggregate when that reader converts.

# Iteration 4 — Slice A1-fix: close the two review-8 A1 blockers

## Files and symbols (own ONLY these)
- `apps/api/src/db/schema.decomposition.test.ts`
- `apps/api/src/modules/ledger/services/accounts.ts` (only the `accountBalancesAtDate` cast at line ~175)

## Required changes
1. `schema.decomposition.test.ts` — reflect the additive schema (1 new table `postings`, 1 new enum
   `account_system_kind`):
   - Add `"postings"` to the ledger shared-layer TABLE identity map keys (line ~184, currently
     `["transactions"]`).
   - Add `"accountSystemKind"` to the hubs ENUM identity map keys (line ~213, currently
     `["accountType", "emailClass", "emailIngestStatus"]`).
   - Bump the count assertions: tables `50 → 51` (line ~133) and enums `38 → 39` (line ~134); update any
     related length assertion at lines ~124/~129 if it hard-codes the old counts; update the doc comments
     at lines ~5 and ~100-101 (`50 tables + 38 enums` → `51 tables + 39 enums`).
   - Read the file first; adjust to whatever the actual structure requires so the test PASSES and still
     asserts exactly-once export + Object.is identity for the new table/enum.
2. `accounts.ts` — at `accountBalancesAtDate` (line ~175), replace `type: r.type as AccountType` with
   `type: assertPublicAccountType(r.type)` (the helper is already imported by the A1n change; confirm the
   import exists, add it if somehow missing). Change nothing else.

## Must NOT change
- No other test expectation, no reader/DTO/schema change, no other file.

## Acceptance criteria
- `node --test apps/api/src/db/schema.decomposition.test.ts` exit 0, zero failures.
- `npm run typecheck -w apps/api` exit 0 (unchanged-green).
- `accounts.ts:175` uses `assertPublicAccountType`; no raw `as AccountType` remains in that function.

## Commands / evidence
1. `node --test apps/api/src/db/schema.decomposition.test.ts` — full summary + exit code.
2. `npm run typecheck -w apps/api` — exit code.
3. `git diff` of both files. Report literally + any deviation.

---

# A2 — system-account seeding + guards (splits into A2a + A2b; DISJOINT files ⇒ run in PARALLEL)

Both must land before A3 (dual-write writers) since writers need system accounts to exist and must never
accept system-account IDs. Neither changes any reader/aggregation formula or the DTO.

## Iteration 5 — Slice A2a: seed wiring (registration + demo) + seed race-hardening

### Files (own ONLY these)
- `apps/api/src/modules/system/services/auth.ts`
- `apps/api/src/modules/system/services/demo.ts`
- `apps/api/src/modules/ledger/services/post-entry.ts` (only `seedSystemAccounts` hardening)

### Required changes
1. `auth.ts registerUser` (line ~38-46): inside the SAME `db.transaction((tx) => ...)` that inserts the
   user and calls `seedDefaultCategories(tx, created.id)`, add `await seedSystemAccounts(tx, created.id);`
   immediately after category seeding. Import `seedSystemAccounts` from
   `../../ledger/services/post-entry.ts` (cross-module SERVICE import is allowed; verify the path). This
   makes the 4 system accounts atomic with user creation.
2. `demo.ts`:
   - Fix the fresh-data guard at `ensureDemoData` (line ~68): the `accounts.findFirst` used to decide
     `hasData` MUST ignore system accounts — add `isNull(accounts.systemKind)` to its `where` (so seeded
     system accounts don't make an unpopulated demo user look populated and suppress recovery seeding).
     Import `isNull` from drizzle-orm if needed.
   - Seed the 4 system accounts for the demo user as part of demo population (call
     `seedSystemAccounts(db, demoUserId)` in `seedInto`/the demo creation path, before/with the demo
     accounts). Read the demo seeding flow first and place it so it runs exactly once, idempotently.
3. `post-entry.ts` `seedSystemAccounts` race-hardening (review-8): the select-then-insert-missing is not
   concurrency-safe under the `accounts_system_kind_idx` partial unique index. Wrap the INSERT so a unique
   violation from a concurrent seeder is tolerated: catch it (reuse the repo's `isUniqueViolation` helper —
   see its import in `auth.ts`) and return normally (the concurrent winner already created the row). Do NOT
   otherwise change `seedSystemAccounts`'s signature or the select-missing logic.

### Must NOT change
- No reader/DTO/schema change. Do not touch A2b's files (ownership.ts, search.ts, accounts.ts, transactions.ts, transfers.ts).

### Acceptance criteria
- `npm run typecheck -w apps/api` exit 0.
- Registration and demo seeding call `seedSystemAccounts`; demo fresh-guard ignores system accounts.
- `seedSystemAccounts` no longer throws on a concurrent unique violation.

### Evidence
- Complete diffs; `typecheck -w apps/api` exit code; confirm the seeding is in the SAME tx as user creation
  (registration) and idempotent (demo). Report the demo seeding flow you found + where you placed the call.

## Iteration 6 — Slice A2b: `assertOwnedRealAccount` + generic exclusions + edit/delete/archive + API rejection

### Files (own ONLY these)
- `apps/api/src/lib/ownership.ts`
- `apps/api/src/modules/ledger/services/search.ts`
- `apps/api/src/modules/ledger/services/accounts.ts` (edit/delete/archive guards only)
- `apps/api/src/modules/ledger/services/transactions.ts` (account-id validation swap only)
- `apps/api/src/modules/ledger/services/transfers.ts` (account-id validation swap only)

### Required changes
1. `lib/ownership.ts`: add `assertOwnedRealAccount(db, userId, accountId)` — same shape as `assertOwnedAccount`
   but its query ALSO requires `isNull(accounts.systemKind)` (so a system-account id is treated as
   not-found). null/undefined is a no-op like the others. Keep `assertOwnedAccount` as-is (system-inclusive)
   for internal callers like `replacePostings`.
2. `search.ts` (line ~19): add `and system_kind is null` to the accounts search query so system accounts
   never appear in cross-entity search.
3. `accounts.ts` edit/delete/archive: at `updateAccount` (loads `current` at line ~334-340) and
   `deleteAccount` (line ~507) — read both first — reject when the target account is a system account
   (its `systemKind` is non-null): throw `HttpError(404, "Account not found")` (treat system accounts as
   invisible to management), BEFORE any mutation. Cover archive (archive flows through updateAccount).
   Load `systemKind` in the `current` select if not already selected.
4. `transactions.ts` + `transfers.ts`: for every USER-SUPPLIED real-account id validated in create/update/
   transfer (currently via `assertOwnedAccount`), swap to `assertOwnedRealAccount`, so the simple/public
   transaction API rejects system-account ids. Read each call site; swap ONLY the user-supplied real-account
   validations (do NOT swap any internal/system-account handling — there is none in these files yet; dual-
   write wiring is A3). Do not add dual-write logic here (that's A3).

### Must NOT change
- No reader/aggregation formula, no DTO, no schema. Do not touch A2a's files. Do not add posting writes.

### Acceptance criteria
- `npm run typecheck -w apps/api` exit 0.
- `assertOwnedRealAccount` rejects both non-owned AND system-account ids; used at the transaction/transfer
  user-supplied-account validation sites.
- `updateAccount`/`deleteAccount`/archive reject system accounts; `search` excludes them.
- No existing test regresses on typecheck (DB-backed test parity is a CONVERGE concern).

### Evidence
- Complete diffs; the list of exact call sites swapped in transactions.ts/transfers.ts (with line context);
  `typecheck -w apps/api` exit code; any deviation/blocker.

## A2 CHECKPOINT (separate verifier, after A2a + A2b)
`typecheck -w apps/api` exit 0; the pure/non-DB tests still green (postings.test.ts, schema.decomposition
.test.ts). Then coordinator validation before A3.
- A2 UNIT COMPLETE + checkpoint-verified (verifier a566575): typecheck 0, root lint 0, postings 20/20,
  schema.decomposition 3/3, packages/shared untouched, file set = A1+A2 manifest. Coordinator-validated.

---

# A3 — dual-write ledger writer graph (sub-slices A3a transactions / A3b accounts-opening / A3c transfers)

ATOMICITY LAW (Codex review-8 foot-gun; applies to EVERY A3–A7 writer): the legacy write and its posting
mirror MUST occur in ONE database transaction. A writer taking `DbOrTx` must guarantee this whether called
with a top-level `Db` or an existing `Tx` — implement via a nested/savepoint `db.transaction(...)` if this
repo's Drizzle supports it (VERIFY first — look for existing nested usage), else via a `withTx(db, fn)`
helper that reuses an existing tx or opens one. Never leave legacy-write and `replacePostings` as separate
autocommits. Readers/DTO stay legacy-derived (hydrate UNCHANGED) — postings are an additive side-effect.

## Iteration 7 — Slice A3a: dual-write transactions.ts

### Files (own ONLY these)
- `apps/api/src/modules/ledger/services/transactions.ts`
- (read-only refs: `postings.ts` builders, `post-entry.ts` `replacePostings`/`resolveSystemAccounts`,
  `transaction_splits`/`transactions` schema, `hydrate`)

### Required changes (mirror postings in the SAME tx as each legacy mutation)
1. `createTransaction` (254): wrap the legacy insert + mirror in one tx. After inserting the legacy row,
   `resolveSystemAccounts(t, userId)` then `buildOrdinaryPostings({ accountId, amountPaise, categoryId,
   necessity, systemExpensesAccountId, systemIncomeAccountId })` → `replacePostings(t, newId, userId, drafts)`.
   `hydrate` stays legacy-based; return value unchanged. (amountPaise may be 0 — builder handles it.)
2. `updateTransaction` (288): after the legacy update in the same tx, RE-READ the complete resulting shape
   (the updated row + any `transaction_splits`), then rebuild postings: if the txn has splits →
   `buildSplitPostings` from those splits; else `buildOrdinaryPostings` from the row's accountId/amountPaise/
   categoryId/necessity; `replacePostings(t, id, userId, drafts)`. Account/amount/category/necessity can all
   change via the spread — the rebuild-from-resulting-shape covers every case (D15). Read `transaction_splits`
   schema to get the exact per-split fields (categoryId/amountPaise/note; necessity = the txn's necessity
   applied to each split posting per D5 unless the split row stores its own).
3. `setSplits` (342): inside its existing tx, AFTER replacing `transaction_splits`, rebuild postings —
   `buildSplitPostings` when `splits.length>0`, else `buildOrdinaryPostings` from the txn's own amount/
   category/necessity (reverting to ordinary) — and `replacePostings(t, id, userId, drafts)`. Keep the
   existing D15 sum check (splits must sum to txn amount).
4. `softDeleteTransaction` (331): NO posting change — add a one-line comment stating readers exclude via the
   parent's `deleted_at` and postings are intentionally retained (per plan + review-8).
5. `bulkAction` (366): inside the existing tx —
   - `restore` (snapshot): for each restored row, rebuild its postings from the resulting shape (category
     may change, and un-delete restores it) → `replacePostings`. 
   - `setCategory`: update the affected transactions' Expenses/Income COUNTER posting category (rebuild each
     row's postings from its resulting shape is the simplest correct approach; never touch Clearing/Opening).
   - `addTag`/`removeTag`: header-only — NO posting change (comment why).
   Do this per-affected-id within the tx; reuse a small local `rebuildPostingsForTransaction(t, userId, id)`
   helper (read row+splits, build ordinary/split, replacePostings) to avoid duplication across update/bulk.

### Must NOT change
- No reader/aggregation, no `hydrate` change, no DTO, no schema. Do not touch accounts.ts/transfers.ts
  (A3b/A3c). Do not convert imports/recurring/etc. (A4). Keep the existing ownership checks
  (`assertOwnedRealAccount` etc.) — they stay.

### Acceptance criteria
- Every posting-affecting mutation (create/update/setSplits/bulk restore+setCategory) mirrors postings in
  the SAME tx; softDelete + tag-only bulk do NOT. Atomicity law satisfied (report the mechanism used).
- `npm run typecheck -w apps/api` exit 0. `postings.test.ts` + `schema.decomposition.test.ts` still green.
- Reader/DTO output unchanged (hydrate untouched).

### Evidence
- Complete diff; the atomicity mechanism (nested tx vs withTx) with proof the repo supports it; per-function
  confirmation of what postings are (or are not) written; typecheck + pure-test results + exit codes.
  Behavioral parity/DB-backed tests are a CONVERGE concern — do NOT run db:migrate.

### A3a status + carry-forwards (coordinator, post-implementation)
- A3a IMPLEMENTED (transactions.ts): create/update/setSplits/bulk restore+setCategory mirror ordinary/split
  postings in one tx via nested-savepoint `db.transaction` (worker cited drizzle node-postgres savepoint
  source as evidence); softDelete/bulk-delete/tag = no posting change. Shared helper
  `rebuildPostingsForTransaction(t, userId, id)` added (reads row+splits → ordinary/split → replacePostings;
  `transaction_splits` has NO necessity column, so each split posting inherits the parent row's necessity —
  verified). typecheck 0; postings 20/20; schema.decomposition 3/3. Diff coordinator-reviewed.
  Independent verification + Codex review DEFERRED to the A3 boundary (after A3a+A3b+A3c) — one writer-graph
  review. `createTransaction`'s unconditional ordinary mirror is CORRECT (isOpening is not a CreateTransaction
  field; structurally cannot create opening rows).
- CARRY-FORWARD — `rebuildPostingsForTransaction` shape-awareness (canonical rebuild used by writers AND
  A5 reconciliation/A7 invariant): currently ordinary/split only. A3b MUST make it OPENING-aware
  (`row.isOpening` → buildOpeningPostings with resolveSystemAccounts.opening). A3c/A5 MUST make it/its
  reconciliation twin TRANSFER-LEG-aware (a legacy transfer row → buildTransferLegPostings with Clearing;
  detect via transfer_links membership). The A5 full-shape reconciliation should reuse ONE canonical
  rebuild that handles all four legacy shapes (ordinary/split/opening/transfer-leg).

## Iteration 8 — Slice A3b: dual-write opening balances + opening-aware canonical rebuild

### Scope confirmed by coordinator (reads done)
- Opening ROW (bank/cash `is_opening=true` transaction, created in createAccount + updateAccount) → mirror
  Opening postings `[A: amount] + [Opening: -amount]`. Opening COLUMN (cards/loans/schemes,
  `accounts.opening_balance_paise`) → NO postings in dual-write (plan Q3); do NOT touch it.
- `reconciliation-writes.ts absorbCarryover` is COLUMN-only for cards → NO posting work in dual-write; do
  NOT touch that file.
- `deleteAccount` already blocks deletion when ANY transaction (incl soft-deleted) references the account
  → a deletable account has zero postings; NO change needed (confirm, don't edit).

### Files (own ONLY these)
- `apps/api/src/modules/ledger/services/transactions.ts` (make the canonical rebuild opening-aware + export it)
- `apps/api/src/modules/ledger/services/accounts.ts` (createAccount + updateAccount opening apply)

### Required changes
1. `transactions.ts` `rebuildPostingsForTransaction`: make it OPENING-aware and EXPORT it (canonical shape
   rebuild, reused by accounts.ts now + A5 reconciliation later). After re-reading `row`, branch FIRST on
   `row.isOpening === true` → `resolveSystemAccounts(t,userId)` + `buildOpeningPostings({ accountId:
   row.accountId, amountPaise: row.amountPaise, systemOpeningAccountId: sys.opening })`; else the existing
   split/ordinary logic (kept identical for non-opening rows). Import `buildOpeningPostings`.
2. `accounts.ts` `createAccount` (line ~226): when it inserts the opening row, capture its id
   (`.returning({ id: transactions.id })`) and call `await rebuildPostingsForTransaction(tx, userId, id)` in
   the SAME tx. Import `rebuildPostingsForTransaction` from `./transactions.ts`.
3. `accounts.ts` `updateAccount` opening apply (lines ~434-470):
   - `insert` branch: add `.returning({ id: transactions.id })`, then `await
     rebuildPostingsForTransaction(tx, userId, id)`.
   - `update` branch: after updating the row amount, `await rebuildPostingsForTransaction(tx, userId,
     plan.txn.id)`.
   - `delete` branch: NO posting change (soft-delete; postings retained). Add a one-line comment.

### Must NOT change
- No reader/aggregation/DTO/schema. Do not touch opening-COLUMN logic, reconciliation-writes.ts,
  transfers.ts, or any A4 file. Do not alter deleteAccount. Column-opening accounts stay posting-free.

### Acceptance criteria
- Opening ROW create/update mirrors/replaces Opening postings in the same tx; opening-row soft-delete does
  not; column-opening accounts get no postings. `rebuildPostingsForTransaction` handles opening rows, is
  exported, and is reused by accounts.ts.
- `npm run typecheck -w apps/api` exit 0; `postings.test.ts` + `schema.decomposition.test.ts` still green.

### Evidence
- Complete diffs of both files; confirm the opening-aware branch precedes split/ordinary; confirm column-
  opening accounts get no postings and reconciliation-writes.ts/deleteAccount untouched; typecheck + pure
  tests + exit codes. Do NOT run db:migrate.

## Iteration 9 — Slice A3c: dual-write transfers (Clearing legs) + transfer-leg-aware rebuild
DEPENDS ON A3b (edits the SAME `rebuildPostingsForTransaction`) — run only AFTER A3b lands + validates.

### Scope confirmed by coordinator (transfers.ts read)
- A legacy transfer = TWO legacy rows (out: −X, in: +X) joined by a `transfer_links` row. Each leg's dual-
  write postings = `buildTransferLegPostings` → `[real: leg.amountPaise] + [Clearing: −leg.amountPaise]`
  (Clearing nets 0 across the pair). Postings are per-leg (per row's own transaction_id).
- `createTransfer` (179) already: tx → `createTransaction(tx)` x2 (each mirrors ORDINARY via A3a) →
  `linkTransfer(tx)`. Making `linkTransfer` rebuild both legs to Clearing after inserting the link means
  createTransfer needs NO other change (the ordinary postings get replaced by Clearing). `autoLinkTransfers`
  routes through `linkTransfer` → covered. `suggestTransfers` is read-only → no change.

### Files (own ONLY these)
- `apps/api/src/modules/ledger/services/transactions.ts` (transfer-leg-aware rebuild)
- `apps/api/src/modules/ledger/services/transfers.ts` (linkTransfer + unlinkTransfer)

### Required changes
1. `transactions.ts` `rebuildPostingsForTransaction` (already opening-aware from A3b): add a TRANSFER-LEG
   branch. Branch order MUST be: (a) `row.isOpening` → Opening; (b) the txn is a member of `transfer_links`
   (as `out_transaction_id` OR `in_transaction_id`) → `resolveSystemAccounts(t,userId)` +
   `buildTransferLegPostings({ accountId: row.accountId, amountPaise: row.amountPaise, clearingAccountId:
   sys.clearing, note: "" })`; (c) splits>0 → split; (d) else ordinary. `transferLinks` is already imported;
   add `buildTransferLegPostings` to the postings import.
2. `transfers.ts` `linkTransfer` (68): wrap the link insert + both-leg rebuilds in one `db.transaction`
   (nested-savepoint safe for the createTransfer-passes-tx case). After inserting the `transfer_links` row,
   `await rebuildPostingsForTransaction(t, userId, outTransactionId)` and `(…, inTransactionId)` so both legs
   become Clearing legs. Return the link `{ id }` unchanged. Import `rebuildPostingsForTransaction`.
3. `transfers.ts` `unlinkTransfer` (134): wrap in `db.transaction`; FIRST read the link row (to get its
   out/in transaction ids) scoped to `(id, userId)`; delete the link; then rebuild BOTH legs (now no longer
   in `transfer_links` → they revert to ORDINARY postings). Preserve the existing 404 when the link doesn't
   exist.

### Must NOT change
- No reader/aggregation/DTO/schema; no change to `createTransfer` body beyond what linkTransfer provides, no
  change to `suggestTransfers`/`autoLinkTransfers` logic, no A4 file. Do not alter the ordinary/opening/split
  branches' behavior.

### Acceptance criteria
- A linked transfer's two legs each carry `[real ±X] + [Clearing ∓X]`; unlinking reverts both to ordinary;
  createTransfer + autoLink produce Clearing legs (via linkTransfer). Atomicity preserved (link/unlink +
  rebuilds in one tx).
- `npm run typecheck -w apps/api` exit 0; `postings.test.ts` + `schema.decomposition.test.ts` still green.

### Evidence
- Complete diffs; confirm rebuild branch order (opening→transfer-leg→split→ordinary); confirm createTransfer/
  suggest/autoLink bodies unchanged except via linkTransfer; typecheck + pure tests + exit codes. No db:migrate.

## A3 BOUNDARY (after A3a+A3b+A3c) — independent verify + Codex writer-graph review
Separate verifier: typecheck 0 + pure tests green + file-set check. Then Codex review of the whole dual-write
writer graph (transactions/accounts/transfers) vs PLAN + DELEGATION (every posting-affecting path mirrors in
one tx; softDelete/tag/column-opening/absorbCarryover write no postings; shape correctness ordinary/split/
opening/transfer-leg; tenant-scope; atomicity). Fix blockers, then A4.

## A4 scope map (coordinator recon via direct-insert/update call-graph; refine after A3 review)
- NEEDS MIRRORING (direct inserts/updates): imports.ts (bulk insert :704 → ordinary mirror; reconciliation
  update :643 → rebuild; rollback restore :840 → rebuild; MOVE autoLinkTransfers into the tx per Codex);
  recurring.ts (:287/:303/:330 materialization → ordinary mirror; EMI = TWO independent ordinary families,
  NOT a transfer, D21); demo.ts (:215 bulk demo insert → mirror); categories.ts (:155 merge → rebuild
  affected counter postings incl split-derived).
- CONFIRM HEADER-ONLY (write NO postings — verify, don't mirror): reconciliation-writes.ts (:129/:140
  reconciledStatementId, D18); merchants.ts (:57 rename); sip-lifecycle.ts (:503/:517 sip FK, D18);
  sip-installments.ts (:319/:385 sip linkage — verify they don't change amount/account/category).
- AUTO-COVERED (route through createTransaction/createTransfer — no direct insert): review-actions.ts,
  insurance.ts, epf-contributions.ts, transfer-classification.ts. Confirm in the A3/A4 review.
- Suggested sub-slices (disjoint files → parallelizable): A4a = imports.ts; A4b = recurring.ts + demo.ts +
  categories.ts. Each reuses the exported rebuildPostingsForTransaction; keep the atomicity law.

## A3 BOUNDARY OUTCOME — review-9 (Codex): A3-HAS-BLOCKERS (coordinator-validated). Verifier PASS (typecheck/
lint/pure-tests/only-apps-api). 3 blockers → Iteration 10 (A3-fix). Deferrals CONFIRMED + recorded:
- A4 imports: when a transfer counterpart is HARD-DELETED the FK cascades the link but nothing rebuilds the
  survivor from Clearing→ordinary; `unlinkTransfer` after a hard-delete 404s (link already cascaded). A4
  rollback/hard-delete handling MUST capture the counterpart id BEFORE deleting and rebuild it. Also auto-
  link invalidation on reconciliation edit.
- A7: DB-backed regression tests for the two transfer rules + setSplits concurrency + transactional writer
  rollback (inject failure after delete → outer rollback) + tenant-scope rejection; full invariant/parity.
- Deferred elsewhere: shared `SafePaiseSchema` on CreateTransaction/SetSplits/CreateTransfer money fields
  (A7/consolidation — a validation refinement, DTO-compatible); replacePostings `Db` foot-gun (all A4-A7
  callers pass a tx); classifyShape Clearing-awareness (PR-B).

## Iteration 10 — Slice A3-fix: close the three review-9 transfer/split integrity blockers

### Files (own ONLY these)
- `apps/api/src/modules/ledger/services/transactions.ts` (updateTransaction guard; setSplits parent lock)
- `apps/api/src/modules/ledger/services/transfers.ts` (linkTransfer atomic+reject; buildTransferLegs D12)

### Required changes
1. Blocker 1 — `updateTransaction`: reject posting-affecting edits of a transfer-linked leg. Before applying
   the update, if the target row is a member of `transfer_links` (out OR in) AND the input changes
   `accountId` or `amountPaise` (field provided), throw `HttpError(409, "Unlink the transfer before changing
   a transfer leg's account or amount")`. Editing notes/tags/category on a linked leg stays allowed. Place
   the check inside the same flow (before the update) — a membership query scoped to the id.
2. Blocker 2 — `linkTransfer`: move the two-row validation INSIDE the `db.transaction`, re-reading BOTH rows
   with `.for("update")` row locks (scoped to userId, not deleted), THEN validate opposite-sign/equal/
   different-account. ADD: reject if EITHER row `isOpening` (`HttpError(400, "Opening balances cannot be
   transfers")`). ADD a cross-role membership guard: reject if EITHER transactionId already appears in
   `transfer_links` as out OR in (`HttpError(409, "Transaction is already part of a transfer")`). Keep the
   existing 404 for missing rows. Then insert the link + rebuild both legs (as today).
3. Blocker 3 — `setSplits`: move the parent read + the `total === parent.amountPaise` validation INSIDE the
   write `db.transaction`, re-reading the parent with `.for("update")` (scoped userId, not deleted); compute
   the total with a BigInt-safe sum (reuse `sumPaise` from postings.ts) rather than Number `reduce`. Keep the
   404 and the 400 sum-mismatch messages. Category ownership checks may stay before the tx.
4. D12 — `buildTransferLegs` (transfers.ts): replace `Number.isInteger(input.amountPaise)` with
   `Number.isSafeInteger(input.amountPaise)`.

### Must NOT change
- No reader/aggregation/DTO/schema; no other writer; keep hydrate/readers untouched. Do not alter the
  ordinary/opening/split/transfer rebuild branch bodies. Do not touch A4 files.

### Acceptance criteria
- Editing a linked leg's account/amount is rejected; linkTransfer validates+locks inside its tx and rejects
  opening legs + already-linked legs (either role); setSplits validates the parent under a lock with a
  BigInt-safe total; buildTransferLegs uses isSafeInteger.
- `npm run typecheck -w apps/api` exit 0; `postings.test.ts` + `schema.decomposition.test.ts` still green.

### Evidence
- Complete diffs; confirm each blocker's fix + the D12 change; confirm no unrelated writer/branch touched;
  typecheck + pure tests + exit codes. Do NOT run db:migrate. Report any deviation/blocker.

## Iteration 11 — Slice A4b: dual-write recurring + demo + categories-merge (all via rebuildPostingsForTransaction)
Disjoint from A3-fix (recurring/demo/categories vs transactions/transfers) → may run in parallel. Each writer
mirrors postings in the SAME tx it already opens, reusing the exported `rebuildPostingsForTransaction`.

### Files (own ONLY these)
- `apps/api/src/modules/ledger/services/recurring.ts`
- `apps/api/src/modules/system/services/demo.ts`
- `apps/api/src/modules/ledger/services/categories.ts`

### Required changes
1. `recurring.ts` — three direct bulk inserts (EMI source ~287, EMI principal ~303, generic ~330), all inside
   the existing `trx`. For EACH: add `.returning({ id: transactions.id })`, then loop the inserted rows and
   `await rebuildPostingsForTransaction(trx, t.userId, row.id)`. EMI stays TWO independent ordinary families
   (source + principal) — NOT a transfer (D21); rebuild's ordinary branch is correct (rows are non-opening,
   non-transfer-linked, no splits). Import `rebuildPostingsForTransaction` from "./transactions.ts".
2. `demo.ts` — the demo bulk insert (~215 `tx.insert(transactions).values(txns)` inside seedInto's tx): add
   `.returning({ id: transactions.id })` and loop `await rebuildPostingsForTransaction(tx, userId, row.id)`.
   (rebuild handles whatever shape each demo row is — ordinary/opening/split; demo card-payment pairs are NOT
   transfer-linked, so they stay ordinary, matching legacy demo.) Import `rebuildPostingsForTransaction`.
3. `categories.ts mergeCategory` (~153 tx): the merge updates `transactions.categoryId` (155) and
   `transaction_splits.categoryId` (159) from the merged-away `id` to `intoCategoryId`. BEFORE those updates,
   collect the affected transaction ids = { transactions where categoryId = id } ∪ { transactionId of
   transaction_splits where categoryId = id } (both implicitly user-scoped via the owned category). AFTER the
   two updates (so the rebuild re-reads the new category), loop the affected ids and
   `await rebuildPostingsForTransaction(tx, userId, txnId)` — updating each row's Expenses/Income counter
   category (never Clearing/Opening; rebuild's branch priority preserves those). Import the helper.

### Must NOT change
- No reader/aggregation/DTO/schema; no other writer; do not touch A3-fix/A4a files (transactions/transfers/
  imports). Keep hydrate/readers untouched. EMI must not become a transfer.

### Acceptance criteria
- recurring/demo inserts mirror postings per row in the same tx; category merge rebuilds affected rows' counter
  postings; EMI = two ordinary families. `npm run typecheck -w apps/api` exit 0; postings + schema.decomposition
  tests still green.

### Evidence
- Complete diffs; per-file confirmation of the returning+rebuild loop / affected-id rebuild; confirm EMI is two
  ordinary families and no transfer; typecheck + pure tests + exit codes. Do NOT run db:migrate.

## Iteration 12 — Slice A4a: dual-write import commit + reconciliation + rollback
Disjoint from A3-fix (transactions/transfers) and A4b (recurring/demo/categories) → parallel-safe. Owns ONLY
`imports.ts`. Reuses the exported `rebuildPostingsForTransaction` (transactions.ts, opening/transfer-leg/split/
ordinary-aware). Coordinator recon (reads done):
- `commitImport` opens ONE tx `await db.transaction(async (t) => {...})` at line 565 (ends ~726). The
  reconciliation-update loop (641-667), the auto-link invalidation delete (669-684), and the bulk insert loop
  (701-725) ALL run inside this SAME `t`. `rollbackImport` opens its own tx at 799.
- `transfer_links.{out,in}_transaction_id` are BOTH `onDelete: "cascade"` and `.unique()` (ledger/schema.ts:64-71).
  So hard-deleting a row cascades its link and orphans the SURVIVING counterpart's Clearing postings → the
  counterpart must be rebuilt to ordinary. `postings.transaction_id` is also cascade → a deleted row's own
  postings vanish automatically (never rebuild a deleted row).

### Files (own ONLY these)
- `apps/api/src/modules/ingest/services/imports.ts`

Import `rebuildPostingsForTransaction` from `../../ledger/services/transactions.ts` (cross-module SERVICE import
is allowed). `transferLinks`/`transactions`/`inArray`/`and`/`or`/`eq` are already imported — reuse them.

### Required changes (all posting rebuilds run INSIDE the existing tx handle)
1. `commitImport` reconciliation path (inside `t` @565):
   - Capture-before-delete: inside the `if (updatedIds.length > 0)` block (669), BEFORE the
     `t.delete(transferLinks)` at 672, SELECT the auto links about to be removed and flatten their tx ids:
     `select({ out: transferLinks.outTransactionId, in: transferLinks.inTransactionId }).from(transferLinks)
      .where(and(eq(transferLinks.userId, userId), eq(transferLinks.auto, true),
      or(inArray(transferLinks.outTransactionId, updatedIds), inArray(transferLinks.inTransactionId, updatedIds))))`.
     Collect every out+in id into a set = the legs whose Clearing partner is being severed.
   - Keep the existing `t.delete(transferLinks)` exactly as-is.
   - AFTER the delete (so rebuild sees the post-delete transfer_links state): rebuild the UNION
     `new Set([...updatedIds, ...capturedLinkTxIds])`. For each id: `await rebuildPostingsForTransaction(t, userId, id)`.
     Rationale: an updated leg whose amount changed but is NOT transfer-linked rebuilds ordinary with the new
     amount; an updated leg whose auto-link was just deleted rebuilds ordinary (no longer a member); a leg with a
     surviving MANUAL link rebuilds as a Clearing leg with the new amount (membership still true → transfer-leg
     branch); the severed counterpart (in capturedLinkTxIds, not itself updated) rebuilds ordinary. Rebuild MUST
     be after the delete or a severed leg would wrongly keep a Clearing shape.
2. `commitImport` bulk insert (701-725, inside `t`): the insert already has `.returning({ id: transactions.id })`
   (`inserted`). After the existing `importRows` update-mapping `t.execute`, loop the inserted ids and
   `await rebuildPostingsForTransaction(t, userId, x.id)` for each `x` in `inserted`. These are fresh ordinary
   import rows (non-opening, non-transfer-linked, no splits) → rebuild yields ordinary postings. Keep the
   importRows mapping untouched.
3. `rollbackImport` (tx @799):
   - Capture-before-delete: after the row lock (812-828) and BEFORE the delete loop (830), if `ids.length > 0`
     SELECT transfer_links where `out ∈ ids OR in ∈ ids`, flatten out+in ids, and compute
     `survivingPartners = flattened \ new Set(ids)` (the counterparts NOT being deleted). These lose their link
     via cascade when the delete runs.
   - Keep the delete loop (830-836) and the snapshot-restore updates (838-850) exactly as-is.
   - AFTER the snapshot updates, rebuild `new Set([...survivingPartners, ...snapshots.map(s => s.transactionId)])`:
     for each id `await rebuildPostingsForTransaction(t, userId, id)`. Surviving partners revert to ordinary
     (their link cascaded away); snapshot rows had their amount reverted so their postings must be rebuilt.
     (A deleted row's postings vanish via cascade — never rebuild a deleted id; both-legs-in-`ids` transfers
     leave no surviving partner, correctly excluded by the set-difference.)

### Deliberately NOT moving post-commit `autoLinkTransfers` (supersedes the A4-scope-map "MOVE" note @line 84)
Leave `autoLinkTransfers(db, userId)` at 730 and 860 post-commit, OUTSIDE the tx, UNCHANGED. Rationale (lead
decision, valid only because A3c made `linkTransfer` atomic): each `linkTransfer` now wraps link-insert + both-leg
Clearing rebuild in ONE nested tx. Before autolink runs, the just-committed import rows are ordinary postings —
a legitimately-valid per-transaction shape for a not-yet-linked row. Each subsequent atomic `linkTransfer` flips
a matched pair to Clearing atomically. There is therefore NO observable state that violates the per-transaction
invariant, so post-commit placement is safe; moving autolink inside `t` is unnecessary and only widens lock
scope. (The earlier "MOVE autoLinkTransfers into the tx" note assumed link+posting were separate non-atomic
writes; A3c removed that premise.) Do NOT change autoLinkTransfers/suggestTransfers/reconcile logic otherwise.

### Must NOT change
- No reader/aggregation/DTO/schema; no other writer; do not touch A3-fix/A4b files (transactions/transfers/
  recurring/demo/categories). Do not alter legacy insert/update/delete/link behavior, importRows mapping,
  snapshot capture, SIP-rollback guard, or lock order. Postings are an additive same-tx side effect only.

### Acceptance criteria
- Reconcile: updated legs + severed counterparts rebuild (ordinary, or Clearing if a manual link survives), AFTER
  the auto-link delete. Bulk insert: every inserted ordinary row mirrors postings. Rollback: surviving transfer
  counterparts + snapshot-restored rows rebuild; deleted rows' postings cascade (no manual rebuild). All rebuilds
  inside the existing tx handle. autoLinkTransfers stays post-commit, unchanged.
- `npm run typecheck -w apps/api` exit 0; `postings.test.ts` + `schema.decomposition.test.ts` still green.

### Evidence
- Complete diff; per-site confirmation (reconcile capture-before-delete + post-delete union rebuild; bulk-insert
  rebuild loop; rollback partner-capture + post-mutation rebuild); explicit confirmation autoLinkTransfers is
  unchanged and still post-commit; typecheck + pure-test output + exit codes. Do NOT run db:migrate.

## Codex review-10 (A4 writer-graph boundary) — verdict 2 BLOCKERS (coordinator-validated in source)
Everything else VERIFIED correct by Codex + cross-checked by coordinator: atomicity (all writers mirror in one
tx; replacePostings opens no tx of its own), rebuild branch order opening→transfer-leg→split→ordinary, EMI two
ordinary families (no transfer_links row), all no-posting paths (softDelete/tag/header-only/column-opening/
absorbCarryover), imports reconcile+rollback counterpart rebuilds, transfer_links FK ON DELETE CASCADE, tenant
scope (replacePostings verifies txn/account/category ownership), A3-fix link/setSplits/isSafeInteger. hydrate +
DTO + readers + shared + web all untouched; migration additive. Both blockers are in `updateTransaction`
(transactions.ts) → Iteration 13 (A3-fix2):
- BLOCKER 1 (D15 split-amount): `updateTransaction` lets `amountPaise` change on a SPLIT transaction without
  re-validating splits; rebuild's split branch derives the real leg from `sumPaise(splits)` (postings.ts:121),
  so real leg ≠ new parent amount → balance parity break. Fix: reject an amountPaise change on a split txn when
  new amount ≠ sum(existing splits) (never silent rescale; D15 "reject until splits resubmitted"). setSplits
  already enforces the sum; updateTransaction is the only open writer. No change needed to buildSplitPostings/
  rebuild (parent==sum(splits) stays an invariant once this writer is guarded).
- BLOCKER 2 (raceable transfer-leg guard): the transfer-link membership check runs on `db` BEFORE the write tx
  (transactions.ts:413) with no lock; a concurrent linkTransfer can link the row in the gap, then the edit
  rebuilds Clearing with the edited value → unequal legs. Fix: move the check INSIDE the write tx, after locking
  the target row `.for("update")` (id+userId, not deleted), then re-check membership. Lock analysis: updateTxn
  locks ONE row; linkTransfer locks two ordered-by-id; setSplits locks the parent — all serialize on the shared
  row, no cycle (updateTxn takes no second lock).
- NON-BLOCKING carry-forwards (do NOT act in A3-fix2): replacePostings per-draft ownership queries (perf, batch
  later); post-entry.ts imports `isUniqueViolation` from an investments service (coupling — move to a neutral
  db-error helper in a later cleanup); `suggestTransfers` (transfers.ts:63) `Number(bigint)` without safe-int
  range check (fold into the reader-side bigint boundary work in PR-B/A7). A5/A6/A7 remain the named next slices.

# Iteration 13 — Slice A3-fix2: close the two review-10 updateTransaction blockers

### Files (own ONLY this)
- `apps/api/src/modules/ledger/services/transactions.ts` (ONLY `updateTransaction`; do not touch the rebuild
  helper, other writers, readers, hydrate, or DTO).

### Required changes (both guards move INSIDE the existing `db.transaction` at ~426, under one row lock)
1. As the FIRST statement inside the `db.transaction(async (t) => {...})`, lock the target row:
   `const [locked] = await t.select({ id: transactions.id }).from(transactions).where(and(
   eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt))).for("update");`
   If `!locked` → `return []` (the existing `rows.length === 0 → 404` path handles it).
2. Blocker 2 — MOVE the transfer-link guard inside the tx, after the lock: if `input.accountId !== undefined ||
   input.amountPaise !== undefined`, `const linkRow = await t.query.transferLinks.findFirst({ where: or(
   eq(transferLinks.outTransactionId, id), eq(transferLinks.inTransactionId, id)) });` and if `linkRow` throw
   `HttpError(409, "Unlink the transfer before changing a transfer leg's account or amount")`. REMOVE the old
   pre-tx copy at lines ~409-421 (the authoritative check is now the locked one).
3. Blocker 1 — D15 split-amount guard, inside the tx after the lock: if `input.amountPaise !== undefined`,
   `const splitRows = await t.query.transactionSplits.findMany({ where: eq(transactionSplits.transactionId, id),
   columns: { amountPaise: true } });` and if `splitRows.length > 0` compute `const splitSum = sumPaise(
   splitRows.map((s) => s.amountPaise));` (import `sumPaise` from "./postings.ts" if not already imported) and if
   `splitSum !== input.amountPaise` throw `HttpError(409, "Update the transaction's splits to match the new
   amount")`. (Account-only edits on a split txn stay allowed; an amount equal to the existing split sum is a
   no-op and allowed.) Then proceed with the existing update + `rebuildPostingsForTransaction` unchanged.
4. Keep the pre-tx ownership checks (assertOwnedRealAccount/assertOwnedCategory/assertOwnedResource/recurring
   template) at ~396-408 AS-IS (they may reject early with zero writes). Keep the isUniqueViolation catch (~447).

### Must NOT change
- No change to `rebuildPostingsForTransaction`, buildSplitPostings, or any other writer/reader/DTO/schema. No
  behavior change for ordinary (non-split, non-transfer-linked) amount edits. Do not alter createTransaction/
  setSplits/bulkAction/transfers/imports/etc.

### Acceptance criteria
- Editing `amountPaise` on a split transaction to a value ≠ sum(splits) is rejected (409); equal value allowed;
  account-only edit on a split txn allowed. Transfer-leg account/amount edit rejection is now performed under a
  `FOR UPDATE` lock inside the write tx (race with linkTransfer closed). Ordinary edits unchanged.
- `npm run typecheck -w apps/api` exit 0; `postings.test.ts` + `schema.decomposition.test.ts` still green.

### Evidence
- Complete diff of `updateTransaction`; confirm the lock is the first stmt in the tx, both guards are inside +
  after the lock, and the old pre-tx transfer guard is removed; typecheck + pure-test output + exit codes.
  Do NOT run db:migrate.

### A3-fix2 status (backend-8.md, exit 0) — COORDINATOR-VALIDATED IN SOURCE (transactions.ts:412-465 read)
Row lock is the first stmt in the write tx (:414 `.for("update")`, id+userId+not-deleted, `return []`→404);
transfer-leg guard moved inside after the lock (:424); D15 split-amount guard inside after the lock (:437,
reject when `sumPaise(splits) !== input.amountPaise`); OLD pre-tx transfer guard REMOVED (:395-408 now only the
ownership checks); update+rebuild+isUniqueViolation catch unchanged. Both review-10 blockers closed. Self-reported
typecheck 0 / postings 20 / decomposition 3. A4-BOUNDARY CLOSE GATE DISPATCHED: independent re-verify
(verification-4.md) + targeted Codex re-review (review-11.md) of just the two fixes. When both clear, the A4
writer-graph boundary CLOSES → advance to A5 (backfill + full-shape reconciliation + gate), then A6, A7.
  - A3-fix2 RE-VERIFY (verification-4.md) CLEAN: typecheck 0, lint 0, postings 20/20, schema.decomposition 3/3;
    transactions.ts is the ONLY file changed this round (same 23-file set as V3); no reader/DTO/shared/web touched.
    Awaiting Codex review-11 (targeted re-review of the two updateTransaction fixes) to close the A4 boundary.
  - Codex review-11 (targeted A3-fix2 re-review): NO BLOCKING FINDINGS — both review-10 blockers CONFIRMED
    CLOSED (lock/404 path, in-tx transfer guard closing the race, split-amount guard correct, no ordinary-edit
    regression, no deadlock cycle from the new single-row lock). Coordinator-validated against source.
    ONE NON-BLOCKING (coordinator-confirmed in transfers.ts:83-104): `linkTransfer` locks out-row then in-row
    WITHOUT sorting by id → residual adversarial reversed-role linkTransfer-vs-linkTransfer deadlock risk
    (Postgres-detected, one 500, NO corruption; legitimate sign-deterministic calls never cycle). PRE-EXISTING
    (from A3-fix iter 10, not A3-fix2). NOT a boundary blocker. CARRY-FORWARD → A7: sort [out,in] ids and lock in
    one deterministic order (single inArray().orderBy(id).for("update") or sorted sequential), covered by an A7
    concurrency/deadlock test.
  - ===== A4 WRITER-GRAPH BOUNDARY CLOSED ===== A3a/A3b/A3c + A3-fix + A3-fix2 + A4a + A4b all landed,
    coordinator-validated in source, verifier-clean (typecheck/lint/pure-tests), and Codex-cleared (review-9
    blockers → A3-fix; review-10 blockers → A3-fix2; review-11 clean). The full dual-write MUTATION graph mirrors
    postings in-tx for every posting-affecting path; no reader/DTO/hydrate/shared/web change; migration additive.
    NEXT: A5 (backfill + idempotent full-shape reconciliation + pre-reader GATE + startup/maintenance hook),
    then A6 (restore compat), A7 (per-transaction invariant + DB-backed mutation/concurrency/rollback tests +
    the linkTransfer lock-order hardening), then CONVERGE (live db:migrate + 6-ws typecheck + lint + api tests).
  - A5 IN PLAN_REVIEW: design written to PLAN-A5.md (P1 extract computePostingDraftsForTransaction from
    rebuildPostingsForTransaction [behavior-preserving]; P2 new reconcile-postings.ts = reconcileUserPostings/
    reconcileAllPostings compare-first multiset-diff + read-only assertPostingsConsistent invariant checker;
    P3 .catch()-guarded boot hook after snapshotAllUsers jobs/index.ts:402). Boot ordering coordinator-verified
    (server.ts:5 buildApp before :15 listen). PR-A gate semantics: reconcile failure does NOT block boot
    (readers still legacy → served data stays correct); gate turns blocking at PR-B. Codex PLAN review dispatched
    → review-12.md. Do NOT implement A5 until plan APPROVED (blocking findings resolved).
  - Codex review-12 (A5 PLAN): directionally sound; 3 BLOCKERS, all CONFIRMED valid + RESOLVED in PLAN-A5.md
    "review-12 resolutions" (APPROVED): B1 move hook to buildApp (app.ts) after :179 before startJobs :181
    (quiescent — system Worker constructed jobs/index.ts:237 consumes immediately, so :402 spot races the
    reconciler; buildApp spot verified quiescent); B2 structured failure aggregation {userId,transactionId?,
    error} surfaced to the boot log; B3 split-parent equality in the SHARED computer — throw PostingShapeError
    on sum(splits)!=parent, reconciler/checker record as failure (never launder). WRITER-PATH FLAG: R-B3 makes
    imports-reconcile of a split txn with a diverging amount FAIL atomically (narrow, judged correct) — Codex
    review-13 must confirm no common path breaks. NB adoptions folded (JSON.stringify multiset key, tenant-scoped
    compute lookup, findInconsistentPostings structured checker, seed-fail-as-failure). A5 split into A5a (shared
    computer refactor + PostingShapeError) then A5b (reconcile-postings.ts + boot hook; depends on A5a).

# Iteration 14 — Slice A5a: shared posting-drafts computer + split-parent invariant (behavior-preserving refactor)

### Files (own ONLY these)
- `apps/api/src/modules/ledger/services/postings.ts` (add ONE exported error class; no builder math change)
- `apps/api/src/modules/ledger/services/transactions.ts` (extract the shape computer; rewire rebuild)

### Required changes
1. `postings.ts`: add `export class PostingShapeError extends Error {}` (a typed marker so the reconciler/checker
   can distinguish an unrepairable shape from an infra error). Do NOT change any builder (`buildOrdinary/Split/
   Opening/TransferLegPostings`) or their math. `buildSplitPostings` real leg stays `sumPaise(splits)`.
2. `transactions.ts`: EXTRACT a new EXPORTED function from the shape-branching currently inlined in
   `rebuildPostingsForTransaction` (~:198-244):
   `export async function computePostingDraftsForTransaction(t: DbOrTx, userId: string, id: string,
   systemAccounts?: ResolvedSystemAccounts): Promise<PostingDraft[] | null>`
   - Resolve system accounts: use the passed `systemAccounts` if provided, else `await resolveSystemAccounts(t,
     userId)` (name the concrete type; reuse whatever `resolveSystemAccounts` returns — export/import that type
     as needed). This lets the reconciler resolve ONCE per user.
   - TENANT-SCOPED row lookup: `const row = await t.query.transactions.findFirst({ where: and(eq(transactions.id,
     id), eq(transactions.userId, userId)) });` — return `null` if not found (NB5: the shared helper enforces its
     own ownership contract; do NOT return a row by global id alone). Keep reading soft-deleted rows (NO
     deleted_at filter — postings are retained on soft delete).
   - Same branch order/precedence as today: (a) `row.isOpening === true` → buildOpeningPostings; else (b)
     transfer-link membership (`transferLinks` out OR in == id) → buildTransferLegPostings (Clearing); else (c)
     splits exist → SPLIT branch; else (d) ordinary.
   - SPLIT branch R-B3: after reading `splitRows`, compute `const splitSum = sumPaise(splitRows.map(s =>
     s.amountPaise));` and if `splitSum !== row.amountPaise` `throw new PostingShapeError(\`transaction ${id}:
     split total ${splitSum} != parent amount ${row.amountPaise}\`);` BEFORE building. Only when equal, build via
     `buildSplitPostings` exactly as today (each split posting's necessity = the parent row's necessity; note =
     split note). This is the ONLY new invariant; everything else is a move.
   - Return the built `drafts`.
3. `transactions.ts`: REWIRE `rebuildPostingsForTransaction(t, userId, id)` to:
   `const drafts = await computePostingDraftsForTransaction(t, userId, id); if (!drafts) return; await
   replacePostings(t, id, userId, drafts);` — remove the now-extracted inline branching. Behavior is identical
   for all VALID data (writers guarantee split sum == parent via setSplits + the A3-fix2 updateTransaction guard).

### Writer-path note (implementer: do NOT add a guard here; just be aware)
Because `rebuildPostingsForTransaction` is a writer primitive, the new PostingShapeError can now surface on a
writer path ONLY if imports reconciliation changes a split txn's amount to != its split sum (commitImport). That
is intentional (refuse to mint invariant-violating postings) and will be scrutinized in review-13. Do NOT special-
case it in A5a. Do NOT change imports.ts.

### Must NOT change
- No builder math; no reader/aggregation/DTO/hydrate/schema/shared/web change; no other writer; no reconciler yet
  (A5b); do not touch app.ts/jobs. Keep `replacePostings`/`resolveSystemAccounts`/`seedSystemAccounts` as-is.

### Acceptance criteria
- `computePostingDraftsForTransaction` exported, tenant-scoped, same branch order, split-parent throw added;
  `rebuildPostingsForTransaction` delegates to it (behavior-preserving for valid data). `PostingShapeError`
  exported from postings.ts. `npm run typecheck -w apps/api` exit 0; `postings.test.ts` + `schema.decomposition.
  test.ts` still green.

### Evidence
- Complete diffs of both files; confirm the extraction is behavior-preserving (branch order unchanged), the
  split-parent throw is only in the split branch and only fires on sum!=parent, the row lookup is tenant-scoped,
  and rebuild now delegates; typecheck + pure-test output + exit codes. Do NOT run db:migrate.

### A5a status (backend-9.md, exit 0) — COORDINATOR-VALIDATED IN SOURCE
transactions.ts:201-264 computePostingDraftsForTransaction (exported, tenant-scoped lookup :207, null-if-absent,
branch order opening:213→transfer-leg:221→split:236→ordinary:256, split-parent PostingShapeError :238); rebuild
:282-286 delegates → replacePostings. postings.ts:27 PostingShapeError exported; post-entry.ts:14
ResolvedSystemAccounts interface (resolveSystemAccounts return type). Behavior-preserving for all valid writer
callers. Self-reported typecheck 0 / postings 20 / decomposition 3 (re-proven at the A5 boundary verifier).

# Iteration 15 — Slice A5b: reconcile-postings service + quiescent boot hook (depends on A5a)

### Files (own ONLY these)
- NEW `apps/api/src/modules/ledger/services/reconcile-postings.ts`
- `apps/api/src/app.ts` (ONLY the boot hook insertion; no other change)

### Required changes
1. NEW `reconcile-postings.ts` — a compare-first, idempotent, full-shape reconciler + read-only checker. Imports:
   `computePostingDraftsForTransaction` + `rebuildPostingsForTransaction`? (only compute needed) from
   "./transactions.ts"; `replacePostings`, `seedSystemAccounts`, `resolveSystemAccounts`, `ResolvedSystemAccounts`
   from "./post-entry.ts"; `PostingDraft` from "./postings.ts"; `users` (from db/core-schema or db/schema),
   `transactions`, `postings` tables; `and`/`eq` from drizzle-orm; the `Db` type. Read a couple of existing
   services (networth.ts all-users loop; post-entry.ts) to match import style.
   - Private helper `postingsMultisetEqual(drafts: PostingDraft[], stored: Array<{ accountId; amountPaise;
     categoryId; necessity; note }>): boolean`: build an occurrence-count Map keyed by
     `JSON.stringify([accountId, amountPaise, categoryId, necessity, note])` for BOTH sides (NOT a delimiter-join —
     notes may contain any char); equal iff same total count and per-key counts. (categoryId/necessity are null on
     both sides for real/transfer/opening legs — JSON handles null; note is always a string.)
   - `export async function reconcileUserPostings(db: Db, userId: string): Promise<{ checked: number; repaired:
     number; failures: Array<{ userId: string; transactionId?: string; error: unknown }> }>`:
     a. `await seedSystemAccounts(db, userId)` (idempotent).
     b. resolve system accounts ONCE: `let sys; try { sys = await resolveSystemAccounts(db, userId); } catch
        (error) { return { checked: 0, repaired: 0, failures: [{ userId, error }] }; }` (a user still missing a
        kind after seed is a FAILURE, not a silent skip — NB6).
     c. select ALL tx ids for the user, NO deleted_at filter: `const ids = await db.select({ id: transactions.id })
        .from(transactions).where(eq(transactions.userId, userId));`
     d. for each `{ id }`: `checked++`; then `try { await db.transaction(async (t) => { const drafts = await
        computePostingDraftsForTransaction(t, userId, id, sys); if (!drafts) return; const stored = await
        t.select({ accountId: postings.accountId, amountPaise: postings.amountPaise, categoryId:
        postings.categoryId, necessity: postings.necessity, note: postings.note }).from(postings).where(
        eq(postings.transactionId, id)); if (!postingsMultisetEqual(drafts, stored)) { await replacePostings(t,
        id, userId, drafts); repaired++; } }); } catch (error) { failures.push({ userId, transactionId: id,
        error }); }`  (per-row db.transaction = failure isolation + atomic compare+replace; do NOT wrap the whole
        user in one tx; do NOT parallelize.)
     e. return `{ checked, repaired, failures }`.
   - `export async function reconcileAllPostings(db: Db): Promise<{ users: number; checked: number; repaired:
     number; failures: Array<{ userId: string; transactionId?: string; error: unknown }> }>`: select all users
     (`db.select({ id: users.id }).from(users)`); for each, `try { const r = await reconcileUserPostings(db,
     u.id); checked += r.checked; repaired += r.repaired; failures.push(...r.failures); } catch (error) {
     failures.push({ userId: u.id, error }); }`; return `{ users: rows.length, checked, repaired, failures }`.
   - `export async function findInconsistentPostings(db: Db, userId?: string): Promise<Array<{ userId: string;
     transactionId: string; reason: string }>>` — READ-ONLY (never seeds, never writes): enumerate users (the one
     passed, else all); per user `try { sys = await resolveSystemAccounts(db, userId); } catch { push({ userId,
     transactionId: "", reason: "system accounts missing" }); continue; }`; select all tx ids (incl soft-deleted);
     per id `try { const drafts = await computePostingDraftsForTransaction(db, userId, id, sys); if (!drafts)
     continue; const stored = await db.select({...5 fields}).from(postings).where(eq(postings.transactionId, id));
     if (!postingsMultisetEqual(drafts, stored)) push({ userId, transactionId: id, reason: "posting drift" }); }
     catch (error) { push({ userId, transactionId: id, reason: error instanceof Error ? error.message :
     String(error) }); }`. Return the list (empty ⇒ consistent). This IS the per-transaction characterization
     invariant used by A7 + the PR-B gate.
2. `app.ts` boot hook: insert BETWEEN `registerLedgerCacheSubscriber(app);` (~:179) and `await startJobs(app);`
   (~:181) — this is the ONLY quiescent window (db decorated at :165; the system Worker is constructed inside
   startJobs at jobs/index.ts:237 and consumes immediately, so it MUST run before startJobs). Add:
   ```
   // Dual-write postings backfill/repair over ALL existing data, in the quiescent
   // window BEFORE any BullMQ worker (startJobs) or HTTP traffic. PR-A non-blocking:
   // every reader is still legacy-derived, so a failure cannot surface posting-derived
   // wrong data — but log it loudly (PR-B's reader-cutover gate depends on this being clean).
   await reconcileAllPostings(app.db)
     .then((pass) => {
       if (pass.failures.length > 0)
         app.log.error({ users: pass.users, checked: pass.checked, repaired: pass.repaired,
           failed: pass.failures.length, failures: pass.failures.slice(0, 20) },
           "boot: postings reconciliation had failures (PR-B reader gate NOT satisfied)");
       else if (pass.repaired > 0)
         app.log.info({ users: pass.users, checked: pass.checked, repaired: pass.repaired },
           "boot: postings reconciliation repaired drift");
     })
     .catch((err: unknown) => app.log.error({ err }, "boot postings reconciliation failed"));
   ```
   Import `reconcileAllPostings` from `./modules/ledger/services/reconcile-postings.ts`.

### Must NOT change
- No reader/aggregation/DTO/hydrate/schema/shared/web change; no other writer; do NOT touch transactions.ts/
  postings.ts/post-entry.ts (A5a is done) or jobs/index.ts; do NOT move any existing app.ts line. Do NOT make the
  boot hook blocking (must be `.catch()`-guarded). Do NOT seed inside `findInconsistentPostings` (read-only).

### Acceptance criteria
- `reconcileAllPostings` seeds system accounts per user, compare-first-repairs each transaction (incl
  soft-deleted) via per-row tx, aggregates structured failures; a second run performs ZERO writes (compare-first).
  `findInconsistentPostings` is read-only + structured. Boot hook is in the quiescent buildApp window,
  `.catch()`-guarded, logs failures loudly. `npm run typecheck -w apps/api` exit 0; lint 0; `postings.test.ts` +
  `schema.decomposition.test.ts` still green.

### Evidence
- Complete diff of reconcile-postings.ts + the app.ts hook; confirm: per-row db.transaction (not per-user, not
  parallel); compare-first (replacePostings only on multiset mismatch); JSON.stringify multiset key; structured
  failures aggregated to reconcileAllPostings; findInconsistentPostings never writes/seeds; boot hook placed
  before startJobs + `.catch()`-guarded. typecheck + lint + pure-test output + exit codes. Do NOT run db:migrate.

### A5b status (backend-10.md, exit 0) — COORDINATOR-VALIDATED IN SOURCE
reconcile-postings.ts: postingsMultisetEqual (JSON.stringify key + occurrence maps); reconcileUserPostings (seed
→ resolve-once→structured-fail-if-missing → all-txn no-deleted_at → per-row db.transaction compare-first,
replacePostings only on mismatch, per-row failure isolation); reconcileAllPostings (per-user aggregate);
findInconsistentPostings (read-only, never seeds/writes). app.ts:182-193 boot hook in the quiescent window
(after registerLedgerCacheSubscriber :180, before startJobs :195), `.catch()`-guarded, loud failure log.
Self-reported typecheck 0 / lint 0 / postings 20 / decomposition 3. A5 BOUNDARY GATE DISPATCHED: independent
verifier (verification-5.md) + Codex implementation review (review-13.md) over A5a+A5b (must scrutinize the B3
writer interaction + reconciler idempotency/coverage/tenant-scope).
  - Codex review-13 (A5 implementation): NO BLOCKING FINDINGS — conforms to review-12 resolutions
    (coordinator-validated in source across all 5 files). B3 WRITER INTERACTION VERDICT: imports-reconcile of a
    split txn changing the amount != split sum → rebuildPostingsForTransaction throws → commitImport tx ROLLS
    BACK (no invariant-violating data committed; rollback restores the valid pre-import amount) → INTENDED +
    CORRECT, NO imports guard needed for PR-A. Also confirmed: A5a extraction behavior-preserving (every writer
    call site traced, none regress); idempotency (2nd run = 0 writes, deterministic builders + compare-first);
    multiset compare correct (no false/masked drift; note NOT NULL DEFAULT '' so no null-vs-'' hazard; necessity/
    categoryId null + bigint number equality safe; unsafe paise → structured failure); coverage (soft-deleted
    incl, seed-before-resolve, missing-kind = structured failure, dup/extra pruned by replacePostings, column-
    only openings excluded by construction); findInconsistentPostings read-only; boot hook quiescent (app.ts:186
    before startJobs :195) + .catch()-guarded; tenant scope safe at unauth boot (replacePostings ownership
    checks). No reader/DTO/hydrate/shared/web change. (Codex also noted the full DB-backed suite fails on backup
    ALL_TABLES [A6] + un-migrated 0067 [CONVERGE] — both correctly out of A5 scope; focused pure tests 23/23.)
  - TWO NON-BLOCKING (coordinator-confirmed) → CARRY-FORWARD TO A7 (fix alongside the DB-backed reconcile tests
    that assert the count): NB1 `repaired++` is inside the per-row tx callback (reconcile-postings.ts:~105) → a
    commit-time failure overstates `repaired` AND pushes a failure entry; fix = increment AFTER the awaited
    db.transaction resolves (return a didRepair boolean). NB2 the concurrency comment (~:62) overclaims snapshot
    stability — the per-row tx does NOT lock source rows before compute; harmless at quiescent boot but the
    comment must be narrowed (or locking added) before the reconciler is used as a LIVE maintenance primitive.
    Neither blocks the A5 boundary. A5 boundary CLOSES once verification-5 confirms clean.
  - A5 VERIFIER (verification-5.md) CLEAN: typecheck 0, lint 0, postings 20/20, schema.decomposition 3/3; only
    net tracked change this round = app.ts; reconcile-postings.ts (new, untracked) has all 3 exports; NO forbidden
    file touched (jobs/index.ts, readers, DTO, packages/shared, apps/web all unchanged). NOTE: reconcile-postings.ts
    + post-entry.ts are UNTRACKED (new files) → must be explicitly staged at commit/CONVERGE time.
  - ===== A5 BOUNDARY CLOSED ===== Backfill + idempotent compare-first full-shape reconciliation + read-only
    findInconsistentPostings invariant checker + quiescent non-blocking boot hook, all Codex-cleared (review-13)
    + verifier-clean. NB1/NB2 carried to A7. NEXT: A6 (restore/backup posting round-trip + D19 remap + old-archive
    synthesis / new-archive validation + ALL_TABLES/LINKED_TABLES registration + db/restore.ts ordering).
    KEY REUSE HYPOTHESIS for A6 (confirm in investigation): old-archive synthesis = run reconcileUserPostings
    after restoring legacy rows + seeding system accounts; new-archive validation = findInconsistentPostings
    (rebuild-and-compare) — reuse A5, do NOT duplicate shape logic.
