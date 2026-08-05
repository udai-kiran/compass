## Findings

### Blocking

1. [CLAUDE.md:42](/home/udai/PennyPilot/CLAUDE.md:42) overclaims that “all DB access” lives in module services. The ledger merchant-rules route queries and deletes directly through `app.db` at [rules.ts:20](/home/udai/PennyPilot/apps/api/src/modules/ledger/routes/rules.ts:20) and [rules.ts:30](/home/udai/PennyPilot/apps/api/src/modules/ledger/routes/rules.ts:30). This would mislead contributors about the currently enforced layering.

2. [CLAUDE.md:49](/home/udai/PennyPilot/CLAUDE.md:49) says every module schema “re-exports the cross-domain ones it references.” That is not generally true. For example:

   - Investments references `accounts`, `holdings`, and `sips` at [investments/schema.ts:33](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.ts:33), but only re-exports `holdings` and `sips` at [investments/schema.ts:37](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.ts:37).
   - Credit imports `accounts`, `emailIngestions`, and `recurringTemplates` at [credit/schema.ts:29](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.ts:29), but only re-exports `statementReconciliations` at [credit/schema.ts:33](/home/udai/PennyPilot/apps/api/src/modules/credit/schema.ts:33).
   - Automation imports shared `accounts` and `emailIngestions` at [automation/schema.ts:24](/home/udai/PennyPilot/apps/api/src/modules/automation/schema.ts:24) and re-exports neither.

   Module schemas re-export selected shared symbols forming their module-facing schema surface, not every cross-domain FK dependency.

3. [ledger/plugin.ts:17](/home/udai/PennyPilot/apps/api/src/modules/ledger/plugin.ts:17) correctly states that ledger physically defines six resident tables and no local enums, but [ledger/plugin.ts:18](/home/udai/PennyPilot/apps/api/src/modules/ledger/plugin.ts:18) incorrectly says it re-exports “the cross-domain tables it references.” Ledger imports `users`, `transactions`, and `categories` for local definitions at [ledger/schema.ts:28](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.ts:28), but does not re-export `users`. The count and enum wording pass; the re-export wording does not.

4. [investments/plugin.ts:10](/home/udai/PennyPilot/apps/api/src/modules/investments/plugin.ts:10) correctly states six locally defined tables and four locally defined enums, but [investments/plugin.ts:11](/home/udai/PennyPilot/apps/api/src/modules/investments/plugin.ts:11) likewise overclaims that all referenced cross-domain tables are re-exported. `accounts` is imported at [investments/schema.ts:33](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.ts:33) but not re-exported.

5. Five schema smoke-test comment blocks incorrectly describe shared-layer enums as “owned” by the module:

   - [ledger/schema.smoke.test.ts:9](/home/udai/PennyPilot/apps/api/src/modules/ledger/schema.smoke.test.ts:9): claims seven owned enums, while ledger locally defines zero `pgEnum()` objects; all seven tested enums come from shared layers.
   - [investments/schema.smoke.test.ts:9](/home/udai/PennyPilot/apps/api/src/modules/investments/schema.smoke.test.ts:9): claims ten owned enums, while investments locally defines four; six are re-exported from `db/shared/spines.ts`.
   - [ingest/schema.smoke.test.ts:12](/home/udai/PennyPilot/apps/api/src/modules/ingest/schema.smoke.test.ts:12): claims eight owned enums, while ingest locally defines four; four are shared-layer re-exports.
   - [planning/schema.smoke.test.ts:12](/home/udai/PennyPilot/apps/api/src/modules/planning/schema.smoke.test.ts:12): claims two owned enums, while planning locally defines only `budgetPeriod`; `goalType` is defined in `db/shared/foundation.ts`.
   - [protection/schema.smoke.test.ts:9](/home/udai/PennyPilot/apps/api/src/modules/protection/schema.smoke.test.ts:9): claims four owned enums, while protection locally defines zero; all four are defined in `db/shared/spines.ts`.

   The numeric counts accurately describe the tested export surfaces, but “owned” incorrectly implies physical local definition.

6. [core-schema.ts:4](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:4)–[core-schema.ts:6](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:6) says both `db/schema.ts` and module schemas reference `users` through `.references(() => users.id, ...)`. `db/schema.ts` is a pure barrel and merely re-exports `users` at [db/schema.ts:16](/home/udai/PennyPilot/apps/api/src/db/schema.ts:16); it contains no FK definitions. The comment should attribute `.references(...)` usage to shared and module schema-definition files, not the barrel.

### Non-blocking

1. [CLAUDE.md:43](/home/udai/PennyPilot/CLAUDE.md:43) says `app.ts` “installs the two plugins,” evidently referring to `setupAuth` and `setupSecurity`, but `buildApp` also registers the multipart and compression plugins at [app.ts:230](/home/udai/PennyPilot/apps/api/src/app.ts:230) and [app.ts:233](/home/udai/PennyPilot/apps/api/src/app.ts:233). “The two application plugins” or explicitly naming auth/security would avoid ambiguity. The surrounding registration recipe remains operationally correct.

## Verified accurate

- The flat `apps/api/src/services`, `routes`, and `repositories` source directories are absent.
- All eight domains have `schema.ts`, `services/`, `routes/`, and `plugin.ts`.
- `app.ts` imports and registers all eight module plugins at [app.ts:19](/home/udai/PennyPilot/apps/api/src/app.ts:19)–[app.ts:26](/home/udai/PennyPilot/apps/api/src/app.ts:26) and [app.ts:139](/home/udai/PennyPilot/apps/api/src/app.ts:139)–[app.ts:148](/home/udai/PennyPilot/apps/api/src/app.ts:148).
- The shared graph contains exactly 12 tables and its shared enums across `foundation → hubs → recurring → spines → ledger`; each layer imports only `core-schema.ts` and preceding layers.
- [core-schema.ts:11](/home/udai/PennyPilot/apps/api/src/db/core-schema.ts:11) physically defines `users`.
- [db/schema.ts:16](/home/udai/PennyPilot/apps/api/src/db/schema.ts:16)–[db/schema.ts:100](/home/udai/PennyPilot/apps/api/src/db/schema.ts:100) is a pure re-export barrel, and [drizzle.config.ts:9](/home/udai/PennyPilot/apps/api/drizzle.config.ts:9) points only to it.
- `cache.ts`, `ownership.ts`, and `periods.ts` are under `apps/api/src/lib`.
- No module `schema.ts` imports another module’s `schema.ts`.
- Runtime cross-module service imports remain present and therefore are correctly documented as allowed.
- The automation, credit, and system smoke-test introductory comments accurately distinguish locally defined resident objects from barrel identity; their stated owned-enum counts are correct.
- [goals.ts:16](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:16) and [sip-lifecycle.ts:89](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:89) cite the current module service paths, not removed flat paths.
- No reviewed comment still says a module schema is a “thin re-export,” assigns physical ownership to `db/schema.ts`, or claims the barrel contains “remaining inline” tables.

Final gate: **fail due to blocking documentation/comment inaccuracies above.**