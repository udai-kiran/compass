# Worker Delegation — Iteration 2: Review-3 blocker fixes

## Task
13.5 EPF Passbook Reconciliation & Benefit Projection (`tasks/091-epf-passbook`)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: a state-machine redesign with several interacting nullable
components (employee/employer/EPS/VPF), a real re-import correctness bug
whose fix must not reintroduce duplicate rows, new pure-function extraction
for date-gated gap logic and compounding projection math, and a large new
real-Postgres integration test suite — none of this reduces to deterministic
mechanical steps without implementation-level reasoning.

## Approved Plan
Canonical spec = `tasks/091-epf-passbook/TASK.md` — read the WHOLE file,
especially the new "Review-3 Blockers (pending fix)" section at the end
(10 numbered items) and the amended "Non-Goals" list, which are authoritative
and supersede this summary wherever they differ.

- P1 (blocker 1): Delete the preflight short-circuit in `importFromPayslip`
  that returns the existing row before reading current payslip components.
  Every import attempt must reach the `onConflictDoUpdate` upsert, which
  already targets the right conflict key and already preserves `actual_*` by
  omitting those columns from its SET clause — do not change the upsert
  itself, only remove what bypasses it.
- P2 (blocker 2): Rewrite `computeStatus` per TASK.md's exact rule: stays
  `pending` while ANY component with a non-null EXPECTED value still has a
  null ACTUAL value, across all FOUR components (employee, employer, EPS,
  **and VPF** — VPF is currently not compared at all); once every
  expected-non-null component has an actual, compute per-component mismatch
  (skip a component when its expected is null or zero) and return `mismatch`
  if any exceeds 1%, else `matched`. Per the coordinator adjudication in
  TASK.md, do NOT make `confirmed` reachable — tighten
  `ReconciliationStatusSchema`'s doc-comment in `tax.ts` instead to say it is
  reserved for a future explicit-user-override action.
- P3 (blocker 3): Add a 45-day grace period to `getGaps`. Implement the
  eligibility check (`today >= wageMonthEnd(wageMonth) + 45 days`) as a
  **pure, unit-tested function** taking `wageMonth` and an injectable `asOf`
  date, not embedded in the DB query.
- P4 (blocker 4): Add a computed `grossEmployerContributionPaise` field
  (employer + EPS, actual-preferred-over-expected, same pattern as
  `eligible80cPaise`) to `EpfContributionSchema`/`buildEpfContributionDto`;
  remove the dead log-only "invariant check". Add one sentence to
  `PAYSLIP_SYSTEM` in `payslip-parse.ts` (~line 290) stating `employer_epf`
  must be the amount actually credited to the PF corpus NET of any EPS
  diversion.
- P5 (blocker 5): Add real-Postgres integration tests following
  `apps/api/src/modules/ledger/services/epf-contributions.test.ts`'s pattern
  exactly (`requireDatabaseUrl()` throws loudly; each test creates/cleans up
  its own rows). Cover at minimum: import ownership + accepted-state checks;
  multi-component summing; the re-import-refresh fix from P1 (if this
  worker's environment can reach a real Postgres, write this test FIRST
  against a git stash of the pre-P1 code to watch it fail, per
  `tasks/TDD.md`'s discipline — if that is impractical given the tooling
  available, write it against the FIXED code and explicitly note in the
  report that the fail-first step was reasoned through by re-reading the old
  code rather than executed); actual-value preservation across re-import;
  cross-user list/confirm isolation; gap-query correctness at/around the
  45-day boundary from P3; posted-balance projection against real ledger
  postings. If no Postgres is reachable at all, write the tests anyway (must
  typecheck, must be structurally complete) and say so plainly — never fake
  DB access with a mock; this repo has no DB-mocking infrastructure and
  `tasks/TDD.md` forbids it outright.
- P6 (blocker 6): Require `accounts.type = 'epf'` in `getProjection`'s
  ownership query; reject any other type the same way an unowned account is
  already rejected (do not leak whether a same-ID different-type account
  exists via a different error message/status).
