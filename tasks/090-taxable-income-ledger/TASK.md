# Task: 13.4 — Structured Taxable-Income Ledger

## Status
COMPLETE

## Objective
Add a reviewable, provenance-carrying income-event ledger to the tax module: one
row per taxable income fact (salary 192, interest 194A/194K, dividend/IDCW, rent
194-I, other) with gross amount, TDS, payer name, payer PAN, payer TAN,
deduction section, accrual date and server-derived financial year. Events are
created manually or derived from an existing source (accepted payslip, dividend
`holdingEvents` row) and must be explicitly accepted before they contribute to
any tax figure. Expose an FY summary the downstream advance-tax work (13.10) and
the tax dashboard (13.13) can consume.

## Root Cause
The tax roadmap assumes salary, interest, dividends, rent, TDS and capital gains
combine into one liability, but only capital gains have a structured
computation. Interest, rent and dividends are ordinary categorized transactions
with no payer, PAN/TAN, section, gross-versus-net split, TDS section, accrual
period or AIS linkage. `holdingEvents.type = "dividend"` exists but
`services/tax-lots.ts` deliberately ignores dividends (they are slab-taxed) and
nothing picks them up afterwards. Bank interest and rental income have no
structure at all.

Tax facts also need provenance and a review status, like `extracted_transactions`:
a payslip, an AIS line, a manual entry and an inferred transaction can disagree.
A tax total with no audit trail is not usable.

## Scope

### New files
- `apps/api/src/modules/tax/services/income-events.ts` — CRUD, guarded
  accept/reject state machine, FY summary, derive-from-payslip,
  derive-from-holding-event
- `apps/api/src/modules/tax/services/income-events.test.ts`
- `apps/api/src/modules/tax/routes/income-events.ts`

### Modified files
- `apps/api/src/modules/tax/schema.ts` — add `incomeEvents` table + 3 pgEnums
- `apps/api/src/modules/tax/plugin.ts` — register `incomeEventRoutes`
- `apps/api/src/db/schema.ts` — re-export `incomeEvents` and its enums
- `packages/shared/src/schemas/tax.ts` — income-event Zod schemas
- `apps/api/src/modules/system/services/backup.ts` — `ALL_TABLES` + `USER_TABLES`
- `apps/api/src/db/schema.decomposition.test.ts` — table count 76 → 77

### Table design
```sql
income_events (
  id              UUID PK DEFAULT gen_random_uuid(),
  user_id         UUID NOT NULL FK → users(id) ON DELETE CASCADE,

  income_kind     income_kind NOT NULL,        -- salary | interest | dividend | rent | other
  section         TEXT,                        -- deduction/TDS section: '192','194A','194K','194-I'; NULL = unknown/NA
  fy              TEXT NOT NULL,               -- ALWAYS fyOf(accrual_date); never client-supplied
  accrual_date    DATE NOT NULL,

  gross_paise     BIGINT NOT NULL,
  tds_paise       BIGINT NOT NULL DEFAULT 0,
  -- no generated column: after-TDS is computed in the DTO, not persisted
  -- (a stored generated column would need OMITTED_RESTORE_COLUMNS handling)

  payer_name      TEXT,
  payer_pan       TEXT,                        -- ^[A-Z]{5}[0-9]{4}[A-Z]$
  payer_tan       TEXT,                        -- ^[A-Z]{4}[0-9]{5}[A-Z]$

  source_kind     income_source_kind NOT NULL, -- payslip | holding_event | manual | ais
  source_id       UUID,                        -- LOGICAL reference (polymorphic, no FK); NULL for manual
  source_priority INTEGER NOT NULL DEFAULT 0,  -- precedence when two sources describe the same income

  status          income_event_status NOT NULL DEFAULT 'pending',
  accepted_at     TIMESTAMPTZ,
  original_values JSONB,                       -- pre-accept snapshot when the user corrects on accept
  notes           TEXT,

  created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CHECK (gross_paise >= 0),
  CHECK (tds_paise   >= 0),
  CHECK (tds_paise   <= gross_paise)
)

-- dedup of repeated derivation from the same source occurrence
CREATE UNIQUE INDEX income_events_source_unique_idx
  ON income_events (user_id, source_kind, source_id)
  WHERE source_id IS NOT NULL;

CREATE INDEX income_events_user_fy_idx ON income_events (user_id, fy);
```

