# Investigation: in-flight module-scaffold refactor — state as of 2026-08-04

Read-only investigation. No files edited, no git state changed.

## 1. `git status --porcelain` (FULL output)

```
 M apps/api/src/app.route-snapshot.test.ts
 M apps/api/src/app.ts
 M apps/api/src/db/bootstrap.ts
 M apps/api/src/db/seed.ts
 M apps/api/src/jobs/index.ts
 M apps/api/src/route-table.snapshot.txt
 D apps/api/src/routes/account-nps.ts
 D apps/api/src/routes/accounts.ts
 D apps/api/src/routes/attachments.ts
 D apps/api/src/routes/bank-details.ts
 D apps/api/src/routes/cards.ts
 D apps/api/src/routes/categories.ts
 D apps/api/src/routes/emis.ts
 D apps/api/src/routes/holdings.ts
 M apps/api/src/routes/insurance.ts
 D apps/api/src/routes/ledger-events.route.test.ts
 D apps/api/src/routes/networth.ts
 D apps/api/src/routes/overdraft-details.ts
 D apps/api/src/routes/recurring.ts
 D apps/api/src/routes/resources.ts
 D apps/api/src/routes/rules.ts
 D apps/api/src/routes/search.ts
 D apps/api/src/routes/sips.ts
 D apps/api/src/routes/transaction-links.ts
 D apps/api/src/routes/transactions.ts
 D apps/api/src/routes/transfers.ts
 D apps/api/src/routes/user-tasks.route.test.ts
 D apps/api/src/routes/user-tasks.ts
 D apps/api/src/services/account-nps.ts
 D apps/api/src/services/accounts.test.ts
 D apps/api/src/services/accounts.ts
 M apps/api/src/services/ai/tools.ts
 D apps/api/src/services/amfi.ts
 D apps/api/src/services/attachments.test.ts
 D apps/api/src/services/attachments.ts
 M apps/api/src/services/auth.ts
 D apps/api/src/services/average-balance.test.ts
 D apps/api/src/services/average-balance.ts
 D apps/api/src/services/bank-details.ts
 M apps/api/src/services/bills.ts
 D apps/api/src/services/capital-gains.test.ts
 D apps/api/src/services/capital-gains.ts
 D apps/api/src/services/card-due-tasks.test.ts
 D apps/api/src/services/card-due-tasks.ts
 D apps/api/src/services/card-statements.ts
 D apps/api/src/services/cards.test.ts
 D apps/api/src/services/cards.ts
 M apps/api/src/services/cashflow.ts
 D apps/api/src/services/categories.ts
 M apps/api/src/services/dashboard.ts
 M apps/api/src/services/demo.ts
 D apps/api/src/services/emis.test.ts
 D apps/api/src/services/emis.ts
 D apps/api/src/services/epf-contributions.test.ts
 D apps/api/src/services/epf-contributions.ts
 D apps/api/src/services/goal-networth.test.ts
 D apps/api/src/services/goal-networth.ts
 M apps/api/src/services/goals.ts
 D apps/api/src/services/holding-details.ts
 D apps/api/src/services/holdings.test.ts
 D apps/api/src/services/holdings.ts
 M apps/api/src/services/imports.test.ts
 M apps/api/src/services/imports.ts
 M apps/api/src/services/inbox.test.ts
 M apps/api/src/services/inbox.ts
 M apps/api/src/services/insurance.ts
 D apps/api/src/services/merchants.ts
 D apps/api/src/services/mf-import.test.ts
 D apps/api/src/services/mf-import.ts
 D apps/api/src/services/mf-scheme-map.ts
 D apps/api/src/services/networth.test.ts
 D apps/api/src/services/networth.ts
 D apps/api/src/services/overdraft-details.ts
 M apps/api/src/services/periods.test.ts
 D apps/api/src/services/recurring.test.ts
 D apps/api/src/services/recurring.ts
 D apps/api/src/services/resources.ts
 D apps/api/src/services/search.ts
 D apps/api/src/services/sips.test.ts
 D apps/api/src/services/sips.ts
 D apps/api/src/services/tax-lots.test.ts
 D apps/api/src/services/tax-lots.ts
 D apps/api/src/services/transaction-links.test.ts
 D apps/api/src/services/transaction-links.ts
 D apps/api/src/services/transactions.test.ts
 D apps/api/src/services/transactions.ts
 D apps/api/src/services/transfers.test.ts
 D apps/api/src/services/transfers.ts
 D apps/api/src/services/user-tasks.test.ts
 D apps/api/src/services/user-tasks.ts
 D apps/api/src/services/xirr.test.ts
 D apps/api/src/services/xirr.ts
 M tasks/01.01-migrate-ledger.md
 M tasks/01.02-migrate-credit.md
 M tasks/01.03-migrate-investments.md
 M tasks/01.04-migrate-protection.md
 M tasks/01.09-cross-module-ports.md
 M tasks/README.md
?? apps/api/src/modules/credit/
?? apps/api/src/modules/investments/
?? apps/api/src/modules/ledger/
?? apps/api/src/route-surface.snapshot.txt
?? tasks/00.01-00.02-verification-1.md
?? tasks/000-agent-harness/
?? tasks/001-domain-event-bus/
?? tasks/001-engineer-routing-memory/
?? tasks/002-retire-url-regex-hook/
?? tasks/003-demo-monthday-utc-fix/
?? tasks/004-fix-eslint-no-undef/
?? tasks/005-fix-api-test-env-loading/
?? tasks/006-module-scaffold-and-route-gate/
?? tasks/007-migrate-ledger/
?? tasks/008-migrate-credit/
?? tasks/009-claude-md-schema-ownership-note/
?? tasks/010-migrate-investments/
?? tasks/011-migrate-protection/
```

