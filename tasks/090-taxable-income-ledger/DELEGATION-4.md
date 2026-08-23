# Worker Delegation — Iteration 4: Review-5 blocker fixes

## Task
13.4 Structured Taxable-Income Ledger (`tasks/090-taxable-income-ledger`)

## Worker
`sonnet-worker`

## Routing Reason
The stack-sanitization fix requires understanding V8's Error.stack format
(first line vs. call frames) and a recursive-cause design; deciding which
mocked-Drizzle test cases to delete vs. keep pure requires judgment about
what each test actually proves.

## Approved Plan
Canonical spec = `tasks/090-taxable-income-ledger/TASK.md` — read the WHOLE
file, especially the new "Review-5 Blockers (pending fix)" section at the
end, which is authoritative.

- P1 (blocker 1): Fix `apps/api/src/lib/error-logging.ts`'s `sanitizeErrorForLog`.
  For a Drizzle-shaped error, split `.stack` on newlines, replace ONLY the
  first line (which V8 renders as `"${name}: ${message}"`, and for a real
  `DrizzleQueryError` that message IS the bound-parameter string) with the
  same safe placeholder already used for `.message`, and keep every
  subsequent line (the `"    at ..."` call frames) — those carry file/line
  info, not data. Also stop passing `.cause` through unchanged: if `.cause`
  is present, recursively apply `sanitizeErrorForLog` to it too before
  including it in the result (some Postgres constraint-violation diagnostics
  can embed failing-row/key values). Add a test that constructs a REAL
  `DrizzleQueryError` (via `new DrizzleQueryError(query, params, cause)` from
  `drizzle-orm/errors.js`, not a hand-written stand-in) containing a fake PAN
  in its bound params, and asserts the fake PAN is absent from EVERY property
  of the sanitized output including `.stack`, serialized as JSON.
- P2 (blocker 2): In `apps/api/src/modules/tax/services/income-events.test.ts`,
  DELETE the test cases that exercise DB-touching behavior (guarded
  accept/reject transitions, cross-user 404 via canned empty query results,
  source-dedup/conflict-refetch) through the hand-built mocked Drizzle chain
  (roughly lines 122-190 define the chain; the tests using it are scattered
  through the file — find them by what they assert, not by line number, since
  line numbers will have shifted after your other edits). KEEP every test in
  this file that is genuinely pure (`lastDayOfMonth`, `buildIncomeEventDto`,
  and any schema/validation-only assertions that never touch the mocked
  chain). The removed DB-touching coverage already exists for real in
  `income-events.integration.test.ts` from the previous round — do not
  duplicate it there, just confirm it is genuinely covered.
- P3 (blocker 3): In `income-events.integration.test.ts`, add a real
  concurrent-derive test (fire two `deriveFromPayslip` calls for the SAME
  payslip via `Promise.all`, not sequentially, and assert exactly one row
  exists and both calls return it) and a real round trip through
  `deriveFromHoldingEvent` proving `section === '194K'` persists (import the
  function, create a real dividend holding event, call it, assert on the
  persisted row). The file's header comment currently claims this coverage
  already exists — it doesn't; adding the tests resolves both the gap and the
  false claim.
- P4 (blocker 4): Run `npx prettier --write` on every file this round
  touches (the test file will change substantially from P2's deletions).

## Files and Symbols
`apps/api/src/lib/error-logging.ts` (+ `.test.ts`) ·
`apps/api/src/modules/tax/services/income-events.test.ts` ·
`apps/api/src/modules/tax/services/income-events.integration.test.ts`

## Must Not Change
Everything already fixed and confirmed by review-5 (section/sourcePriority
exposure, the create/derive paths, AC1-AC6/AC8) — do not re-touch those code
paths. EPF files (a different concurrent worker may be fixing task 13.5 at
the same time in a fully disjoint file set this round — no shared-file risk
this time, verify that remains true before you start). Any table, migration,
or route path. `packages/shared/src/schemas/tax.ts` — this round needs NO
change to that file at all; if you find yourself wanting to edit it, stop and
reconsider, you have likely misread the brief.

## Commands
`npm run typecheck` · `npm run lint` ·
`node --test apps/api/src/lib/error-logging.test.ts` ·
`node --test apps/api/src/modules/tax/services/income-events.test.ts` ·
`node --test apps/api/src/modules/tax/services/income-events.integration.test.ts`
(report whether it could connect to Postgres) · `npx prettier --check` on all
touched files

## Required Evidence
files changed · complete diff per file · literal command outputs · exit codes ·
deviations · explicit proof (literal JSON output) that a real
DrizzleQueryError's sanitized form contains no trace of the fake PAN
anywhere, including in `.stack`
→ report to `tasks/090-taxable-income-ledger/implementation-4.md`