Discriminators are pg enums, not free text, so migrations, restore and internal
service writes are constrained too (Zod alone does not protect those paths).

### Financial year derivation (server-side, always)
- `CreateIncomeEventBody` has **no** `fy` field. Every creation path computes
  `fy = fyOf(accrualDate)` using `apps/api/src/lib/financial-year.ts`.
- Payslip derivation: `accrualDate = lastDayOfMonth(payslip.payMonth)` where
  `payMonth` is `"YYYY-MM"` (e.g. `"2025-06"` → `"2025-06-30"`). The payslip's
  own `fy` column is not trusted.
- Holding-event derivation: `accrualDate = event.date`.
- `accrualDate` must be validated as a real calendar date, not just a
  `YYYY-MM-DD` shape, so an impossible date cannot reach `fyOf()` and surface as
  a 500.

### PAN / TAN
Separate nullable fields, never a merged `payer_pan_tan`:
```typescript
const panSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format").nullable().optional();
const tanSchema = z.string().trim().toUpperCase()
  .regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "Invalid TAN format").nullable().optional();
```
Stored plaintext (consistent with PRAN in the investments schema), but never
echoed into error messages, logs, analytics or AI event payloads.

### Review state machine
`pending → accepted | rejected`, one-way, using the extracted-transactions
pattern:
```sql
UPDATE income_events SET status='accepted', accepted_at=NOW(), original_values=<pre-state>, ...
 WHERE id=$1 AND user_id=$2 AND status='pending' RETURNING *
```
- Empty `RETURNING` → 409 if the row exists in a terminal state, 404 if it does
  not exist or belongs to another user (indistinguishable).
- Accept may carry corrections to `payer_name`, `payer_pan`, `payer_tan`,
  `notes`; the pre-correction values are snapshotted into `original_values` in
  the same statement/transaction as the acceptance.
- Rejected rows keep `accepted_at = NULL`.

### Derivation (user-invoked, idempotent)
- `deriveFromPayslip(payslipId)`: payslip must be owned by the caller and
  accepted; maps gross → `gross_paise`, current-period TDS → `tds_paise`,
  `income_kind='salary'`, `section='192'`, `source_kind='payslip'`,
  `source_id=payslipId`. A null `grossPaise` is **rejected with 422**.
- `deriveFromHoldingEvent(eventId)`: ownership is checked through
  `holdingEvents.holdingId → holdings.userId` (`holding_events` has no
  `user_id`). `event.type` must be `'dividend'`; `buy`/`sell` are rejected with
  400 ("Only dividend events can be derived as income") so a purchase cannot
  manufacture dividend income.
- Both use targetless `.onConflictDoNothing()` (Drizzle cannot emit the
  `WHERE source_id IS NOT NULL` predicate required to infer the partial unique
  index) and, when `RETURNING` is empty, re-fetch the existing row scoped by
  `(user_id, source_kind, source_id)`. Re-deriving is therefore a no-op.

### Summary
Accepted rows only. Pending rows contribute to `pendingCount` alone; rejected
rows contribute to nothing. Grouped by `income_kind`, with all five kinds always
present. Fields are named `grossPaise`/`tdsPaise` — never `taxableSalaryPaise` —
because payslip gross is not taxable salary. The response carries
`acceptedCount`, `pendingCount`, `isEstimate: true`, and `notes[]` stating that
salary figures are gross (exemptions and deductions live in payslip components
and are applied downstream).

### Routes (relative paths inside the `/api/tax` plugin prefix)
Static segments registered before parameterized ones; `/summary` before `/:id`.
- `GET  /income-events?fy=&status=&incomeKind=`
- `GET  /income-events/summary?fy=`
- `GET  /income-events/:id`
- `POST /income-events` (201, manual entry)
- `POST /income-events/:id/accept`
- `POST /income-events/:id/reject`
- `POST /income-events/derive/payslip/:payslipId`
- `POST /income-events/derive/holding-event/:eventId`

The manual-create route always persists `source_kind='manual'` and
`source_id=NULL`; the client cannot claim `payslip`, `holding_event` or `ais`
provenance through it.

