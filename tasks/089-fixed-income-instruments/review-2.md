# Implementation Review — Task 089

Overall verdict: **BLOCKING**

The implementation is structurally well integrated, and the repaired working tree passes typecheck and the 15 targeted tests. However, the RD calculation violates the approved accrual specification, NSC terms are incompletely enforced, and several related financial edge cases remain incorrect or untested.

## High

### H1 — RD installments are credited at the start of the quarter

**BLOCKING — confirms C1.**

The approved rule explicitly says each RD deposit contributes from its own date ([TASK.md:75](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:75)). Instead, the implementation documents and implements a front-loaded approximation:

- The header says all quarterly installments arrive at period start ([deposit-accrual.ts:10](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:10)).
- It aggregates every installment in the period ([deposit-accrual.ts:209](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:209)).
- That entire aggregate is added to the opening balance before calculating a full period’s interest ([deposit-accrual.ts:212](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:212), [deposit-accrual.ts:215](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:215)).

For three ₹10,000 installments dated January 1, February 1, and March 1 at 7%, the implementation awards the full quarterly rate to ₹30,000, producing 52,500 paise. Accruing each installment only from its date to April 1 gives approximately 34,904 paise under Actual/365 Fixed. The first quarter alone is overstated by 17,596 paise, about 50%.

The test does not independently validate the specification; it codifies the same shortcut by placing ₹30,000 at the quarter start ([deposit-accrual.test.ts:127](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:127), [deposit-accrual.test.ts:132](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:132)).

Correct model: generate installment dates from the RD start date, let the opening balance earn the nominal full-period rate, and accrue each new installment only from its actual deposit date to the compounding boundary. Under the task’s rounding rule, aggregate the period’s interest contributions and half-up round the period total.

## Medium

### M1 — NSC is not enforced as a five-year instrument

**BLOCKING — confirms C2.**

AC7 requires NSC to be five-year, annually compounded, and reinvested ([TASK.md:114](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:114)).

The service enforces annual compounding and reinvestment ([deposit-details.ts:86](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:86)), but performs no NSC maturity-span validation. The only term-length check is inside the `tax_saver_fd` branch ([deposit-details.ts:95](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:95)).

Consequently, one-year or ten-year NSCs are accepted and scheduled. The NSC test only supplies a valid five-year example; it never verifies rejection of a non-five-year term ([deposit-accrual.test.ts:190](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:190)).

Validate `maturityDate` as exactly five calendar years after `startDate` for both NSC and tax-saver FD.

### M2 — RD accrual terminates when installments are exhausted, not at maturity

**BLOCKING — confirms C3.**

The loop condition requires both an unmatured deposit and unused installments ([deposit-accrual.ts:203](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:203)). Once `installmentsUsed === totalInstallments`, the balance stops earning interest even if `maturityDate` is later.

For example, three installments with an April 1 compounding boundary produce the exact same schedule and maturity value whether maturity is April 1 or May 1. The April–May stub earns nothing.

This is materially wrong whenever the entered maturity extends beyond the compounding period in which the final installment is consumed. The loop should continue until `maturityDate`, with `depositPaise: 0` after the final installment, and accrue the remaining balance through any final stub.

No test covers a post-final-installment stub.

### M3 — Iterative end-of-month clamping creates spurious stub periods

**BLOCKING.**

`addMonths` correctly clamps a single January 31 addition to February 28/29 ([deposit-accrual.ts:79](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:79)). However, each next boundary is calculated from the previously clamped date ([deposit-accrual.ts:131](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:131), [deposit-accrual.ts:165](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:165)).

Thus a January 31 monthly FD drifts:

`Jan 31 → Feb 28 → Mar 28 → Apr 28 → Apr 30 stub`

A January 31–April 30 three-calendar-month term therefore receives three nominal monthly periods plus an extra two-day stub. The test explicitly records this drift but only asserts the first boundary and that there are at least three periods ([deposit-accrual.test.ts:351](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:351), [deposit-accrual.test.ts:364](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:364)).

Period boundaries should retain the original day-of-month or end-of-month anchor, for example by deriving boundary `n` from `startDate + n × monthsPerPeriod`.

### M4 — RD quarterly compounding is not enforced

**BLOCKING.**

The approved accrual rules define RD as monthly deposits with quarterly compounding ([TASK.md:75](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:75)). The service’s RD validation checks only installment amount and count ([deposit-details.ts:74](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:74)).

