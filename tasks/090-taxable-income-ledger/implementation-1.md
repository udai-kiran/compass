# Task 090 — Structured Taxable-Income Ledger: Implementation Report

## Files Inspected (read before editing)

- `apps/api/src/modules/tax/schema.ts`
- `apps/api/src/modules/tax/plugin.ts`
- `packages/shared/src/schemas/tax.ts`
- `apps/api/src/modules/investments/schema.ts` (holdingEvents table structure)
- `apps/api/src/lib/financial-year.ts` (fyOf signature)
- `apps/api/src/modules/tax/services/payslip-review.ts` (state machine pattern)
- `apps/api/src/db/shared/spines.ts` (holdings table with userId)
- `apps/api/src/db/schema.ts` (barrel)
- `apps/api/src/modules/system/services/backup.ts`
- `apps/api/src/db/schema.decomposition.test.ts`
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`
- `apps/api/src/modules/tax/routes/payslips.ts` (pattern reference)
- `packages/shared/src/index.ts`

## Files Changed

1. `apps/api/src/modules/tax/schema.ts` — Added 3 pgEnums + incomeEvents table
2. `packages/shared/src/schemas/tax.ts` — Added income event Zod schemas
3. `apps/api/src/modules/tax/services/income-events.ts` — NEW service file
4. `apps/api/src/modules/tax/routes/income-events.ts` — NEW routes file
5. `apps/api/src/modules/tax/plugin.ts` — Registered incomeEventRoutes
6. `apps/api/src/db/schema.ts` — Re-exported incomeEvents + 3 new enums
7. `apps/api/src/modules/system/services/backup.ts` — Added income_events to ALL_TABLES and USER_TABLES
8. `apps/api/src/db/schema.decomposition.test.ts` — Updated count 76→77, enum count 58→61, added new symbols to taxResidents
9. `apps/api/src/modules/tax/services/income-events.test.ts` — NEW test file
10. `apps/api/src/route-surface.snapshot.txt` — Updated with new income-event routes
11. `apps/api/src/route-table.snapshot.txt` — Updated with new route tree
12. `apps/api/drizzle/0015_unknown_christian_walker.sql` — Generated migration
13. `apps/api/drizzle/meta/0015_snapshot.json` — Generated migration metadata

## Implementation Details

### P1: Schema (tax/schema.ts)

Added 3 pgEnums:
- `incomeEventStatus`: `["pending", "accepted", "rejected"]`
- `incomeKind`: `["salary", "interest", "dividend", "rent", "other"]`
- `incomeSourceKind`: `["payslip", "holding_event", "manual", "ais"]`

Added `incomeEvents` table with:
- All required columns per spec
- Check constraints: `gross_paise >= 0`, `tds_paise >= 0`, `tds_paise <= gross_paise`
- Partial unique index: `(user_id, source_kind, source_id) WHERE source_id is not null`
- FK: `user_id → users.id CASCADE DELETE`
- Additional imports: `sql` from drizzle-orm; `check`, `date`, `jsonb` from drizzle-orm/pg-core

### P2: Shared Zod schemas (packages/shared/src/schemas/tax.ts)

Added:
- `IncomeEventStatusSchema`, `IncomeKindSchema`, `IncomeSourceKindSchema`
- `IncomeEventSchema` (full DTO)
- `CreateIncomeEventBodySchema` — no `fy` field; PAN/TAN with trim+toUpperCase+regex; refine for tds<=gross
- `AcceptIncomeEventBodySchema` — corrections to payerName, payerPan, payerTan, notes
- `IncomeKindSummarySchema`, `IncomeEventSummarySchema` — all 5 income kinds always present
- `GetIncomeEventsQuerySchema`, `GetIncomeEventsSummaryQuerySchema`

PAN regex: `^[A-Z]{5}[0-9]{4}[A-Z]$`
TAN regex: `^[A-Z]{4}[0-9]{5}[A-Z]$`

### P3: Service (income-events.ts)

Key functions:
- `lastDayOfMonth(payMonth: string): string` — exported pure helper for testing
- `buildIncomeEventDto(row): IncomeEvent` — exported pure helper for testing
- `createIncomeEvent(db, userId, input)` — fy = fyOf(accrualDate), sourceKind defaults to 'manual'
- `listIncomeEvents(db, userId, query)` — filters by fy, status, incomeKind
- `getIncomeEvent(db, userId, id)` — ownership-scoped
- `acceptIncomeEvent(db, userId, id, corrections)` — snapshots pre-accept state in original_values, guarded UPDATE WHERE status='pending'
- `rejectIncomeEvent(db, userId, id)` — guarded UPDATE WHERE status='pending' RETURNING
- `getSummary(db, userId, fy)` — aggregates ONLY accepted rows; all 5 kinds always present; isEstimate: always true
- `deriveFromPayslip(db, userId, payslipId)` — accrualDate=lastDayOfMonth(payslip.payMonth), fy=fyOf(accrualDate), onConflictDoNothing() without explicit target, fetch-on-conflict
- `deriveFromHoldingEvent(db, userId, eventId)` — innerJoin holdings on holdingId, ownership via holdings.userId, throws 400 if type !== 'dividend'

### P4: Routes (income-events.ts)

8 endpoints, static before parameterized:
1. `GET /income-events` — list with optional filters
2. `GET /income-events/summary` — FY summary (registered before /:id)
3. `GET /income-events/:id` — single event
4. `POST /income-events` — create manual (201)
5. `POST /income-events/:id/accept` — accept with corrections
6. `POST /income-events/:id/reject` — reject
7. `POST /income-events/derive/payslip/:payslipId` — derive from payslip
8. `POST /income-events/derive/holding-event/:eventId` — derive from dividend event

### P5: Plugin wiring

`taxRoutes` in `plugin.ts` now registers: `regimePreferenceRoutes`, `payslipRoutes`, `incomeEventRoutes`

### P6: Migration generated

File: `drizzle/0015_unknown_christian_walker.sql`

Contains:
- `CREATE TYPE income_event_status AS ENUM(...)`
- `CREATE TYPE income_kind AS ENUM(...)`
- `CREATE TYPE income_source_kind AS ENUM(...)`
- `CREATE TABLE income_events (...)` with all columns and check constraints
- `ALTER TABLE income_events ADD CONSTRAINT ... FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE cascade`
- `CREATE UNIQUE INDEX income_events_source_unique_idx ... WHERE source_id is not null`
- `CREATE INDEX income_events_user_fy_idx ...`

### P7: Route snapshots regenerated

Both `route-surface.snapshot.txt` and `route-table.snapshot.txt` updated with the 11 new routes (3 GET/HEAD + 5 POST + HEAD copies).

### P8: Test file

14 tests covering:
- `lastDayOfMonth` — 7 tests (June, January, February non-leap, February leap, March, April, December)
- `buildIncomeEventDto` — 7 tests (pending salary, accepted with corrections, rejected, null sourceId, dividend, zero tds, PAN+TAN)

## Commands Run

```
DATABASE_URL=postgresql://compass:password@localhost:5432/compass node ../../node_modules/drizzle-kit/bin.cjs generate
→ [✓] drizzle/0015_unknown_christian_walker.sql