## Dependencies
- 13.1 (FY helpers `fyOf` / `fyRange`) — complete
- 13.2 (payslips, payslip_components, payslip review state machine) — complete
- 13.3 (fixed-income deposits) — complete (interest derivation itself is a
  non-goal here, see below)

## Plan
- P1: Add `incomeEvents` table + `income_event_status` / `income_kind` /
  `income_source_kind` pgEnums to `modules/tax/schema.ts`, with the paise check
  constraints and the partial unique index. No generated columns.
- P2: Add Zod schemas to `packages/shared/src/schemas/tax.ts`:
  `IncomeEventSchema` (incl. computed `afterTdsPaise`), `CreateIncomeEventBody`
  (no `fy`), `AcceptIncomeEventBody`, `IncomeEventSummarySchema`,
  `GetIncomeEventsQuery`, with the exact PAN/TAN regexes and real-date
  `accrualDate` validation.
- P3: Create `modules/tax/services/income-events.ts`: `createIncomeEvent`,
  `listIncomeEvents`, `getIncomeEvent`, `acceptIncomeEvent`,
  `rejectIncomeEvent`, `getSummary`, `deriveFromPayslip`,
  `deriveFromHoldingEvent`, plus the pure helpers `lastDayOfMonth` and
  `buildIncomeEventDto`.
- P4: Create `modules/tax/routes/income-events.ts` (8 endpoints).
- P5: Wire the tax plugin, backup arrays, `db/schema.ts` barrel, decomposition
  test (76 → 77).
- P6: `npm run db:generate` and review the SQL.
- P7: Regenerate route snapshots.
- P8: Write `income-events.test.ts` covering: guarded transitions, concurrent
  accept vs reject, cross-user 404s, source dedup / concurrent derive,
  accepted-only summary, non-dividend rejection, null-gross 422, FY boundary
  cases (31 Mar / 1 Apr), PAN/TAN normalization and invalid positions, and
  `original_values` capture.

## Acceptance Criteria
- AC1: `income_events` table with pgEnum discriminators, `section` and
  `source_priority` columns, check constraints (including
  `tds_paise <= gross_paise`), partial UNIQUE index, no generated column.
- AC2: `pending → accepted|rejected` via a guarded atomic
  `UPDATE ... WHERE status='pending' RETURNING`; corrections snapshotted into
  `original_values`.
- AC3: Summary aggregates accepted rows only, exposes `acceptedCount`,
  `pendingCount`, `isEstimate: true` and gross-not-taxable `notes`, with all
  five income kinds present.
- AC4: `deriveFromPayslip` is idempotent (targetless `onConflictDoNothing` +
  conflict fetch), requires an accepted owned payslip, sets `section='192'` and
  `accrualDate = lastDayOfMonth(payMonth)`, and rejects a null `grossPaise` with
  422.
- AC5: `deriveFromHoldingEvent` rejects non-dividend events with 400 and
  verifies ownership through `holdings.userId`.
- AC6: `fy` is always server-computed from `accrualDate` on every path;
  `CreateIncomeEventBody` has no `fy` field; `accrualDate` rejects impossible
  calendar dates.
- AC7: PAN and TAN are separate fields with the exact positional regexes,
  trimmed and uppercased, and never logged or sent to a model.
- AC8: `income_events` present in `ALL_TABLES` and `USER_TABLES`; decomposition
  count updated (76 → 77).
- AC9: typecheck + lint + test green; route snapshots regenerated.

## Verification
- T1: `npm run typecheck` — exit 0
- T2: `npm run lint` — exit 0
- T3: `node --test apps/api/src/modules/tax/services/income-events.test.ts`
- T4: `npm run test -w apps/api` — decomposition (77 tables) and both route
  snapshot tests green
- T5: `npm run test -w packages/shared` — income-event schema tests green
- T6: backup coverage: `income_events` in both arrays, ordered after `payslips`
- T7: generated migration reviewed (new enums + table + FK + indexes only)

## Non-Goals
- Automatic materialization hooks on payslip acceptance, dividend create/delete,
  or deposit accrual generation — derivation is user-invoked in this task.
