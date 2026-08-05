# Sonnet Worker / backend-engineer Delegation — SP2a (shared schema layers)

## Task
020-cross-module-ports (roadmap 1.9), sub-phase SP2a. Physical relocation of the 12 cross-domain
"shared" table definitions out of the `db/schema.ts` monolith into 5 DAG-depth layer files, WITHOUT
touching the 8 module `schema.ts` files yet. This is a MECHANICAL MOVE — refactor NOTHING.

## Vehicle
This is entirely backend (Drizzle schema) code → delegate the implementation to `backend-engineer`:
`/home/udai/.claude/bin/backend-engineer tasks/020-cross-module-ports/backend-sp2a-1.md "<full prompt>"`
(increment the filename for repeat runs; the wrapper refuses to overwrite).

## Approved plan (Policy B, layered — LOCKED)
Move the 12 shared tables + their owned enums into 5 new files under `apps/api/src/db/shared/`, each
importing ONLY `../core-schema.ts` (`users`) and strictly-EARLIER shared layers. `db/schema.ts` then
`import`s these back (for the still-inline module-resident tables that FK into them) AND re-exports them,
so drizzle-kit still sees all 50 tables + 38 enums from the one entry point. The 8 module `schema.ts`
files stay EXACTLY as they are (thin re-exports of the `db/schema.ts` barrel) — SP2b converts them later.

## Exact layer → table + enum assignment
Create these files (exact names): `apps/api/src/db/shared/foundation.ts`, `hubs.ts`, `recurring.ts`,
`spines.ts`, `ledger.ts`. Within `spines.ts`, DECLARE `holdings` BEFORE `sips` (sips FKs into holdings).

- **foundation.ts** (imports: `users` from `../core-schema.ts` only)
  - Tables: `goals`, `categories`, `resources`, `mailboxAccounts`
  - Enums: `goalType`, `categoryKind`, `expenseNecessity`, `resourceKind`, `mailboxProvider`, `mailboxStatus`
- **hubs.ts** (imports: core + foundation)
  - Tables: `accounts` (goalId→goals, keep its `AnyPgColumn` cast), `emailIngestions` (mailboxId→mailboxAccounts)
  - Enums: `accountType`, `emailClass`, `emailIngestStatus`
- **recurring.ts** (imports: core + foundation + hubs)
  - Tables: `recurringTemplates` (accountId→accounts, categoryId→categories, resourceId→resources)
  - Enums: `recurringFrequency`, `recurringKind`
- **spines.ts** (imports: core + foundation + hubs + recurring)
  - Tables (in this declaration order): `holdings` (goalId→goals), `insurancePolicies` (resourceId→resources),
    `statementReconciliations` (accountId→accounts, ingestionId→emailIngestions), then `sips`
    (goalId→goals, sourceAccountId/targetAccountId→accounts, targetHoldingId→holdings)
  - Enums: `assetClass`, `gainsTaxClass` (holdings); `insuranceKind`, `vehicleKind`, `healthType`,
    `premiumFrequency` (insurancePolicies); `sipTargetKind`, `sipStatus`, `sipFundingSource`, `sipFrequency`
    (sips). `statementReconciliations` owns no enum.
- **ledger.ts** (imports: core + foundation + hubs + recurring + spines)
  - Tables: `transactions` (accountId→accounts, categoryId→categories, resourceId→resources,
    recurringTemplateId→recurringTemplates, policyId→insurancePolicies, sipId→sips,
    reconciledStatementId→statementReconciliations; also uses `expenseNecessity` from foundation for the
    `necessity` column, and `transactionSource`). Keep every existing `AnyPgColumn` cast as-is.
  - Enums: `transactionSource`

That is 12 tables and 22 enums moving to shared. The other 38 tables and 16 enums STAY defined inline in
`db/schema.ts` for SP2a.

## Required changes
1. Create the 5 files above. Move each table's ENTIRE definition VERBATIM — column list, all defaults,
   every `.references()` incl. exact `onDelete`/absence-of-onUpdate, the full third-argument callback
   (indexes, unique/partial-unique with exact SQL predicates, checks with exact SQL + constraint names,
   composite PKs), and any leading comments. Move each enum VERBATIM (exact pg name, export name, value
   spelling AND order). Do NOT reorder, rename, re-cast, or "tidy" anything.
2. In `db/schema.ts`: delete the 12 moved table defs + 22 moved enum defs; add `import { … }` from the new
   layer files for every moved symbol still referenced by an inline (module-resident) definition; and
   re-export ALL 12 tables + 22 enums so the barrel's public surface is unchanged (e.g. explicit
   `export { accounts, goals, … } from "./shared/…"` or `export *` — but ensure NO symbol is exported
   twice and NO name collision).
3. Preserve declaration/init order so no file references a symbol before it is defined/imported (layer
   files import earlier layers; within `spines.ts`, holdings before sips).

## Must NOT change
- Any table name, column name, enum name/value/order, index, constraint, FK action, default.
- The 8 `modules/*/schema.ts` files (leave thin re-exports of the barrel exactly as-is).
- `drizzle.config.ts` (stays `schema: "./src/db/schema.ts"` — the single entry point).
- Any `apps/api/drizzle/*.sql` or `meta/` file — a new migration or a modified meta file is a FAILURE.
- `services/backup.ts` ALL_TABLES/USER_TABLES (names unchanged, so no edit needed).
- No refactor of `AnyPgColumn` casts, method-chain order, or callback SQL. Mechanical move only.

## Acceptance criteria (SP2a)
- AC-a1: The 5 layer files exist; the 12 tables + 22 enums are physically defined there, once each.
- AC-a2: `db/schema.ts` no longer defines those 12 tables / 22 enums but re-exports them; still defines the
  other 38 tables + 16 enums inline; barrel public surface (all 50 tables + 38 enums) unchanged.
- AC-a3: `npm run typecheck` green; `npm run test -w apps/api` green.
- AC-a4: `npm run db:generate` produces NO new migration AND `apps/api/drizzle/` tree byte-identical to the
  pre-change baseline (no meta file modified).
- AC-a5: Each layer file imports ONLY `../core-schema.ts` + strictly-earlier layer files (no module imports,
  no later-layer imports, no import of `db/schema.ts`).

## Commands (run and capture literal output + exit code for each)
1. Baseline first (BEFORE edits): record `git status --porcelain apps/api/drizzle/` and a hash manifest of
   `apps/api/drizzle/` (e.g. `find apps/api/drizzle -type f | sort | xargs sha256sum`).
2. `npm run typecheck`
3. `npm run test -w apps/api`
4. `npm run db:generate` then re-run the drizzle hash manifest and diff against baseline (must be identical).
5. `git status --porcelain` (confirm only intended files changed; NO new drizzle migration).

## Required evidence (report back)
- Files created/changed (paths).
- Complete diff.
- Each command's exact invocation, literal output, and exit code.
- The two drizzle hash manifests (before/after) proving byte-identity.
- Any deviation from this brief or blocker — do NOT silently change scope.
