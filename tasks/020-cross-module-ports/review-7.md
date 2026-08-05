## Blocking findings

1. **The periods importer inventory is incomplete, and P8 cannot empty `services/` as written.**

The plan claims 14 importers and omits `apps/api/src/services/periods.test.ts` ([TASK.md:393](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:393), [TASK.md:425](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:425)). The real test imports `currentPeriodKey`, `periodRange`, and `prevPeriodKey` directly from `./periods.ts` ([periods.test.ts:3](/home/udai/PennyPilot/apps/api/src/services/periods.test.ts:3)).

Therefore:

- There are **15 source import sites**, not 14, when the anomaly sibling and `periods.test.ts` are included.
- P4 must also move `periods.test.ts`, most naturally to `apps/api/src/lib/periods.test.ts`; its `./periods.ts` import remains valid.
- Its ledger import must change from `../modules/ledger/services/recurring.ts` ([periods.test.ts:4](/home/udai/PennyPilot/apps/api/src/services/periods.test.ts:4)) to `../modules/ledger/services/recurring.ts` after moving to `lib/`—the same spelling happens to remain correct because both `services/` and `lib/` are one level below `src/`.
- Without that additional move, the assertion that P1–P7 empties `services/` is false ([TASK.md:408](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:408), [TASK.md:439](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:439)), and AC3 is not met ([TASK.md:485](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:485)).

2. **T4’s “no reverse automation edge” assertion is false in the current code.**

The system module directly imports automation: `modules/system/routes/auth.ts` imports `modules/automation/services/ai-settings.ts` ([auth.ts:20](/home/udai/PennyPilot/apps/api/src/modules/system/routes/auth.ts:20)). Thus the planned grep cannot confirm that system does not import automation, contrary to T4 and the risk statement ([TASK.md:451](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:451), [TASK.md:462](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:462)).

Moving the two files adds direct edges in the other direction:

- `autopilot.ts` imports system notifications and preferences ([autopilot.ts:9](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:9), [autopilot.ts:10](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:10)).
- `anomaly.ts` imports the same system services ([anomaly.ts:6](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:6), [anomaly.ts:7](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:7)).

At the **module dependency** level, the move therefore creates a new direct two-way relationship `automation ↔ system`. There is no demonstrated file-level runtime cycle back into `autopilot.ts` or `anomaly.ts`: the reverse edge targets `ai-settings.ts`, not either moved file. But the plan’s categorical “no reverse edge/no new import cycle” proof is invalid and must either:

- treat module-level cycles as disallowed and choose/refactor ownership accordingly; or
- explicitly state that the check concerns file-level SCCs, run an actual import-graph cycle detector, and document the already-present `system → automation` edge.

There is also already an indirect module-level route from automation through planning to system: automation tools import planning services ([tools.ts:6](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:6), [tools.ts:10](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:10)), while planning goals import system notifications and preferences ([goals.ts:43](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:43), [goals.ts:45](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:45)). A simple reverse-edge grep is therefore not a sufficient cycle proof.

## Non-blocking findings

### 1. Importer audit

Apart from the missing `periods.test.ts`, the digest’s importer inventories match the real source.

- **cache.ts — complete: 7 importers.** They are app ([app.ts:27](/home/udai/PennyPilot/apps/api/src/app.ts:27)); planning insights, budgets, dashboard, and cashflow ([insights route:6](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/insights.ts:6), [budgets route:23](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/budgets.ts:23), [dashboard.ts:6](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:6), [cashflow.ts:8](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:8)); credit EMIs ([emis route:7](/home/udai/PennyPilot/apps/api/src/modules/credit/routes/emis.ts:7)); and investment SIPs ([sips.ts:27](/home/udai/PennyPilot/apps/api/src/modules/investments/routes/sips.ts:27)).

- **balances.ts — complete: 4 importers.** System prefs ([prefs.ts:6](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:6)), planning dashboard and cashflow ([dashboard.ts:5](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:5), [cashflow.ts:7](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:7)), and the ledger EPF test ([epf-contributions.test.ts:12](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/epf-contributions.test.ts:12)).

