# Task: 13.10 — Advance Tax & 234B/234C Interest

## Status
PLAN_REVIEW

## Codex Review-1 Findings (addressed)

**H1 (no payment input)**: No persisted payment history exists and payment tracking stays a non-goal. Decision: **scenario-based estimates only.** The calculator takes `payments: Array<{date, amountPaise}>` as an explicit input on the estimate endpoint; the sourced GET assumes zero payments and returns instalment schedule + "if you pay nothing more" interest exposure, clearly labelled `scenario: 'no_payments'`. Real interest requires user-supplied payments.

**H2 (capital-gains timing)**: Timing uses actual realization dates, not quarter buckets. Requires dated gain allocation through set-off — but 13.11 returns annual net totals. Decision: consume 13.11's annual net figure for liability, and apply the §234C relief using per-quarter realized-gain attribution computed from capital-gains slices' sellDate (investments module exposes slices; tax service groups by due-date cutoff). A gain arising after a due date is excluded from that instalment's obligation; remaining instalments must cover it (or Mar 31 if none). Tests: gain Dec 20 (after Dec 15 cut), gain immediately before/after each due date.

**H3 (234C thresholds)**: Statutory de-minimis: no interest for Q1 if ≥12% paid by Jun 15, none for Q2 if ≥36% paid by Sep 15; Q3/Q4 use 75%/100%. Interest 1%/month × months (3/3/3/1) on shortfall below these cumulative floors.

**H4 (alert threshold paise)**: ₹10,000 = 1_000_000 paise; condition `>=` (liability ≥ threshold). Threshold added to tax-rules.ts as effective-dated `advanceTaxLiabilityThresholdPaise` (not hardcoded in job).

**M1 (senior citizen detection)**: Compass has no residency field and no business income_kind. Decision: return `seniorExemptionEligibility: 'exempt' | 'not_exempt' | 'unknown'`:
- age ≥60 anytime during FY (from DOB vs FY window)
- 'unknown' when age ≥60 AND user hasn't attested `hasBusinessIncome` (query param / profile flag); never silently exempt
- Residency assumed resident (labelled assumption)

**M2 (234B base)**: Trigger: advance tax + TDS < 90% of assessed tax. Interest: 1%/month from Apr 1 (of assessment year... implemented as FY-end +1 month start) on the FULL shortfall vs assessed tax (not just up to 90%), reduced by self-assessment payments from their payment dates. Zero-payment scenario: shortfall = assessed tax − TDS.

**M3 (TDS scope)**: Use ALL accepted TDS (`totalTdsPaise` across kinds) as credit; disclose non-salary TDS/TCS coverage in assumptions.

**M4 (alerts need notification pipeline)**: Alert integration needs a daily scheduled evaluator + createNotification call + boot catch-up + claim-then-notify so a notification failure doesn't leave a dedup tombstone. Decision: defer the scheduler to 13.9 (deadline nudges owns the cron infra). 13.10 ships the GET endpoints + pure calculator + a `computeDueAlerts()` function returning which instalments are alert-worthy; 13.9 wires alert_ledger + notifications.

**M5 (double-counting with 13.8)**: Pure calculator receives a liability snapshot (`estimatedAnnualTaxPaise` input). Orchestration layer computes liability via 13.8 WITHOUT gains included, then adds dated gains separately for timing. Never both.

**L1**: threshold into tax-rules.ts data.
**L2 (rounding)**: Round interest BASE to nearest ₹100 (round down? statute: nearest ₹100 rounding of assessed tax), interest to nearest ₹10 — implement statutory rounding, boundary tests at exact multiples.
**L3 (FY 2026-27)**: Notes say "IT Act 2025 §§424/425 govern this FY" where fy >= '2026-27'.

**M-jobs**: Registering a new date-sensitive scheduler requires jobs framework classification — another reason alerts move to 13.9.

## Objective
Compute advance tax instalment schedule, 234B and 234C interest exposure, and integrate with alert_ledger for due-date reminders — correctly handling the capital-gains timing exception and senior citizen exemption.

## Root Cause
Users with capital gains owe advance tax but nothing computes it. Section 234C interest for instalment deferment is the surprise that follows. Existing capital-gains.ts computes FY gains; no liability or schedule uses them.

## Scope

### Pure computation service
`apps/api/src/modules/tax/services/advance-tax.ts`

**Instalment schedule** (cumulative):
- 15 Jun: 15% of estimated annual liability
- 15 Sep: 45% of estimated annual liability
- 15 Dec: 75% of estimated annual liability
- 15 Mar: 100% of estimated annual liability

