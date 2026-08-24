# Task: 13.7 — 80C/80D Deduction Basket

## Status
COMPLETE

## Objective
Aggregate all deduction sources into four legally-distinct buckets (80C, 80CCD(1B), 80CCD(2), 80D) with correct individual caps, headroom computation, and regime-gating.

## Root Cause
No tax-classification exists for ELSS vs. regular equity MFs. Insurance premiums, EPF, PPF are tracked but not aggregated into tax buckets. No code gates headroom on regime.

## Codex Review-1 Findings (addressed)

**H1 (NPS allocation)**: Policy (not legal rule): allocate up to ₹50K to 80CCD(1B) first; remaining to 80CCD(1) subject to salary cap. Document clearly as "tax-optimizing allocation policy". 80CCD(1) and 80CCD(1B) are mutually exclusive pools from one contribution.

**H2 (80CCD(2) cap)**: 80CCD(2) = employer contribution to NPS. Cap = 10% salary (private/unrecognized) or 14% salary (government). This is available under BOTH old AND new regimes. Get rate from tax-rules.ts per employer type and FY. Source: manual deduction entry (user provides from Form 16). Validate: claimedPaise <= (salary * applicableRate).

**H3 (insurance source)**: Use actual FY-filtered premium TRANSACTIONS (non-deleted, in FY date range, linked to policy), NOT annualized premium × frequency. Use annualized terms only as labelled estimate when no premium transactions exist.

**H4 (home loan 24(b))**: Section 24(b) cap depends on property type (₹2L self-occupied, unlimited let-out) and completion conditions. DO NOT label as "full deduction". Expose as `emiInterestEstimatePaise` from EMI splits — user manually claims as 24(b) in their ITR. Run EMI splitting from loan inception (not just FY transactions).

**H5 (dependencies)**: Tasks 13.5/13.6 must be COMPLETE before dispatching 13.7 worker.

**M1 (isTaxSaverFd)**: DO NOT add boolean — depositKind='tax_saver_fd' ALREADY EXISTS in deposit_details (investments module). Use `depositKind = 'tax_saver_fd'` to identify.

**M2 (isElss)**: Add `isElss: boolean DEFAULT false` to holdings table (spines.ts). Expose through HoldingSchema, CreateHoldingSchema, UpdateHoldingSchema, toHolding(). Validate: only allowed when assetClass='mutual_fund'.

**M5 (NSC)**: depositKind='nsc' already exists in deposit_details. Auto-derive NSC deduction from initial deposit amount in origin FY.

**M6 (EPF precedence)**: Use confirmed actual (if actual_employee_paise IS NOT NULL) → else expected (expected_employee_paise) → else payslip components (canonical_kind='employee_epf' sum). Never sum two sources.

**M8 (regime function)**: Use `getRegimePreference()` from regime-preference.ts (always returns 'old' | 'new', defaults to 'new').

**M9 (caps from tax-rules.ts)**: All caps from tax-rules.ts. Never hardcode limits in basket service.

**M3 (80D allocation)**: Use policy_covered_persons (via policyId) for family vs parent allocation. ₹50K parent limit when parent is senior (≥60 years from family_members.date_of_birth). ₹50K self limit if taxpayer or spouse is senior. Preventive check-up ₹5K is inside the group limit, not additional.

## Scope

### Schema changes
1. Add `isElss BOOLEAN NOT NULL DEFAULT false` to holdings (spines.ts + migration) + expose through toHolding()
2. NO isTaxSaverFd — use existing depositKind='tax_saver_fd'
3. New deductionEntries table (tax/schema.ts) for manual items

### New table: deduction_entries
```sql
deduction_entries (
  id UUID PK,
  user_id UUID FK→users ON DELETE CASCADE,
  fy TEXT NOT NULL,
  section TEXT NOT NULL CHECK IN ('80C', '80D', '80CCD1B', '80CCD2'),
  deduction_kind TEXT NOT NULL,  -- pgEnum: 'nsc_additional' | 'tuition_fees' | 'elss_manual' | 'nps_additional' | 'employer_nps_ccd2' | 'preventive_checkup' | 'other_80c' | 'other_80d'
  amount_paise BIGINT NOT NULL CHECK (amount_paise > 0),
  description TEXT,
  source_doc_key TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
)
```
Use pgEnum for deduction_kind; validate section+kind compatibility.

### Sources per bucket

