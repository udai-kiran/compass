# Worker Delegation — Iteration 3: Review-4 blocker fixes

## Task
13.4 Structured Taxable-Income Ledger (`tasks/090-taxable-income-ledger`)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: a repo-wide error-logging security fix with no existing
precedent to copy, a state-machine-adjacent schema exposure fix that must not
reopen the review-3 precedence questions, and new real-Postgres integration
tests that must actually prove the guarded-transition/dedup semantics rather
than exercise a mock.

## Approved Plan
Canonical spec = `tasks/090-taxable-income-ledger/TASK.md` — read the WHOLE
file, especially the new "Review-4 Blockers (pending fix)" section at the end,
which is authoritative and supersedes this summary wherever they differ.

- P1: Expose `section`/`sourcePriority` end-to-end.
  - `packages/shared/src/schemas/tax.ts`: add `section: z.string().nullable()`
    and `sourcePriority: z.number().int()` to `IncomeEventSchema`; add
    `section: z.string().min(1).nullable().optional()` to
    `CreateIncomeEventBodySchema` (do NOT add `sourcePriority` to the create
    body — it stays server-controlled, default 0, per the existing pattern for
    other server-derived fields on this schema).
  - `income-events.ts` `buildIncomeEventDto`: map both fields through.
  - `income-events.ts` `createIncomeEvent`: insert `section: input.section ?? null`;
    insert `sourcePriority: 0` explicitly (documents intent even though it
    matches the DB default).
  - `income-events.ts` `deriveFromPayslip`: already sets `section: "192"` —
    leave it; also set `sourcePriority: 0` explicitly for the same reason.
  - `income-events.ts` `deriveFromHoldingEvent`: set `section: "194K"` (the
    real TDS section for dividend/IDCW from mutual-fund units — NOT 194-I,
    which is rent) with a short code comment citing the section like the
    existing `// TDS on salary is deducted under section 192.` comment does;
    set `sourcePriority: 0`.
- P2: Fix the PAN/TAN-in-logs risk in the global error handler.
  Add a new pure, unit-tested helper — suggested location
  `apps/api/src/lib/error-logging.ts`, e.g.
  `sanitizeErrorForLog(err: unknown): Record<string, unknown>` — that always
  includes `name` and `stack` (when present) but OMITS `.message` for a
  `DrizzleQueryError`-shaped error (duck-type on `name === "DrizzleQueryError"`
  or on the presence of a `.query`/`.params` pair — your call, document which
  and why) since `DrizzleQueryError.message` bakes bound query parameters
  directly into the string (`node_modules/drizzle-orm/errors.js:10-19`). For
  every other error shape, keep logging `.message` — do not regress existing
  debuggability. Wire this helper into `apps/api/src/app.ts`'s unexpected-5xx
  branch (~line 245, `req.log.error(err)`) in place of logging the raw error.
  Unit-test the helper directly with a constructed object shaped like a real
  `DrizzleQueryError` (message containing a fake PAN e.g. `ABCDE1234F`) and
  assert the fake PAN string is NOT present anywhere in the sanitized output,
  while a plain `Error("boom")`'s message IS still present in its sanitized
  output. `app.ts` is outside this task's originally-declared file scope but
  the coordinator has approved this narrow, single-function addition as part
  of closing AC7 — do not expand beyond the one call site.
- P3: Add shared-schema tests. Find the existing test-file pattern under
  `packages/shared/src/schemas/*.test.ts` (deepEqual-style) and add coverage
  for `IncomeEventSchema`/`CreateIncomeEventBodySchema`/`AcceptIncomeEventBodySchema`:
  PAN/TAN trim+uppercase normalization, rejection of a PAN/TAN with a digit
  and letter transposed from the correct position, rejection of an impossible
  calendar date (`2025-02-30`) at the schema layer, `CreateIncomeEventBodySchema`
  has no `fy`/`sourceKind`/`sourceId` field to strip, `afterTdsPaise` shape
  presence on `IncomeEventSchema`, and the summary schema's five-kinds-always-present
  shape.