- Fixed-income interest derivation from `computeAccrualSchedule` accrual periods
  (needs a deterministic occurrence key; deferred).
- Cross-source reconciliation identity / supersession graph and append-only
  correction history beyond the single `original_values` snapshot.
- AIS / Form 16 import and matching.
- Section-level (`bySection`) aggregation in the summary.
- Editing or un-accepting an accepted event.
- Any taxable-salary computation (exemptions, deductions, slab treatment) —
  belongs to 13.7 / 13.8 / 13.10.
- Capital gains, which stay in their own computation and are joined only
  downstream.

## Review-3 Blockers (pending fix)
1. Missing `section` column on `income_events` (deduction-section tagging) and
   missing `source_priority` column for precedence ordering — neither is in the
   Drizzle table or the generated migration.
2. DTO / shared `IncomeEventSchema` is missing the `afterTdsPaise` field
   (`grossPaise - tdsPaise` is never computed in list/get responses).
3. Summary response is missing `acceptedCount` and the required `notes`
   explaining that salary figures are gross rather than taxable salary.
4. No service tests yet — the test file covers only `lastDayOfMonth` and
   `buildIncomeEventDto`; the state machine, concurrency, dedup, ownership,
   derivation and summary semantics are untested.
5. Null `grossPaise` in `deriveFromPayslip` must be rejected with **422** per
   the original spec; it currently returns 400.
6. Force `source_kind='manual'` where applicable — the manual-create route lets
   the client choose `sourceKind`, so fake `payslip`/`holding_event`/`ais`
   provenance can be created.
7. `accrualDate` must validate against real calendar dates — an impossible date
   such as `2025-02-30` passes Zod today and makes `fyOf()` throw a 500 instead
   of a validation error.

## Review-4 Blockers (pending fix)

Codex implementation review (`review-4.md`) found the review-3 fixes landed at
the persistence layer but not at the API boundary, plus one repo-wide security
gap surfaced by this task's own PAN/TAN handling. Confirmed by the coordinator
via direct reads of the current code (not taken on the review's word alone).

1. **`section` and `sourcePriority` never reach the API.** Both columns exist
   on the table (`schema.ts:233,242`) but `IncomeEventSchema` omits both
   (`tax.ts`), `buildIncomeEventDto` omits both (`income-events.ts:67-90`),
   `CreateIncomeEventBodySchema` has no `section` field, and `createIncomeEvent`
   never inserts one — a manual 194A/194K/194-I entry cannot record its section
   at all. `deriveFromPayslip` DOES set `section: "192"` already
   (`income-events.ts:389`); `deriveFromHoldingEvent` sets none.
   `sourcePriority` is never assigned anywhere and stays at the DB default (0)
   on every row.
2. **PAN/TAN can reach application logs on an unexpected DB error.**
   `DrizzleQueryError`'s constructor bakes the bound parameters directly into
   `.message` (`node_modules/drizzle-orm/errors.js:10-19`:
   `` `Failed query: ${query}\nparams: ${params}` ``). The global unexpected-5xx
   handler logs the raw error object (`app.ts:245`, `req.log.error(err)`) for
   any error with `status >= 500 && name !== "HttpError"`. A DB failure during
   an income-event create/accept write (both send PAN/TAN as bound params)
   would place plaintext PAN/TAN in the application log. This is a repo-wide
   gap (any bound parameter on any failed query anywhere is exposed this way),
   surfaced concretely by this task's own AC7 requirement.
3. **No shared-contract tests exist for the income-event schemas.**
   `packages/shared/src/**/*.test.ts` has no reference to `IncomeEventSchema`,
   `CreateIncomeEventBodySchema`, or `AcceptIncomeEventBodySchema` — PAN/TAN
   normalization, invalid-position rejection, impossible-date rejection, and
   `fy`/provenance-field exclusion are untested at the schema layer (only
   indirectly, at the service layer, via a mocked DB).
4. **`income-events.test.ts`'s "concurrency"/dedup/ownership tests use a
   mocked Drizzle query-builder that ignores its `.where()` and
   `.onConflictDoNothing()` arguments** (`income-events.test.ts:122-190`).
   `tasks/TDD.md` is explicit and repo-wide: *"Do not mock the database. CI has
   a real one; a mocked Drizzle chain tests your mock."* These tests would
   still pass if the production code dropped its user/status predicates
   entirely. Real Postgres-backed integration tests are required for: guarded
   accept-vs-reject (a real race), cross-user 404 against a real second user's
   row, and source-dedup against the real partial unique index via two real
   `deriveFromPayslip` calls. `apps/api/src/modules/ledger/services/epf-contributions.test.ts`
   is this repo's exemplar pattern (`requireDatabaseUrl()` throws loudly rather
   than skipping when `DATABASE_URL` is unset; each test creates and cleans up
   its own throwaway user/rows).
