# Task: 020-cross-module-ports (roadmap 1.9) — Phase-1 CLOSER

## Status
COMPLETE — **all sub-phases SP0-SP4 COMPLETE; roadmap 1.9 done.** SP4 fix pass (F2-F6) applied comment-only,
gate green (typecheck 0, lint 0, 885 pass/0 fail/1 skip, db:generate no-changes, drizzle diff exit 0), Codex
review-11 = ZERO findings. F1 rejected (pre-existing aspirational layering language, out of scope). PENDING:
CLOSEOUT — roadmap status→done + README index DONE. Scoped commit AWAITS explicit user go-ahead (git-ops
hard rule; NOT pushed).

### Prepared scoped 1.9 commit (awaiting explicit user go-ahead — do NOT push)
INCLUDE (path-scoped `git add`, never -A/.): `apps/` (all working-tree changes are 1.9: db/schema.ts barrel
rewrite, db/shared/*, db/core-schema.ts, every module schema.ts + schema.smoke.test.ts, the 10 staged file
moves services/→lib/ + →modules/*/services + repositories/users→system, broad SP3 importer-path updates across
modules, networth.ts NetWorthContributor SP1, ledger/accounts.ts accountBalancesAtDate, plugin.ts comment fixes,
new db/schema.decomposition.test.ts + db/shared/*.ts + ledger account-balances.test.ts); `CLAUDE.md`;
`tasks/01.09-cross-module-ports.md`; `tasks/README.md`; `tasks/020-cross-module-ports/` (this task's full
orchestration, user default = include tasks/).
EXCLUDE (belong to OTHER tasks — leave uncommitted): tasks/014-migrate-planning/TASK.md (1.5),
tasks/013-release-v1.97.0/commit-pr-final.md, tasks/015-statusline/**, tasks/018-migrate-system/commit-log.md,
tasks/BATCH-phase1-close.md.
Proposed message subject: `refactor(api): physical per-module schema ownership + flat-services cleanup (roadmap 1.9)`
with a body summarizing Policy B + NetWorthContributor + cleanup, and the Co-Authored-By: Claude trailer.
SP4: rewrite CLAUDE.md architecture (lines 42/43/49) to the final module layout with all 4 of review-9's
factual corrections (AC5); fix ALL stale schema-architecture comments (2 path comments + core-schema.ts:5 +
plugin.ts "thin re-export" sites + 8 smoke-test comment blocks) under a decidable rule with an explicit
leave-untouched list; remove the empty routes/ dir; run the full gate (AC6/AC4/AC11). NEXT: delegate impl
(comment-only + CLAUDE.md prose); independent verify (V1-V4); Codex impl review-10. Then CLOSEOUT: scoped commit
of all of 1.9 incl. tasks/ + roadmap 01.09 status→done + README index (user default; DO NOT push unless asked).
--- prior SP1 note ---
SP1 (AC1 net-worth contributor) done: ledger now
owns accountBalancesAtDate (faithful raw-SQL move, 3 binds [userId,asOf,userId]); investments/networth
computeNetWorth consumes it; `sql` import dropped; new account-balances.test.ts (stub-execute, asserts
mapping + exact ordered params + params.length===3). Independently verified green (typecheck/lint 0; apps/api
885 pass/1 skip [skip = storage-contract, NOT networth.route which RAN+passed under a real DB]; networth.test
39/39 unchanged). Codex impl review-6: correct + net-worth provably preserved; 2 Low findings (test string-
filter; removed comments/formatting) BOTH resolved + re-verified. NEXT: SP3 (flat-folder cleanup), then SP4
(docs + final gate), then scoped commit incl. tasks/ (user default; do not push). SP1 files: ledger/services/
accounts.ts, investments/services/networth.ts, ledger/services/account-balances.test.ts.
IMPLEMENTING — **SP0 + SP2 (SP2a & SP2b) COMPLETE.** Policy B (layered) LOCKED (user chose Option B
2026-08-05). SP2a (12 shared tables + 22 enums → db/shared/{foundation,hubs,recurring,spines,ledger}.ts)
and SP2b (38 residents into 8 module schema.ts + pure barrel + schema.decomposition.test.ts) both
independently verified green with zero migration diff; Codex impl reviews review-3 (SP2a: 0 findings) and
review-4 (SP2b: 1 P2 test-tautology, RESOLVED via DB-name uniqueness check) both cleared. AC2/AC4/AC9/AC10/
AC11 proven for the schema decomposition. NEXT: SP1 (behavioral cross-module ports), then SP3 (flat-folder
cleanup), then SP4 (docs + final gate), then scoped commit incl. tasks/ (user default; do not push).
This is the largest, most delicate Phase-1 task — sub-phases below. 1.1-1.8 + 1.10 all COMMITTED
(cfc36b5 / 825705d); dependency satisfied.

## Objective
Close Phase 1: (A) replace raw cross-domain reads with declared ports; (B) physically decompose the
schema so each module's `schema.ts` holds the real `pgTable()`/`pgEnum()` it owns (no more thin
re-exports), with a documented policy for cyclic SCCs; (C) empty and delete the flat `services/` +
`repositories/` folders. NO behaviour change: net-worth numbers, route surface, and every table/column
name invariant; zero migration diff.

## Root Cause
Not a defect — roadmap 1.9, the ninth and final Phase-1 task, the closer that resolves every transitional
surface tasks 1.1-1.8 deliberately deferred.

## Decomposition (sub-phases — sequenced by dependency)
- **SP0 — FK graph + SCC analysis (foundation, IN FLIGHT).** Produce the complete cross-module
  foreign-key graph (every pgTable, every FK edge) and its SCC decomposition; from it, a proposed final
  owning module for every acyclic table and a per-SCC shared-core policy for cyclic ones. Pure analysis
  (read-only) → design doc. Gates SP2. Feeds the Codex plan review.
- **SP1 — Cross-module ports (behavioral).** NetWorthContributor per module (ledger/credit/investments/
  protection), reward earn-rate lookup port (1.2), goal-projection port (1.5). Net-worth numbers unchanged.
  Largely independent of SP2's physical moves, but AC "no module imports another module's schema slice"
  couples them — sequence SP1 before or alongside SP2 with care.
- **SP2 — Physical schema decomposition (highest risk).** Per SP0's assignment: relocate each pgTable's
  physical definition into its owning `modules/<d>/schema.ts`; convert every thin re-export (incl.
  modules/ledger/schema.ts) to real ownership; introduce per-SCC shared-core schema file(s) following the
  db/core-schema.ts precedent; keep exactly ONE Drizzle Kit entry point; prove zero migration diff
  (drizzle/ content-hash manifest) + table-object identity (schema.smoke-style) for EVERY relocation.
  Depends on SP0.
- **SP3 — Flat-folder cleanup.** Rehome the remaining flat services — autopilot (→ automation or planning;
  roadmap leans automation since 1.6 created it), cache, anomaly, balances, ownership, periods — into
  owning modules; resolve repositories/users.ts (fold into system module or drop); delete the emptied
  flat services/ + repositories/ folders. Depends on SP1+SP2 (a service can't be rehomed until its
  schema/port homes exist).
- **SP4 — Docs + final gate.** Update CLAUDE.md architecture section to describe the final module layout;
  full typecheck+lint+test; route snapshot unchanged; zero migration diff.

Each sub-phase gets its own plan → Codex plan review → implement → independent verify → Codex impl review
before the next dependent one starts. SP0 and SP1 could run in parallel (SP1 doesn't need the FK graph);
SP2 waits on SP0; SP3 waits on SP1+SP2.

## SP0 findings + the AC2-vs-AC8 policy fork (DECISION NEEDED)
FK analysis (investigation-1, coordinator-validated): 51 tables, NO table-level FK cycles (pure DAG);
module-level SCC of 6 {ledger, planning, credit, investments, protection, ingest} incl. a 3-way
credit→ingest→ledger→credit cycle; `accounts` = dominant hub (16 inbound cross-module FK cols).

The crux: AC8 says relocate to owning module "where the graph is acyclic for that table" + shared-core
for cyclic remainder; AC2 says "no module imports another module's schema slice directly." These conflict
because ALL cross-module FKs route through `transactions`:
- **Policy A (minimal shared — 7 tables):** shared = {accounts, goals, categories, resources,
  recurringTemplates, mailboxAccounts, emailIngestions}. Makes the MODULE import graph acyclic (AC8 met,
  matches roadmap's "small core file per SCC"). BUT leaves 4 ACYCLIC sibling-module schema imports:
  ingest→ledger (extractedTransactions→transactions) and ledger→{investments,credit,protection}
  (transactions.sipId/reconciledStatementId/policyId). Those literally brush AC2.
- **Policy B (strict AC2 — ~12 tables):** because `transactions` is referenced cross-module (by ingest)
  it must go to shared; once it does, its FK targets sips/insurancePolicies/statementReconciliations must
  follow (shared can't import modules), and sips→holdings drags holdings in too. shared ≈ {the 7 +
  transactions, sips, insurancePolicies, statementReconciliations, holdings}. Fully satisfies AC2 (modules
  import ONLY core+shared) but pulls the spines of ledger/investments/protection into a big shared file —
  undermining "physical ownership per module."
### Codex plan review-1 digest (do not re-read review-1.md)
Codex VALIDATED the graph: 51 tables, zero table-level cycles, 6-module SCC, 3-way cycle, Policy A's exactly
4 sibling-import relationships (5 FK cols — ingest uses transactions twice), Policy B's 12-table cascade —
all confirmed correct. Artifact corrections to make in investigation-1 (AC7 deliverable; none change the
SCC): (i) 3a/3b misclassifies ledger-internal edges (transactions→accounts/categories/resources/
recurringTemplates at 290/303/336/344; recurringTemplates→accounts/categories/resources at 656/659/672) as
cross-module; (ii) accounts source breakdown = credit×7, investments×3, ingest×3, system×1, protection×1,
automation×1 (total 16 cross-module; 18 incl. 2 ledger-internal); (iii) categories cross-module inbound = 3
not 4; (iv) holdings cross-module inbound = 0 not 1 (sips.targetHoldingId is investments-internal).
Codex VERDICT: choose **Policy B** — Policy A literally fails AC2 ("acyclic ≠ none"; AC8 doesn't repeal
AC2); Policy A is only permissible if TASK.md explicitly amends AC2. Codex's THIRD OPTION (adopted into the
recommendation): implement Policy B as LAYERED shared files (foundation: goals/categories/resources/
mailboxAccounts; hubs: accounts/emailIngestions; recurring: recurringTemplates; domain spines: holdings/
sips/insurancePolicies/statementReconciliations; ledger spine: transactions) under db/, each importing only
earlier layers, ALL behind the unchanged single db/schema.ts Drizzle barrel — small reviewable files, strict
AC2, one entry point, one object per table. "Per-SCC" split is meaningless (one SCC); layer by DAG depth.
Codex SP2 implementation cautions (fold into SP2 plan): zero-migration-diff needs byte-equivalent defs
(indexes/onDelete/checks/composite keys/enum names+values — callback constraints easy to miss); compare
schema serialization before/after, not just an empty `drizzle-kit generate`; db/schema.ts stays the sole
barrel re-exporting every table+enum EXACTLY once; strict table-OBJECT identity (never a 2nd
pgTable("x",...)); enums defined once; declaration/init order must follow the DAG.

### DECISION (LOCKED 2026-08-05) — **Policy B, layered**
User chose Option B. Rationale (coordinator, aligned with Codex): Policy B satisfies AC2 as written and gives
a single mechanically-enforceable invariant — *a module's schema.ts imports only db/core-schema.ts and the
shared layers, never another module's schema.ts* (lintable, cannot rot). The file graph is a strict DAG by
construction, so no latent-cycle or declaration-order fragility. Policy A's only upside (physical locality of
transactions/sips/etc.) is aesthetic and cost a standing AC2 violation + perpetual manual cycle-vigilance.
Guardrail against shared-layer bloat: a table enters the shared layer ONLY when genuinely referenced by ≥2
modules; layering keeps each file small; modules keep ALL logic/services (shared layer holds table+enum
DEFINITIONS only). Superseded §6 of investigation-1 (Policy A minimal cut) with a banner.

### AC7 artifact status — CORRECTED
The 4 Codex-flagged errors in investigation-1 are fixed (coordinator, direct edit — tasks/ file): (i) 7
ledger-internal edges moved §3b→§3a with a correction note; (ii) accounts breakdown credit×7/investments×3/
ingest×3/system×1/protection×1/automation×1 (16 cross-module, 18 incl. 2 ledger-internal); (iii) categories
cross-module inbound = 3; (iv) holdings cross-module inbound = 0. SCC decomposition unchanged. AC7 satisfied.

### SP2 authoritative layer design (Policy B-layered) — DRAFT for Codex plan review
Shared surface = 12 cross-domain table definitions, split into DAG-depth layer files under db/, each importing
ONLY earlier layers (+ core), all re-exported by the unchanged single db/schema.ts barrel:
- **db/core-schema.ts** (unchanged leaf): `users`.
- **Layer 1 — foundation** (imports core only): `goals`, `categories`, `resources`, `mailboxAccounts`.
- **Layer 2 — hubs** (imports core + L1): `accounts` (goalId→goals), `emailIngestions` (mailboxId→mailboxAccounts).
- **Layer 3 — recurring** (imports core + L1/L2): `recurringTemplates` (accountId→accounts, categoryId→categories, resourceId→resources).
- **Layer 4 — domain spines** (imports core + L1–L3): `holdings` (goalId→goals), `insurancePolicies` (resourceId→resources), `statementReconciliations` (accountId→accounts, ingestionId→emailIngestions); then `sips` (goalId→goals, sourceAccountId/targetAccountId→accounts, targetHoldingId→holdings).
- **Layer 5 — ledger spine**: `transactions` (accountId→accounts, categoryId→categories, resourceId→resources, recurringTemplateId→recurringTemplates, policyId→insurancePolicies, sipId→sips, reconciledStatementId→statementReconciliations).
Every remaining table stays in its module's schema.ts as a real pgTable(), importing only core+shared for its
cross-layer FKs and its own module tables for intra-module FKs. Modules import ONLY core + shared layers —
never each other. Enums travel with their owning table's layer/module.

**Coordinator DAG self-verification (against corrected §3a/§3b):** every shared table's FK targets resolve to
`users` or a strictly-earlier layer; NO shared table references a module-resident table (shared cannot import
modules — the load-bearing invariant); each module's residents reference only core+shared+own-intra tables.
Consequence: `extractedTransactions.transactionId → transactions` now resolves to SHARED, so Policy A's lone
surviving `ingest→ledger` edge DISSOLVES; every module imports ONLY core+shared; AC2 holds with zero exceptions.
Module residents after extraction: ledger={transactionSplits,transferLinks,transactionLinks,merchantRules,
userTasks,attachments}; investments={accountNpsDetails,npsDetails,goldDetails,holdingValuations,holdingEvents,
netWorthSnapshots}; credit={cardDetails,cardIssuerSettings,cardStatements,bankDetails,overdraftDetails,
rewardEntries,emiDetails}; protection={retirementDetails,insuranceHealthCards}; planning={budgets,budgetLines,
budgetAlerts,subscriptionDismissals,projectionSettings}; ingest={imports,importRows,importPresets,
mailboxCredentials,extractedTransactions}; system={userProfiles,familyMembers,notifications,alertLedger,
notificationPrefs}; automation={aiSettings,aiEvents}. Total 50 monolith tables = 12 shared + 38 module-resident.

## SP2 Plan (Policy B-layered) — for Codex plan review
- **P1** — Create the shared layer files under `apps/api/src/db/` (proposed: `shared/foundation.ts`,
  `shared/hubs.ts`, `shared/recurring.ts`, `shared/spines.ts`, `shared/ledger.ts` — or an equivalent
  DAG-depth layering; exact filenames are an implementation choice, but each file imports ONLY core + earlier
  layer files). Move the 12 shared `pgTable()` definitions (and each one's enums) OUT of `db/schema.ts` into
  the correct layer file, preserving every column, default, `.references()` (incl. `onDelete`/`onUpdate`),
  index, unique/composite key, check constraint, and enum name+values BYTE-FOR-BYTE. No table redefined; each
  `pgTable()`/`pgEnum()` object created EXACTLY once.
- **P2** — Convert each `modules/<d>/schema.ts` from a thin re-export of `db/schema.ts` into the real physical
  home of its resident tables (the 38 above). Each module file imports its cross-layer FK targets from the
  shared layer files and `users` from `db/core-schema.ts`; NO module imports another module's schema.ts.
- **P3** — Keep `db/schema.ts` as the SINGLE Drizzle Kit entry point: it re-exports every table + enum EXACTLY
  once (from the shared layers + every module schema.ts) so drizzle-kit still sees the full set from one file.
  `drizzle.config.ts` continues to point at `./src/db/schema.ts` only (AC10: exactly one entry point).
- **P4** — Update every non-schema import site that reaches into `db/schema.ts` for a relocated table, if any
  remain, to import from the module/shared home (or leave `db/schema.ts` barrel re-export intact so existing
  `from "../../db/schema.ts"` imports keep resolving — decide and document; the barrel-preserving route is
  lower-risk and preferred).
- **P5** — Prove zero migration diff: `db:generate` produces NO new migration; additionally compare the
  drizzle schema *serialization* before/after (snapshot/meta), not merely an empty generate, per Codex caution.
- **P6** — Prove table-object identity for every one of the 50 relocations: extend the `schema.smoke.test.ts`
  pattern so `db/schema.ts`'s exported table object is `===` the module/shared file's object (no second
  `pgTable("x",…)` anywhere). Enums asserted defined once.

### Codex SP2 cautions folded in (from plan review-1)
Zero-migration-diff needs byte-equivalent defs (indexes / onDelete / checks / composite keys / enum
names+values — callback-form constraints are easy to drop); compare schema serialization before/after, not
just an empty `drizzle-kit generate`; `db/schema.ts` stays the sole barrel re-exporting every table+enum
EXACTLY once; strict table-OBJECT identity (never a 2nd `pgTable("x",…)`); enums defined once; file
declaration/init order must follow the DAG (a layer file importing a later layer = ES cycle / TDZ crash).

### SP2 Verification (independent worker, read-only) — STRENGTHENED per Codex plan review-2
- **T1** — Capture a CLEAN baseline manifest (git-tracked content hash) of EVERY file under `apps/api/drizzle/`
  before impl; after impl, `npm run db:generate` produces NO new file AND the full `apps/api/drizzle/` tree is
  byte-identical to baseline (a generator can MODIFY an existing meta file without adding one). Literal cmd +
  output + exit.
- **T2** — Drizzle schema serialization identical before↔after via a documented, reproducible command/artifact
  (not "snapshot/meta serialization identical" hand-wave; name the exact command compared).
- **T3** — Table-object-identity test: every one of the 50 relocated tables exported by the `db/schema.ts`
  barrel is `===` the object defined in its shared-layer/module home; barrel `users` export `===`
  `core-schema.ts`'s. Identity universe = 51 tables (50 relocations + already-core `users`).
- **T3b** — Enum-object-identity test: every one of the 38 enums `===` between barrel and its defining file,
  ESPECIALLY the two cross-home enums `expenseNecessity` (defined L1 categories, consumed by L5 transactions)
  and `mailboxProvider` (defined L1 mailboxAccounts, consumed by ingest resident `mailboxCredentials`).
- **T3c** — Export-set test: barrel exports EXACTLY 51 table objects + all 38 enums, none twice (no duplicate/
  ambiguous export from broad `export *`).
- **T3d** — Static definition counts: exactly 51 `pgTable()` repo-wide (50 shared+module + 1 core `users`),
  exactly 38 `pgEnum()`; ZERO `pgTable()`/`pgEnum()` definitions remain physically in `db/schema.ts` (barrel
  is re-exports only); NO thin `export { … } from "../../db/schema.ts"` module schema survives (AC9).
- **T4** — `npm run typecheck`, `npm run lint`, `npm run test` all green (literal pass/fail counts + exit).
- **T4b** — Runtime init/import test: a test that imports `db/schema.ts` + every shared layer file + every
  module `schema.ts` and touches each export, catching ESM cycles / TDZ that typecheck alone misses.
- **T5** — Route snapshots (`route-surface` + `route-table`) byte-unchanged (AC4).
- **T6** — `backup.test.ts` green (ALL_TABLES/USER_TABLES names unchanged — no table renamed). NOTE: this
  proves name coverage only, NOT schema equivalence — T1/T2/T3 carry AC11.
- **T7** — Static direction check: no `modules/*/schema.ts` imports another `modules/*/schema.ts` (AC2); AND
  no shared-layer file imports a module; AND each shared layer imports ONLY core + strictly-earlier layers
  (L1→core only). Grep evidence.
- **T8** — `drizzle.config.ts` has EXACTLY one schema path (`./src/db/schema.ts`, unchanged) AND no second
  Drizzle config / alternate CLI schema entry exists anywhere (AC10).
- **T9** — Source-control diff confirms ONLY intended schema files + tests changed; no private artifacts.

### Codex plan review-2 digest (do not re-read review-2.md)
VERDICT: design VALIDATED, no blocking defect — 12-table set complete & minimal, L1→L5 a valid DAG, no shared
table references a module resident, `ingest→ledger` dissolves (via BOTH `extractedTransactions.transactionId`
AND `.matchedTransactionId` → transactions). Findings folded into plan/verification above. Coordinator
corrections to Codex: (a) enum count is **38**, not Codex's 37 — verified by reading source (line 31 is a
comment; 38 real `pgEnum()`, 50 `pgTable()`); T3b/T3d use 38. Key refinements adopted:
- **Import path invariant (CRITICAL):** modules import shared-layer FILES directly + `users` from core —
  NEVER the `db/schema.ts` barrel (the barrel re-exports modules, so a module importing it recreates a
  cycle). Non-schema/service code MAY keep importing `db/schema.ts`. This runtime-vs-schema-file distinction
  is explicit in P4.
- **"Enums travel with owning table" is imprecise:** an enum is DEFINED once in its owning layer/module and
  IMPORTED by any other-home consumer (expenseNecessity, mailboxProvider). Barrel re-exports each enum once.
- **Shared-set closure rule (correct the ≥2-modules guardrail):** the true rule is "start from cross-module
  FK targets required by AC2, then close transitively over all outbound FKs FROM shared tables"
  (`mailboxAccounts` enters only because shared `emailIngestions.mailboxId` points at it, not via 2 modules).
- **AC9 nuance:** ledger's schema.ts becomes real ownership for its 6 residents; the 5 former-ledger shared
  tables (accounts/categories/resources/recurringTemplates/transactions) live in shared layers, NOT
  physically in modules/ledger/schema.ts. "Thin re-export → real ownership" must not be read as "every symbol
  ledger currently exports must be defined in ledger."
- **Mechanical-move discipline:** do NOT remove `AnyPgColumn` casts, reorder method chains, or "clean up"
  callback SQL during the move — move definitions (with their comments) verbatim; refactor never.
- **Byte-equivalence hazards to preserve verbatim** (from Codex §5): callback-form indexes/unique/checks
  (categories :240-248, transactions partial-unique :362-384, userTasks :419-425, cardIssuerSettings composite
  PK :864-887, statementReconciliations :1192-1195, holdingEvents partial-unique :1418-1421, sips :1491-1505);
  FK `onDelete` variety (cascade vs set-null vs omitted) — never normalize; NO `onUpdate` anywhere (preserve
  absence); enum name+export+value spelling+ORDER; descending index cols (transactions :363-368, notifications
  :631, aiEvents :1762); SQL array defaults (accounts upiIds :182-185, txn tags :314-317, import headers :484);
  SQL predicate style (raw col names vs userTasks' Drizzle-column interpolation); one-to-one FK-as-PK tables;
  `transferLinks` column-level `.unique()` (:453-460); bigint `{mode:"number"}`, tz options, nullability.
- **Stale comments to fix:** `db/schema.ts:31`, `modules/ledger/schema.ts:3`, `modules/automation/schema.ts:4`
  all currently assert definitions live in the barrel — must be corrected after the move.
- **File granularity:** the proposed 5 shared files are sufficient; do NOT over-granularize.

## SP2 Status: APPROVED (2026-08-05)
Design validated by Codex plan review-2, no blocking defect; all findings folded into the plan and the
strengthened T1-T9 verification.

### SP2 implementation decomposition (de-risk the less-proven backend-engineer)
Each step keeps typecheck/tests green AND zero-migration-diff provable on its own:
- **SP2a — shared layers (12 tables).** Create the 5 shared-layer files under `apps/api/src/db/shared/`
  (foundation/hubs/recurring/spines/ledger). MOVE the 12 shared tables + their owned enums out of
  `db/schema.ts` into the correct layer. `db/schema.ts` `import`s them from the layers (for the still-inline
  module-resident tables that FK into them) AND re-exports them, so the barrel still exposes all 50 tables/38
  enums to drizzle-kit. The 8 module `schema.ts` files are UNTOUCHED (still thin re-exports of the barrel).
  Intermediate state: AC2 not yet met (modules still re-export barrel) but green + zero-diff. Proves the
  layer mechanics + zero-diff/identity harness on 12 tables. Full loop: impl → verify → Codex review.
- **SP2b — module residents (38 tables) + finalize.** Convert each of the 8 module `schema.ts` to physical
  ownership of its residents (real `pgTable()`), importing shared from the LAYER FILES directly + `users`
  from core — never the barrel. `db/schema.ts` becomes a pure re-export barrel (0 inline defs). Now AC2/AC9
  fully met. Add the identity/export-set/runtime-init tests (T3/T3b/T3c/T3d/T4b). Fix stale comments. Full
  loop again. Only after SP2b green does SP2 close.

### SP2a: COMPLETE (2026-08-05)
Implemented by backend-engineer (backend-sp2a-1.md). Footprint: only `db/schema.ts` (M) + new `db/shared/`
{foundation,hubs,recurring,spines,ledger}.ts. Independent verify (verification-sp2a-1.md, different worker):
typecheck exit 0; 881 pass / 1 expected skip / 0 fail; `db:generate` = "No schema changes", 135-file drizzle
manifest byte-identical (ZERO migration diff); modules untouched. Coordinator read db/schema.ts directly: 0
surviving pgTable defs of the 12 moved tables; re-export block (lines 27-31) covers all 12 tables + 22 enums
once; import block (21-25) pulls back only the minimal symbols the 38 inline residents reference
(goals/resources/statementReconciliations re-export-only — no resident refs them). Grep confirmed layer import
directions form a strict DAG (foundation→core only … ledger→all-earlier), no shared file imports the barrel or
any module. Codex impl review-3: ZERO findings — every moved table byte-identical to HEAD, all 22 enums exact,
and Codex explicitly closed the "zero-diff could mask type-only/export-name/identity changes" gap via direct
byte comparison. AC-a1..AC-a5 all proven. The verifier's "38 pgTable remain in schema.ts" was a mistake in the
brief's stated expectation, not a code defect (SP2a intentionally leaves the 38 residents inline until SP2b).

### SP2b resident assignment (for DELEGATION-sp2b.md)
38 resident tables + 16 resident enums move from db/schema.ts INTO their module schema.ts (real pgTable),
importing shared from db/shared/<layer>.ts directly + users from core; db/schema.ts becomes a PURE barrel
re-exporting shared (12+22) + all 8 modules (38+16) + users. Modules NEVER import the barrel.
- system: tables userProfiles, familyMembers, notifications, alertLedger, notificationPrefs; enums familyRelationship, educationStage
- ledger: tables transactionSplits, transferLinks, transactionLinks, merchantRules, userTasks, attachments; enums NONE (all 7 ledger enums already in shared)
- credit: tables cardDetails, cardIssuerSettings, cardStatements, bankDetails, overdraftDetails, rewardEntries, emiDetails; enums cardNetwork, bankAccountSubtype
- investments: tables accountNpsDetails, npsDetails, goldDetails, holdingValuations, holdingEvents, netWorthSnapshots; enums npsTier, goldForm, holdingEventType, holdingEventSource
- protection: tables retirementDetails, insuranceHealthCards; enums NONE (all 4 in shared)
- planning: tables budgets, budgetLines, budgetAlerts, subscriptionDismissals, projectionSettings; enums budgetPeriod
- ingest: tables imports, importRows, importPresets, mailboxCredentials, extractedTransactions; enums importStatus, extractedTxnStatus, txnDirection, extractedTxnIntent
- automation: tables aiSettings, aiEvents; enums aiProvider, aiEventKind, aiEventStatus
Only intra-module resident→resident FKs: importRows→imports (ingest), budgetLines→budgets (planning); all
other resident FKs point at shared. Add tests T3/T3b/T3c/T3d/T4b; fix stale comments (db/schema.ts:31,
modules/ledger/schema.ts:3, modules/automation/schema.ts:4, and any sibling module comments).

### SP2b Codex impl review-4 digest (read in full; do not re-read)
Codex raised ONE finding, [P2] non-blocking test-quality only, on schema.decomposition.test.ts:110-114:
the "no duplicates" Set-size==length assertion is TAUTOLOGICAL — Object.entries(barrel) yields unique JS
export names, so it can never fail. Codex EXPLICITLY confirms the test correctly covers all 50 tables +
users + 38 enums and that every Object.is identity assertion is sound; only the "no duplicates" claim is
weaker than its name. Coordinator validation: finding accurate but NOT a correctness hole — meaningful
duplicates are already caught (distinct-JS-name dup DB table → count becomes 51 → count assert fails;
same-JS-name dup → ESM ambiguous re-export → typecheck/lint fail; unexported dup → dead code invisible to
drizzle-kit; plus db:generate zero-diff is drizzle's own authoritative entry-graph duplicate check). RESOLVED
by strengthening the test to assert DB-name-level uniqueness (drizzle getTableName / enum.enumName) across all
barrel table+enum exports — closes the tautology. Codex's "repo-wide static uniqueness" suggestion (unexported
dup) deemed overkill/harmless. No finding on the actual barrel/module/identity decomposition work.

## SP1 status: INVESTIGATED (not yet planned) — see investigation-2.md
Port surfaces mapped. Highlights (read investigation-2.md §4 when planning SP1): (1) net-worth
`computeNetWorth` (investments/networth.ts:57-67) reads ledger accounts/transactions via BARE raw-SQL string
table names → `LedgerBalanceAtDate` port (also removes a rename-safety gap SP2 would otherwise leave);
protection bucket already null (no protection contributor). (2) credit/reconciliation-writes.ts:332 calls
investments `repairSnapshots` → `NetWorthRepairer` port. (3) reward earn-rate (credit/rewards.ts:58-103) has
ZERO cross-module consumers today — planned port surface only. (4) planning/goals.ts getGoalProgress imports
ledger/investments/system → 3 ports. (5) pure-function cycles to resolve by moving to @compass/shared or
lib/errors.ts: planning↔investments allocation-class fns; `isUniqueViolation`; system↔planning budget-alert.
(6) ledger/recurring.ts:12 → credit emis `EmiAmortizationStepper` port. SP1 is INDEPENDENT of SP2a (schema
files only) so can be planned/run without collision; sequence SP1 impl vs SP2b (both touch module dirs) with
care. NOTE: point (5)'s pure-function moves may need to precede SP2b to avoid module→module import churn.

## SP1 PLAN (behavioral ports) — AC1. Scoped TIGHT to the one genuine raw cross-domain read.
Rationale (coordinator, validated against code): AC1 is the ONLY hard SP1 acceptance criterion
("NetWorthContributor or equivalent implemented per module; net-worth numbers unchanged"). AC2/AC9 (schema
slices / thin surfaces) are already met by SP2. The broad service→service import map in investigation-2 §4
(30+ edges: automation→planning, credit→ledger, ingest→ledger, planning→system, etc.) is NOT covered by any
AC — those are PERMITTED service-function calls, not schema imports — so port-ifying all of them is scope
creep and explicitly OUT. The pure-fn cycle moves / isUniqueViolation relocation (investigation-2 §5,§6) are
likewise non-AC and DEFERRED (note them for a possible later cleanup, not SP1). The ONE true "raw cross-domain
read" (objective A) is the bare-SQL accounts⋈transactions join in investments/networth.ts:57-67 — it also
carries the §8 rename-safety hole. That is exactly what AC1 targets. SP1 = fix that, nothing else.

"Per module" contributors reduce to TWO only: LEDGER (account balances-at-date; note credit_card/loan/
overdraft are ledger ACCOUNT TYPES whose balances already flow through this one accounts query — there is NO
separate credit contributor) and INVESTMENTS (portfolio holdings, already in-module via portfolioValue).
protection contributes nothing (ACCOUNT_BUCKET.insurance === null). So no credit/protection contributor needed.

KEY CONSTRAINT (discovered in networth.test.ts): that suite drives computeNetWorth through a STUB db whose
`.execute()` returns {rows:[]} and inspects bound params for failFor. Therefore the port MUST be a FAITHFUL
raw-SQL move via `db.execute(sql\`…\`)` — a query-builder rewrite would bypass the stub's execute() and break
the suite. Faithful move ⇒ identical SQL + identical bound params ⇒ net-worth numbers provably unchanged, and
the whole existing suite stays green unmodified (computeNetWorth→accountBalancesAtDate→db.execute(same query)).

- P1: In apps/api/src/modules/ledger/services/accounts.ts add exported `interface AccountBalanceAtDate
  { type: AccountType; balancePaise: number }` and `export async function accountBalancesAtDate(db: Db,
  userId: string, asOf: string): Promise<AccountBalanceAtDate[]>` containing the EXACT SQL now in
  networth.ts:57-67 (byte-identical query text + the two ${userId}/${asOf} binds), mapping each row to
  `{ type: r.type as AccountType, balancePaise: Number(r.balance) }`. Idiomatic — same raw-SQL-in-owning-module
  pattern as accounts.ts listAccounts / average-balance.ts.
- P2: In investments/services/networth.ts computeNetWorth, replace the `db.execute(sql\`…\`)` block + its
  `res.rows` iteration SOURCE with `const entries = await accountBalancesAtDate(db, userId, asOf)`; iterate
  `for (const r of entries)` using `r.type` (keep the runtime `bucket === undefined` guard exactly) and
  `const balance = r.balancePaise`. ACCOUNT_BUCKET map, bucket sums, accountAssets/Liabilities, holdingsValue
  via portfolioValue — ALL unchanged. Add `import { accountBalancesAtDate } from "../../ledger/services/
  accounts.ts";`. REMOVE now-unused `sql` from the drizzle import (→ `import { and, asc, eq, gte, lt, lte }`).
- P3: Add a focused stub-execute unit test for accountBalancesAtDate (in ledger/services/accounts.test.ts or a
  new colocated test): assert it maps rows {type,balance:"..."} → {type, balancePaise:Number} and that userId
  + asOf reach the bound params. Keep the existing networth.test.ts + networth.route.test.ts UNCHANGED and green.

### SP1 Codex plan review-5 digest (read in full; do not re-read) — APPROVED
No blocking findings; plan sound. Two refinements folded into DELEGATION-sp1: (a) the SQL has THREE bound
slots [userId, asOf, userId] — userId appears TWICE (transactions-subquery user filter line 63 AND outer
accounts user filter line 66) plus asOf at 63; all three interpolations copied verbatim (my "two binds"
phrasing was imprecise). (b) P3 test must assert exact ordered params [userId, asOf, userId] incl. the
duplicate userId, and add a large/negative bigint-STRING case for Number(r.balance). Codex confirmed: `sql`
is used ONLY by the moved query (safe to drop from import); the stub-execute interception keeps the whole
existing suite green unmodified; no new import cycle (investments→ledger via accounts.ts already exists, and
accounts.ts does not import transactions.ts so no cycle closes); AC1's "or equivalent" does NOT require empty
credit/protection adapters; user-isolation + no-injection preserved. SP1 PLAN STATUS: APPROVED.

SP1 Acceptance: AC1 met (ledger owns the balances-at-date contributor; investments consumes it); net-worth
numbers identical (proven by unchanged networth.test.ts + route snapshot). typecheck+lint+test green (AC6).
No schema/migration change. investments→ledger service import is allowed (already exists via goal-networth).
DEFERRED (not SP1, note for later): NetWorthRepairer port (credit→investments repairSnapshots), earn-rate
port (0 consumers), goal-projection ports, NotificationWriter, the two pure-fn cycles, isUniqueViolation move.

## SP3 investigation digest (investigation-3.md — read in full; do not re-read)
No `services/index.ts` or `repositories/index.ts` barrel exists — deleting both folders needs no barrel
update. Wiring touchpoints: `app.ts:27` imports `invalidateUserCache` from services/cache.ts (sole app.ts
ref); `jobs/index.ts:8-9` imports `evaluateAnomalies` (anomaly.ts) + `runAutopilotReview`/`runGoalReview`
(autopilot.ts); plugins reference none of the 7. Per-file owner + importer facts:
- **cache.ts** (`cached`, `invalidateUserCache`; imports only `ioredis` type — zero domain) → `lib/cache.ts`.
  Importers: app.ts:27, planning×4 (insights.ts:6, budgets.ts:23, dashboard.ts:6, cashflow.ts:8), credit
  emis.ts:7, investments sips.ts:27.
- **balances.ts** (`AccountBalance`, `bankCashBalances`, `bankCashTotal`; raw SQL on accounts/transactions,
  no module imports) → `modules/ledger/services/balances.ts` (ledger domain tables). Real importers: system
  prefs.ts:6, ledger epf-contributions.test.ts:12 (→ becomes sibling `./balances.ts`), planning dashboard.ts:5
  + cashflow.ts:7. (sip-lifecycle.ts:89 is a comment, not an import.)
- **ownership.ts** (`assertOwnedAccount/Category/Goal/Holding`; imports db/schema.ts tables + lib/errors) →
  `lib/ownership.ts` (guards for tables owned by 3 modules, called by 5 — only neutral home). 8 importers:
  system prefs.ts:8, credit emis.ts:13, ledger recurring.ts:13/transactions.ts:16/accounts.ts:13, planning
  budgets.ts:14, investments holdings.ts:19/sip-lifecycle.ts:18.
- **periods.ts** (LIABILITY_TYPES_SQL, periodRange, prevPeriodKey, currentPeriodKey, monthKeyOf,
  spentByCategory, NecessitySpendRow, spendByNecessity, incomeExpense; @compass/shared + raw SQL) →
  `lib/periods.ts` (HIGHEST CHURN — 14 importers across 6 modules + anomaly sibling; moving to planning would
  invert direction). Importers: system notifications.ts:7; planning insights.ts:7, cashflow.ts:10,
  reports.test.ts:5, dashboard.ts:14, goals.ts:44, budgets.ts:15, insights.ts(svc):4, reports.ts:21; ingest
  inbox.test.ts:12; ledger recurring.test.ts:12; credit alerts.ts:6; automation tools.ts:11; anomaly.ts:8.
- **autopilot.ts** (runAutopilotReview, runGoalReview, + helpers; imports planning×3 + system×2) →
  `modules/automation/services/autopilot.ts`. Sole real importer jobs/index.ts:9 (+ colocated autopilot.test.ts
  moves with it). Its `../modules/planning|system/...` imports become sibling `../../planning|system/...`.
- **anomaly.ts** (sensitivityThreshold, detectAnomaly, evaluateAnomalies; imports system×2 + sibling
  ./periods.ts) → `modules/automation/services/anomaly.ts`. Sole importer jobs/index.ts:8 (+ anomaly.test.ts).
  Its `./periods.ts` sibling import must repoint to `../../../lib/periods.ts`.
- **repositories/users.ts** (UserRow, countUsers, findUserByEmail, findUserById, createUser; Drizzle on users)
  → fold into `modules/system/services/users.ts`. Importers: db/bootstrap.ts:15 (deploy script — no cycle),
  system demo.ts:28, services/auth.ts:7 (also drops its separate UserRow import), routes/auth.ts:18.
After all 7 moves, `apps/api/src/services/` and `apps/api/src/repositories/` are empty → delete both (AC3).

## SP3 PLAN (flat-folder cleanup) — AC3. Mechanical rehome; ZERO behaviour change.
Discipline: MOVE each file (contents verbatim except its own relative-import paths, which change with depth),
then update every importer's path. NO logic edits, no signature changes, no "cleanup". Prefer `git mv` for the
physical relocation so rename history is preserved, then Edit import lines. lib/ is the established home for
cross-cutting infra (errors.ts, storage.ts already live there); AC2 restricts only module *schema.ts* imports,
so lib/ util code importing db/schema.ts (ownership) is fine.
- **P1 — cache.ts → `lib/cache.ts`.** Move file (no internal relative imports to fix — only `ioredis` type).
  Update 7 importer paths: app.ts:27, planning insights/budgets/dashboard/cashflow, credit emis, investments
  sips.
- **P2 — balances.ts → `modules/ledger/services/balances.ts`.** Fix its own `../db/index.ts` →
  `../../../db/index.ts`. Update importers: system prefs.ts:6, planning dashboard.ts:5 + cashflow.ts:7 (→
  `../../ledger/services/balances.ts`), ledger epf-contributions.test.ts:12 (→ sibling `./balances.ts`).
- **P3 — ownership.ts → `lib/ownership.ts`.** Fix its own imports: `../db/index.ts` and `../db/schema.ts` STAY
  `../db/…` (lib/ is one level under src, same depth as services/); its `../lib/errors.ts` becomes `./errors.ts`
  EXACTLY (errors.ts is a sibling inside lib/ now — review-7 §2 explicit fix). Update all 8 importer paths.
- **P4 — periods.ts → `lib/periods.ts`.** Fix its own `../db/index.ts` to lib depth (`../db/…` stays `../db/…`
  — lib/ is same depth as services/). Update all 14 importer paths (highest churn — enumerate every one from
  the digest). anomaly.ts's import is handled in P6. **ALSO move the colocated `services/periods.test.ts` →
  `lib/periods.test.ts`** (review-7 blocking-1): its two imports `./periods.ts` and `../modules/ledger/
  services/recurring.ts` BOTH remain byte-identical at the new location (sibling + same-depth), so the test
  file moves verbatim with ZERO edits. Without this move services/ is not emptied and AC3 fails.
- **P5 — autopilot.ts (+ autopilot.test.ts) → `modules/automation/services/`.** Fix its internal imports:
  `../db/index.ts`→`../../../db/index.ts`, `../db/schema.ts`→`../../../db/schema.ts`,
  `../modules/planning/...`→`../../planning/...`, `../modules/system/...`→`../../system/...`. Update sole
  importer jobs/index.ts:9 → `../modules/automation/services/autopilot.ts`. Move colocated test with matching
  import fix.
- **P6 — anomaly.ts (+ anomaly.test.ts) → `modules/automation/services/`.** Fix internal imports like P5, and
  repoint the `./periods.ts` sibling to `../../../lib/periods.ts` (its new home from P4). Update sole importer
  jobs/index.ts:8. Move colocated test.
- **P7 — repositories/users.ts → `modules/system/services/users.ts`.** Fix its own `../db/index.ts`/
  `../db/schema.ts` → system/services depth (`../../../db/…`). Update importers: db/bootstrap.ts:15, system
  demo.ts:28, routes/auth.ts:18 (→ `../services/users.ts`), services/auth.ts:7 (→ sibling `./users.ts`, and
  merge its `UserRow`+function imports into one from the new file, dropping the old repositories import).
- **P8 — delete emptied folders.** After P1–P7, `apps/api/src/services/` and `apps/api/src/repositories/` hold
  no files → remove both directories. Confirm no remaining reference to either path anywhere in the repo.

### SP3 Verification (independent worker, read-only) — proves AC3 + AC6 + AC4 — STRENGTHENED per review-7 §5
- **T1 (decisive AC3 proof)** — FILESYSTEM nonexistence: `test ! -e apps/api/src/services && test ! -e
  apps/api/src/repositories` (git status cannot represent an emptied directory — use the filesystem check, not
  status). Both directories must be gone.
- **T2** — Import-resolution audit SCOPED to executable/config source (`apps/**`, `packages/**`, and active
  config), EXCLUDING `tasks/`, `docs/`, `reviews/` (a literal repo-wide grep would match this plan's own
  historical references and falsely fail): ZERO surviving import of `services/cache.ts`, `services/balances.ts`,
  `services/ownership.ts`, `services/periods.ts`, `services/autopilot.ts`, `services/anomaly.ts`,
  `services/periods.test.ts`, `repositories/users.ts` (no bare flat `services/<file>` or `/repositories/`
  import). AND positively confirm every NEW destination file exists (lib/cache.ts, lib/ownership.ts,
  lib/periods.ts, lib/periods.test.ts, modules/ledger/services/balances.ts, modules/automation/services/
  {autopilot,autopilot.test,anomaly,anomaly.test}.ts, modules/system/services/users.ts).
- **T3 (proves AC6)** — `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run test` — literal
  pass/fail/skip counts + exit; the moved tests **lib/periods.test.ts, modules/automation/services/
  autopilot.test.ts, modules/automation/services/anomaly.test.ts** + the periods/balances-consumer tests
  (reports.test.ts, recurring.test.ts, inbox.test.ts, reports.test.ts, epf-contributions.test.ts) all RAN and
  passed at their paths. (Node test glob is `src/**/*.test.ts` and tsconfig includes all of `src` — no
  glob/tsconfig update needed; confirm.)
- **T4 (cycle safety — reframed; naive reverse-grep is INVALID)** — A module-level `system→automation` edge
  ALREADY EXISTS (system/routes/auth.ts:20 → automation/services/ai-settings.ts) and automation→planning→system
  already routes through tools.ts→planning + planning/goals→system; module-level service cycles are NOT
  forbidden (only schema.ts imports are, AC2). The real safety proof: autopilot.ts + anomaly.ts are imported
  ONLY by jobs/index.ts (a non-module job entrypoint) — grep-confirm NO module imports either moved file — so
  neither can participate in any import cycle that returns to itself; the reverse system→automation edge targets
  ai-settings.ts, not the moved files. Verifier must (a) confirm the sole importer of each moved file is
  jobs/index.ts, and (b) confirm typecheck + the runtime test suite load cleanly (no TDZ/ESM-cycle crash).
- **T5 (AC4)** — Zero migration diff: capture `git diff --exit-code -- apps/api/drizzle` (exit 0) AND
  `npm run db:generate` produces NO new file and MODIFIES no existing drizzle/meta file (SP3 touches no schema).
  Route surface unchanged: run the actual route-surface test by name (route-surface + route-table snapshot
  tests) and quote green result lines.
- **T6 (mechanical-move proof)** — `git status --porcelain` shows ONLY: the 7 implementation files + 3 test
  files (periods.test.ts, autopilot.test.ts, anomaly.test.ts) as moves (rename or delete+add), their importers'
  path edits, and the two deleted folders; NO private artifact touched. For each of the 10 moved files, a
  `git diff` / word-diff confirming the content differs from HEAD ONLY in import specifiers (no logic/signature
  change). Complete diff attached to the verification record.

### SP3 risks (folded into plan)
- periods.ts is the highest-churn move (14 import sites + its own test = 15 files) — a single missed path fails
  typecheck (good: caught). Enumerate all 14 importers explicitly in the DELEGATION; move periods.test.ts too.
- autopilot/anomaly land in modules/automation importing planning+system. Module-level automation↔system and
  automation→planning→system edges ALREADY exist; the move adds no NEW cycle back into the moved files because
  jobs/index.ts is their only importer. T4 proves this (not a naive reverse-grep).
- Relative depth to `../db/` from `lib/` = `../db/…` (lib/ and services/ are both one level under src). NOTE:
  lib/errors.ts does not itself import db, so it's a depth precedent only, not an import precedent — the worker
  confirms by directory arithmetic, not by matching errors.ts. ownership's `../lib/errors.ts` becomes
  `./errors.ts`.
- "lib files import no module" is a DIRECT-import rule only — transitively db/index.ts→db/schema.ts re-exports
  module schemas; that pre-existing facade edge is out of scope and not a violation.
- db/bootstrap.ts is a deploy script (an active package command) importing repositories/users.ts — its path
  update (P7) is easy to miss; T2 grep catches it.

### SP3: COMPLETE (2026-08-05) — independently verified + Codex impl review-8
Implemented by backend-engineer (backend-sp3-1.md): 10 files moved via git mv (7 impl + periods.test.ts +
autopilot.test.ts + anomaly.test.ts), 29 importers edited, both flat folders deleted. Independent verify
(verification-sp3.md, different worker): T1 both dirs ABSENT; T2 zero surviving old-path imports + all 10 new
files exist; T3 typecheck 0 / lint 0 / apps/api 885 pass·1 skip·0 fail (moved tests periods 4/4, autopilot 7/7,
anomaly 5/5 ran+passed); T4 autopilot/anomaly imported ONLY by jobs/index.ts, lib files import no module; T5
`git diff --exit-code -- apps/api/drizzle` = 0 + db:generate "No schema changes"; T6 all 10 renames similarity
100%, unstaged diffs are import-specifier-only. Coordinator read every moved file's import block directly:
ownership `../db/…`+`./errors.ts`; balances/users `../../../db/…`; autopilot/anomaly `../../../db/…`+
`../../planning|system/…` (anomaly `../../../lib/periods.ts`); auth.ts merged UserRow+fns from `./users.ts`;
jobs→automation — all correct. AC3 + AC4 + AC6 PROVEN.
### SP3 Codex impl review-8 digest (read in full; do not re-read) — REJECTED blocker + 2 real cleanliness items
Codex "blocking #1" (worktree not schema-clean: db/schema.ts, 8 module schema.ts, db/shared/, schema.decomposition
.test.ts, accounts.ts accountBalancesAtDate all differ from HEAD) is a MISATTRIBUTION — coordinator REJECTED it.
Those are the already-COMPLETE, already-verified, already-Codex-reviewed (reviews 3/4/6) SP1 + SP2 changes, which
intentionally accumulate uncommitted in the worktree until the single scoped 1.9 commit. Codex assumed the whole
tree must be SP3-only; the real SP3 claim is narrower (SP3's OWN moves are import-only + SP3 adds no schema
change), and Codex itself CONFIRMED it: migration diff clean, routes unchanged, all 10 moved files import-only,
all importers updated (incl. bootstrap.ts:15), auth.ts merge clean, folders gone, no cycle, 885/1/0. NOT a
defect. GENUINE (non-blocking) findings, DEFERRED to SP4 (docs pass, where the full gate reruns): two stale
source JSDoc comments naming deleted paths — planning/services/goals.ts:16 (→ services/autopilot.ts) and
investments/services/sip-lifecycle.ts:89 (→ services/balances.ts) — plus stale doc refs (docs/PRD-wow-features.md
:178, tasks/README.md:77/256, tasks/01.09-cross-module-ports.md:14 pre-move layout). Archival task/investigation/
review files keep old paths intentionally (contemporaneous evidence) — do NOT rewrite those.

### SP3 Codex plan review-7 digest (read in full; do not re-read) — resolved, APPROVED
TWO blocking findings, both VALIDATED against code and FIXED in the plan above:
1. **periods.test.ts overlooked** (services/periods.test.ts:3-4). It imports `./periods.ts` + `../modules/
   ledger/services/recurring.ts`; without moving it, services/ is not emptied and AC3 fails. FIXED: P4 now
   moves it to lib/periods.test.ts — coordinator confirmed both its imports stay byte-identical at lib/ depth
   (verbatim move, zero edits). Codex re-confirmed the other 6 importer inventories COMPLETE (cache 7, balances
   4, ownership 8, periods 14, autopilot jobs-only, anomaly jobs-only, users 4 incl. db/bootstrap.ts).
2. **T4 naive reverse-grep is INVALID** — system/routes/auth.ts:20 ALREADY imports automation/services/
   ai-settings.ts (coordinator confirmed), and automation→planning→system already routes via tools.ts+goals.ts.
   Module-level service cycles are not forbidden (only schema.ts, AC2). FIXED: T4 reframed to the real proof —
   autopilot/anomaly are imported ONLY by jobs/index.ts (non-module entry), so they cannot sit in a cycle
   returning to themselves; verify sole-importer=jobs + clean runtime load.
Non-blocking refinements ALL folded in: P3 ownership `../lib/errors.ts`→`./errors.ts`; T1 filesystem
nonexistence (not git status); T2 scoped to apps/**+packages/**+config, exclude tasks/docs, and positively
assert new destinations exist; T3 lists lib/periods.test.ts; T5 `git diff --exit-code -- apps/api/drizzle` +
named route-surface test; T6 includes all 3 moved tests + word-diff mechanical-move proof; "lib imports no
module" clarified as direct-import-only (db/index→schema facade edge pre-exists). Codex confirmed: relative
depths in P1-P7 all correct; destinations (cache/ownership/periods→lib, balances→ledger, autopilot/anomaly→
automation, users→system) sound; AC2 not violated by lib util importing db/schema.ts; NO route/table/migration
change; no barrel or tsconfig/test-glob pins the old dirs; repositories/ holds only users.ts. SP3 STATUS:
APPROVED — ready to implement.

## SP4 PLAN (docs + final gate) — AC5 + AC6 (+ re-confirm AC4/AC11). Final sub-phase, closes 1.9.
Verified current layout (coordinator, via glob): apps/api/src/{routes,services,repositories}/ ALL absent — every
domain's routes+services live in modules/<d>/{routes,services}; app.ts registers each module plugin.ts.
Cross-cutting utils in lib/ (cache, ownership, periods, errors, storage, csv, event-bus, secret-box, …). Schema:
db/schema.ts = PURE re-export barrel (single Drizzle Kit entry point), db/core-schema.ts = users, db/shared/
{foundation,hubs,recurring,spines,ledger}.ts = the 12 cross-domain tables (DAG-layered, Policy B); each
modules/<d>/schema.ts physically owns its resident tables.
- **P1 — CLAUDE.md line 42** (repositories claim). Current text ends "…`repositories/` is nearly empty (only
  `users.ts`) — **write new logic in `services/`, not `repositories/`.**" REPLACE: state the flat
  `services/`/`routes/`/`repositories/` SOURCE dirs are gone — all domain code lives under `modules/<domain>/`;
  DB-backed service operations take a `Db | Tx` handle and, where user-scoped, a `userId` (per review-9 #2, do
  NOT claim EVERY service does — some are pure, e.g. cycle-math/xirr); cross-cutting, domain-neutral helpers
  live in `lib/` (e.g. `cache.ts`, `ownership.ts`, `periods.ts`).
- **P2 — CLAUDE.md line 49** (the "Transitional module scaffold" paragraph). REPLACE wholesale. FINAL text
  (all review-9 corrections folded): "**Module layout (Phase 1 complete):** every domain lives in
  `modules/<domain>/` (`schema.ts`, `services/`, `routes/`, `plugin.ts`); `app.ts` registers each module's
  `plugin.ts`, not routes directly. Schema ownership is physical: each `modules/<domain>/schema.ts` defines the
  real `pgTable()`/`pgEnum()` for its RESIDENT tables/enums, and re-exports the cross-domain ones it references.
  The 12 tables referenced across modules (and their shared enums) are physically defined in DAG-layered files
  under `db/shared/` (`foundation` → `hubs` → `recurring` → `spines` → `ledger`; each layer may import
  `db/core-schema.ts` and only PRECEDING shared layers), and `db/core-schema.ts` holds the cycle-free core
  identity (`users`), on which the shared layers and module schemas depend. A module's `schema.ts` imports its
  cross-domain FK targets from `db/shared/*` and `users` from `db/core-schema.ts` — it NEVER imports another
  module's `schema.ts`. `db/schema.ts` is now a pure re-export barrel that re-exports every table + enum exactly
  once and remains the single Drizzle Kit entry point (`drizzle.config.ts` points only at it); service/runtime
  code may still import tables from `db/schema.ts`, but module `schema.ts` files import from the shared layers
  directly to keep the schema graph acyclic. (Runtime cross-module SERVICE imports are still allowed — only
  cross-module SCHEMA imports are forbidden.)"
- **P3 — CLAUDE.md line 43** (feature recipe). Currently "A new feature = new schema in `packages/shared`, new
  `services/x.ts`, new `routes/x.ts`, register it in `app.ts`." UPDATE (review-9 #8): distinguish the shared
  Zod/API contract (`packages/shared`) from the Drizzle persistence schema (`modules/<domain>/schema.ts`); a new
  feature in an EXISTING domain adds/updates files inside that module and registers the route in the module's
  existing `plugin.ts`; a NEW domain adds a `modules/<domain>/` (`schema.ts`, `services/`, `routes/`,
  `plugin.ts`) and registers its `plugin.ts` in `app.ts`.
- **P4 — fix ALL stale schema-architecture comments** (review-8 + review-9). RULE (decidable): a comment is
  STALE and must be corrected to the post-1.9 reality if it states/implies any of (i) a `modules/<domain>/
  schema.ts` is a "thin re-export" / re-exports the barrel / is "not an independent definition"; (ii) physical
  table ownership or inline `pgTable()` definitions live in `db/schema.ts`; (iii) `db/schema.ts` holds
  "remaining inline tables"; (iv) an old flat path `services/autopilot.ts` / `services/balances.ts` (etc.).
  Reality: each module `schema.ts` PHYSICALLY defines its resident tables + re-exports shared tables from
  `db/shared/*`; `db/schema.ts` is a PURE barrel (zero inline defs). Known sites (worker greps for the FULL set
  under the rule): `db/core-schema.ts:5`; `modules/ledger/plugin.ts` (~15-17); `modules/investments/plugin.ts`
  :10; any `plugin.ts` calling schema a thin re-export (review-9 cited automation/credit/ledger/system too — VERIFY
  and fix each); the 8 `modules/*/schema.smoke.test.ts` comment blocks ("thin re-export, not an independent
  definition" → reword to "asserts the module's export is the exact same object as the barrel's; the module now
  physically defines its residents"); the 2 path comments `planning/services/goals.ts:16` (→ `modules/automation/
  services/autopilot.ts`) and `investments/services/sip-lifecycle.ts:89` (→ `modules/ledger/services/
  balances.ts`). **LEAVE UNTOUCHED (already accurate — do NOT edit):** `db/schema.ts`'s own header ("pure
  re-export barrel … ZERO inline"); the `modules/*/schema.ts:10` headers (they correctly say the file imports
  shared layer files and never another module's schema); `db/schema.decomposition.test.ts`. Comment-only edits —
  NO test logic, NO code changes.
- **P5 — remove the empty `apps/api/src/routes/` directory** if it still exists on disk (review-9 #1 — it is an
  empty dir left behind; git doesn't track empty dirs, so this is local cleanup that makes the "no flat routes/"
  claim literally true).
- **P6 — final gate** (run + capture literal output/exit): `npm run typecheck`, `npm run lint`, `npm run test`
  all green (AC6); `npm run db:generate` = no new migration + `git diff --exit-code -- apps/api/drizzle` exit 0
  (AC11/AC4); route-surface + route-table snapshot tests green (AC4). NON-CODE docs (docs/PRD-wow-features.md:178,
  tasks/README.md, tasks/01.09 status frontmatter + README index) handled at CLOSEOUT with the commit, not here.

### SP4 Verification (independent worker, read-only)
- **V1** — CLAUDE.md diff shows ONLY the three architecture edits (lines 42/43/49 region) changed; quote the new
  text; confirm it contains no claim contradicted by code (spot-check: pure barrel, single entry, shared DAG).
- **V2** — Stale-comment sweep: grep active source (apps/**, EXCLUDING tasks/docs/reviews) for "thin re-export",
  "remaining inline", old flat paths `services/autopilot.ts`/`services/balances.ts` — ZERO survivors in code
  comments. Confirm the LEAVE-UNTOUCHED comments (db/schema.ts header, module schema.ts:10 headers,
  decomposition test) are UNCHANGED vs HEAD.
- **V3** — Full gate literal output: typecheck exit 0, lint exit 0, test pass/fail/skip counts + exit; route
  snapshots (route-surface + route-table) green; `git diff --exit-code -- apps/api/drizzle` exit 0; db:generate
  "No schema changes".
- **V4** — `git status --porcelain` — confirm the only NEW changes beyond the (already-verified) SP1+SP2+SP3
  footprint are CLAUDE.md + the comment-only edits (goals.ts, sip-lifecycle.ts, core-schema.ts, the plugin.ts
  files, the smoke tests); every one of those diffs is COMMENT-ONLY (no code/logic/test-assertion change); no
  private artifact.

### SP4 Codex plan review-9 digest (read in full; do not re-read) — corrections folded, APPROVED
Codex fact-checked the proposed CLAUDE.md prose against code. Verified TRUE: flat services/routes/repositories
source files gone; all 8 domains have schema/services/routes/plugin + app.ts registers plugins (app.ts:19,139);
module schemas physically define residents (system/ledger/planning/automation cited); 12 shared tables in the
named DAG (4+2+1+4+1, decomposition.test:178) + users in core-schema:11; modules import shared/core only, never
another module schema (headers ledger:7, planning:7); db/schema.ts pure barrel + drizzle.config.ts sole entry
(config:7); cache/ownership/periods in lib/; both P4 path comments exist as claimed. FOUR would-be-false/imprecise
claims CORRECTED in the prose above: (1) routes/ empty dir still on disk → reword to "source files gone" + P5
removes the dir; (2) "each service takes Db|Tx+userId" overbroad (pure cycle-math/xirr) → "DB-backed operations
… where user-scoped"; (3) "importing only earlier layers" → "core-schema + only preceding shared layers" (every
layer imports users); (4) "defines tables the domain owns" → "physically defines RESIDENT tables + re-exports
shared". Non-blocking adopted: mention shared enums (12 tables + 22 shared enums); recipe distinguishes existing-
vs-new module + Zod-contract-vs-Drizzle-schema; note runtime cross-module service imports still allowed (schema-
only isolation). KEY EXPANSION: Codex found MANY other stale comments contradicting the new architecture (module
plugin.ts "thin re-export", ledger/plugin.ts physical-ownership-in-db/schema, 8 schema.smoke.test.ts, core-
schema.ts:5) — folded into an expanded P4 with a decidable stale-vs-accurate rule + explicit leave-untouched list.
SP4 STATUS: APPROVED.

### SP4 implementation digest (backend-engineer, then coordinator fact-check + corrective edit)
Impl pass done: CLAUDE.md edits A/B/C applied; core-schema.ts:5 comment fixed; 8 schema.smoke.test.ts comment
blocks + planning/goals.ts:16 + investments/sip-lifecycle.ts:89 old-flat-path comments fixed; empty routes/ dir
removed. I read the edits myself: CLAUDE.md 41-49 accurate; core-schema.ts accurate.
**DEFECT caught + FIXED by coordinator (the exact review-9 #4 imprecision):** the impl pass wrote FACTUALLY WRONG
counts in two plugin.ts comments — ledger/plugin.ts said "11 ledger tables and 7 owned enums", investments/
plugin.ts said "8 investments tables and 10 owned enums", conflating resident defs with re-exported shared ones.
Ground truth (Grep of each module schema.ts): ledger physically defines 6 resident tables (transactionSplits,
transferLinks, transactionLinks, merchantRules, userTasks, attachments) + 0 enums (its enums live in shared);
investments defines 6 resident tables (accountNpsDetails, npsDetails, goldDetails, holdingValuations,
holdingEvents, netWorthSnapshots) + 4 enums (npsTier, goldForm, holdingEventType, holdingEventSource). Corrective
comment-only edit applied → ledger now "physically defines ledger's 6 resident tables (its enums are defined in
the shared layers) and re-exports the cross-domain tables it references from db/shared/*"; investments now
"physically defines investments' 6 resident tables and 4 owned enums; re-exports the cross-domain tables it
references from db/shared/*". Post-fix lint=0, typecheck=0.

### SP4 independent verification digest (verification-sp4.md, different worker, read-only)
V1 PASS (CLAUDE.md = 3 prose-only edits; all claims check against code: barrel zero inline pgTable, drizzle.config
sole entry, db/shared 5 layers, lib/ has cache/ownership/periods). V2 PASS (zero "thin re-export"/"remaining
inline" survivors; plugin.ts counts verified against raw local-def counts: ledger 6 pgTable/0 pgEnum, investments
6 pgTable/4 pgEnum — my corrections are accurate). V4 PASS (typecheck 0, lint 0, test 885 pass/0 fail/1 skip exit
0, all decomposition+smoke+route-surface+route-table green, db:generate "no schema changes", drizzle diff exit 0).
V5 PASS (routes/ dir gone, no private artifacts). **V3 "FAIL" = MISATTRIBUTION, REJECTED:** verifier flagged
goals.ts:44 & sip-lifecycle.ts:16 import-line changes (services/periods.ts→lib/periods.ts, services/ownership.ts→
lib/ownership.ts) as non-comment. Those are the SP3 file-move importer updates (verification-sp3.md:179/181 renames
+ :198/212 list both files M, diff :271-292) — already verified + Codex-reviewed (review-8). The cumulative
working-tree diff spans SP3+SP4; SP4 itself only added the JSDoc path-fix comments to those two files. SP4 IS
comment-only. NEXT: Codex impl review-10.

### SP4 Codex impl review-10 digest (read in full; do not re-read) — 5 VALID doc defects, 1 REJECTED
Codex reviewed CLAUDE.md + comment accuracy against real code. Verified accurate: flat dirs gone; 8 domains
complete; app.ts registers all 8 plugins; shared graph = 12 tables + shared enums in the DAG; users in
core-schema; db/schema.ts pure barrel + sole drizzle entry; cache/ownership/periods in lib/; no module schema
imports another's; goals.ts:16 / sip-lifecycle.ts:89 cite current paths; no "thin re-export"/"remaining inline"
survivors. SIX blocking findings — I validated each against code:
- **F2 VALID (CLAUDE.md:49):** "re-exports the cross-domain ones it references" is FALSE as a general rule.
  Confirmed: investments imports accounts(:33) but re-exports only holdings/sips(:37-38); credit imports
  accounts/emailIngestions/recurringTemplates(:29-30), re-exports only statementReconciliations(:33); automation
  imports accounts/emailIngestions(:24), re-exports NEITHER. Re-export set ≠ FK-reference set. → FIX.
- **F3 VALID (ledger/plugin.ts:18) + F4 VALID (investments/plugin.ts:11):** same overclaim in my corrective
  wording — ledger references users(:28) without re-exporting it; investments references accounts(:33) without
  re-exporting it. → FIX both plugin comments to drop re-export⟺reference equivalence.
- **F5 VALID (5 smoke tests):** ledger/investments/ingest/planning/protection smoke comments call the FULL
  export-surface enum count "owned" though those enums are re-exported shared, not resident: ledger "7 owned"
  (0 resident), investments "10" (4), ingest "8" (4), planning "2" (1), protection "4" (0). Confirmed vs module
  schema headers. Codex correctly cleared automation/credit/system (their counts == resident counts). → FIX the
  5 comment blocks (comment-only; NO test-code/assertion change): drop "owned", state the count is the export
  surface (residents + re-exported shared).
- **F6 VALID (core-schema.ts:4-6) — I INTRODUCED IT:** my edit is self-contradictory — calls db/schema.ts "a
  pure re-export barrel" yet says it references users via `.references(() => users.id, ...)`. A barrel has no FK
  defs; the real `.references()` sites are the db/shared/* layers + module schema.ts files. → FIX attribution.
- **F1 REJECTED as blocking (CLAUDE.md:42):** rules.ts:20/30 do direct app.db access in a route, so "all DB
  access lives in services" is a mild overclaim — BUT that is PRE-EXISTING aspirational "routes are thin, call a
  service" convention language that SP4 only re-pathed (services/*.ts → modules/<domain>/services/*.ts). Not
  introduced by SP4, and re-auditing every route's layering is out of the module-migration docs scope. NON-
  BLOCKING; left intact (noted). NEXT: SP4-fix iteration (comment-only) for F2-F6, re-verify, Codex review-11.

## Scope (files/areas, refined per sub-phase)
- Ports: modules/investments/services/networth.ts (the net-worth aggregator) + ledger/credit/protection
  contributors; modules/credit reward earn-rate (1.2); modules/planning goal projections (1.5).
- Schema: apps/api/src/db/schema.ts (the monolith to decompose), db/core-schema.ts (precedent), every
  modules/*/schema.ts thin re-export, apps/api/drizzle/ (must show zero diff).
- Flat services still present: cache, anomaly, balances, ownership, periods, autopilot (+ tests);
  repositories/users.ts.

## Must NOT change
- Net-worth output numbers; any (method, URL) route surface; any table/column name; any migration
  (drizzle/ content hash invariant); the single Drizzle Kit entry point count.
- apps/ingestor + apps/extractor raw SQL table/column names.

## Acceptance Criteria (verbatim from tasks/01.09-cross-module-ports.md)
- AC1: NetWorthContributor (or equivalent) implemented per module; net-worth numbers unchanged.
- AC2: No module imports another module's schema slice directly.
- AC3: Flat services/ emptied; repositories/ resolved and removed.
- AC4: Route snapshot unchanged; no migration diff.
- AC5: CLAUDE.md architecture section updated to describe the module layout.
- AC6: typecheck + lint + test green.
- AC7: Full cross-module FK graph produced, with explicit SCC decomposition.
- AC8: Every physical pgTable assigned to a final owning module where acyclic; explicit documented policy
  (per-SCC shared core schema) covers whatever remains cyclic.
- AC9: Every transitional thin-schema surface from 1.1-1.8 (incl. modules/ledger/schema.ts) converted to
  physical ownership or removed — none survive.
- AC10: Exactly one Drizzle Kit entry point remains.
- AC11: Zero migration diff (drizzle/ content-hash manifest) + table-object identity proven for every
  relocation.

## Dependencies
- 1.1-1.8 + 1.10 (all COMMITTED). This task depends on all of them and closes Phase 1.

## Non-Goals
- Any Phase-2 (shopping pillar / postings) work, even though ports are shaped for later consumers.
- Behavioral changes to net worth, rewards, or goal projections.