Although the accrual comments say RD uses quarterly compounding, the implementation deliberately honors any stored frequency ([deposit-accrual.ts:186](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:186)). Monthly, half-yearly, or annual RD inputs are therefore accepted and calculated.

The service should reject an RD unless `compoundingFrequency === "quarterly"`, with a negative service test.

### M5 — Required money-invariant and rejection coverage is missing

**BLOCKING.**

The task calls the accrual file a “property + example” test suite ([TASK.md:36](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:36)), and repository rules require money/balance/rounding invariants across generated inputs.

The only balance-coherence test uses one fixed payout FD ([deposit-accrual.test.ts:415](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:415)). There is no generated/property coverage for:

- `closing = opening + deposit + interest − payout`
- period-to-period opening/closing continuity
- totals reconciling to period sums
- half-up rounding boundaries
- non-negative/safe-integer results across representative terms

There are also no regression tests for:

- NSC with a non-five-year term
- RD installment-date accrual
- maturity after the final installment
- non-quarterly RD rejection
- exact tax-saver maturity boundaries

The targeted 15/15 pass therefore confirms current examples, not AC7/AC8 conformance.

## Low

### L1 — Tax-saver five-year validation allows up to a week of excess term

**NON-BLOCKING — confirms C4.**

The comment says the intended tolerance is 1825–1827 days, but the actual upper bound is 1832 days ([deposit-details.ts:102](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:102), [deposit-details.ts:103](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:103)). This accepts terms several days longer than five calendar years.

Prefer exact calendar comparison—`maturityDate === startDate + 5 years`—which naturally handles leap years and avoids arbitrary day-count tolerance.

## Confirmed Correct / No Additional Finding

- FD/NSC lump-sum schedules use nominal periodic rates for complete periods and Actual/365 Fixed for final stubs ([deposit-accrual.ts:100](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:100)).
- `Math.round` provides half-up behavior because accepted balances and rates are non-negative.
- Payout mode pays each calculated period’s interest and leaves principal flat ([deposit-accrual.ts:149](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:149)).
- `daysDiff` uses UTC-midnight dates and returns correct calendar-day differences ([deposit-accrual.ts:89](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:89)).
- Arithmetic remains safe at realistic tested magnitudes; Zod’s `.int()` also rejects values beyond JavaScript’s safe-integer range. The current test covers roughly ₹9 crore ([deposit-accrual.test.ts:311](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:311)).
- Ownership matches `holding-details`: lookup by holding ID plus user ID, 404 for wrong owner, then asset-class validation ([deposit-details.ts:49](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:49)).
- Gating all deposit kinds behind `assetClass === "fd"` is intentional because the holding enum has no RD or NSC members ([spines.ts:26](/work/personal/compass/apps/api/src/db/shared/spines.ts:26)).
- Upsert conflicts on the `holdingId` primary key and updates every mutable deposit term plus `updatedAt`; ownership columns are appropriately not reassigned ([deposit-details.ts:136](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:136)).
- All five specified table checks are present in both Drizzle schema and migration ([schema.ts:240](/work/personal/compass/apps/api/src/modules/investments/schema.ts:240), [0012_simple_nightshade.sql:24](/work/personal/compass/apps/api/drizzle/0012_simple_nightshade.sql:24)).
- Migration columns, enums, foreign keys, defaults, and constraints match the Drizzle definition.
- `deposit_details` is placed after its holding parent and is included in both `ALL_TABLES` and `USER_TABLES`, not `LINKED_TABLES` ([backup.ts:43](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:43), [backup.ts:68](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:68)).
- Shared schemas match table nullability and route response shapes; routes use shared request/response schemas.
- Route registration and snapshots cover all three required endpoints.
- Demo PUT safety is inherited correctly from the global mutation chokepoint ([auth.ts:64](/work/personal/compass/apps/api/src/plugins/auth.ts:64)).
- Imports follow explicit TypeScript ESM conventions, calculations remain in a pure DB-free module, and no prohibited cross-module schema dependency was introduced.
- `fix-1.md` accurately describes the `displayName` repair. On the current tree, `npm run typecheck` exits successfully and the targeted deposit tests pass 15/15. Full DB-backed verification remains unavailable in the stated environment, so AC11/T3 cannot be independently declared fully green here.