- P7 (blocker 7): Rename `yearsToRetirement` → `monthsToRetirement` (matches
  TASK.md's `EpfCorpusProjection` interface — do not keep both), add
  `rateApplicableFy` and `disclaimer` fields, tighten `isEstimate` to
  `z.literal(true)` and `rateSource` to `z.literal("last_known_official")` in
  `EpfCorpusProjectionSchema`. Extract the compounding calculation into a
  pure function (inputs: `currentCorpusPaise`, months/years to retirement,
  rate in bps, `asOf`/DOB as plain values; output: the projection fields) so
  it is unit-testable without a DB or `new Date()` inside it; the service
  calls the pure function and supplies the real clock/DB values.
- P8 (blocker 8): Replace the `Math.pow`-based compounding with **year-by-year
  integer compounding**:
  `corpus = Math.round(corpus * (10000 + assumedAnnualRateBps) / 10000)`
  applied once per elapsed year, not a single power operation over N years.
  Add a safe-integer check on the FINAL `projectedCorpusPaise` (not just the
  starting aggregate). Replace the floating mismatch check
  `Math.abs(actual - expected) / expected > 0.01` with the exactly-equivalent
  integer cross-multiplication `Math.abs(actual - expected) * 100 > expected`.
- P9 (blocker 9): No code change — TASK.md's route line has been corrected to
  say POST (coordinator adjudication favoring the already-implemented,
  already-consistent-with-090's-sibling-routes convention). Confirm the route
  file and both snapshots already say POST (they should — do not change them
  to PUT).
- P10 (blocker 10): As part of this round's own verification pass,
  independently re-run and report the CURRENT `npm run typecheck`,
  `npm run lint`, and both route-snapshot tests. A prior review's snapshot of
  the tree reported these red for reasons attributed to unrelated concurrent
  task 13.6 work that has since landed and self-reported fixed — do not take
  either report's word for it, re-confirm directly.

## Files and Symbols
`apps/api/src/modules/tax/services/epf-contributions.ts` (computeStatus,
importFromPayslip, getGaps, getProjection, buildEpfContributionDto) ·
`apps/api/src/modules/tax/services/payslip-parse.ts` (PAYSLIP_SYSTEM only) ·
`packages/shared/src/schemas/tax.ts` (ReconciliationStatusSchema,
EpfContributionSchema, EpfCorpusProjectionSchema, EpfGapResultSchema if
needed) · `apps/api/src/modules/tax/services/epf-contributions.test.ts`
(pure-function tests) · new
`apps/api/src/modules/tax/services/epf-contributions.integration.test.ts` ·
possibly a new small pure module for the gap-eligibility and/or projection
math if you judge that cleaner than adding functions to the service file —
your call, document the choice

## Must Not Change
income-events files (`income-events*`, migrations 0015/0017) — a DIFFERENT
concurrent worker may be fixing task 13.4 in these files right now; migration
0016 (no new migration needed — this round adds no columns, per TASK.md's
Non-Goals deferring CHECK constraints); any table other than
`epf_contributions`; existing route paths/methods (P9 keeps POST); task 13.6's
`scheme-compliance` files/schemas. **`packages/shared/src/schemas/tax.ts`
file-sharing note:** a different concurrent worker may be editing the
income-events region of this SAME file (roughly the front/middle) for task
13.4 at the same time. Touch ONLY the EPF section (from
`// ─── EPF Contributions` onward). Re-read the file immediately before every
`Edit` call rather than relying on line numbers or content read earlier in
your session — the file may change underneath you from the other worker's
concurrent edits.

## Commands
`npm run typecheck` · `npm run lint` ·
`node --test apps/api/src/modules/tax/services/epf-contributions.test.ts` ·
`node --test apps/api/src/modules/tax/services/payslip-parse.test.ts`
(regression) · `npm run test -w packages/shared` · both route-snapshot tests ·
the new integration test file (report whether it could actually connect to
Postgres)

## Required Evidence
files changed · complete diff per file · literal command outputs · exit codes ·
deviations · explicit confirmation of current (not historical) typecheck/lint/
route-snapshot status
→ report to `tasks/091-epf-passbook/implementation-2.md`
