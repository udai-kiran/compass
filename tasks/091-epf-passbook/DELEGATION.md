# Worker Delegation

## Task
091 — EPF Passbook Reconciliation (13.5)

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: complex dual-column expected/actual reconciliation schema, EPFO Member ID identity semantics with nullable UNIQUE constraints, VPF canonical kind addition to shared schema, payslip component mapping correctness, corpus projection math, and reconciliation status state machine — all require careful reasoning.

## Approved Plan
- P1: Add `vpf` to CanonicalComponentKindSchema in packages/shared/src/schemas/tax.ts
- P2: Add `epfContributions` table to apps/api/src/modules/tax/schema.ts
- P3: Add Zod schemas to packages/shared/src/schemas/tax.ts (EpfContribution, CreateEpfContribution, ConfirmActualBody, EpfGapResult, EpfProjection)
- P4: Create apps/api/src/modules/tax/services/epf-contributions.ts (createManual, importFromPayslip, confirmActual, listContributions, getGaps, getProjection)
- P5: Create apps/api/src/modules/tax/routes/epf-contributions.ts (6 routes)
- P6: Wire plugin, backup (ALL_TABLES + USER_TABLES after payslips), barrel, decomposition (77→78, since 090 adds income_events first)
- P7: Generate migration
- P8: Write tests
- P9: Regenerate route snapshots

## Files and Symbols
- NEW: `apps/api/src/modules/tax/services/epf-contributions.ts`
- NEW: `apps/api/src/modules/tax/services/epf-contributions.test.ts`
- NEW: `apps/api/src/modules/tax/routes/epf-contributions.ts`
- MODIFY: `apps/api/src/modules/tax/schema.ts` — add epfContributions table
- MODIFY: `apps/api/src/modules/tax/plugin.ts` — register epf-contributions routes
- MODIFY: `apps/api/src/db/schema.ts` — re-export epfContributions
- MODIFY: `packages/shared/src/schemas/tax.ts` — add vpf to CanonicalComponentKindSchema, add EPF schemas
- MODIFY: `apps/api/src/modules/system/services/backup.ts` — ALL_TABLES + USER_TABLES
- MODIFY: `apps/api/src/db/schema.decomposition.test.ts` — count 77→78 (090 adds income_events, making it 77 before this task)

## Required Changes

### CanonicalComponentKindSchema
Add 'vpf' to the enum in packages/shared/src/schemas/tax.ts.

### Table design (tax/schema.ts)
```sql
epf_contributions (
  id UUID PK,
  user_id UUID NOT NULL FK→users ON DELETE CASCADE,
  wage_month TEXT NOT NULL,                     -- "2025-06"
  employer_name TEXT,                            -- display only
  epfo_member_id TEXT NOT NULL,                 -- REQUIRED — establishment-specific member ID
  
  -- Expected (from payslip)
  expected_employee_paise BIGINT,
  expected_employer_paise BIGINT,               -- net credited to PF corpus (AFTER EPS diversion)
  expected_eps_paise BIGINT,                    -- diverted to EPS pension fund
  expected_vpf_paise BIGINT NOT NULL DEFAULT 0,
  payslip_id UUID REFERENCES payslips(id),      -- source payslip; NULL for manual

  -- Actual (from passbook confirmation)
  actual_employee_paise BIGINT,
  actual_employer_paise BIGINT,
  actual_eps_paise BIGINT,
  actual_vpf_paise BIGINT,

  reconciliation_status TEXT NOT NULL DEFAULT 'pending',
  -- 'pending' | 'matched' | 'gap' | 'mismatch' | 'confirmed'
  gap_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  
  UNIQUE (user_id, wage_month, epfo_member_id)
)
```
Also add partial index: `(payslip_id) WHERE payslip_id IS NOT NULL` for idempotent import.

### Import-from-payslip logic
Route: `POST /epf-contributions/import-from-payslip/:payslipId`
Body: `{ epfoMemberId: string }` — REQUIRED, 422 if missing.