- **ownership.ts — complete: 8 importers.** System prefs ([prefs.ts:8](/home/udai/PennyPilot/apps/api/src/modules/system/services/prefs.ts:8)); credit EMIs ([emis.ts:13](/home/udai/PennyPilot/apps/api/src/modules/credit/services/emis.ts:13)); ledger accounts, recurring, and transactions ([accounts.ts:13](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/accounts.ts:13), [recurring.ts:13](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.ts:13), [transactions.ts:16](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/transactions.ts:16)); planning budgets ([budgets.ts:14](/home/udai/PennyPilot/apps/api/src/modules/planning/services/budgets.ts:14)); and investments holdings and SIP lifecycle ([holdings.ts:19](/home/udai/PennyPilot/apps/api/src/modules/investments/services/holdings.ts:19), [sip-lifecycle.ts:18](/home/udai/PennyPilot/apps/api/src/modules/investments/services/sip-lifecycle.ts:18)).

- **periods.ts — digest’s listed 14 are real, but the list is missing the fifteenth importer identified above.** The listed imports are system notifications ([notifications.ts:7](/home/udai/PennyPilot/apps/api/src/modules/system/services/notifications.ts:7)); eight planning files ([insights route:7](/home/udai/PennyPilot/apps/api/src/modules/planning/routes/insights.ts:7), [cashflow.ts:10](/home/udai/PennyPilot/apps/api/src/modules/planning/services/cashflow.ts:10), [reports.test.ts:5](/home/udai/PennyPilot/apps/api/src/modules/planning/services/reports.test.ts:5), [dashboard.ts:14](/home/udai/PennyPilot/apps/api/src/modules/planning/services/dashboard.ts:14), [goals.ts:44](/home/udai/PennyPilot/apps/api/src/modules/planning/services/goals.ts:44), [budgets.ts:15](/home/udai/PennyPilot/apps/api/src/modules/planning/services/budgets.ts:15), [insights service:4](/home/udai/PennyPilot/apps/api/src/modules/planning/services/insights.ts:4), [reports.ts:21](/home/udai/PennyPilot/apps/api/src/modules/planning/services/reports.ts:21)); ingest and ledger tests ([inbox.test.ts:12](/home/udai/PennyPilot/apps/api/src/modules/ingest/services/inbox.test.ts:12), [recurring.test.ts:12](/home/udai/PennyPilot/apps/api/src/modules/ledger/services/recurring.test.ts:12)); credit alerts ([alerts.ts:6](/home/udai/PennyPilot/apps/api/src/modules/credit/services/alerts.ts:6)); automation tools ([tools.ts:11](/home/udai/PennyPilot/apps/api/src/modules/automation/services/tools.ts:11)); and anomaly ([anomaly.ts:8](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:8)).

- **autopilot.ts — complete.** The production importer is jobs ([jobs/index.ts:9](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:9)); the colocated test is correctly acknowledged and imports the file at [autopilot.test.ts:3](/home/udai/PennyPilot/apps/api/src/services/autopilot.test.ts:3).

- **anomaly.ts — complete.** The production importer is jobs ([jobs/index.ts:8](/home/udai/PennyPilot/apps/api/src/jobs/index.ts:8)); the colocated test is correctly acknowledged at [anomaly.test.ts:3](/home/udai/PennyPilot/apps/api/src/services/anomaly.test.ts:3).

- **repositories/users.ts — complete: 4 importers.** Bootstrap ([bootstrap.ts:15](/home/udai/PennyPilot/apps/api/src/db/bootstrap.ts:15)); system demo ([demo.ts:28](/home/udai/PennyPilot/apps/api/src/modules/system/services/demo.ts:28)); system auth service ([auth service:7](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:7)); and system auth route ([auth route:18](/home/udai/PennyPilot/apps/api/src/modules/system/routes/auth.ts:18)). The plan correctly includes the easy-to-miss bootstrap script.

### 2. Relative import depths

The specified P1–P7 path changes are correct, with one clarification in P3.

