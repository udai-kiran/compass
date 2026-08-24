# Task: 13.8 — Old vs New Regime Comparison

## Status
PLAN_REVIEW

## Codex Review-1 Findings (addressed)

**H1 (capital gains rates)**: FY 2024-25 has a mid-year change (transfers on/after 23 Jul 2024: STCG 20%, LTCG 12.5%, §112A exemption ₹1.25L; before: 15%/10%/₹1L). `CapitalGainsStatement` drops `gainsTaxClass` and `sellDate` — it CANNOT feed a correct CGT computation. Decision: **13.8 does NOT compute capital-gains tax itself.** It consumes a `capitalGainsTaxPaise` input supplied by the caller (or 0 with an explicit assumption note). Adding FY/effective-dated CGT rate data + bucket-level statement is deferred to a follow-up task. The comparison is explicitly labelled "ordinary-income comparison; capital gains tax not included" when the input is absent.

**H2 (80CCD(2) in new regime)**: 80CCD(2) is available under BOTH regimes. New-regime path deducts the regime-appropriate employer NPS amount (14% all employer types from FY 2024-25 per tax-rules.ts). Crossover variable = old-regime-EXCLUSIVE deductions only; 80CCD(2) sits in each regime's fixed baseline.

**H3 (crossover algorithm)**: Binary search for minimum D where `oldTax(D) <= newTax` (predicate `>=`, not exact equality). Edge states:
- `already_old_better` when predicate holds at D=0
- `unattainable` (null crossover) when predicate false at max attainable old-only deductions (sum of caps from getDeductionCap + eligible ordinary income)
- Surcharge recalculated at every probe (income can cross ₹50L/₹1Cr bands)
- Recommendation from computed totals, not from deduction comparison alone
- Special-rate 15% enhanced-surcharge cap NOT modelled (disclosed as assumption; no special-rate income in scope)

**H4 (87A + marginal relief)**:
- §112A LTCG tax is NOT eligible for 87A rebate — excluded from rebate base
- Rebate eligibility requires residency — add `residentAssumed: true` as a labelled assumption (Compass has no residency field)
- New-regime §87A marginal relief just above threshold must be implemented (rebate caps at (tax - incomeAboveThreshold) near boundary)
- Surcharge marginal relief already flagged by `marginalRelief: boolean` in tax-rules.ts — implement the standard computation
- Cess applied AFTER tax + surcharge + relief
- Separate tests: both relief types, boundary±1, special-rate income excluded from rebate base

**M1 (80CCD(1) base)**: Cap = 10% of Basic+DA (not gross salary). Source: accepted payslip components (canonical_kind='basic') summed for FY, divided by months present ×12 annualized; fallback: manual `salaryBasePaise` input on the estimate endpoint; if neither, 80CCD(1) cap = contribution amount with an explicit "cap not applied — no salary base" note. 80CCD(1) remainder shares the ₹1.5L 80CCE ceiling with 80C — apply aggregate cap in old-regime path.

**M2 (complete income)**: Consume the full accepted-income summary (salary, interest, dividend, rent, other) — every bucket classified as ordinary income. Pending counts disclosed in assumptions.

**M3 (HRA)**: Estimate endpoint accepts optional `hraExemptionPaise` manual input. Sourced GET reports "HRA not included" prominently in assumptions when absent (biases toward new regime — stated).

**M4 (dependencies)**: 13.11 (loss set-off) and 13.7 (basket) must be COMPLETE before 13.8 implementation. Gains input comes from 13.11's getNetGainsAfterSetOff.

**M5 (taxpayerType)**: Derive from user DOB (user_profiles.date_of_birth): ≥80 → super_senior, ≥60 → senior, else ordinary. Pass to getRegimeRules for old regime.

**L4 (naming)**: `cessPaise` + `cessRateBps`, `rebate87APaise`, `surchargePaise`, `nps80CCD1CapPaise`.

**L1 (architecture)**: `compareRegimes(inputs)` pure; `getRegimeComparison(db, userId, fy)` orchestration calls income-events summary + deductions + capital-loss services. One-way imports only.

## Objective
Compute estimated tax liability under both regimes from identical inputs, state the crossover deduction level, and feed regime-gating into 13.9 (deadline nudges) and 13.14 (UI). All computations use FY-versioned slab data from tax-rules.ts (already populated by 13.1).

## Root Cause
The decision between old and new regime is the most consequential tax choice a user makes. No computation exists. Tax-rules.ts already has FY-versioned slabs and rate tables for both regimes (from 13.1), but no service uses them.

## Scope

### Pure computation service (no new DB tables needed)
`apps/api/src/modules/tax/services/regime-comparison.ts`

**Inputs (from existing data)**:
- `grossSalaryPaise`: from income_events (sum of salary events for FY) — from 13.4
- `deductionBasket`: from 13.7 (80C/80CCD/80D basket)
- `capitalGainsAfterSetOff`: from 13.11 or directly from capital-gains.ts
- `interestIncomePaise`: from income_events (interest events)
- `rentalIncomePaise`: from income_events (rent events)
- `fy`: string

