# Task 089 Re-review

## Final verdict

**BLOCKING — not COMPLETE-ready.**

All prior product-logic defects except M5 are resolved, including the RD stub follow-up. However, the redesign introduced two medium-severity problems: accepted inputs can lose a paise through unsafe intermediate arithmetic, and unbounded `totalInstallments` can cause excessive allocation/work. Required property coverage remains incomplete and does not detect either issue.

## Prior-finding resolution

| Finding | Status | Evidence |
|---|---|---|
| H1 — RD per-installment date-based accrual | **RESOLVED** | Installment dates are anchored individually at `startDate + k months` ([deposit-accrual.ts:214](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:214)); only installments in `[periodStart, periodEnd)` are included and each earns Actual/365F interest from its own date ([deposit-accrual.ts:244](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:244)); raw contributions receive one final rounding ([deposit-accrual.ts:255](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:255)). The 3-installment regression expects 34,904 paise, not the old 52,500 ([deposit-accrual.test.ts:442](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:442)). |
| M2 — accrual past final installment | **RESOLVED** | The loop terminates only when `periodStart >= maturityDate`, independently of installment exhaustion ([deposit-accrual.ts:224](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:224)). The post-installment full-period regression verifies a zero-deposit period earning 53,111 paise ([deposit-accrual.test.ts:483](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:483)); the additional stub regression verifies post-installment accrual through April 15 ([deposit-accrual.test.ts:522](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:522)). |
| M3 — anchored boundaries without EOM drift | **RESOLVED in code** | FD/NSC boundaries are derived from the original start date and period index ([deposit-accrual.ts:142](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:142)); RD uses the same approach ([deposit-accrual.ts:224](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:224)). Maturity equality is explicitly treated as a full period ([deposit-accrual.ts:147](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:147)). The Jan-31 regression checks the anchored dates, although its `periods.length >= 3` assertion is too weak to reject the old four-period drift ([deposit-accrual.test.ts:365](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:365)). |
| M4 — RD quarterly enforcement | **RESOLVED** | Service validation rejects every non-quarterly RD ([deposit-details.ts:74](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:74)); tests cover monthly, half-yearly, and annual rejection plus quarterly acceptance ([deposit-details.test.ts:21](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.test.ts:21)). |
| M1 — NSC exact-calendar five-year term | **RESOLVED** | NSC requires annual compounding, reinvestment, and `maturityDate === addMonths(startDate, 60)` ([deposit-details.ts:90](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:90)). Negative and positive tests are present ([deposit-details.test.ts:61](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.test.ts:61)). |
| M5 — property/regression coverage | **PARTIALLY RESOLVED — still blocking** | The rejection regressions, balance identities, continuity, reconciliation, and rounding examples were added. However, the “property” test is only a fixed table of representative cases ([deposit-accrual.test.ts:559](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:559)), not generated or boundary-driven coverage. Its safe-integer checks use moderate amounts and only check period interest/closing ([deposit-accrual.test.ts:690](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:690)); they miss the demonstrated RD precision failure below. The EOM assertion also would not catch the old extra stub. |
| L1 — tax-saver exact calendar term | **RESOLVED** | Tax-saver FD now requires exact `addMonths(startDate, 60)` equality ([deposit-details.ts:104](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.ts:104)). Exact, one-day-short, and one-day-long cases are tested ([deposit-details.test.ts:114](/work/personal/compass/apps/api/src/modules/investments/services/deposit-details.test.ts:114)). |

## High severity

No unresolved high-severity findings. Prior H1 is resolved.

## Medium severity

### M-NEW1 — RD raw arithmetic can round to the wrong paise

The new RD path performs `number` multiplication before division and accumulates unrounded floating-point contributions ([deposit-accrual.ts:239](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:239), [deposit-accrual.ts:247](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:247)). Individual inputs are only constrained to safe integers; there is no bound or exact-integer calculation for intermediate products ([wealth.ts:877](/work/personal/compass/packages/shared/src/schemas/wealth.ts:877)).

A read-only reproduction using an accepted, safe-integer input:

- `installmentPaise = 955,173,831,910,025`
- `totalInstallments = 3`
- `annualRateBps = 1,184`
- `2024-01-01` to `2024-04-01`

The implementation returns interest of **56,391,369,504,282** paise. Exact rational arithmetic gives:

`205,828,498,690,627,467,200 / 3,650,000 = 56,391,369,504,281.497…`

The required half-up result is therefore **56,391,369,504,281**, one paise lower. The resulting closing balance remains a safe integer, so output-level safe-integer checks do not prevent the error.