1. Load payslip by ID, verify user ownership AND status='accepted'
2. Map canonical components:
   - canonical_kind='employee_epf' → expected_employee_paise (sum currentPaise)
   - canonical_kind='employer_epf' → expected_employer_paise
   - canonical_kind='eps' → expected_eps_paise
   - canonical_kind='vpf' → expected_vpf_paise
3. Employer invariant check: employer_epf + eps = gross employer share (log warning if zero, don't error — not all payslips have EPS)
4. Upsert: INSERT ON CONFLICT (user_id, wage_month, epfo_member_id) DO UPDATE SET expected_* = EXCLUDED.*
   — preserves existing actual_* values on re-import
5. Also check payslip_id conflict: if payslip already imported (look up by payslip_id), return existing row

### Reconciliation status logic (pure function: computeStatus)
```typescript
function computeStatus(row): ReconciliationStatus {
  if (row.actual_employee_paise === null) return 'pending'; // not confirmed yet
  // All actual set: check mismatch
  const tolerance = 0.01;
  const isMismatch = (expected, actual) => 
    expected !== null && expected > 0 && Math.abs(actual - expected) / expected > tolerance;
  if (isMismatch(row.expected_employee, row.actual_employee) ||
      isMismatch(row.expected_employer, row.actual_employer) ||
      isMismatch(row.expected_eps, row.actual_eps)) return 'mismatch';
  return 'matched';
}
```
Persist computed status after confirmActual.

### Gap detection (gaps endpoint)
Return rows where: expected_employee_paise IS NOT NULL AND actual_employee_paise IS NULL.
Filter by FY (wage_month within FY). Include as 'gap' in response, but don't persist status='gap' until user explicitly marks (or coordinator deems this ok — the gaps endpoint is purely read-only).

### Corpus projection
Route: `GET /epf-contributions/projection?accountId=`
- accountId: the user's EPF account in the ledger (accounts table, type='epf' or similar)
- Current corpus: query account balance
- Retirement date: from user_profiles.date_of_birth + 60 years (or explicit retirement_age param)
- Compound at 8.25% p.a. using standard compound formula. No future contributions assumed.
- Response: EpfCorpusProjection with isEstimate:true, rateSource:'last_known_official', assumedAnnualRateBps:825

### 80C eligibility note (in response)
- eligible_employee_paise = (actual_employee_paise ?? expected_employee_paise ?? 0) + (actual_vpf_paise ?? expected_vpf_paise ?? 0)
- employer_epf is NOT 80C eligible — note this in response

## Must Not Change
- Existing payslip services/routes
- The existing ledger EPF contribution flow (POST /api/epf-contributions — that's a separate module)
- Any investment schema tables

## Acceptance Criteria
- AC1: epfContributions table with dual expected/actual columns; UNIQUE on (user_id, wage_month, epfo_member_id)
- AC2: vpf added to CanonicalComponentKindSchema
- AC3: import-from-payslip requires epfoMemberId, is idempotent by payslip_id, preserves actual_* on re-import
- AC4: employer EPF/EPS invariant: employer_epf = credited to PF corpus; eps = diverted; never double-counted
- AC5: Gap detection: rows with expected set but actual null (endpoint, not persisted status)
- AC6: employee + vpf = 80C eligible (expected when not confirmed, actual when confirmed)
- AC7: Corpus projection: isEstimate:true, 8.25% rate, current balance from account
- AC8: backup: ALL_TABLES + USER_TABLES; decomposition 76→77
- AC9: typecheck + lint + test green

## Commands
1. Read apps/api/src/modules/tax/schema.ts before editing
2. Read packages/shared/src/schemas/tax.ts — CanonicalComponentKindSchema location
3. Read apps/api/src/modules/tax/services/payslip-review.ts for import patterns
4. Implement all changes
5. `npm run db:generate`
6. `npm run typecheck`
7. `npm run lint`
8. `npm run test -w apps/api`

## Required Evidence
- Report path: `tasks/091-epf-passbook/implementation-1.md`
- Files changed (list)
- Complete diff
- typecheck exit code + output
- lint exit code + output
- test exit code + pass/fail counts
- Migration file name
- Any blockers or deviations
