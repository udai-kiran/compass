# Task: 13.5 — EPF Passbook Reconciliation & Benefit Projection

## Status
PLANNING

## Objective
Employee/employer/EPS split per wage month, passbook reconciliation with gap detection, interest credit reconciliation, EPF and EPS benefit projection to retirement.

## Root Cause
EPF is a single combined positive transaction today. No employee/employer/EPS split, no per-month tracking, no gap detection, no passbook reconciliation, no benefit projection. The contribution-gap check is the highest-value part: an employer quietly missing deposits is money the household loses permanently.

## Scope

### New files
- `apps/api/src/modules/tax/services/epf-reconciliation.ts` — per-month contribution tracking, gap detection, benefit projection
- `apps/api/src/modules/tax/services/epf-reconciliation.test.ts` — unit tests
- `apps/api/src/modules/tax/routes/epf.ts` — contribution list, gap check, projection routes

### Modified files
- `apps/api/src/modules/tax/schema.ts` — add `epf_contributions` table (structured per-month breakdown)
- `apps/api/src/modules/tax/plugin.ts` — register EPF routes
- `apps/api/src/modules/system/services/backup.ts` — add table
- `packages/shared/src/schemas/tax.ts` — extend with EPF Zod schemas

### Table design: `epf_contributions`
```
epf_contributions (
  id UUID PK,
  user_id UUID NOT NULL FK → users(id) ON DELETE CASCADE,
  account_id UUID NOT NULL FK → accounts(id),  -- the retirement/EPF account
  wage_month TEXT NOT NULL,  -- "2025-06"
  employer_name TEXT,
  employee_paise BIGINT NOT NULL DEFAULT 0,
  employer_epf_paise BIGINT NOT NULL DEFAULT 0,  -- employer PF excluding EPS
  eps_paise BIGINT NOT NULL DEFAULT 0,
  vpf_paise BIGINT NOT NULL DEFAULT 0,
  is_vpf BOOLEAN NOT NULL DEFAULT false,
  source TEXT NOT NULL,  -- 'payslip' | 'passbook' | 'manual'
  source_payslip_id UUID,
  status TEXT NOT NULL DEFAULT 'unreconciled',  -- 'unreconciled' | 'reconciled' | 'gap' | 'mismatch'
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (user_id, account_id, wage_month, source)
)
```

## Dependencies
- 13.2 (payslip parse) — provides payslip-sourced contributions

## Plan
- P1: Add `epf_contributions` table to tax schema
- P2: Create EPF reconciliation service — per-month tracking, gap detection, passbook vs payslip matching
- P3: Create benefit projection — EPF corpus at retirement, EPS pension estimate using DoB from userProfiles
- P4: Create routes — list contributions, detect gaps, get projection
- P5: Wire and test

## Acceptance Criteria
- AC1: Employee/employer/EPS split per wage month, per employer
- AC2: Passbook or payslip reconciliation flags missing or mismatched months
- AC3: Interest credit reconciled annually against declared rate
- AC4: VPF contributions distinguished from statutory EPF
- AC5: EPF and EPS benefit projected to retirement using DoB and service history
- AC6: UAN continuity across employers; transfers not double-counted
- AC7: Employee contribution feeds 13.7 (80C); employer excluded
- AC8: typecheck + lint + test green

## Non-Goals
- UI for EPF (13.14)
- Actual EPFO integration (manual/payslip data only)