Note: `apps/api/src/modules/planning/` (found by `ls -R` in section 5) is **not** listed above as `??` — it is apparently already tracked/committed or otherwise not showing as untracked in this porcelain output. This is worth flagging: `planning` did not appear as `?? apps/api/src/modules/planning/` in the status output, unlike `credit`, `investments`, and `ledger`.

## 2. `git diff --stat` and `git diff --stat --cached`

```
=== git diff --stat ===
 apps/api/src/app.route-snapshot.test.ts         |  106 +-
 apps/api/src/app.ts                             |   79 +-
 apps/api/src/db/bootstrap.ts                    |    2 +-
 apps/api/src/db/seed.ts                         |    2 +-
 apps/api/src/jobs/index.ts                      |    8 +-
 apps/api/src/route-table.snapshot.txt           |   58 +-
 apps/api/src/routes/account-nps.ts              |   29 -
 apps/api/src/routes/accounts.ts                 |   57 -
 apps/api/src/routes/attachments.ts              |   60 --
 apps/api/src/routes/bank-details.ts             |   29 -
 apps/api/src/routes/cards.ts                    |  215 ----
 apps/api/src/routes/categories.ts               |   63 --
 apps/api/src/routes/emis.ts                     |   51 -
 apps/api/src/routes/holdings.ts                 |  176 ---
 apps/api/src/routes/insurance.ts                |    2 +-
 apps/api/src/routes/ledger-events.route.test.ts |  193 ----
 apps/api/src/routes/networth.ts                 |   54 -
 apps/api/src/routes/overdraft-details.ts        |   30 -
 apps/api/src/routes/recurring.ts                |   77 --
 apps/api/src/routes/resources.ts                |   54 -
 apps/api/src/routes/rules.ts                    |   48 -
 apps/api/src/routes/search.ts                   |   38 -
 apps/api/src/routes/sips.ts                     |  122 ---
 apps/api/src/routes/transaction-links.ts        |   28 -
 apps/api/src/routes/transactions.ts             |  104 --
 apps/api/src/routes/transfers.ts                |   62 --
 apps/api/src/routes/user-tasks.route.test.ts    |  307 ------
 apps/api/src/routes/user-tasks.ts               |   57 -
 apps/api/src/services/account-nps.ts            |   58 -
 apps/api/src/services/accounts.test.ts          |  467 --------
 apps/api/src/services/accounts.ts               |  507 ---------
 apps/api/src/services/ai/tools.ts               |    2 +-
 apps/api/src/services/amfi.ts                   |   63 --
 apps/api/src/services/attachments.test.ts       |   59 -
 apps/api/src/services/attachments.ts            |  124 ---
 apps/api/src/services/auth.ts                   |    2 +-
 apps/api/src/services/average-balance.test.ts   |  229 ----
 apps/api/src/services/average-balance.ts        |  261 -----
 apps/api/src/services/bank-details.ts           |   73 --
 apps/api/src/services/bills.ts                  |    2 +-
 apps/api/src/services/capital-gains.test.ts     |   67 --
 apps/api/src/services/capital-gains.ts          |  164 ---
 apps/api/src/services/card-due-tasks.test.ts    | 1025 ------------------
 apps/api/src/services/card-due-tasks.ts         |  129 ---
 apps/api/src/services/card-statements.ts        |  104 --
 apps/api/src/services/cards.test.ts             | 1068 ------------------
 apps/api/src/services/cards.ts                  | 1182 --------------------
 apps/api/src/services/cashflow.ts               |    4 +-
 apps/api/src/services/categories.ts             |  216 ----
 apps/api/src/services/dashboard.ts              |    2 +-
 apps/api/src/services/demo.ts                   |    2 +-
 apps/api/src/services/emis.test.ts              |  507 ---------
 apps/api/src/services/emis.ts                   |  493 ---------
 apps/api/src/services/epf-contributions.test.ts |  372 -------
 apps/api/src/services/epf-contributions.ts      |   65 --
 apps/api/src/services/goal-networth.test.ts     |   95 --
 apps/api/src/services/goal-networth.ts          |  148 ---
 apps/api/src/services/goals.ts                  |    6 +-
 apps/api/src/services/holding-details.ts        |  110 --
 apps/api/src/services/holdings.test.ts          |  191 ----
 apps/api/src/services/holdings.ts               |  536 ---------
 apps/api/src/services/imports.test.ts           |    2 +-
 apps/api/src/services/imports.ts                |    4 +-
 apps/api/src/services/inbox.test.ts             |    4 +-
 apps/api/src/services/inbox.ts                  |    8 +-
 apps/api/src/services/insurance.ts              |    6 +-
 apps/api/src/services/merchants.ts              |   73 --
 apps/api/src/services/mf-import.test.ts         |  305 ------
 apps/api/src/services/mf-import.ts              |  Bin 16174 -> 0 bytes
 apps/api/src/services/mf-scheme-map.ts          |   56 -
 apps/api/src/services/networth.test.ts          |  946 ----------------
 apps/api/src/services/networth.ts               |  581 ----------
 apps/api/src/services/overdraft-details.ts      |   57 -
 apps/api/src/services/periods.test.ts           |    2 +-
 apps/api/src/services/recurring.test.ts         |  721 -------------
 apps/api/src/services/recurring.ts              |  350 ------
 apps/api/src/services/resources.ts              |   76 --
 apps/api/src/services/search.ts                 |   34 -
 apps/api/src/services/sips.test.ts              | 1026 ------------------
 apps/api/src/services/sips.ts                   | 1319 -----------------------
 apps/api/src/services/tax-lots.test.ts          |  368 -------
 apps/api/src/services/tax-lots.ts               |  378 -------
 apps/api/src/services/transaction-links.test.ts |   14 -
 apps/api/src/services/transaction-links.ts      |   76 --
 apps/api/src/services/transactions.test.ts      |   89 --
 apps/api/src/services/transactions.ts           |  441 --------
 apps/api/src/services/transfers.test.ts         |  147 ---
 apps/api/src/services/transfers.ts              |  195 ----
 apps/api/src/services/user-tasks.test.ts        |  503 ---------
 apps/api/src/services/user-tasks.ts             |  182 ----
 apps/api/src/services/xirr.test.ts              |  380 -------
 apps/api/src/services/xirr.ts                   |  270 -----
 tasks/01.01-migrate-ledger.md                   |   16 +-
 tasks/01.02-migrate-credit.md                   |   16 +-
 tasks/01.03-migrate-investments.md              |   24 +-
 tasks/01.04-migrate-protection.md               |    2 +-
 tasks/01.09-cross-module-ports.md               |   15 +-
 tasks/README.md                                 |    6 +-
 98 files changed, 237 insertions(+), 18899 deletions(-)

=== git diff --stat --cached ===
(empty — nothing staged)
```

