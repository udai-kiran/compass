# Implementation Report — Task 091 EPF Passbook (worker, session 2 resume)

## Result

All steps complete. typecheck exit 0, lint exit 0, API tests 1216 pass / 33 fail
(all 33 are pre-existing `DATABASE_URL`-gated whole-file module-load aborts; zero
assertion failures).

## Files changed

New:
- `apps/api/src/modules/tax/routes/epf-contributions.ts` — 6 endpoints
- `apps/api/src/modules/tax/services/epf-contributions.test.ts` — 26 hermetic cases
- `apps/api/drizzle/0016_mighty_blonde_phantom.sql`
- `apps/api/drizzle/meta/0016_snapshot.json`

Modified:
- `apps/api/src/modules/tax/services/epf-contributions.ts` (2 edits this session)
- `apps/api/src/modules/tax/plugin.ts` — registers `epfContributionRoutes`
- `apps/api/src/db/schema.ts` — re-exports `epfContributions`
- `apps/api/src/db/schema.decomposition.test.ts` — 78 tables, `taxResidents`
- `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES + USER_TABLES
- `apps/api/src/route-surface.snapshot.txt`, `route-table.snapshot.txt` — regenerated
- `apps/api/drizzle/meta/_journal.json` — 0016 entry

Already done by interrupted session 1 (verified unchanged): `vpf` in
`CanonicalComponentKindSchema`, all EPF Zod schemas in shared tax.ts,
`epfContributions` table in modules/tax/schema.ts, service body.

## Implementation detail

1. Removed unused `Db` import; added `postings`, `transactions` imports.
2. **Balance fix**: `getProjection` had been reading `accounts.openingBalancePaise`
   as current corpus. In this repo opening balance materialises as a posting
   against the `opening` system account and `listAccounts` derives balance purely
   from postings. Replaced with ownership check + posted-balance aggregate using
   listAccounts predicates (`deleted_at is null`, `date <= current_date`,
   `transactions.user_id = userId`) incl. `Number.isSafeInteger` guard.

Routes (statics before params, `/api/tax` prefix):
GET /epf-contributions · GET /epf-contributions/gaps · GET /epf-contributions/projection ·
POST /epf-contributions (201) · POST /epf-contributions/import-from-payslip/:payslipId ·
POST /epf-contributions/:id/confirm-actual

Tests: computeStatus ×12 (incl. 1%-tolerance boundary, zero/null expected columns),
fyToWageMonthRange ×4, buildEpfContributionDto ×10 (incl. employer_epf/EPS excluded
from 80C invariant).

## Commands and literal results

```
DATABASE_URL unset → db:generate failed; rerun offline:
cd apps/api && DATABASE_URL="postgres://localhost:5432/offline" npm run db:generate
EXIT=0 ; 79 tables ; epf_contributions 18 columns 3 indexes 2 fks
→ drizzle/0016_mighty_blonde_phantom.sql (new table + 2 FKs + 3 indexes only)

npm run typecheck          → EXIT=0
npm run lint               → EXIT=0
npm run test -w apps/api   → EXIT=1 : tests 1250, pass 1216, fail 33, skipped 1
  all 33 = "needs DATABASE_URL set" module-load aborts (no .env / no Postgres here)
gates that ran green: 78-table decomposition, both route-snapshot byte-for-byte tests,
computeStatus/fyToWageMonthRange/buildEpfContributionDto suites

Backup coverage re-checked hermetically (throwaway root script, deleted after):
OK full backup covers every schema table (79) · exportGaps()==[] · no double-scoped
table · FILE_COLUMNS covers storage keys · payslips(75) precedes epf_contributions(78)
· epf_contributions in USER_TABLES: user_id — EXIT=0
```

## Coordinator-adjudicated deviations (accepted)

1. **400 not 422** on missing `epfoMemberId`: app.ts converts every Zod failure to
   400 repo-wide; field stays required in the body schema.
2. **78 tables** not 77: AC8 number was stale; barrel genuinely holds 78 (+users).
3. **Snapshot regen absorbed stale 088/090 routes** (28-line surface diff, 10 lines
   are this task's). Necessary; snapshots now match reality.

## Open risks (for coordinator)

1. `vpf` unreachable from payslip parsing — payslip-parse.ts canonicalKind enum
   lacks "vpf"; `importFromPayslip case "vpf"` dead for payslip rows. Follow-up fix.
2. No DB integration coverage locally (upsert idempotency, actual_* preservation,
   FY wage-month filter, projection aggregate) — CI-only until DB available.
3. `payslip_id` FK has ON DELETE no action → deleting imported payslip blocked.
4. Ledger `POST /api/epf-contributions` vs tax `POST /api/tax/epf-contributions`
   coexist — readability hazard only, verified distinct.
5. Empty sibling dir `tasks/091-epf-reconciliation/` exists — stale, untouched.