- From `apps/api/src/lib/`, `../db/index.ts` and `../db/schema.ts` resolve to the sibling `src/db/` directory. The current sources use those paths from the equally deep flat `services/` directory ([ownership.ts:2](/home/udai/PennyPilot/apps/api/src/services/ownership.ts:2), [ownership.ts:3](/home/udai/PennyPilot/apps/api/src/services/ownership.ts:3), [periods.ts:8](/home/udai/PennyPilot/apps/api/src/services/periods.ts:8)). The directory calculation is correct.
- `lib/errors.ts` does **not** actually import `db`, so it is not a concrete import precedent; it only establishes the directory level ([errors.ts:1](/home/udai/PennyPilot/apps/api/src/lib/errors.ts:1)). The risk text overstates what can be matched against it ([TASK.md:463](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:463)).
- After moving ownership into `lib/`, its current `../lib/errors.ts` import ([ownership.ts:4](/home/udai/PennyPilot/apps/api/src/services/ownership.ts:4)) must become `./errors.ts`. P3 says to fix it “to the lib depth” but does not spell out the result ([TASK.md:422](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:422)); the delegation should make `./errors.ts` explicit.
- From `modules/automation/services/`, `../../../db/index.ts`, `../../../db/schema.ts`, and `../../../lib/periods.ts` correctly reach `src/db/` and `src/lib/`.
- From that automation service directory, `../../planning/...` and `../../system/...` correctly reach sibling module directories. These are the correct replacements for the current paths in autopilot ([autopilot.ts:4](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:4), [autopilot.ts:6](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:6), [autopilot.ts:9](/home/udai/PennyPilot/apps/api/src/services/autopilot.ts:9)) and anomaly ([anomaly.ts:4](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:4), [anomaly.ts:6](/home/udai/PennyPilot/apps/api/src/services/anomaly.ts:6)).
- From `jobs/`, `../modules/automation/services/...` is correct.
- From `modules/system/services/users.ts`, `../../../db/...` is correct. The importer results in P7 are also correct: bootstrap needs `../modules/system/services/users.ts`; system `demo.ts` and `auth.ts` need `./users.ts`; the system auth route needs `../services/users.ts`. The existing source locations establish those depths ([bootstrap.ts:15](/home/udai/PennyPilot/apps/api/src/db/bootstrap.ts:15), [auth service:7](/home/udai/PennyPilot/apps/api/src/modules/system/services/auth.ts:7), [auth route:18](/home/udai/PennyPilot/apps/api/src/modules/system/routes/auth.ts:18)).

### 3. Destination and ownership assessment

The ownership choices are otherwise sound.

- `cache.ts` is domain-neutral Redis infrastructure and imports only the `ioredis` type ([cache.ts:1](/home/udai/PennyPilot/apps/api/src/services/cache.ts:1)); `lib/cache.ts` is appropriate.
- `ownership.ts` guards objects spanning accounts, categories, goals, and holdings ([ownership.ts:3](/home/udai/PennyPilot/apps/api/src/services/ownership.ts:3)); its eight consumers span five modules, so a neutral `lib/` location avoids assigning it to one consumer domain.
- `periods.ts` combines general period arithmetic with SQL aggregation and is consumed by system, planning, ingest, ledger, credit, and automation. `lib/periods.ts` is reasonable given that breadth.
- AC2 prohibits a module from importing another module’s schema slice ([TASK.md:484](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:484)); it does not prohibit shared utilities from using the canonical DB surface. Thus ownership’s `db/schema.ts` dependency does not violate AC2.
- `balances.ts` queries accounts and transactions ([balances.ts:27](/home/udai/PennyPilot/apps/api/src/services/balances.ts:27), [balances.ts:30](/home/udai/PennyPilot/apps/api/src/services/balances.ts:30)); ledger ownership is correct.
- Autopilot and anomaly are scheduled/detection automation concerns, so automation is semantically appropriate despite the dependency-cycle caveat.
- `users.ts` operates directly on the users table ([users.ts:3](/home/udai/PennyPilot/apps/api/src/repositories/users.ts:3), [users.ts:8](/home/udai/PennyPilot/apps/api/src/repositories/users.ts:8)); system ownership is correct.

The moved lib files will have no **direct** imports from `modules/`, satisfying the intended check. Note, however, that `db/index.ts` imports `db/schema.ts` ([db/index.ts:3](/home/udai/PennyPilot/apps/api/src/db/index.ts:3)), and the schema facade re-exports module schemas, including automation ([db/schema.ts:94](/home/udai/PennyPilot/apps/api/src/db/schema.ts:94)). Therefore “lib files import no module” should be described as a direct-import rule, not a transitive dependency claim.

### 4. Behaviour, tables, routes, and migrations

No intended behavioral, table, route, or migration change is present in SP3. The seven source moves only alter module specifiers, and the plan explicitly prohibits logic or signature edits ([TASK.md:410](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:410)). None of the moved files defines a Fastify route, table, or migration:

