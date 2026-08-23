# Worker Delegation

## Task
090 — Structured Taxable-Income Ledger (13.4)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: cross-module ownership checks (holdingEvent through holdings.user_id), partial-unique-index conflict handling in Drizzle (no targetWhere support), state machine with atomic corrections, PAN/TAN normalization regex, FY derivation logic, and correct mapping of payslip fields to income event fields — all require substantial reasoning against real codebase conventions.

## Approved Plan
- P1: Add `incomeEvents` table to `apps/api/src/modules/tax/schema.ts` — columns per TASK.md design, using pgEnum for status/income_kind/source_kind, check constraints on paise, partial UNIQUE index
- P2: Add Zod schemas to `packages/shared/src/schemas/tax.ts`: IncomeEventSchema, CreateIncomeEventBody (no fy field — server derives), AcceptIncomeEventBody, IncomeEventSummarySchema, GetIncomeEventsQuery. PAN: `^[A-Z]{5}[0-9]{4}[A-Z]$` with trim+toUpperCase. TAN: `^[A-Z]{4}[0-9]{5}[A-Z]$`.
- P3: Create `apps/api/src/modules/tax/services/income-events.ts`: createIncomeEvent (fy=fyOf(accrualDate)), listIncomeEvents, getIncomeEvent, acceptIncomeEvent (UPDATE WHERE status='pending' RETURNING, corrections→original_values), rejectIncomeEvent, getSummary (accepted rows only), deriveFromPayslip (accrualDate=lastDayOfMonth(payMonth), onConflictDoNothing, fetch if conflict), deriveFromHoldingEvent (require event.type==='dividend', 400 otherwise)
- P4: Create `apps/api/src/modules/tax/routes/income-events.ts` (8 endpoints: static before parameterized; /summary before /:id)
- P5: Wire in tax plugin, backup arrays, barrel re-export, decomposition test (76→77)
- P6: Generate migration
- P7: Regenerate route snapshots (npm run typecheck first)
- P8: Write `apps/api/src/modules/tax/services/income-events.test.ts`

## Files and Symbols
- NEW: `apps/api/src/modules/tax/services/income-events.ts`
- NEW: `apps/api/src/modules/tax/services/income-events.test.ts`
- NEW: `apps/api/src/modules/tax/routes/income-events.ts`
- MODIFY: `apps/api/src/modules/tax/schema.ts` — add incomeEvents table
- MODIFY: `apps/api/src/modules/tax/plugin.ts` — register income-events routes
- MODIFY: `apps/api/src/db/schema.ts` — re-export incomeEvents
- MODIFY: `packages/shared/src/schemas/tax.ts` — add income event schemas
- MODIFY: `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES + USER_TABLES
- MODIFY: `apps/api/src/db/schema.decomposition.test.ts` — count 76→77

## Required Changes

### Table (tax/schema.ts)
Use pgEnum for status ('pending','accepted','rejected'), income_kind ('salary','interest','dividend','rent','other'), source_kind ('payslip','holding_event','manual','ais').
Check constraints: `gross_paise >= 0`, `tds_paise >= 0`, `tds_paise <= gross_paise`.
Partial unique index: `(user_id, source_kind, source_id) WHERE source_id IS NOT NULL`.
No generated columns. No `fy` in CreateIncomeEventBody — always server-computed.

### FY derivation
Always: `fy = fyOf(accrualDate)`. For payslip: `accrualDate = lastDayOfMonth(payslip.payMonth)` where payMonth is "YYYY-MM" — e.g. "2025-06" → "2025-06-30".

### ON CONFLICT for derives
Use Drizzle's `.onConflictDoNothing()` WITHOUT a target. Then check if RETURNING is empty and if so, fetch the existing row by (user_id, source_kind, source_id). This is the established pattern for partial unique indexes.

### Derive from holding event
Load holding event by ID. Verify ownership via `holdingEvents.holdingId → holdings.userId = userId`. If event.type !== 'dividend', return 400 with message "Only dividend events can be derived as income".

### Summary
Aggregate only status='accepted' rows. Pending rows go to pendingCount only. Rejected rows excluded entirely. Group by income_kind.

### PAN/TAN
```typescript
const panSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{5}[0-9]{4}[A-Z]$/, "Invalid PAN format").nullable().optional();
const tanSchema = z.string().trim().toUpperCase().regex(/^[A-Z]{4}[0-9]{5}[A-Z]$/, "Invalid TAN format").nullable().optional();
```
Never include in error messages, logs, or AI event payloads.

### Accept with corrections
Accept route body: optional corrections to payer_name, payer_pan, payer_tan, notes.
Store pre-accept state in original_values JSONB.
Acceptance: `UPDATE income_events SET status='accepted', accepted_at=NOW(), original_values=<pre-state>, ... WHERE id=? AND user_id=? AND status='pending' RETURNING *`.

## Must Not Change
- Any existing tax module tables (payslips, payslip_components, deposit_details, tax_rules)
- Cross-module schema imports (no importing from investments/schema.ts into tax/schema.ts)
- The payslip services or routes

## Acceptance Criteria
- AC1: income_events table with pgEnum columns, check constraints (including tds<=gross), partial UNIQUE index, no generated column
- AC2: pending→accepted|rejected guarded atomic UPDATE WHERE status='pending'; corrections in original_values
- AC3: Summary accepts only accepted rows; isEstimate:true; byKind for all 5 kinds
- AC4: deriveFromPayslip: idempotent (onConflictDoNothing), requires accepted payslip, accrualDate=lastDayOfMonth(payMonth), rejects null grossPaise
- AC5: deriveFromHoldingEvent: rejects non-dividend events with 400, verifies ownership via holdings.userId
- AC6: FY always server-computed from accrualDate; CreateIncomeEventBody has no fy field
- AC7: PAN/TAN: separate fields, regex validated, normalized to uppercase, never logged
- AC8: Tables in backup arrays (ALL_TABLES + USER_TABLES); decomposition count updated (76→77)
- AC9: typecheck + lint + test green

## Commands
1. Read apps/api/src/modules/tax/schema.ts, plugin.ts, packages/shared/src/schemas/tax.ts before editing
2. Read apps/api/src/modules/investments/schema.ts for holdingEvents table structure
3. Read apps/api/src/lib/financial-year.ts for fyOf() and fyRange() signatures
4. Read apps/api/src/modules/tax/services/payslip-review.ts for state-machine pattern reference
5. Read apps/api/src/modules/ingest/services/review-actions.ts for accept/reject pattern reference
6. Implement all changes
7. `npm run db:generate` to generate migration
8. `npm run typecheck` (fix all errors)
9. `npm run lint` (fix all errors)
10. `npm run test -w apps/api` (fix failures)
11. `node --test apps/api/src/modules/tax/services/income-events.test.ts`
12. `cat apps/api/src/route-surface.snapshot.txt` and update if needed

## Required Evidence
- Report path: `tasks/090-taxable-income-ledger/implementation-1.md`
- Files changed (list)
- Complete diff of all changes
- `npm run typecheck` exit code and output
- `npm run lint` exit code and output  
- `npm run test -w apps/api` exit code and test counts
- Migration file name generated
- Route snapshot diff (if changed)
- Any plan deviations or blockers
