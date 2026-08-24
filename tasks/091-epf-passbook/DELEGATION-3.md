# Worker Delegation — Iteration 3: Review-4 blocker fixes

## Task
13.5 EPF Passbook Reconciliation & Benefit Projection (`tasks/091-epf-passbook`)

## Worker
`sonnet-worker`

## Routing Reason
The `computeStatus` fix requires careful reasoning about which of four
nullable/non-nullable components the zero-exception legitimately applies to,
and the stale-status bug requires reasoning about where in the upsert flow
recomputation must happen without breaking the existing preserve-actuals
behavior.

## Approved Plan
Canonical spec = `tasks/091-epf-passbook/TASK.md` — read the WHOLE file,
especially the new "Review-4 Blockers (pending fix)" section at the end
(5 numbered items), which is authoritative. Note: the stale PUT route line
has ALREADY been corrected to POST by the coordinator directly — no route
code change is needed for that.

- P1 (blocker 1): Rewrite `computeStatus` in
  `apps/api/src/modules/tax/services/epf-contributions.ts`. Add an
  unconditional leading check: if `actualEmployeePaise`, `actualEmployerPaise`,
  `actualEpsPaise`, AND `actualVpfPaise` are ALL null, return `'pending'`
  immediately. Otherwise, apply `needsConfirmation` as follows: for
  employee/employer/EPS, a component needs confirmation whenever its expected
  is non-null (INCLUDING when it is exactly zero) and its actual is null. For
  VPF only, keep the existing zero-skip exception (VPF's expected defaults to
  0 meaning "no VPF", so a zero expected does not need an actual). The
  mismatch-calculation zero/null skip (divide-by-zero guard) is unchanged for
  all four components. Update/add tests: all-actuals-null with a zero VPF
  expected and null nullable expecteds → `pending` (the case review-4 found
  broken); a non-null zero expected on employee/employer/EPS with a null
  actual → `pending` (not `matched`); the existing VPF-zero-exception tests
  should still pass unchanged.
- P2 (blocker 2): Make `createManual` and `importFromPayslip` recompute
  `reconciliationStatus` inside their existing upsert whenever `expected_*`
  changes — call the now-fixed `computeStatus` with the row's CURRENT actual
  values (existing actuals when updating an existing row via conflict, nulls
  on a fresh insert) and the NEW expected values, and include the recomputed
  status in the same `SET`/insert clause. Add an integration test: confirm a
  row (employee expected+actual both 180000 → `matched`), then re-import with
  a corrected payslip whose employee component is now 185000, and assert the
  row's status is `mismatch` after the re-import (not stale `matched`).
- P3 (blocker 3): In `computeEpfProjection`, replace the per-year
  floating-adjacent multiplication `corpus * (10000 + assumedAnnualRateBps) /
  10000` with exact `BigInt` arithmetic per step (multiply as BigInt, add half
  the divisor before dividing for round-half-up, convert back to `Number`),
  with a safe-integer check after EVERY step, not just the final result. Add
  a test using a corpus value large enough to demonstrate the old
  `number`-only arithmetic would have diverged (reviewer's example was
  ~8,000,000,000,200 paise) and assert the new BigInt path produces the
  exact expected result.
- P4 (blocker 4): When `getProjection` falls back to a 20-year retirement
  horizon because DOB is missing, set the response's `disclaimer` field
  explicitly to state that assumption (distinct wording from the normal-case
  disclaimer), rather than reusing the same generic text.
- P5 (blocker 5): Fix the three stale "12% of basic" doc comments (service
  file header, `schema.ts`, `tax.ts`) to describe the actual rule (employer
  share = whatever the payslip/passbook states; no unconditional-rate check
  per H2). Fix the import route's doc comment describing the deleted
  preflight-return behavior to describe the current always-upsert behavior.

## Files and Symbols
`apps/api/src/modules/tax/services/epf-contributions.ts` (computeStatus,
createManual, importFromPayslip, computeEpfProjection, getProjection, header
comment) · `apps/api/src/modules/tax/schema.ts` (comment only) ·
`packages/shared/src/schemas/tax.ts` (comment only — EPF section) ·
`apps/api/src/modules/tax/routes/epf-contributions.ts` (comment only) ·
`apps/api/src/modules/tax/services/epf-contributions.test.ts` ·
`apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`

## Must Not Change
Everything already fixed and confirmed by review-4 (45-day grace period,
grossEmployerContributionPaise, EPF account-type check, projection interface
shape, integer cross-multiplication mismatch check, the POST route) — do not
re-touch those unless directly required by P1-P5 above. income-events files
(a different concurrent worker may be fixing task 13.4 at the same time in a
fully disjoint file set this round — no shared-file risk this time, verify
that remains true before you start). Any table, migration, or route path —
this round adds no new columns and needs no migration.

## Commands
`npm run typecheck` · `npm run lint` ·
`node --test apps/api/src/modules/tax/services/epf-contributions.test.ts` ·
`node --test apps/api/src/modules/tax/services/epf-contributions.integration.test.ts`
(report whether it could connect to Postgres) ·
`npm run test -w packages/shared` (regression — should be unaffected since
you're only touching comments there)

## Required Evidence
files changed · complete diff per file · literal command outputs · exit codes ·
deviations
→ report to `tasks/091-epf-passbook/implementation-3.md`