Aggregate deposits and closings can also exceed the safe range because no checked addition is performed at [deposit-accrual.ts:259](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:259) or [deposit-accrual.ts:276](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:276).

**Blocking fix:** use exact rational/BigInt arithmetic through rounding, or impose and test input bounds that prove every intermediate and aggregate stays exact.

### M-NEW2 — unbounded installment precomputation enables excessive allocation/work

`totalInstallments` has no practical maximum in the request schema ([wealth.ts:882](/work/personal/compass/packages/shared/src/schemas/wealth.ts:882)). The redesign eagerly constructs one string for every declared installment before considering maturity ([deposit-accrual.ts:214](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:214)), then scans the entire array for every period ([deposit-accrual.ts:247](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:247)).

A DB-valid integer near 2.1 billion would therefore attempt billions of allocations on schedule retrieval, even for a short maturity term. This behavior was introduced by the redesign.

**Blocking fix:** cap `totalInstallments` to a defensible product maximum—600 is already used for similar schemas—or generate only installment indices intersecting each period without precomputing/scanning the full term.

### M5 — invariant coverage remains insufficient

The added fixed-case suite is useful, but it is not the generated/property coverage required by the task and repository rules. It also failed to exercise accepted high-value RD inputs, aggregate overflow, payout-mode RD, or very large installment counts. This is why both new defects remain green under the current 29 tests.

## Low severity

No new low-severity product finding. L1 is resolved.

The EOM regression should nevertheless assert exactly three periods, not `>= 3`, and the RD payout path deserves a direct regression even though its current balance behavior is coherent.

## RD stub follow-up

The follow-up is implemented correctly and is consistent with the FD path:

- RD computes the same maturity-equality/full-period distinction as FD ([deposit-accrual.ts:228](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:228)).
- Stub opening interest uses `opening × bps × days / (10,000 × 365)` ([deposit-accrual.ts:239](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:239)).
- The test encodes `3,034,904 × 700 × 14 / 3,650,000`, rounds 8,148.509… to **8,149**, and expects closing **3,043,053** ([deposit-accrual.test.ts:543](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:543)).

This follow-up is **verified resolved**.

## Regression scan

- **Half-open RD boundary:** Intended and implemented. `[periodStart, periodEnd)` is explicitly documented and enforced ([deposit-accrual.ts:202](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:202)). The 12-month test implicitly verifies April 1, July 1, and October 1 installments move to the next period through three deposits per quarter ([deposit-accrual.test.ts:135](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:135), [deposit-accrual.test.ts:175](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:175)).
- **FD/NSC maturity equality:** Correct. Exact anchored boundaries receive the nominal full-period rate; only an earlier maturity produces a stub.
- **RD `totalDepositPaise`:** Summing period deposits is equivalent to `includedInstallments × installmentPaise` because every included installment increments one period exactly once. It equals the declared `totalInstallments × installmentPaise` only when every declared installment falls before maturity. The standard 12-installment case verifies that equivalence ([deposit-accrual.test.ts:170](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.test.ts:170)).
- **Payout-mode RD:** The general payout calculation remains coherent: interest is paid out and excluded from closing balance ([deposit-accrual.ts:258](/work/personal/compass/apps/api/src/modules/investments/services/deposit-accrual.ts:258)). No dedicated RD payout test exists.
- **Zero inputs:** HTTP inputs reject zero principal/installments and zero installment counts ([wealth.ts:880](/work/personal/compass/packages/shared/src/schemas/wealth.ts:880)). The pure scheduler degrades to zero-valued periods rather than crashing, but it is not itself a validation boundary.
- **Safe integers:** Not sound at the accepted upper range; see M-NEW1.

## Scope-creep check

No fix-round scope creep was found. Iteration 4 records changes only to the two services and their tests ([implementation-2.md:30](/work/personal/compass/tasks/089-fixed-income-instruments/implementation-2.md:30)); Iteration 5 records only `deposit-accrual.ts` and its test ([fix-2.md:10](/work/personal/compass/tasks/089-fixed-income-instruments/fix-2.md:10)). The schema, migration, plugin, backup lists, routes, and snapshots were not changed by these fix rounds. Their current working-tree changes belong to the original implementation/co-resident tasks.

The targeted suite was independently rerun read-only: **29/29 passed**. Typecheck/lint are recorded green in verification-2; DB-backed service coverage remains unavailable because PostgreSQL/Redis are intentionally absent.

**Final verdict: BLOCKING.** Resolve M-NEW1, M-NEW2, and complete M5’s boundary/property coverage before marking task 089 COMPLETE.