**80C (cap from tax-rules.ts — ₹1.5L for all FYs currently)**:
- Employee EPF: epf_contributions (actual_employee_paise if confirmed, else expected_employee_paise)
- VPF: epf_contributions (actual_vpf_paise if confirmed, else expected_vpf_paise)
- PPF: scheme-compliance annualContributedPaise (ppf accounts)
- SSY: scheme-compliance annualContributedPaise (ssy accounts)
- ELSS: sum buyEvent.amountPaise for holdings.isElss=true in FY
- Life insurance: sum of FY premium transactions (via transactions.policyId) for insurancePolicies.kind='life'
- 5-year tax-saver FD: deposit_details where depositKind='tax_saver_fd', initial deposit paise in origin FY
- NSC: deposit_details where depositKind='nsc', initial deposit paise in origin FY
- Manual: deductionEntries where section='80C'

**80CCD(1B) policy**: min(npsEmployeeContributionPaise, 5_000_000) allocated to 80CCD(1B). Remainder up to salary cap → 80CCD(1). Both use the same NPS contribution pool.

**80CCD(2) (available both regimes)**:
- Source: deductionEntries where section='80CCD2' (user provides from Form 16)
- Cap: from tax-rules.ts employer NPS rate × salary (advisory validation only)

**80D**:
- Self/family policies: FY premium transactions for health policies where covered persons exclude parents only
- Parent policies: FY premium transactions where all covered persons are parents
- Use policy_covered_persons to determine allocation
- Self/family cap: ₹25K (₹50K if self or spouse ≥60)
- Parent cap: ₹25K (₹50K if any covered parent ≥60) — from tax-rules.ts
- Preventive checkup: deductionEntries where deduction_kind='preventive_checkup' (sub-limit ₹5K, inside 80D cap)

**EMI interest (24(b) estimate — NOT a deduction bucket)**:
- Expose from EMI splits (compute from loan inception, filter FY)
- Label clearly as `emiInterestEstimatePaise` — NOT a deduction claim
- User manually uses this in ITR

### Routes (relative paths in tax plugin)
- `GET /deductions?fy=` — full basket
- `POST /deductions/entries` — manual deduction entry
- `GET /deductions/entries?fy=` — list manual entries
- `PUT /deductions/entries/:id` — update
- `DELETE /deductions/entries/:id` — remove

## Dependencies
- 13.1 (FY helpers, tax-rules.ts caps) — complete
- 13.2 (payslip components) — complete
- 13.3 (deposit_details with depositKind) — complete
- 13.5 (EPF — epf_contributions table) — task 091 (must be complete)
- 13.6 (scheme compliance — PPF/SSY amounts) — task 092 (must be complete)

## Plan
- P1: Add `isElss` to holdings (spines.ts + migration); expose in toHolding(), HoldingSchema, CreateHoldingSchema
- P2: Create deductionEntries table in tax/schema.ts with pgEnum for deduction_kind
- P3: Add shared Zod schemas (DeductionBasket, DeductionEntry) to packages/shared/src/schemas/tax.ts
- P4: Create apps/api/src/modules/tax/services/deductions.ts (aggregation service)
- P5: Create routes (5 endpoints)
- P6: Wire plugin, backup, barrel, decomposition
- P7: Generate migration; update route snapshots
- P8: Tests: 80C cap boundary, NPS 80CCD(1B)/80CCD(1) split, senior citizen 80D rate, new-regime suppression, EPF precedence

## Acceptance Criteria
- AC1: isElss on holdings; deductionEntries table with pgEnum; no isTaxSaverFd (use depositKind)
- AC2: 80C, 80CCD(1B), 80CCD(2), 80D as separate buckets; caps from tax-rules.ts
- AC3: 80D senior citizen parent limit (₹50K) via policy_covered_persons + family_members DOB
- AC4: NPS allocation: up to ₹50K → 80CCD(1B); rest → 80CCD(1) (salary cap applied in 13.8)
- AC5: 80CCD(2) available both regimes; capped per tax-rules.ts employer rate
- AC6: Headroom suppressed for new-regime users via getRegimePreference()
- AC7: Insurance: actual FY premium transactions (not annualized)
- AC8: NSC, tax-saver FD auto-derived from depositKind
- AC9: typecheck + lint + test green

## Non-Goals
- 80CCC (pension plan premiums)
- SCSS, time deposits, stamp duty
- HRA exemption
- 24(b) as a deduction claim (expose estimate only)
