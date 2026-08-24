# Worker Delegation — Iteration 2: Review-3 blocker fixes

## Task
13.4 Structured Taxable-Income Ledger (`tasks/090-taxable-income-ledger`)

## Worker
`sonnet-worker`

## Routing Reason
Fixes span Drizzle schema + offline migration generation + shared contract +
state-machine semantics + writing nontrivial new service tests; several items
(interplay of guarded accept transitions with summary counts, real-date
validation placement) require judgement against unfamiliar code.

## Approved Plan (fix items, in order)
- P1: `apps/api/src/modules/tax/schema.ts` — add `section TEXT` (nullable) and
  `sourcePriority INTEGER NOT NULL DEFAULT 0` to `incomeEvents`; generate
  migration via:
  `cd apps/api && DATABASE_URL="postgres://localhost:5432/offline" npm run db:generate`
  (offline diff; DATABASE_URL required by drizzle.config even though unused).
  Migration must contain ONLY the two ALTER TABLE ADD COLUMN statements.
- P2: `packages/shared/src/schemas/tax.ts` — add `afterTdsPaise: number` to
  IncomeEvent DTO schema (= grossPaise - tdsPaise); compute it in
  `buildIncomeEventDto`. Update any deepEqual expected objects in schema tests.
- P3: FY summary (`services/income-events.ts`) — add `acceptedCount` and
  `notes: string[]` (gross-not-taxable-salary explanation) to the response;
  update shared schema accordingly.
- P4: Manual-create path must FORCE `sourceKind='manual'` regardless of client
  input (server-side, in the service create function).
- P5: `accrualDate` validated as a REAL calendar date (reject e.g. 2025-02-30)
  with a 400-class validation error before `fyOf()` runs.
- P6: Null `grossPaise` on payslip derivation → reject. COORDINATOR ADJUDICATION:
  use **400**, not 422 (repo-wide Zod/validation errors are 400; app.ts has no
  422 path — same ruling accepted for task 091). Blocker text saying 422 is
  superseded.
- P7: Expand `income-events.test.ts`: guarded accept/reject one-way transition
  (incl. 409-on-terminal semantics at pure level if testable without DB),
  correction snapshot into originalValues, afterTdsPaise computation,
  sourceKind forcing, real-date rejection (2025-02-30) vs valid leap date,
  summary counts incl. acceptedCount + all-five-kinds presence, notes content.
  Hermetic/pure tests only — no DATABASE_URL available locally.

## Files and Symbols
- `apps/api/src/modules/tax/schema.ts` (incomeEvents)
- `apps/api/drizzle/00NN_*.sql` + `meta/*` + `_journal.json` (generated)
- `packages/shared/src/schemas/tax.ts`
- `apps/api/src/modules/tax/services/income-events.ts`
- `apps/api/src/modules/tax/routes/income-events.ts` (only if needed for P5/P6 wiring)
- `apps/api/src/modules/tax/services/income-events.test.ts`

## Must Not Change
- Existing payslip services/routes; EPF files (task 091); tax plugin registration
  order; any table other than incomeEvents; route paths/methods (snapshots stay
  valid); `fy` server-derivation design; partial unique index design.

## Commands
1. `npm run typecheck` → exit 0
2. `npm run lint` → exit 0
3. `node --test apps/api/src/modules/tax/services/income-events.test.ts` → all pass
4. `node --test packages/shared` (schema deepEqual tests) → pass

## Required Evidence
files changed · complete diff · literal command outputs · exit codes · deviations