## 3. `git log --oneline -5`

```
5b3f499 Merge pull request #158 from udai-kiran/docs/roadmap-2.0-task-board
5fba845 docs(tasks): commit the 2.0-2.8 roadmap task board and Codex critique reviews
2ad2db4 Merge pull request #157 from udai-kiran/feat/module-scaffold-route-gate
37683a0 feat(api): module scaffold + route-table identity gate (roadmap 0.3)
8333b3c Merge pull request #156 from udai-kiran/fix/demo-seed-date-utc-rollover
```

## 4. `git stash list`

```
stash@{0}: On fix/db-app-role-table-ownership: wip: insurance feature (settings)
```

## 5. `ls -R apps/api/src/modules/`

```
credit
investments
ledger
planning

apps/api/src/modules/credit:
plugin.test.ts
plugin.ts
routes
schema.smoke.test.ts
schema.ts
services

apps/api/src/modules/credit/routes:
bank-details.ts
cards.ts
emis.ts
overdraft-details.ts

apps/api/src/modules/credit/services:
alerts.ts
bank-details.ts
card-due-tasks.test.ts
card-due-tasks.ts
card-statements.ts
cards.ts
cycle-math.test.ts
cycle-math.ts
emis.test.ts
emis.ts
overdraft-details.ts
reconciliation-reads.test.ts
reconciliation-reads.ts
reconciliation-writes.test.ts
reconciliation-writes.ts
rewards.test.ts
rewards.ts

apps/api/src/modules/investments:
plugin.test.ts
plugin.ts
routes
schema.smoke.test.ts
schema.ts
services

apps/api/src/modules/investments/routes:
account-nps.ts
holdings.ts
networth.route.test.ts
networth.ts
sips.ts

apps/api/src/modules/investments/services:
account-nps.ts
amfi.ts
capital-gains.test.ts
capital-gains.ts
goal-networth.test.ts
goal-networth.ts
holding-details.ts
holdings.test.ts
holdings.ts
mf-import.test.ts
mf-import.ts
mf-scheme-map.ts
networth.test.ts
networth.ts
sip-commitments.test.ts
sip-commitments.ts
sip-installments.test.ts
sip-installments.ts
sip-lifecycle.test.ts
sip-lifecycle.ts
sip-schedule.test.ts
sip-schedule.ts
tax-lots.test.ts
tax-lots.ts
xirr.test.ts
xirr.ts

apps/api/src/modules/ledger:
plugin.test.ts
plugin.ts
routes
schema.smoke.test.ts
schema.ts
services

apps/api/src/modules/ledger/routes:
accounts.ts
attachments.ts
categories.ts
ledger-events.route.test.ts
recurring.ts
resources.ts
rules.ts
search.ts
transaction-links.ts
transactions.ts
transfers.ts
user-tasks.route.test.ts
user-tasks.ts

apps/api/src/modules/ledger/services:
accounts.test.ts
accounts.ts
attachments.test.ts
attachments.ts
average-balance.test.ts
average-balance.ts
categories.ts
epf-contributions.test.ts
epf-contributions.ts
merchants.ts
recurring.test.ts
recurring.ts
resources.ts
search.ts
transaction-links.test.ts
transaction-links.ts
transactions.test.ts
transactions.ts
transfers.test.ts
transfers.ts
user-tasks.test.ts
user-tasks.ts

apps/api/src/modules/planning:
plugin.ts
routes
schema.ts
services

apps/api/src/modules/planning/routes:
projection-settings.route.test.ts
projection-settings.ts

apps/api/src/modules/planning/services:
projection-settings.test.ts
projection-settings.ts
```

