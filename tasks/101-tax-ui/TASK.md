# Task: 13.14 — Tax Surface UI

## Status
PLANNING

## Objective
New "Tax" nav entry under Plan; TaxPage.tsx showing 4 deduction buckets, regime comparison with crossover, advance tax schedule, and AIS reconciliation discrepancy list. All estimates labelled. New-regime users told deductions don't apply to them.

## Root Cause
13 backend tasks and no user-facing surface. Users need a unified tax view.

## Scope

### New files
- `apps/web/src/routes/tax/TaxPage.tsx`
- `apps/web/src/lib/tax-queries.ts` — React Query hooks for all tax endpoints

### Modified files (nav — 3 required edits per UI.md rules)
- `apps/web/src/layouts/AppLayout.tsx` — add "Tax" link
- `apps/web/src/routes/index.tsx` (or router config) — add TaxPage route
- Plus one more nav file (check actual nav implementation)

### TaxPage sections

**Section 1: Deduction Basket** (from GET /api/tax/deductions)
- Four separate Meter components (never pooled): 80C, 80CCD(1B), 80CCD(2), 80D
- Each shows: filled amount, cap, headroom
- NEW-REGIME GATE: if regime=new OR regime=unknown with new as default → show banner "You are on the new regime. 80C/80D deductions don't apply to you." — suppress headroom meters
- Source breakdown per bucket (collapsible)

**Section 2: Regime Comparison** (from GET /api/tax/regime-comparison)
- Two columns: Old vs New regime
- Crossover point: "You need ₹{X} in deductions for old regime to be better"
- Current actual deductions vs crossover
- Recommendation badge

**Section 3: Advance Tax** (from GET /api/tax/advance-tax)
- Table of 4 instalments with due dates, amounts, status (due/upcoming/past)
- 234C exposure if estimate available
- Show nothing if senior citizen exempt

**Section 4: AIS Reconciliation** (from GET /api/tax/ais/reconciliation)
- Unmatched AIS lines as reviewable list (using existing review-list pattern)
- Unmatched income events (from our ledger not in AIS)
- Upload AIS button

### Query hooks (tax-queries.ts)
```typescript
export function useDeductionBasket(fy: string) { ... }
export function useRegimeComparison(fy: string) { ... }
export function useAdvanceTax(fy: string) { ... }
export function useAisReconciliation(fy: string) { ... }
```

## Dependencies
- 13.7 (deduction basket API) — task 093
- 13.8 (regime comparison API) — task 094
- 13.9 (deadline nudges) — task 095
- 13.10 (advance tax API) — task 096
- 13.13 (AIS reconciliation API) — task 099

## Plan
- P1: Read UI.md for nav rules and component conventions
- P2: Create tax-queries.ts with query hooks
- P3: Create TaxPage.tsx (all 4 sections; regime-gate on 80C meters)
- P4: Add nav entries (3 coordinated edits)
- P5: typecheck + lint + `npm run build -w apps/web`

## Acceptance Criteria
- AC1: 4 deduction buckets with distinct caps; never visually pooled
- AC2: New-regime users see explicit "deductions don't apply" banner; headroom meters hidden
- AC3: Regime comparison side-by-side with crossover point
- AC4: Advance tax table with due dates and 234C exposure
- AC5: AIS discrepancies as reviewable list (not auto-applied)
- AC6: All figures labelled as estimates with FY basis
- AC7: Nav entry via 3 coordinated edits (per UI.md rules)
- AC8: typecheck + lint + `npm run build -w apps/web` green
