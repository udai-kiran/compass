# backend-engineer Delegation — SP2b (module physical ownership + pure barrel)

## Task
020-cross-module-ports (roadmap 1.9), sub-phase SP2b. Convert all 8 `modules/<d>/schema.ts` from thin
re-exports of the `db/schema.ts` barrel into the PHYSICAL home of their 38 resident tables (+ 16 resident
enums), and turn `apps/api/src/db/schema.ts` into a PURE re-export barrel. SP2a already moved the 12 shared
tables + 22 enums into `apps/api/src/db/shared/{foundation,hubs,recurring,spines,ledger}.ts`.

## Vehicle
Entirely backend Drizzle schema code → `backend-engineer`:
`/home/udai/.claude/bin/backend-engineer tasks/020-cross-module-ports/backend-sp2b-1.md "<full prompt>"`
(increment filename for repeat runs).

## Core design (LOCKED — Policy B layered)
Each module `schema.ts` MUST keep its EXACT current public export set (so its services that
`import … from "./schema.ts"` keep working) but split it:
- **DEFINE locally** (real `pgTable()`/`pgEnum()`, moved VERBATIM from `db/schema.ts`): its resident tables + enums.
- **RE-EXPORT from the shared layers** (`../../db/shared/<layer>.ts`): the now-shared tables/enums it used to
  own (`export { … } from "../../db/shared/<layer>.ts"`).
- **IMPORT** (for resident FK `.references()` use) any shared tables/enums its residents point at, from the
  shared layer files, and `users` from `../../db/core-schema.ts`. NEVER import from `../../db/schema.ts`, and
  NEVER import another module's schema.ts (AC2).
`db/schema.ts` becomes a pure barrel: `export { users } from "./core-schema.ts"`; `export * from` each of the
5 shared layers; and EXPLICIT named re-export of ONLY each module's RESIDENTS from `../modules/<d>/schema.ts`
(do NOT `export *` from modules — they re-export shared symbols, which would duplicate the shared exports).
Result: barrel exposes exactly 50 tables + 38 enums + `users`, each exactly once. Zero migration diff.

Shared-layer symbol locations (for import/re-export sources):
- foundation.ts: goals, categories, resources, mailboxAccounts + goalType, categoryKind, expenseNecessity, resourceKind, mailboxProvider, mailboxStatus
- hubs.ts: accounts, emailIngestions + accountType, emailClass, emailIngestStatus
- recurring.ts: recurringTemplates + recurringFrequency, recurringKind
- spines.ts: holdings, insurancePolicies, statementReconciliations, sips + assetClass, gainsTaxClass, insuranceKind, vehicleKind, healthType, premiumFrequency, sipTargetKind, sipStatus, sipFundingSource, sipFrequency
- ledger.ts: transactions + transactionSource

## Per-module spec (DEFINE locally / RE-EXPORT from shared / IMPORT for FKs)
Preserve each module's existing export ORDER/names where practical; the SET must stay identical to today.

### system (`modules/system/schema.ts`)
- DEFINE: userProfiles, familyMembers, notifications, alertLedger, notificationPrefs; enums familyRelationship, educationStage
- RE-EXPORT from shared: none
- Keep: `export { users } from "../../db/core-schema.ts"`
- IMPORT for FKs: `users` (core); `accounts` (hubs) for notificationPrefs.accountId

### ledger (`modules/ledger/schema.ts`)
- DEFINE: transactionSplits, transferLinks, transactionLinks, merchantRules, userTasks, attachments; enums none
- RE-EXPORT from shared: accounts (hubs); categories, resources (foundation); recurringTemplates (recurring); transactions (ledger); accountType (hubs); categoryKind, expenseNecessity, resourceKind (foundation); recurringFrequency, recurringKind (recurring); transactionSource (ledger)
- IMPORT for FKs: `users` (core); `transactions`, `categories` (shared) — transactionSplits→transactions+categories; transferLinks/transactionLinks/userTasks/attachments→transactions; merchantRules→users

### credit (`modules/credit/schema.ts`)
- DEFINE: cardDetails, cardIssuerSettings, cardStatements, bankDetails, overdraftDetails, rewardEntries, emiDetails; enums cardNetwork, bankAccountSubtype
- RE-EXPORT from shared: statementReconciliations (spines)
- IMPORT for FKs: `users` (core); `accounts`, `emailIngestions` (hubs); `recurringTemplates` (recurring) — emiDetails→recurringTemplates+accounts(loanAccountId); rewardEntries→accounts+emailIngestions; card*/bank/overdraft→accounts

### investments (`modules/investments/schema.ts`)
- DEFINE: accountNpsDetails, npsDetails, goldDetails, holdingValuations, holdingEvents, netWorthSnapshots; enums npsTier, goldForm, holdingEventType, holdingEventSource
- RE-EXPORT from shared: holdings, sips (spines); assetClass, gainsTaxClass, sipTargetKind, sipStatus, sipFundingSource, sipFrequency (spines)
- IMPORT for FKs: `users` (core); `accounts` (hubs); `holdings`, `sips` (spines) — accountNpsDetails→accounts; npsDetails/goldDetails/holdingValuations→holdings; holdingEvents→holdings+sips; netWorthSnapshots→users

### protection (`modules/protection/schema.ts`)
- DEFINE: retirementDetails, insuranceHealthCards; enums none
- RE-EXPORT from shared: insurancePolicies (spines); insuranceKind, vehicleKind, healthType, premiumFrequency (spines)
- IMPORT for FKs: `users` (core); `accounts` (hubs); `insurancePolicies` (spines) — retirementDetails→accounts; insuranceHealthCards→insurancePolicies