- P4: Add real-Postgres integration tests. Follow
  `apps/api/src/modules/ledger/services/epf-contributions.test.ts`'s pattern
  exactly (`requireDatabaseUrl()` throws loudly rather than skipping when
  `DATABASE_URL` is unset; each test creates and cleans up its own throwaway
  user/rows via `t.after()` or an `after()` hook). New file, e.g.
  `income-events.integration.test.ts`, colocated next to the service. Cover:
  a real guarded accept-vs-reject race (fire both concurrently via
  `Promise.all`, assert exactly one succeeds and the loser gets 409); a real
  cross-user 404 on `getIncomeEvent`/`acceptIncomeEvent`/`rejectIncomeEvent`
  against a second real user's row; real dedup via two real
  `deriveFromPayslip` calls against the same accepted payslip, asserting the
  second call returns the SAME row id and the partial unique index has
  exactly one row; one round trip proving `section`/`sourcePriority` persist
  and return correctly end to end. If this worker's environment genuinely has
  no reachable Postgres, write the tests anyway (they must typecheck and be
  structurally complete) and say so explicitly in the report — do not fake
  DB access with a mock to make them "pass" (this repo has no DB-mocking
  infrastructure and `tasks/TDD.md` forbids it).
- P5: Minor cleanup — remove the unreachable `if (!event)` fallback in the
  holding-event route; fix the route-ordering comment to describe the actual
  registration order (reordering the routes themselves is acceptable instead,
  your call, but the snapshots must still match afterward); check whether
  this repo has a `prettier`/format script in `package.json` before spending
  effort reformatting the six files review-4 flagged — if no such script
  exists, skip this item and say so.
- P6: Re-run the FULL verification suite (see Commands) and confirm AC9 is
  currently green in this tree — a prior review's snapshot of the tree
  reported it red for reasons attributed to unrelated concurrent work (task
  13.6) that has since landed; independently re-confirm, do not assume.

## Files and Symbols
`packages/shared/src/schemas/tax.ts` (IncomeEventSchema, CreateIncomeEventBodySchema) ·
`apps/api/src/modules/tax/services/income-events.ts` (buildIncomeEventDto,
createIncomeEvent, deriveFromPayslip, deriveFromHoldingEvent) ·
`apps/api/src/modules/tax/routes/income-events.ts` · new
`apps/api/src/lib/error-logging.ts` (+ `.test.ts`) · `apps/api/src/app.ts`
(one call site only) · new `income-events.integration.test.ts` · new/extended
`packages/shared/src/schemas/tax.test.ts` (or wherever the existing pattern
lives — find it, do not invent a new location)

## Must Not Change
EPF files (`epf-contributions*`, `payslip-parse*`, migration 0016) — a
DIFFERENT concurrent worker may be fixing task 13.5 in these files right now;
income-events migrations 0015/0017 (no new migration needed for this round —
`section`/`sourcePriority` are already-migrated columns, this round is API/DTO
exposure only); any table other than `income_events`; existing route
paths/methods; the 400-not-422 adjudication from review-3 (do not revert to
422); task 13.6's `scheme-compliance` files/schemas (a different task).
**`packages/shared/src/schemas/tax.ts` file-sharing note:** a different
concurrent worker may be editing the EPF section of this SAME file (roughly
the back half, from `// ─── EPF Contributions` onward) for task 13.5 at the
same time. Touch ONLY the income-events region (`IncomeEventSchema` and
friends, roughly the front/middle of the file). Re-read the file immediately
before every `Edit` call rather than relying on line numbers or content read
earlier in your session — the file may change underneath you from the other
worker's concurrent edits.

## Commands
`npm run typecheck` · `npm run lint` ·
`node --test apps/api/src/modules/tax/services/income-events.test.ts` ·
`node --test apps/api/src/lib/error-logging.test.ts` ·
`npm run test -w packages/shared` · route snapshot test(s) · the new
integration test file (report whether it could actually connect to Postgres)

## Required Evidence
files changed · complete diff per file · literal command outputs · exit codes ·
deviations · explicit confirmation of current (not historical) typecheck/lint/
route-snapshot status
→ report to `tasks/090-taxable-income-ledger/implementation-3.md`