**Input sources**:
- Annual estimated tax liability: from regime-comparison.ts (uses the user's preferred regime)
- Capital gains by quarter: from getCapitalGains() or capital-loss.ts (getNetGainsAfterSetOff)
- TDS already deducted: from income_events (sum of tdsPaise for accepted salary events)

**Capital-gains timing exception (Section 234C)**:
- A capital gain that first arises in a quarter is NOT penalised retrospectively for earlier instalments
- Implementation: compute cumulative gain as of each due date; instalment obligation adjusts accordingly
- E.g., if ₹10L LTCG arose in Q3 (Oct-Dec), no 234C interest on Q1/Q2 instalments for that amount

**Senior citizen exemption**: 
- Check user_profiles.date_of_birth
- If age >= 60 AND no business/profession income → exempt from advance tax entirely
- Note: determining "no business income" requires income_kind check from income_events

**234C interest** (Section 234C):
- Rate: 1% per month (simple interest) for deferment
- Per instalment: if actual payment < required cumulative, charge 1% × shortfall × months
- Months for each instalment: Q1=3, Q2=3, Q3=3, Q4=1

**234B interest** (Section 234B):
- If total advance tax paid < 90% of assessed tax by 31 March
- Rate: 1% per month from 1 April to date of payment

### Response
```typescript
interface AdvanceTaxSchedule {
  fy: string;
  estimatedAnnualTaxPaise: number;
  tdsAlreadyDeductedPaise: number;
  netAdvanceTaxLiabilityPaise: number;
  isSeniorCitizenExempt: boolean;
  instalments: Array<{
    quarter: 'Q1' | 'Q2' | 'Q3' | 'Q4';
    dueDate: string;                    // "2024-06-15"
    cumulativePctRequired: number;      // 15, 45, 75, 100
    cumulativeAmountDuePaise: number;
    capitalGainAdjustmentApplied: boolean;
    status: 'due' | 'upcoming' | 'past';
  }>;
  interest234C: {
    q1: number; q2: number; q3: number; q4: number; total: number;
  };
  interest234B: {
    applicableAfterYearEnd: boolean;
    estimatedPaise: number;
  };
  capitalGainsTimingExceptionApplied: boolean;
  isEstimate: true;
  notes: string[];
}
```

### Routes (relative paths in tax plugin)
- `GET /advance-tax?fy=` — current schedule
- `GET /advance-tax/234c-estimate?fy=` — 234C interest breakdown

### Alert computation (deferred wiring to 13.9)
`computeDueAlerts(schedule, today)` pure function returns alert-worthy instalments (due within lead window, liability >= threshold from tax-rules.ts, senior exemption not applied). 13.9 consumes this to write alert_ledger + notifications via its scheduler infra.

## Dependencies
- 13.1 (FY, instalment dates + liability threshold in tax-rules.ts) — complete
- 13.4 (income events — all accepted TDS + income kinds) — task 090 — complete
- 13.8 (regime comparison — liability snapshot input) — task 094 — MUST be complete
- 13.11 (loss set-off — net gains) — task 097 — MUST be complete
- 13.9 owns alert_ledger wiring + scheduler

## Plan
- P1: Add `advanceTaxLiabilityThresholdPaise` to tax-rules.ts data (effective-dated per FY) + tests
- P2: Create advance-tax.ts: pure calculator (instalments, 234C with 12%/36%/75%/100% floors + dated-gain relief, 234B on full shortfall, statutory rounding ₹100 base/₹10 interest, senior-citizen eligibility states, computeDueAlerts)
- P3: Orchestration: liability snapshot from 13.8 (gains excluded), dated gain attribution from capital-gains slices, TDS from income-events summary
- P4: Routes: GET /advance-tax?fy= (no-payments scenario), POST /advance-tax/estimate (with payments array)
- P5: Wire plugin; route snapshots
- P6: Tests: 12%/36% de-minimis boundaries (pay 11.9% vs 12% by Jun 15), gain Dec 20 vs Dec 15 cut, gain before/after each due date, 234B full-shortfall base with mid-year payment reduction, senior 'unknown' vs 'exempt', rounding boundaries, FY 2026-27 note

## Acceptance Criteria
- AC1: Instalment schedule: 15%, 45%, 75%, 100% cumulative at correct dates
- AC2: Capital-gains timing exception: gains arising in Q3 not penalised in Q1/Q2 — unit tested with worked example
- AC3: Senior citizen (≥60) without business income: exempt from advance tax
- AC4: 234B: 1%/month on shortfall from 90% threshold
- AC5: 234C: 1%/month per quarter, per instalment
- AC6: TDS already deducted from income_events reduces liability
- AC7: alert_ledger entries for each due date; deduped by (userId, kind, refKey)
- AC8: isEstimate:true; typecheck + lint + test green

## Non-Goals
- Actual tax payment tracking (user-entered; deferred)
- Self-assessment tax computation
- Filing assistance