### planning (`modules/planning/schema.ts`)
- DEFINE: budgets, budgetLines, budgetAlerts, subscriptionDismissals, projectionSettings; enums budgetPeriod
- RE-EXPORT from shared: goals (foundation); goalType (foundation)
- IMPORT for FKs: `users` (core); `categories` (foundation) — budgetLines→budgets(intra)+categories; budgetAlerts→categories; budgets/subscriptionDismissals/projectionSettings→users

### ingest (`modules/ingest/schema.ts`)
- DEFINE: imports, importRows, importPresets, mailboxCredentials, extractedTransactions; enums importStatus, extractedTxnStatus, txnDirection, extractedTxnIntent
- RE-EXPORT from shared: mailboxAccounts (foundation), emailIngestions (hubs); mailboxProvider, mailboxStatus (foundation), emailClass, emailIngestStatus (hubs)
- IMPORT for FKs: `users` (core); `accounts`, `emailIngestions` (hubs); `categories`, `mailboxProvider` (foundation); `transactions` (ledger) — imports/importPresets→accounts; importRows→imports(intra); mailboxCredentials→users (uses mailboxProvider enum); extractedTransactions→accounts+categories+transactions+emailIngestions

### automation (`modules/automation/schema.ts`)
- DEFINE: aiSettings, aiEvents; enums aiProvider, aiEventKind, aiEventStatus
- RE-EXPORT from shared: none
- IMPORT for FKs: `users` (core); `accounts`, `emailIngestions` (hubs) — aiEvents→accounts+emailIngestions; aiSettings→users

## db/schema.ts barrel (final form)
Delete ALL 38 remaining inline table defs + 16 inline enum defs. The file becomes ONLY:
- `export { users } from "./core-schema.ts";`
- `export * from "./shared/foundation.ts";` … through `./shared/ledger.ts` (all 5)
- 8 EXPLICIT named re-export lines, ONE per module, listing ONLY that module's RESIDENT tables + resident
  enums (the DEFINE lists above) from `../modules/<d>/schema.ts`.
- A corrected header comment (the current one at line 31 wrongly says every definition lives here).

## Tests to ADD — new file `apps/api/src/db/schema.decomposition.test.ts` (node:test)
Import the barrel namespace, every shared layer, and every module schema, then assert:
- **T3 table identity:** for all 50 tables + `users`, the barrel's export is `Object.is`-identical to the object
  in its defining file (shared layer or module).
- **T3b enum identity:** for all 38 enums, barrel export `Object.is`-identical to its defining file — INCLUDING
  cross-home `expenseNecessity` (defined foundation, consumed by ledger.ts transactions) and `mailboxProvider`
  (defined foundation, consumed by ingest resident mailboxCredentials).
- **T3c export-set:** the barrel exports EXACTLY 50 Drizzle tables and EXACTLY 38 pgEnums, none duplicated.
- Merely importing all files exercises runtime init across the graph (T4b) — catches ESM cycles / TDZ.

## Fix stale comments
Rewrite the header comment of ALL 8 module `schema.ts` files AND `db/schema.ts` (line 31): they currently
assert definitions live in `db/schema.ts` and that the barrel does NOT re-export from modules — both now false.
New comments: module files own their residents physically + re-export shared symbols from the shared layers;
`db/schema.ts` is the single Drizzle Kit entry-point barrel re-exporting shared layers + module residents.

## Must NOT change
- Any table/column/enum name, value, or order; any index/constraint/FK action/default. Mechanical move only —
  do NOT touch `AnyPgColumn` casts, method-chain order, or callback SQL.
- `drizzle.config.ts` (stays `schema: "./src/db/schema.ts"`).
- Any file under `apps/api/drizzle/` — a new/modified migration or meta file is a FAILURE.
- `services/backup.ts` ALL_TABLES/USER_TABLES (names unchanged).
- Any service/route source (their `import … from "./schema.ts"` / `from "../db/schema.ts"` must keep resolving
  because export sets are preserved).

## Acceptance criteria (SP2b → closes SP2)
- AC-b1: All 8 module schema.ts physically DEFINE their residents (real pgTable/pgEnum); each preserves its
  exact prior export set via local defs + shared re-exports; NONE imports `db/schema.ts` or another module.
- AC-b2: `db/schema.ts` has ZERO inline pgTable/pgEnum defs; is a pure barrel exposing 50 tables + 38 enums +
  users, each once. (AC9, AC10 — one entry point unchanged.)
- AC-b3: `npm run typecheck`, `npm run lint`, `npm run test` all green; new decomposition test green.
- AC-b4: `npm run db:generate` → NO new migration; `apps/api/drizzle/` byte-identical to baseline (AC11).
- AC-b5: Static: no `modules/*/schema.ts` imports another module's schema; no shared layer imports a module;
  each shared layer imports only core + strictly-earlier layers. Repo-wide 51 pgTable (50 + core users) and
  38 pgEnum; 0 defs in the barrel; no `export { … } from "../../db/schema.ts"` survives in any module schema.
- AC-b6: Route snapshots byte-unchanged; backup.test.ts green.

## Commands (capture literal output + exit for each)
1. BEFORE edits: `git status --porcelain` and `find apps/api/drizzle -type f | sort | xargs sha256sum` (baseline).
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test` (report per-workspace pass/fail/skip counts; confirm the new decomposition test ran + passed)
5. `npm run db:generate`; re-run the drizzle sha256 manifest; diff vs baseline (must be identical).
6. `git status --porcelain` (only the 8 module schema.ts + db/schema.ts + new test file changed; no drizzle diff).

## Required evidence (report back)
- Files changed/created (paths); complete diff.
- Each command's exact invocation, literal output, exit code.
- Both drizzle hash manifests (before/after) proving byte-identity.
- The new test's literal pass output.
- Any deviation or blocker — do NOT silently change scope.