npm run typecheck
→ exit 0 (all 6 workspaces pass)

npm run lint
→ exit 0 (no warnings)

npm run test -w apps/api
→ exit 1 (failures are all pre-existing DATABASE_URL-dependent tests)
→ All pure tests pass including:
   - route snapshot tests: 7/7 pass
   - decomposition: 3/3 pass
   - income-events unit: 14/14 pass
   - payslip tests: pass

node --test apps/api/src/modules/tax/services/income-events.test.ts
→ 14/14 pass, exit 0
```

## Test Counts

`npm run test -w apps/api` full run:
- All pure/hermetic tests pass
- All failures are pre-existing: DATABASE_URL-dependent tests (require a running Postgres)
  The list of DB-requiring test files includes: app.test.ts, backup.test.ts, automation.route.test.ts, revolving-debt.route.test.ts, emis.test.ts, rewards.test.ts, reconciliation-writes.test.ts, ingest.route.test.ts, inbox.test.ts, networth.route.test.ts, sip-installments.test.ts, ledger route/service tests, planning route/service tests, protection route tests, shopping route tests, system route/service tests

`node --test apps/api/src/modules/tax/services/income-events.test.ts`: **14 pass, 0 fail**

## Migration File Name

`apps/api/drizzle/0015_unknown_christian_walker.sql`

## Route Snapshot Changes

New routes added to surface snapshot:
```
GET /api/tax/income-events
GET /api/tax/income-events/:id
GET /api/tax/income-events/summary
HEAD /api/tax/income-events
HEAD /api/tax/income-events/:id
HEAD /api/tax/income-events/summary
POST /api/tax/income-events
POST /api/tax/income-events/:id/accept
POST /api/tax/income-events/:id/reject
POST /api/tax/income-events/derive/holding-event/:eventId
POST /api/tax/income-events/derive/payslip/:payslipId
```

Route table tree addition:
```
├── /api/tax/income-events (GET, HEAD, POST)
│   ├── /summary (GET, HEAD)
│   ├── /derive/payslip/:payslipId (POST)
│   ├── /derive/holding-event/:eventId (POST)
│   └── /:id (GET, HEAD)
│       ├── /accept (POST)
│       └── /reject (POST)
```

## Assumptions

- The `originalValues` JSONB field stores pre-accept corrections as a JSON object (not deeply typed); the service stores a plain `Record<string, unknown>`.
- For `rejectIncomeEvent`, original_values is not set (not relevant to rejection).
- The `deriveFromHoldingEvent` service throws 400 internally (not in the route), so the dead-code `if (!event)` guard in the route is redundant but harmless.

## Unresolved Risks

- The partial unique index `(user_id, source_kind, source_id) WHERE source_id is not null` prevents Drizzle from using `.onConflictDoUpdate()` with an explicit target (Drizzle limitation). The implemented workaround — `.onConflictDoNothing()` without explicit target + fetch-on-conflict — is the established pattern per DELEGATION.md and works correctly.
- The `backup.test.ts` pure unit tests (lines 46–98) that validate ALL_TABLES coverage DO require DATABASE_URL at module load time (line 388), so they cannot be verified without a DB connection in this environment. The logic is correct — income_events is in both ALL_TABLES and USER_TABLES.
