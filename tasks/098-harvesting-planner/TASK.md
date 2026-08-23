# Task: 13.12 — LTCG & Tax-Loss Harvesting Planner

## Status
PLAN_REVIEW

## Pre-hardening (from sibling reviews; Codex review pending)
**Rate-bucket gap (from 094 review)**: `CapitalGainsSliceSchema` drops `gainsTaxClass` and slices lack per-slice term+class in the statement rollup. Harvest tax-effect estimates need at least equity-vs-other classification per lot. Decision: compute per-lot estimates from the holding's `gainsTaxClass` (present on holdings table) + holding period — do NOT wait for statement-schema changes. Label rates as advisory.

**LTCG exemption**: FY-versioned from rule data where available; ₹1.25L for transfers on/after 23 Jul 2024 in FY 2024-25, ₹1L before — implement effective-date split, not a flat constant. Source: hardcode with FY+date-band comment and a named constant + test, or add to tax-rules.ts if a CGT section exists by implementation time.

**Loss netting**: consume 13.11's getNetGainsAfterSetOff() for brought-forward context; harvest suggestions reduce CURRENT-year losses first (CYLA), never double-count BF losses already allocated.

**ELSS lock-in**: holdings.isElss (added by 13.7) + earliest buy event date + 3-year lock-in → exclude locked lots; expose lockInExpiresAt.

**Shared service**: apps/api/src/modules/investments/services/tax-position.ts is THE calculator; rebalancing (future) must import it, never fork it. Routes live in investments plugin (verify prefix conventions against plugin.test.ts route-group expectations — that test hardcodes expected groups and must be updated when adding routes).

**"No harvest worthwhile"**: explicit response shape `{ suggestions: [], reason: 'no_beneficial_harvest' }` when all candidates are net-negative after costs/exit loads — not an empty success with no explanation.

## Objective
Per-lot unrealised gain/loss analysis, LTCG exemption headroom, tax-loss harvesting suggestions ordered by net tax benefit, with explicit rebuy consequences — sharing a single tax-position service with rebalancing.

## Root Cause
FIFO open lots exist in tax-lots.ts. Current valuations from holdingValuations are tracked. No service computes per-lot unrealised gain/loss or identifies harvesting opportunities.

## Scope

### Pure computation service
`apps/api/src/modules/investments/services/tax-position.ts` — shared service consumed by both harvesting and rebalancing.

**Inputs**:
- Open lots from tax-lots.ts
- Current NAV/price from holdingValuations (existing)
- Realized gains from capital-gains.ts
- Brought-forward losses from capital-loss.ts (13.11)

**Per-lot computation**:
```typescript
interface LotTaxPosition {
  holdingId: string;
  lotIndex: number;
  buyDate: string;
  buyPricePerUnit: number;
  units: number;
  currentNav: number;
  currentValuePaise: number;
  costBasisPaise: number;
  unrealisedGainPaise: number;      // positive = gain, negative = loss
  holdingPeriodDays: number;
  isLongTerm: boolean;              // equity: >=365; debt: >=36 months
  dateOfLongTermCrossover: string | null;  // null if already long-term
  isElss: boolean;                  // from holding.isElss — locked for 3 years
  lockInExpiresAt: string | null;   // ELSS lock-in expiry
  estimatedTaxOnRealisationPaise: number;  // at applicable rate
}
```

**LTCG exemption headroom (equity)**:
- Annual LTCG exemption: ₹1L (100_000_00 paise) per FY
- Used from realized gains
- Headroom = max(0, 1_00_000_00 - realizedLtcgPaise)

**Harvesting suggestions**:
- Candidates: lots with unrealisedGainPaise < 0 (loss lots) where harvest could offset realized gains
- Priority: largest net tax saving first
- Skip locked lots (ELSS in lock-in period)
- Include: "Rebuying immediately resets the holding period. You will be out of the market for transaction time."
- Tax effect: loss harvest saves tax at applicable rate; transaction costs/exit loads reduce benefit

### Routes (in investments plugin, not tax)
- `GET /tax-position?fy=` — per-lot positions with unrealised P&L
- `GET /tax-position/harvest-suggestions?fy=` — ordered harvest opportunities
- `GET /tax-position/ltcg-headroom?fy=` — exemption headroom

## Dependencies
- 13.11 (loss carryforward — BF losses for netting) — task 097
- 13.3 (deposit_details for FD interest context) — complete
- Existing: tax-lots.ts, holdingValuations, capital-gains.ts

## Plan
- P1: Read tax-lots.ts, holdingValuations schema, capital-gains.ts interfaces
- P2: Create tax-position.ts shared service (lot positions + harvest suggestions + LTCG headroom)
- P3: Create routes (3 endpoints in investments plugin)
- P4: Wire investments plugin, update route snapshots
- P5: Tests: lot long-term crossover date, ELSS lock-in exclusion, harvest ordering, LTCG headroom consumption, "will harvest say no" case (no worthwhile candidates)

## Acceptance Criteria
- AC1: Per-lot unrealised gain/loss, holding period, long-term crossover date
- AC2: LTCG exemption headroom computed per FY (₹1L for equity)
- AC3: Harvest suggestions exclude ELSS in lock-in; ordered by net tax benefit
- AC4: Rebuy consequences explicitly stated
- AC5: Shares tax-position.ts with rebalancing (no duplicate calculator)
- AC6: "No harvest worthwhile" case handled explicitly
- AC7: typecheck + lint + test green
