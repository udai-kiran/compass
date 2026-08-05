Everything verified. Here's the complete summary:

---

## Summary

### Files moved (10 `git mv` operations)

| # | Old path | New path | Own-import changes |
|---|----------|----------|-------------------|
| P1 | `services/cache.ts` | `lib/cache.ts` | None (only `ioredis` import) |
| P2 | `services/balances.ts` | `modules/ledger/services/balances.ts` | `../db/index.ts` → `../../../db/index.ts` |
| P3 | `services/ownership.ts` | `lib/ownership.ts` | `../lib/errors.ts` → `./errors.ts` |
| P4 | `services/periods.ts` | `lib/periods.ts` | None (`../db/index.ts` same depth) |
| P4 | `services/periods.test.ts` | `lib/periods.test.ts` | None (sibling + cross-module paths identical) |
| P5 | `services/autopilot.ts` | `modules/automation/services/autopilot.ts` | `../db/` → `../../../db/`, `../modules/planning/` → `../../planning/`, `../modules/system/` → `../../system/` |
| P5 | `services/autopilot.test.ts` | `modules/automation/services/autopilot.test.ts` | None (sibling import) |
| P6 | `services/anomaly.ts` | `modules/automation/services/anomaly.ts` | `../db/` → `../../../db/`, `../modules/system/` → `../../system/`, `./periods.ts` → `../../../lib/periods.ts` |
| P6 | `services/anomaly.test.ts` | `modules/automation/services/anomaly.test.ts` | None (sibling import) |
| P7 | `repositories/users.ts` | `modules/system/services/users.ts` | `../db/index.ts` → `../../../db/index.ts`, `../db/schema.ts` → `../../../db/schema.ts` |

### Importers edited (29 files, 35 import specifier changes)

**P1 (cache.ts → lib):** `app.ts`, `planning/routes/insights.ts`, `planning/routes/budgets.ts`, `planning/services/dashboard.ts`, `planning/services/cashflow.ts`, `credit/routes/emis.ts`, `investments/routes/sips.ts`

**P2 (balances.ts → ledger):** `system/services/prefs.ts`, `planning/services/dashboard.ts`, `planning/services/cashflow.ts`, `ledger/services/epf-contributions.test.ts`

**P3 (ownership.ts → lib):** `system/services/prefs.ts`, `credit/services/emis.ts`, `ledger/services/recurring.ts`, `ledger/services/transactions.ts`, `ledger/services/accounts.ts`, `planning/services/budgets.ts`, `investments/services/holdings.ts`, `investments/services/sip-lifecycle.ts`

**P4 (periods.ts → lib):** `system/services/notifications.ts`, `planning/routes/insights.ts`, `planning/services/cashflow.ts`, `planning/services/reports.test.ts`, `planning/services/dashboard.ts`, `planning/services/goals.ts`, `planning/services/budgets.ts`, `planning/services/insights.ts`, `planning/services/reports.ts`, `ingest/services/inbox.test.ts`, `ledger/services/recurring.test.ts`, `credit/services/alerts.ts`, `automation/services/tools.ts`

**P5+P6 (autopilot+anomaly → automation):** `jobs/index.ts` (both)

**P7 (users.ts → system):** `db/bootstrap.ts`, `system/services/demo.ts`, `system/services/auth.ts`, `system/routes/auth.ts`

### Deleted directories (P8)
- `apps/api/src/services/` — confirmed gone
- `apps/api/src/repositories/` — confirmed gone

### Verification results

| Command | Exit code | Result |
|---------|-----------|--------|
| `npm run typecheck` | 0 | All 7 workspaces pass |
| `npm run lint` | 0 | No lint errors |
| `npm run test -w apps/api` | 0 | 885 pass, 1 skip, 0 fail (886 total) |
| `git status --porcelain` | — | All changes are `R` (renamed) or `M` (modified import lines) |

**Moved tests confirmed ran:** `periodRange`, `prevPeriodKey`, `currentPeriodKey`, `advanceDate` (periods.test.ts), `detectAnomaly` x4 (anomaly.test.ts), `no breach...`, `breaches when...` (autopilot.test.ts).

**No stale references:** `grep` confirms zero remaining `services/cache|balances|ownership|periods|autopilot|anomaly` or `repositories/users` import paths.

**Zero behaviour change:** Every diff is purely import specifier adjustments. No logic edits, no signature changes, no SQL changes, no formatting changes.