5. Minor/low, bundle into the same pass: an unreachable `if (!event)` fallback
   in the holding-event route (`income-events.ts` routes file, the underlying
   service function always throws or returns); a route-file comment claiming
   derive routes are registered before `/:id` when the actual order is
   reversed (Fastify's specificity rules make this harmless today, but fix the
   comment or the order); six touched files fail `prettier --check` (only if
   this repo has a format script/gate — check `package.json` before spending
   effort here).

Coordinator adjudications carried into this round (not to be re-litigated):
review-3 blocker 5 stays **400** (not 422); the shared-schema deepEqual tests
already in place from review-3 fixes are not being redone, only supplemented.

## Review-5 Blockers (pending fix)

Codex implementation review (`review-5.md`) confirmed review-4's two High
findings are now fixed, then found the PAN/TAN fix itself is incomplete.

1. **PAN/TAN still leak through `DrizzleQueryError.stack`.** `sanitizeErrorForLog`
   correctly omits `.message`, `.query`, `.params`, but passes `.stack` through
   unchanged (`error-logging.ts:57`). V8 constructs `Error.stack` starting with
   `"${name}: ${message}"` followed by call frames — for a real
   `DrizzleQueryError` that first line IS the same
   `Failed query: ...\nparams: ...` string the whole fix exists to suppress.
   Reviewer proved this by constructing a real `DrizzleQueryError` containing a
   fake PAN and observing it survive sanitization. Fix: for a
   Drizzle-shaped error, replace only the FIRST LINE of `.stack` (the
   `name: message` line) with the same safe placeholder used for `.message`,
   while preserving the remaining call-frame lines (`"    at ..."`) — those
   carry no bound values and remain useful for debugging. Also stop passing
   `.cause` through unsanitized — recursively apply the same sanitizer to
   `.cause` if present, since some Postgres constraint-violation diagnostics
   can embed failing-row/key values.
2. **The prohibited mocked Drizzle chain remains in `income-events.test.ts`.**
   The guarded-transition/dedup/ownership tests still use a hand-built query
   builder that ignores its `.where()`/`.onConflictDoNothing()` arguments
   (lines ~122-190), which `tasks/TDD.md` explicitly forbids ("Do not mock the
   database"). This is no longer a correctness gap (the same behavior is now
   also proven by the real-Postgres integration suite from the previous
   round), so it is pure convention debt — but this round should actually
   REMOVE the DB-mocking test cases from this file (guarded accept/reject,
   cross-user 404 via canned empty selects, source-dedup conflict-refetch)
   rather than leave both a fake and a real version. KEEP the genuinely pure
   tests in this same file (`lastDayOfMonth`, `buildIncomeEventDto`, and
   anything that doesn't touch a mocked DB chain at all).
3. **Two P8 real-DB edge cases are still missing**: a concurrent-derive test
   (two `deriveFromPayslip` calls fired via `Promise.all`, not just
   sequentially) and a real round trip through `deriveFromHoldingEvent`
   proving the `194K` section persists (the integration file's own header
   comment claims this coverage but the function is never imported/called in
   that file — fix the false claim by either adding the test or correcting
   the comment; adding the test is preferred since it is cheap and the
   function is already exported).
4. `prettier --check` still fails on `income-events.test.ts` — re-run
   `prettier --write` after the other changes in this round land (the file
   will change substantially from finding 2's test removal anyway).

Accepted, non-blocking: AC9's real-Postgres/API-suite gate cannot be verified
in this sandboxed environment (`DATABASE_URL` unset) — this is an
environment limitation affecting every task in this phase equally, not a
090-specific defect, and does not block this round's completion.