- The only route files edited are import consumers such as system auth ([auth route:18](/home/udai/PennyPilot/apps/api/src/modules/system/routes/auth.ts:18)).
- The moved data helpers consume existing `db/schema.ts` objects ([ownership.ts:3](/home/udai/PennyPilot/apps/api/src/services/ownership.ts:3), [users.ts:3](/home/udai/PennyPilot/apps/api/src/repositories/users.ts:3)).
- Balances and periods use existing raw SQL; moving them does not change SQL text ([balances.ts:26](/home/udai/PennyPilot/apps/api/src/services/balances.ts:26), [periods.ts:58](/home/udai/PennyPilot/apps/api/src/services/periods.ts:58)).

The principal behavior risk is therefore an accidentally missed or mistyped import, not runtime semantic drift.

### 5. Verification sufficiency

T1–T6 are close but need these corrections:

- **T1 is the decisive AC3 proof** once `periods.test.ts` is added to scope: assert both paths do not exist. `git status` cannot represent deletion of an empty directory, so the filesystem nonexistence check—not status—is required ([TASK.md:443](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:443)).
- **T2 must be scoped to executable/config source imports.** A literal repo-wide zero-match check will fail on historical task and documentation references, including the plan itself ([TASK.md:444](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:444)). Search `apps/**`, `packages/**`, and active configuration for import specifiers; either exclude `tasks/`, `docs/`, and `reviews/`, or explicitly classify their historical references.
- **T2 should include `services/periods.test.ts` and verify all new destinations exist.** Typecheck catches unresolved imports, but an explicit import inventory makes the proof auditable.
- **T3 proves AC6** because the root scripts run workspace typechecks/tests and repository lint ([package.json:19](/home/udai/PennyPilot/package.json:19), [package.json:20](/home/udai/PennyPilot/package.json:20), [package.json:21](/home/udai/PennyPilot/package.json:21)). Add the moved `lib/periods.test.ts` explicitly to the “ran and passed” list.
- The API test command is location-independent under `src/**/*.test.ts` ([apps/api/package.json:14](/home/udai/PennyPilot/apps/api/package.json:14)), so moving tests into `lib/` or automation services does not require a test-glob update.
- TypeScript includes all of `src` ([apps/api/tsconfig.json:6](/home/udai/PennyPilot/apps/api/tsconfig.json:6)), so no tsconfig update is needed.
- **T4 must be replaced with a real dependency-graph/SCC check** or narrowed to file-level cycles. Its proposed direct grep has already been disproved by system auth’s automation import.
- **T5 should compare migration state before and after**, not merely say `db:generate` made no new file. Capture `git diff --exit-code -- apps/api/drizzle` and/or a pre/post content hash. Also fail if generation modifies an existing migration or metadata file. Route-snapshot verification should name and run the actual route-surface test rather than saying only “confirm green” ([TASK.md:454](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:454)).
- **T6’s wording should include the three moved tests**, not only “7 moved files” ([TASK.md:456](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:456)). The expected physical moves are seven implementation files plus `autopilot.test.ts`, `anomaly.test.ts`, and the newly identified `periods.test.ts`, along with importer-only edits.
- For stronger zero-behavior-change evidence, add `git diff --word-diff=porcelain` or an equivalent check confirming moved-file content differs only in import specifiers. Typecheck/lint/test establish AC6, while this diff review establishes the SP3 “mechanical rehome” constraint.

### 6. Overlooked files, barrels, and configuration

- The overlooked file is `apps/api/src/services/periods.test.ts`; it is both an importer and the file preventing folder deletion ([periods.test.ts:1](/home/udai/PennyPilot/apps/api/src/services/periods.test.ts:1)).
- No other flat implementation file remains outside the seven named implementations and the three colocated tests. `repositories/` contains only `users.ts`.
- There is no `services/index.ts` or `repositories/index.ts` barrel to update, consistent with the digest’s claim ([TASK.md:380](/home/udai/PennyPilot/tasks/020-cross-module-ports/TASK.md:380)).
- No TypeScript or test configuration pins these old directories: TypeScript includes the entire `src` tree ([apps/api/tsconfig.json:6](/home/udai/PennyPilot/apps/api/tsconfig.json:6)), and Node’s test glob finds tests anywhere beneath it ([apps/api/package.json:14](/home/udai/PennyPilot/apps/api/package.json:14)).
- The bootstrap script is an active package command ([apps/api/package.json:12](/home/udai/PennyPilot/apps/api/package.json:12)), reinforcing that its users import must be updated even though it is not part of the regular server entry path.