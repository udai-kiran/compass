# Iteration 5 Fix: RD Stub-Period Day-Count Consistency

## Summary
Fixed `computeRdSchedule` to mirror FD path's stub period handling:
- Compute `isFullPeriod` using FD logic: `!isLastPeriod || standardEnd === maturityDate`
- Apply Actual/365 Fixed day-count pro-rating to opening balance on stub periods
- Installment contributions unchanged (already Actual/365F)
- Added RD stub test with hand-computed expected values

## Files Changed
- `apps/api/src/modules/investments/services/deposit-accrual.ts` (function logic + comment)
- `apps/api/src/modules/investments/services/deposit-accrual.test.ts` (new stub test added)

## Complete Diff — deposit-accrual.ts

### Header Comment (lines 194-207)
OLD:
```
 * Per period:
 *   - Opening balance earns the nominal periodic rate.
```

NEW:
```
 * Per period:
 *   - Opening balance earns the nominal periodic rate for full periods.
 *     For stub periods (final period shorter than one standard compounding
 *     interval), opening balance is pro-rated using Actual/365 Fixed day-count.
```

### Core Logic (lines 228-242)
OLD:
```typescript
    const opening = runningBalance;

    // Opening balance earns the nominal periodic rate (even for stub final period).
    const openingInterestRaw = (opening * terms.annualRateBps) / (10_000 * periodsPerYear);
```

NEW:
```typescript
    // isFullPeriod: true for periods that span a full standard interval,
    // OR if the period boundary coincides with maturity. Stub periods are
    // when isLastPeriod is true but standardEnd !== maturityDate.
    const isFullPeriod = !isLastPeriod || standardEnd === terms.maturityDate;

    const opening = runningBalance;

    // Opening balance: nominal periodic rate for full periods, Actual/365 Fixed for stubs.
    const openingInterestRaw = isFullPeriod
      ? (opening * terms.annualRateBps) / (10_000 * periodsPerYear)
      : (opening * terms.annualRateBps * daysDiff(periodStart, periodEnd)) / (10_000 * 365);
```

## New Test — deposit-accrual.test.ts

Added test at line 512: `RD: stub final period uses pro-rated opening balance (Actual/365 Fixed)`

### Test Setup
- 3 installments × 1,000,000 paise at 700 bps, quarterly compounding
- Start: 2024-01-01
- Maturity: 2024-04-15 (NOT on quarter boundary → creates stub final period)

### Hand-Computed Expected Values

**Q1 [2024-01-01, 2024-04-01): Full Quarter**
- Deposit: 3 × 1,000,000 = 3,000,000 paise
- Per-installment accrual:
  - Jan 1→Apr 1: 91 days → (1M × 700 × 91) / (10K × 365) = 17,452.054...
  - Feb 1→Apr 1: 60 days → (1M × 700 × 60) / (10K × 365) = 11,506.849...
  - Mar 1→Apr 1: 31 days → (1M × 700 × 31) / (10K × 365) = 5,945.205...
  - Raw total: 34,904.108... → **Math.round = 34,904**
- Closing: 0 + 3,000,000 + 34,904 = **3,034,904**

**Stub [2024-04-01, 2024-04-15): 14-Day Stub**
- No new deposits: 0
- Opening balance: 3,034,904 paise
- Opening interest (pro-rated Actual/365F):
  - Days: 14
  - Formula: (3,034,904 × 700 × 14) / (10,000 × 365)
  - Numerator: 3,034,904 × 700 = 2,124,432,800
  - Numerator: 2,124,432,800 × 14 = 29,742,059,200
  - Division: 29,742,059,200 ÷ 3,650,000 = 8,148.509369...
  - **Math.round = 8,149**
- Closing: 3,034,904 + 0 + 8,149 = **3,043,053**

### Test Assertions
```typescript
assert.equal(schedule.periods[1]!.interestPaise, 8_149);
assert.equal(schedule.periods[1]!.closingPaise, 3_043_053);
assert.equal(schedule.totalInterestPaise, 34_904 + 8_149);
assert.equal(schedule.maturityValuePaise, 3_043_053);
```

## Gate Runs

### Gate 1: Test Execution
```bash
$ node --test apps/api/src/modules/investments/services/deposit-accrual.test.ts apps/api/src/modules/investments/services/deposit-details.test.ts
```

**Output (tail):**
```
✔ RD: stub final period uses pro-rated opening balance (Actual/365 Fixed) (0.103918ms)
✔ RD: maturity beyond final installment continues to accrue stub interest (0.263392ms)
✔ property: balance coherence and period continuity for representative terms (0.317986ms)
...
ℹ tests 29
ℹ suites 0
ℹ pass 29
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 438.352374
```

**Exit code: 0** ✓

### Gate 2: TypeCheck
```bash
$ npm run typecheck
```

**Output (all workspaces pass):**
```
> @compass/api@0.1.0 typecheck
> tsc --noEmit

> @compass/docs@0.1.0 typecheck
> tsc --noEmit

> @compass/extractor@0.1.0 typecheck
> tsc --noEmit

> @compass/ingestor@0.1.0 typecheck
> tsc --noEmit

> @compass/web@0.1.0 typecheck
> tsc --noEmit

> @compass/ai@0.1.0 typecheck
> tsc --noEmit

> @compass/shared@0.1.0 typecheck
> tsc --noEmit
```

**Exit code: 0** ✓

## Test Status Summary
- **Pre-existing tests:** 28 tests remain green (unchanged expectations)
- **New stub test:** 1 test added, now passing
- **Total:** 29 tests pass, 0 fail

## Implementation Notes
- FD and RD now consistently treat stub periods (isFullPeriod logic identical)
- RD opening balance correctly pro-rated on stubs vs. nominal rate on full periods
- RD installments continue using Actual/365F (no change)
- Comment documentation updated to clarify stub behavior
- All existing RD tests verified green (no regression)