**Existing tax-rules.ts structure** (confirm by reading): check if it already has:
- Slab rates for old/new regime per FY
- Standard deduction (₹50,000 old; ₹75,000 new for FY 2024-25+)
- Rebate under 87A (₹12,500 old / ₹25,000 new for FY 2024-25)
- Surcharge rates and cess (4% health & education cess)

**Old regime path**:
- Gross salary - Standard deduction - 80C (capped at ₹1.5L) - 80CCD(1B) (capped at ₹50K) - 80D - 80CCD(2) - HRA exemption (manual input or skipped)
- Apply old-regime slabs to taxable income
- Add capital gains tax (STCG @ 15%, LTCG @ 10% above ₹1L exemption — equity; other rates for debt)

**New regime path**:
- Gross salary - Standard deduction (new regime value) only; no 80C/80D
- Apply new-regime slabs
- Add capital gains tax (same as old regime for FY 2024-25+; FY-aware)

**Crossover computation**:
- Binary search: find deduction level D where oldRegimeTax(income - D) = newRegimeTax(income)
- Return: crossoverDeductionPaise (what the user needs to claim for old to be equal)
- If user's actual deductions > crossover → old regime better
- If actual < crossover → new regime better

**NPS salary cap for 80CCD(1)**:
- In old regime: 80CCD(1) = min(npsContribution, 0.10 * grossSalary) [employees]
- This is the first task where salary is available for this cap

### Response
```typescript
interface RegimeComparisonResult {
  fy: string;
  oldRegime: {
    grossIncomeBeforeDeductionsPaise: number;
    deductionsClaimedPaise: number;
    taxableIncomePaise: number;
    taxBeforeCessPaise: number;
    cess4Pct: number;
    surcharge: number;
    totalTaxPaise: number;
    effectiveRateBps: number;
    marginalRateBps: number;
    rebate87A: number;
  };
  newRegime: { ... same fields ... };
  recommendedRegime: 'old' | 'new' | 'tie';
  oldRegimeSavingPaise: number;         // newTax - oldTax (positive = old better)
  crossoverDeductionPaise: number;      // what user needs for break-even
  actualDeductionsPaise: number;
  nps80CCD1CapApplied: number;          // the salary-based cap applied
  isEstimate: true;
  notes: string[];
  assumptions: string[];
}
```

### Routes (relative paths in tax plugin)
- `GET /regime-comparison?fy=` — full comparison (sources income from income_events, deductions from basket)
- `POST /regime-comparison/estimate` — ad-hoc estimate with manual income inputs

## Dependencies
- 13.1 (tax rules with FY slabs) — complete
- 13.4 (income events — source of all income kinds) — task 090
- 13.7 (deduction basket) — task 093 — MUST be complete
- 13.11 (loss set-off → net gains input) — task 097 — MUST be complete

## Plan
- P1: Create regime-comparison.ts: pure compareRegimes() (slab walk from tax-rules.ts getRegimeRules, standard deduction, old-only deductions with 80CCE aggregate cap, both-regime 80CCD(2), §87A rebate with new-regime marginal relief + §112A exclusion + resident assumption, surcharge with marginal relief, cess last)
- P2: Pure findCrossover() — monotonic binary search on old-only deductions D, predicate oldTax(D) <= newTax, full recompute per probe, already_old_better / unattainable states
- P3: Orchestration getRegimeComparison(db, userId, fy): income summary (all kinds), deduction basket, net gains after set-off, taxpayerType from DOB, Basic+DA from payslip components
- P4: Routes: GET /regime-comparison?fy=, POST /regime-comparison/estimate (manual inputs incl. optional hraExemptionPaise, salaryBasePaise, capitalGainsTaxPaise)
- P5: Wire plugin; route snapshots
- P6: Tests: FY 2024-25 worked case, ₹7L/₹12L new-regime 87A boundary±1 with marginal relief, §112A excluded from rebate base, surcharge band crossing during crossover search, super_senior slab selection, 80CCD(2) in both regimes, unattainable crossover, already_old_better, cess-after-relief ordering, HRA-missing assumption note

## Acceptance Criteria
- AC1: Both regimes computed from identical income inputs, shown side by side
- AC2: NPS 80CCD(1) salary cap (10% of salary) applied only in old regime path
- AC3: Crossover deduction stated correctly
- AC4: 87A rebate, surcharge, cess all FY-versioned from tax-rules.ts (never hardcoded inline)
- AC5: isEstimate:true; all assumptions listed
- AC6: Standard deduction per regime per FY from tax-rules.ts (₹50K old / ₹75K new for 2024-25+)
- AC7: typecheck + lint + test green

## Non-Goals
- HRA exemption auto-computation (requires rent receipts and salary breakdown)
- 80G (charitable donations)
- Section 24(b) interest auto-computation (expose from EMI splits, but computation is deferred)
- Capital gains tax on non-equity assets (complex; use placeholder rate)