**Modules found: 4** — `credit`, `investments`, `ledger`, `planning`.

Note: `planning` module has no `plugin.test.ts` and no `schema.smoke.test.ts`, unlike the other three modules (`credit`, `investments`, `ledger`) which each have both.

## 6. Per-module file listing

Captured verbatim in section 5 above (the `ls -R` output already lists every module directory's files).

## 7. `grep -n "modules/" apps/api/src/app.ts`

```
21:import { ledgerRoutes } from "./modules/ledger/plugin.ts";
27:import { investmentsRoutes } from "./modules/investments/plugin.ts";
30:import { creditRoutes } from "./modules/credit/plugin.ts";
38:import { planningRoutes } from "./modules/planning/plugin.ts";
88: * `modules/ledger/plugin.ts`. As of task 1.2 (migrate-credit), the same
94: * registration order — see `modules/credit/plugin.ts`. As of task 1.3
95: * after `insuranceRoutes` — see `modules/investments/plugin.ts` and
```

(Corrected line ordering in transcript above vs. the tool output — actual grep line 7 read "100: * after `insuranceRoutes`..." in the raw capture; reproduced verbatim from the log file below to avoid transcription error.)

Verbatim from the captured log file (`06-appts-grep.log`):
```
21:import { ledgerRoutes } from "./modules/ledger/plugin.ts";
27:import { investmentsRoutes } from "./modules/investments/plugin.ts";
30:import { creditRoutes } from "./modules/credit/plugin.ts";
38:import { planningRoutes } from "./modules/planning/plugin.ts";
88: * `modules/ledger/plugin.ts`. As of task 1.2 (migrate-credit), the same
94: * registration order — see `modules/credit/plugin.ts`. As of task 1.3
100: * after `insuranceRoutes` — see `modules/investments/plugin.ts` and
```

All four `*Routes` plugin imports (`ledgerRoutes`, `investmentsRoutes`, `creditRoutes`, `planningRoutes`) are imported from `./modules/<name>/plugin.ts`. No grep hit shows the `planningRoutes` plugin being registered/called or documented past the import line (no comment block referencing `modules/planning/plugin.ts` the way ledger/credit/investments have doc comments at lines 88, 94, 100).

## 8. File counts: remaining vs. deleted

### `apps/api/src/routes/*.ts`

Remaining (19 files):
```
apps/api/src/routes/ai-events.ts
apps/api/src/routes/ai.ts
apps/api/src/routes/auth.ts
apps/api/src/routes/backup.ts
apps/api/src/routes/bills.ts
apps/api/src/routes/budgets.ts
apps/api/src/routes/cashflow.ts
apps/api/src/routes/dashboard.ts
apps/api/src/routes/goals.ts
apps/api/src/routes/health.ts
apps/api/src/routes/imports.ts
apps/api/src/routes/inbox.ts
apps/api/src/routes/insights.ts
apps/api/src/routes/insurance.ts
apps/api/src/routes/mailboxes.ts
apps/api/src/routes/notifications.ts
apps/api/src/routes/profile.ts
apps/api/src/routes/reports.ts
apps/api/src/routes/retirement.ts
```

Deleted per `git status --porcelain` (21 entries, `D apps/api/src/routes/...`):
```
apps/api/src/routes/account-nps.ts
apps/api/src/routes/accounts.ts
apps/api/src/routes/attachments.ts
apps/api/src/routes/bank-details.ts
apps/api/src/routes/cards.ts
apps/api/src/routes/categories.ts
apps/api/src/routes/emis.ts
apps/api/src/routes/holdings.ts
apps/api/src/routes/ledger-events.route.test.ts
apps/api/src/routes/networth.ts
apps/api/src/routes/overdraft-details.ts
apps/api/src/routes/recurring.ts
apps/api/src/routes/resources.ts
apps/api/src/routes/rules.ts
apps/api/src/routes/search.ts
apps/api/src/routes/sips.ts
apps/api/src/routes/transaction-links.ts
apps/api/src/routes/transactions.ts
apps/api/src/routes/transfers.ts
apps/api/src/routes/user-tasks.route.test.ts
apps/api/src/routes/user-tasks.ts
```

**routes: 19 remaining, 21 deleted.**

### `apps/api/src/services/*.ts`

Remaining (49 files):
```
apps/api/src/services/ai-settings.test.ts
apps/api/src/services/ai-settings.ts
apps/api/src/services/anomaly.test.ts
apps/api/src/services/anomaly.ts
apps/api/src/services/auth.ts
apps/api/src/services/autopilot.test.ts
apps/api/src/services/autopilot.ts
apps/api/src/services/backup.test.ts
apps/api/src/services/backup.ts
apps/api/src/services/balances.ts
apps/api/src/services/bills.ts
apps/api/src/services/budgets.ts
apps/api/src/services/cache.ts
apps/api/src/services/cashflow.ts
apps/api/src/services/dashboard.ts
apps/api/src/services/demo.test.ts
apps/api/src/services/demo.ts
apps/api/src/services/goal-allocation.test.ts
apps/api/src/services/goal-allocation.ts
apps/api/src/services/goal-plan.test.ts
apps/api/src/services/goal-plan.ts
apps/api/src/services/goal-projection.test.ts
apps/api/src/services/goal-projection.ts
apps/api/src/services/goal-returns.test.ts
apps/api/src/services/goal-returns.ts
apps/api/src/services/goals.ts
apps/api/src/services/health.ts
apps/api/src/services/import-reconciliation.test.ts
apps/api/src/services/import-reconciliation.ts
apps/api/src/services/imports.test.ts
apps/api/src/services/imports.ts
apps/api/src/services/inbox.test.ts
apps/api/src/services/inbox.ts
apps/api/src/services/insights.test.ts
apps/api/src/services/insights.ts
apps/api/src/services/insurance.ts
apps/api/src/services/mailboxes.ts
apps/api/src/services/notifications.ts
apps/api/src/services/ownership.ts
apps/api/src/services/periods.test.ts
apps/api/src/services/periods.ts
apps/api/src/services/prefs.ts
apps/api/src/services/profile.test.ts
apps/api/src/services/profile.ts
apps/api/src/services/reports.test.ts
apps/api/src/services/reports.ts
apps/api/src/services/restore-user.ts
apps/api/src/services/retirement.ts
apps/api/src/services/session.ts
```

Deleted per `git status --porcelain` (51 entries, `D apps/api/src/services/...`):
```
apps/api/src/services/account-nps.ts
apps/api/src/services/accounts.test.ts
apps/api/src/services/accounts.ts
apps/api/src/services/amfi.ts
apps/api/src/services/attachments.test.ts
apps/api/src/services/attachments.ts
apps/api/src/services/average-balance.test.ts
apps/api/src/services/average-balance.ts
apps/api/src/services/bank-details.ts
apps/api/src/services/capital-gains.test.ts
apps/api/src/services/capital-gains.ts
apps/api/src/services/card-due-tasks.test.ts
apps/api/src/services/card-due-tasks.ts
apps/api/src/services/card-statements.ts
apps/api/src/services/cards.test.ts
apps/api/src/services/cards.ts
apps/api/src/services/categories.ts
apps/api/src/services/emis.test.ts
apps/api/src/services/emis.ts
apps/api/src/services/epf-contributions.test.ts
apps/api/src/services/epf-contributions.ts
apps/api/src/services/goal-networth.test.ts
apps/api/src/services/goal-networth.ts
apps/api/src/services/holding-details.ts
apps/api/src/services/holdings.test.ts
apps/api/src/services/holdings.ts
apps/api/src/services/merchants.ts
apps/api/src/services/mf-import.test.ts
apps/api/src/services/mf-import.ts
apps/api/src/services/mf-scheme-map.ts
apps/api/src/services/networth.test.ts
apps/api/src/services/networth.ts
apps/api/src/services/overdraft-details.ts
apps/api/src/services/recurring.test.ts
apps/api/src/services/recurring.ts
apps/api/src/services/resources.ts
apps/api/src/services/search.ts
apps/api/src/services/sips.test.ts
apps/api/src/services/sips.ts
apps/api/src/services/tax-lots.test.ts
apps/api/src/services/tax-lots.ts
apps/api/src/services/transaction-links.test.ts
apps/api/src/services/transaction-links.ts
apps/api/src/services/transactions.test.ts
apps/api/src/services/transactions.ts
apps/api/src/services/transfers.test.ts
apps/api/src/services/transfers.ts
apps/api/src/services/user-tasks.test.ts
apps/api/src/services/user-tasks.ts
apps/api/src/services/xirr.test.ts
apps/api/src/services/xirr.ts
```

**services: 49 remaining, 51 deleted.**

Cross-check: every deleted `routes/*.ts` and `services/*.ts` file name has a same-named counterpart present under one of the four `apps/api/src/modules/<name>/routes/` or `.../services/` directories (visual match against section 5's listing), consistent with a routes/services → modules move rather than a net deletion of functionality. (This is an observation from comparing the two listings, not a verified diff/checksum comparison — no content-level diff was run to confirm the moved files are byte-identical or equivalent.)

## 9. `npm run typecheck`

**Result: PASS.** Exit code 0. No `error` lines in the entire output (`grep -ci "error"` on the log returned `0`).

Full output (32 lines total, no truncation needed):
```

> compass@0.1.0 typecheck
> npm run typecheck --workspaces --if-present


> @compass/api@0.1.0 typecheck
> tsc --noEmit


> @compass/docs@0.1.0 typecheck
> tsc --noEmit


> @compass/extractor@0.1.0 typecheck
> tsc --noEmit


> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit


> @compass/web@0.1.0 typecheck
> tsc --noEmit


> @compass/ai@0.1.0 typecheck
> tsc --noEmit


> @compass/shared@0.1.0 typecheck
> tsc --noEmit

```

## 10. `npm run test -w apps/api`

**Result: PASS.** Exit code 0.

Summary counts (from `node --test` TAP output tail):
```
ℹ tests 837
ℹ suites 1
ℹ pass 837
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 7827.403917
```

Last ~30 individual test lines before the summary (for context):
```
✔ SQL eligibility predicate: a debit already referenced by transfer_links is excluded — the create branch runs instead (37.401251ms)
✔ SQL eligibility predicate: a debit on a different account is excluded — the create branch runs instead (41.108334ms)
✔ SQL eligibility predicate: a row-level userId mismatch is excluded — the create branch runs instead (37.67064ms)
✔ savingRatePct: fraction of income saved, floored at income<=0 (2.04395ms)
✔ coefficientOfVariation: 0 for steady, rises with spread (0.648386ms)
✔ lifestyleInflationPct: recent 3-mo vs earlier baseline drift (0.428936ms)
✔ computeHealthScore: documented weighted formula, clamped components (0.686206ms)
✔ periodRange handles month lengths and years (2.31184ms)
✔ prevPeriodKey crosses year boundaries (0.393458ms)
✔ currentPeriodKey formats today (0.488821ms)
✔ advanceDate steps and clamps day-of-month (0.432694ms)
✔ toFamilyMember maps all fields correctly (2.27732ms)
✔ toFamilyMember does not leak userId/createdAt/updatedAt (0.294127ms)
✔ toFamilyMember passes through null fields (0.217433ms)
✔ UserProfileSchema accepts null dateOfBirth (1.227372ms)
✔ UserProfileSchema accepts ISO date string (0.734261ms)
✔ UserProfileSchema rejects non-ISO date (1.254147ms)
✔ UpdateUserProfileSchema is same as UserProfileSchema (0.220101ms)
✔ CreateFamilyMemberSchema applies null defaults (1.060112ms)
✔ UpdateFamilyMemberSchema rejects expectedCompletionYear out of range (1.422949ms)
✔ UpdateFamilyMemberSchema accepts expectedCompletionYear in range (0.431574ms)
✔ UpdateUserProfileSchema round-trips a dateOfBirth (0.252518ms)
✔ UpdateUserProfileSchema rejects an empty string for dateOfBirth (0.347134ms)
✔ UpdateUserProfileSchema accepts null to clear dateOfBirth (0.195287ms)
✔ User profile DOB save/reload flow: round-trip through service layer (0.916302ms)
✔ resolveReportRange resolves monthly bounds (2.516638ms)
✔ resolveReportRange resolves leap-February bounds (0.301702ms)
✔ resolveReportRange resolves annual bounds (0.21456ms)
✔ resolveReportRange passes a custom range through and joins the periodKey (0.589721ms)
✔ resolveReportRange throws when a custom range lacks from/to (0.40293ms)
✔ resolveReportRange throws when monthly/annual lacks a key (0.212131ms)
✔ resolveReportRange throws for a custom range with an impossible calendar date (0.252067ms)
✔ resolveReportRange throws for a custom range exceeding MAX_REPORT_RANGE_DAYS (0.260098ms)
✔ resolveReportRange does not throw at exactly MAX_REPORT_RANGE_DAYS (0.328671ms)
✔ resolveReportRange throws for a malformed monthly key (0.307769ms)
✔ splitByNecessity sorts rows into essential, non-essential and unclassified by resolved necessity (0.350335ms)
✔ a transaction override routes spend away from its category's default bucket (0.322884ms)
✔ uncategorized spend is unclassified, never assumed (0.231097ms)
✔ a category with no necessity default set is unclassified (0.222721ms)
✔ spend booked against an income category's default is unclassified (0.155021ms)
✔ a transaction override classifies spend that has no category at all (0.206413ms)
✔ a transaction override applies across all of its split category rows (0.243202ms)
✔ two rows resolving to the same necessity sum rather than overwrite (0.240058ms)
✔ the three buckets always sum to the total spend across all input rows (0.179567ms)
✔ reportToCsv emits the necessity rows with distinct labels and values (1.296215ms)
```

Full raw log (952 lines) was captured to `/tmp/claude-1001/-home-udai-PennyPilot/3201a6c8-2e0b-4ad8-80fc-8dc4318e868d/scratchpad/test.log` during this investigation session (not committed anywhere; not part of the repo).

## Summary of findings

- **Refactor in flight:** the `routes/*.ts` and `services/*.ts` files for four domains (ledger, credit, investments, and part of a "protection"/insurance area whose services/routes were not found flatly — see below) have been deleted from the flat `apps/api/src/routes/` and `apps/api/src/services/` directories and now live under `apps/api/src/modules/{ledger,credit,investments,planning}/{routes,services}/`.
- **routes/*.ts: 19 remain flat, 21 deleted** (moved into modules).
- **services/*.ts: 49 remain flat, 51 deleted** (moved into modules).
- `apps/api/src/app.ts` imports `ledgerRoutes`, `investmentsRoutes`, `creditRoutes`, and `planningRoutes` from the four `modules/<name>/plugin.ts` files.
- `git status --porcelain` shows `credit`, `investments`, `ledger` as new untracked directories (`??`), but **`planning` is not listed as untracked** — worth the coordinator's attention, since `ls -R` clearly shows `apps/api/src/modules/planning/` exists with files inside it, yet it doesn't appear as a `??` entry in git status. This investigation did not run `git status apps/api/src/modules/planning` directly to confirm why (e.g., whether it's ignored, or whether it's already tracked from a prior commit); flagging as an open question rather than resolving it, per the read-only/no-further-commands-beyond-the-list instruction.
- `npm run typecheck`: **PASS**, exit code 0, zero errors across all 7 workspaces (api, docs, extractor, ingestor, web, ai, shared).
- `npm run test -w apps/api`: **PASS**, exit code 0, 837 tests / 837 pass / 0 fail / 0 cancelled / 0 skipped / 0 todo, duration 7827.4ms.
- Despite the large-scale file moves (routes/services deleted from flat dirs, re-created under `modules/`), both typecheck and the full api test suite are currently green — i.e., the refactor's current on-disk state is not obviously broken by these two signals.
- No content-diff was performed between deleted flat files and their same-named module counterparts; this report only establishes filename correspondence and aggregate pass/fail signals, not semantic equivalence.
