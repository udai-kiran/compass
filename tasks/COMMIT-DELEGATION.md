# Worker Delegation — Commit & push phase-13 tax work (session handoff)

## Task
Explicit-path commit + push of tasks 090–092 implementation and 093–101
orchestration files, on branch `feat/082-083-receipt-cart-review`.

## Worker
`sonnet-worker`

## Routing Reason
Multi-step git work requiring judgment when the working tree contains files
outside the approved list (report, don't stage) and a hard stop if gates are
red.

## Approved Plan
1. Run `git status --porcelain` and `git diff --stat`.
2. Verify gates BEFORE staging: `npm run typecheck` and `npm run lint`
   must both exit 0, plus `node --test apps/api/src/app.route-snapshot.test.ts`,
   `node --test apps/api/src/db/schema.decomposition.test.ts`,
   `node --test apps/api/src/lib/error-logging.test.ts`,
   `node --test apps/api/src/lib/scheme-limits.test.ts`,
   `node --test apps/api/src/modules/tax/services/scheme-compliance.test.ts`,
   `node --test apps/api/src/modules/tax/services/income-events.test.ts`,
   `node --test apps/api/src/modules/tax/services/epf-contributions.test.ts`.
   **If ANY gate fails: STOP. Do not stage, commit, or push. Report the literal
   failure output and exit.**
3. Stage EXPLICITLY, by exact path (no `-A`, no `.`, no globs beyond whole
   directories named below):
   - `apps/api/src/modules/tax` (entire directory — all of it is this phase)
   - `apps/api/src/lib/error-logging.ts` `apps/api/src/lib/error-logging.test.ts`
     `apps/api/src/lib/scheme-limits.ts` `apps/api/src/lib/scheme-limits.test.ts`
   - `apps/api/src/app.ts` `apps/api/src/db/schema.ts`
     `apps/api/src/db/shared/hubs.ts` `apps/api/src/db/schema.decomposition.test.ts`
   - `apps/api/drizzle` (entire directory — migrations 0014–0018 + meta)
   - `apps/api/src/route-surface.snapshot.txt` `apps/api/src/route-table.snapshot.txt`
   - `apps/api/src/modules/system/services/backup.ts` `apps/api/src/modules/system/services/backup.test.ts`
   - `apps/api/src/modules/automation/schema.ts`
   - `apps/api/src/modules/credit/services/card-due-tasks.test.ts`
   - `apps/api/src/modules/ledger/services/accounts.ts`
   - `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts`
   - `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
   - `apps/api/src/modules/ledger/services/reconcile-postings.test.ts`
   - `apps/api/src/modules/ledger/services/recurring.test.ts`
   - `apps/api/src/modules/planning/services/postings-planning-parity.test.ts`
   - `packages/shared/src/schemas/tax.ts` `packages/shared/src/schemas/tax.test.ts`
     `packages/shared/src/schemas/ledger.ts` `packages/shared/src/schemas/ai-events.ts`
   - `apps/web/src/routes/accounts/account-groups.test.ts`
   - `apps/web/src/routes/events/EventLogPage.tsx`
   - `apps/web/src/routes/inbox/repayment-eligibility.test.ts`
   - `apps/web/src/routes/settings/SettingsPage.tsx`
   - `tasks/090-taxable-income-ledger` `tasks/091-epf-passbook`
     `tasks/092-scheme-limits` `tasks/093-80c-basket` `tasks/094-regime-comparison`
     `tasks/095-deadline-nudges` `tasks/096-advance-tax` `tasks/097-loss-carryforward`
     `tasks/098-harvesting-planner` `tasks/099-ais-reconciliation` `tasks/101-tax-ui`
     `tasks/PHASE13-CHECKPOINT.md` `tasks/COMMIT-DELEGATION.md`
     `tasks/082-receipt-loop/DELEGATION.md`
4. If any MODIFIED or untracked file exists that is NOT in this list, leave it
   unstaged and name it in the report (expected leftovers: `AGENTS.md`,
   older `tasks/06x`–`08x` dirs, stray artifacts).
5. Commit (message below), then `git push origin feat/082-083-receipt-cart-review`.

## Commit message (verbatim, including trailer)

feat(tax): income-event ledger, EPF passbook & scheme checks (tasks 090-092)

- 13.4 structured taxable-income ledger: income_events table, guarded
  accept/reject transitions, payslip/dividend derivation, FY summary,
  PAN/TAN log-sanitization via lib/error-logging.ts
- 13.5 EPF passbook reconciliation: expected/actual column pairs,
  idempotent payslip import, 45-day gap grace period, corpus projection
  with integer-exact compounding
- 13.6 PPF/SSY/NPS scheme compliance: lib/scheme-limits.ts,
  accounts.scheme_opened_date column, FY-aware limit & lifecycle checks
- plans + review histories for 13.7-13.13 under tasks/

Co-Authored-By: Claude <noreply@anthropic.com>

## Must Not Change
No source file may be edited. Staging only. Never `git add -A`/`.`. Do not
stage anything outside the list. Do not touch other branches.

## Required Evidence
literal `git status --porcelain` before/after · staged file list · gate outputs
with exit codes · commit hash · push result
→ report to `tasks/commit-report-1.md`
