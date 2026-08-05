# backend-engineer Delegation — SP3 (flat-folder cleanup, AC3)

## Task
020-cross-module-ports (roadmap 1.9), sub-phase SP3. Mechanically rehome the 7 remaining flat files (+ 3
colocated tests) out of `apps/api/src/services/` and `apps/api/src/repositories/` into their owning
homes, update every importer's path, then DELETE both now-empty folders. ZERO behaviour change: contents of
every moved file are byte-identical EXCEPT that file's own relative-import specifiers (which change with
directory depth). NO logic edits, NO signature changes, NO "cleanup", NO reformatting.

## Vehicle
`/home/udai/.claude/bin/backend-engineer tasks/020-cross-module-ports/backend-sp3-1.md "<full prompt>"`
(increment filename for repeat runs). Prefer `git mv` for each physical relocation to preserve rename history,
then edit only the import lines.

## Approved plan (Codex-reviewed, review-7 — 2 blockers fixed, APPROVED)

Before editing any importer, OPEN the file and confirm the CURRENT import specifier, then replace it with the
target below. A single wrong path is caught by typecheck — but aim for zero.

### P1 — `services/cache.ts` → `lib/cache.ts`
File internals: only `import type { Redis } from "ioredis";` — NO change. Update 7 importers:
- `apps/api/src/app.ts` (`"./services/cache.ts"` → `"./lib/cache.ts"`)
- `apps/api/src/modules/planning/routes/insights.ts` → `"../../../lib/cache.ts"`
- `apps/api/src/modules/planning/routes/budgets.ts` → `"../../../lib/cache.ts"`
- `apps/api/src/modules/planning/services/dashboard.ts` → `"../../../lib/cache.ts"`
- `apps/api/src/modules/planning/services/cashflow.ts` → `"../../../lib/cache.ts"`
- `apps/api/src/modules/credit/routes/emis.ts` → `"../../../lib/cache.ts"`
- `apps/api/src/modules/investments/routes/sips.ts` → `"../../../lib/cache.ts"`

### P2 — `services/balances.ts` → `modules/ledger/services/balances.ts`
File internals: `import type { Db } from "../db/index.ts";` → `"../../../db/index.ts"`. (`sql` import unchanged.)
Update importers:
- `apps/api/src/modules/system/services/prefs.ts` → `"../../ledger/services/balances.ts"`
- `apps/api/src/modules/planning/services/dashboard.ts` → `"../../ledger/services/balances.ts"`
- `apps/api/src/modules/planning/services/cashflow.ts` → `"../../ledger/services/balances.ts"`
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` → `"./balances.ts"` (sibling)

### P3 — `services/ownership.ts` → `lib/ownership.ts`
File internals: `../db/index.ts` STAYS `../db/index.ts`; `../db/schema.ts` STAYS `../db/schema.ts`;
`../lib/errors.ts` → `./errors.ts` (errors.ts is now a sibling in lib/). Update 8 importers to
`"../../../lib/ownership.ts"`:
- system/services/prefs.ts, credit/services/emis.ts, ledger/services/recurring.ts,
  ledger/services/transactions.ts, ledger/services/accounts.ts, planning/services/budgets.ts,
  investments/services/holdings.ts, investments/services/sip-lifecycle.ts

### P4 — `services/periods.ts` → `lib/periods.ts` AND `services/periods.test.ts` → `lib/periods.test.ts`
periods.ts internals: `../db/index.ts` STAYS `../db/index.ts` (lib/ same depth as services/). periods.test.ts:
BOTH its imports (`./periods.ts`, `../modules/ledger/services/recurring.ts`) stay byte-identical — move it
VERBATIM. Update 13 non-anomaly importers to `"../../../lib/periods.ts"` (anomaly's import is fixed in P6):
- system/services/notifications.ts, planning/routes/insights.ts, planning/services/cashflow.ts,
  planning/services/reports.test.ts, planning/services/dashboard.ts, planning/services/goals.ts,
  planning/services/budgets.ts, planning/services/insights.ts, planning/services/reports.ts,
  ingest/services/inbox.test.ts, ledger/services/recurring.test.ts, credit/services/alerts.ts,
  automation/services/tools.ts

### P5 — `services/autopilot.ts` (+ `autopilot.test.ts`) → `modules/automation/services/`
autopilot.ts internals: `../db/index.ts`→`../../../db/index.ts`; `../db/schema.ts`→`../../../db/schema.ts`;
`../modules/planning/...`→`../../planning/...`; `../modules/system/...`→`../../system/...`. autopilot.test.ts:
recompute any relative import by +2 dirs of depth (its `./autopilot.ts` sibling import stays). Update importer
`apps/api/src/jobs/index.ts` → `"../modules/automation/services/autopilot.ts"`.

### P6 — `services/anomaly.ts` (+ `anomaly.test.ts`) → `modules/automation/services/`
anomaly.ts internals: `../db/index.ts`→`../../../db/index.ts`; `../db/schema.ts`→`../../../db/schema.ts`;
`../modules/system/...`→`../../system/...`; `./periods.ts`→`../../../lib/periods.ts` (its new lib/ home).
anomaly.test.ts: recompute relative imports by +2 depth (`./anomaly.ts` sibling stays). Update importer
`apps/api/src/jobs/index.ts` → `"../modules/automation/services/anomaly.ts"`.

### P7 — `repositories/users.ts` → `modules/system/services/users.ts`
users.ts internals: `../db/index.ts`→`../../../db/index.ts`; `../db/schema.ts`→`../../../db/schema.ts`.
Update importers:
- `apps/api/src/db/bootstrap.ts` → `"../modules/system/services/users.ts"`
- `apps/api/src/modules/system/services/demo.ts` → `"./users.ts"`
- `apps/api/src/modules/system/services/auth.ts` → `"./users.ts"` (it imports both `UserRow` type + functions;
  merge into a single import from `./users.ts` since UserRow now lives there)
- `apps/api/src/modules/system/routes/auth.ts` → `"../services/users.ts"`

### P8 — delete emptied folders
After P1–P7, `apps/api/src/services/` and `apps/api/src/repositories/` contain NO files. Remove both dirs.

## Must NOT change
- Any moved file's LOGIC, exported names, signatures, SQL text, or formatting — ONLY its import specifiers.
- Any schema, migration, route definition (no route file is moved — only import lines in route files change).
- Any file not listed above.

## Acceptance criteria
- AC3: services/ and repositories/ emptied and DELETED.
- AC6: `npm run typecheck`, `npm run lint`, `npm run test` all green.
- AC4: zero migration diff (no schema touched); route surface unchanged.

## Commands (capture literal invocation, output, exit code for each)
1. `npm run typecheck`
2. `npm run lint`
3. `npm run test -w apps/api` (report total pass/fail/skip; confirm moved tests ran)
4. `git status --porcelain`

## Required evidence (report back)
- Files moved/edited (paths); complete diff.
- Each command's exact invocation, literal output (incl. counts), exit code.
- Confirmation both folders are gone.
- Any deviation or blocker — do NOT silently change scope.
