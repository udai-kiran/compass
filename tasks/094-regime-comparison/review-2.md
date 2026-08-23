## Verdict: Not implementation-ready

Review-1’s findings appear in the opening “addressed” section, but all five requested corrections are contradicted or left underspecified elsewhere in the operative Scope, response contract, or test plan. Dependencies 13.7 and 13.11 are also still `PLAN_REVIEW` and do not yet promise compatible, complete inputs.

## High

1. **H1 is not consistently reflected: the Scope still instructs 13.8 to compute capital-gains tax.**

   The recorded decision says 13.8 accepts caller-supplied `capitalGainsTaxPaise` and must not calculate CGT ([TASK.md:8](/work/personal/compass/tasks/094-regime-comparison/TASK.md:8)). But the operative Scope still says:

   - consume `capitalGainsAfterSetOff` “or directly from capital-gains.ts” ([TASK.md:55](/work/personal/compass/tasks/094-regime-comparison/TASK.md:55));
   - calculate STCG at 15% and LTCG at 10% above ₹1 lakh ([TASK.md:69](/work/personal/compass/tasks/094-regime-comparison/TASK.md:69));
   - add FY-aware capital-gains tax in the new regime ([TASK.md:74](/work/personal/compass/tasks/094-regime-comparison/TASK.md:74));
   - use a placeholder rate for non-equity gains ([TASK.md:145](/work/personal/compass/tasks/094-regime-comparison/TASK.md:145)).

   Those instructions would reintroduce the exact date/rate-class bug H1 intended to prevent. Delete or rewrite them. Define whether supplied CGT is included identically in both totals, and specify that the sourced GET currently uses zero plus the required limitation note because no persisted CGT estimate exists.

2. **H4’s tax model cannot be implemented from the proposed inputs.**

   The plan records residency, 87A marginal relief, §112A exclusion, surcharge marginal relief, and cess ordering ([TASK.md:19](/work/personal/compass/tasks/094-regime-comparison/TASK.md:19)), but the input and response contracts do not separate:

   - ordinary-rate tax;
   - special-rate tax eligible/ineligible for rebate;
   - total income used to determine rebate and surcharge;
   - tax subject to the enhanced-surcharge 15% cap.

   A single opaque `capitalGainsTaxPaise` cannot support these distinctions. Further, the exclusion is broader than §112A for FY 2025-26 onward: the official Finance Act 2025 memorandum says special-rate Chapter XII income, including sections 111A and 112, is outside the new-regime rebate calculation. [Income Tax Department memorandum](https://www.incometaxindia.gov.in/documents/20117/6476586/memo-2025.pdf/f92f27e1-aa07-d24c-8776-2884c9bbac1c?t=1762782732359)

   The plan also says the enhanced-surcharge cap is omitted because “no special-rate income” is in scope ([TASK.md:17](/work/personal/compass/tasks/094-regime-comparison/TASK.md:17)), while explicitly including capital gains and dividend income. The department states that enhanced surcharge is capped at 15% for sections 111A, 112, 112A and most dividend income. [Income Tax Department guidance](https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-3)

   Either formally make the comparison ordinary-income-only—excluding gains from computed tax while clearly defining how they affect total-income thresholds—or add a caller-supplied special-rate breakdown sufficient for rebate and surcharge calculations.

3. **H3 is contradicted by the operative crossover specification and response shape.**

   The corrected algorithm is properly stated in the review record and P2: binary search for the minimum `D` satisfying `oldTax(D) <= newTax`, recomputing surcharge at every probe, with `already_old_better` and `unattainable` states ([TASK.md:12](/work/personal/compass/tasks/094-regime-comparison/TASK.md:12), [TASK.md:126](/work/personal/compass/tasks/094-regime-comparison/TASK.md:126)). However:

   - Scope still asks for exact equality ([TASK.md:77](/work/personal/compass/tasks/094-regime-comparison/TASK.md:77));
   - it derives the recommendation from actual deduction versus crossover ([TASK.md:79](/work/personal/compass/tasks/094-regime-comparison/TASK.md:79)), contrary to the instruction to use computed totals;
   - `crossoverDeductionPaise` remains a mandatory number with no status field or nullable unattainable representation ([TASK.md:105](/work/personal/compass/tasks/094-regime-comparison/TASK.md:105));
   - the maximum search bound is ambiguously described as a sum of caps “and” eligible income rather than the lesser of legal old-only capacity and income that can actually be reduced.

   Define a discriminated result such as `{status, deductionPaise}` and specify the exact inclusive integer-paise search interval and tie behavior.

4. **M1 is contradicted and is not implementable against current payslip data.**

   The correction properly says the 80CCD(1) base is Basic plus eligible DA ([TASK.md:27](/work/personal/compass/tasks/094-regime-comparison/TASK.md:27)), but Scope reverts to 10% of gross salary ([TASK.md:83](/work/personal/compass/tasks/094-regime-comparison/TASK.md:83)) and AC2 again says merely “10% of salary” ([TASK.md:134](/work/personal/compass/tasks/094-regime-comparison/TASK.md:134)).

   Current canonical payslip kinds include `basic` but no DA kind ([tax.ts:76](/work/personal/compass/packages/shared/src/schemas/tax.ts:76)). The plan must define how DA forming part of retirement benefits is represented or explicitly state that only Basic is currently available and label the resulting estimate.

   Annualizing `sum / months present × 12` can also overstate the legal cap for partial-year employment. The cap base should normally use Basic plus qualifying DA actually earned during the FY, not an annualized hypothetical amount. The “no salary base → cap equals contribution” fallback silently disables a legal cap and should instead require manual input or return an explicit incomplete/unavailable result.

5. **The mandatory dependency contracts are neither complete nor compatible.**

   Both 13.7 and 13.11 are still `PLAN_REVIEW`, not `COMPLETE` ([13.7 TASK.md:3](/work/personal/compass/tasks/093-80c-basket/TASK.md:3), [13.11 TASK.md:3](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:3)). Upstream 13.4, 13.5 and 13.6 are also still `IMPLEMENTING`.

   Contract problems remain:

   - 13.7 mentions a shared `DeductionBasket` schema but provides no exact response fields ([13.7 TASK.md:111](/work/personal/compass/tasks/093-80c-basket/TASK.md:111)). Its objective describes four buckets excluding 80CCD(1), while later text promises an 80CCD(1) remainder. It does not define whether 13.8 receives raw NPS contributions, allocated 80CCD(1), claimed/capped amounts, Basic+DA, or employer type.
   - 13.11 promises `{netStcgPaise, netLtcgPaise, ...}` only ([13.11 TASK.md:107](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:107)). It does not return `capitalGainsTaxPaise`, tax class, or sale-date buckets, so it cannot provide H1’s required CGT input.
   - 13.8’s alternative direct import from `capital-gains.ts` undermines the stated requirement that 13.11 be complete first.

   Exact shared schemas and ownership of CGT calculation must be settled before implementation.

## Medium

1. **H2 is only partially reflected.**

   The opening correction and P1 correctly put 80CCD(2) in both fixed regime baselines ([TASK.md:10](/work/personal/compass/tasks/094-regime-comparison/TASK.md:10), [TASK.md:125](/work/personal/compass/tasks/094-regime-comparison/TASK.md:125)). The new-regime Scope nevertheless says “standard deduction only” ([TASK.md:72](/work/personal/compass/tasks/094-regime-comparison/TASK.md:72)). Rewrite both regime paths explicitly.

2. **`tax-rules.ts` has the four claimed categories, but not all semantics the plan assumes.**

   It does contain, for FY 2023-24 through 2026-27:

   - old/new slabs, including senior and super-senior old-regime variants;
   - per-regime standard deductions;
   - 87A thresholds and maximum amounts;
   - surcharge bands;
   - 4% cess;
   - a `marginalRelief` flag.

   See the rule interface ([tax-rules.ts:49](/work/personal/compass/apps/api/src/lib/tax-rules.ts:49)), FY 2024-25 new rules ([tax-rules.ts:276](/work/personal/compass/apps/api/src/lib/tax-rules.ts:276)), and lookup function ([tax-rules.ts:623](/work/personal/compass/apps/api/src/lib/tax-rules.ts:623)).

   It does **not** encode residency eligibility, special-rate rebate exclusions, distinct 87A-versus-surcharge marginal-relief algorithms, or the enhanced-surcharge cap. Thus the narrow Scope checklist is present, but “everything needed” is not.

3. **Income Scope is stale.**

   The listed inputs omit dividend and other income ([TASK.md:52](/work/personal/compass/tasks/094-regime-comparison/TASK.md:52)), while M2 and P3 require all five kinds. The actual summary provides salary, interest, dividend, rent and other, plus pending counts ([tax.ts:390](/work/personal/compass/packages/shared/src/schemas/tax.ts:390)). The plan should reference that exact `IncomeEventSummary` shape.

4. **Taxpayer age semantics and missing DOB behavior are unspecified.**

   “≥60/≥80” needs an as-of date, normally age attained during the relevant FY, plus tests around the 60th/80th birthday and FY boundary. Missing DOB also needs an explicit fallback/assumption instead of silently choosing ordinary.

5. **Integer-paise and rounding requirements are insufficiently specified.**

   The architecture requires integer paise throughout ([CLAUDE.md:57](/work/personal/compass/CLAUDE.md:57)), but the plan does not say how slab tax, bps multiplication, rebate, surcharge, marginal relief, cess, or effective-rate bps are rounded. Inputs should use safe-integer paise validation, not merely `number`/`.int()`, and calculations should guard overflow.

6. **P6 is not adequate for a financial computation.**

   Add tests for:

   - every supported FY, not one FY 2024-25 example;
   - old-regime 87A boundary and new-regime boundaries mapped to the correct FY;
   - all special-rate rebate exclusions applicable per FY;
   - every surcharge threshold, surcharge marginal relief, and capped-surcharge limitation;
   - standard deduction capped at salary income and zero-salary cases;
   - 80CCE aggregation, 80CCD(1B), and Basic+DA cap boundaries;
   - private/government 80CCD(2), including the FY 2023-24 versus FY 2024-25 change;
   - missing DOB, salary base, HRA and CGT;
   - all five income kinds and pending-count disclosure;
   - negative, fractional, unsafe and overflow inputs;
   - crossover minimality/monotonicity properties, exact one-paisa boundaries, tie, zero and maximum bound;
   - shared Zod request/response contracts;
   - real-DB orchestration tests proving `userId` isolation;
   - route validation and route-surface snapshots.

   The repository explicitly requires pure arithmetic tests, contract tests, DB scoping integration tests, and invariant/property coverage ([TDD.md:28](/work/personal/compass/tasks/TDD.md:28), [TDD.md:36](/work/personal/compass/tasks/TDD.md:36)).

7. **TDD checklist convention is not followed.**

   `tasks/TDD.md` requires each acceptance criterion to be an unchecked `- [ ]` item and to receive a failing test before implementation ([TDD.md:14](/work/personal/compass/tasks/TDD.md:14)). 13.8’s ACs are plain bullets, and broad ACs such as “all assumptions listed” and “crossover stated correctly” are not decomposed enough to establish one test per criterion.

8. **Security and API compatibility need explicit coverage.**

   P3 correctly passes `userId`, consistent with repository scoping rules, but P6 lacks cross-user isolation tests. POST estimate schemas should be strict, use non-negative safe paise values, bound strings/arrays, reject unknown fields, and avoid echoing sensitive input. The response must be defined in `packages/shared` before routes; its current nullable/state and naming ambiguities would otherwise create immediate API/UI compatibility churn.

## Low

1. **Review-1 naming is still not reflected.**

   The response uses `cess4Pct`, `surcharge`, `rebate87A`, and `nps80CCD1CapApplied` ([TASK.md:95](/work/personal/compass/tasks/094-regime-comparison/TASK.md:95)) instead of the recorded `cessPaise`, `cessRateBps`, `surchargePaise`, `rebate87APaise`, and `nps80CCD1CapPaise` ([TASK.md:37](/work/personal/compass/tasks/094-regime-comparison/TASK.md:37)).

2. **The regime-preference assumption is correct.**

   `getRegimePreference(db, userId, fy)` exists, is user/FY scoped, and returns an effective `"new"` default without writing a row ([regime-preference.ts:76](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:76)). If 13.8 is intended to expose the current preference alongside its recommendation or update an inferred preference, that behavior still needs to be stated; comparison itself should not mutate the user’s choice.

3. **The functional-core direction is correct.**

   Pure `compareRegimes(inputs)` and pure `findCrossover()` conform to the repository’s functional-core convention. Keep DB gathering, DOB lookup, and calls to other services in `getRegimeComparison`; do not let either pure function call the database. Binary search is appropriate and not unnecessary complexity—once its bounds and result type are fixed, it should take only logarithmically many full tax probes.

4. **No hardcoded tax constants is the right rule, but the plan needs a stronger gate.**

   Slabs, deductions, rebate thresholds, surcharge rates, cess, and standard deductions should all come from `tax-rules.ts`. Add a test or code-review criterion preventing duplicate monetary/rate literals in `regime-comparison.ts`. Generic arithmetic constants such as the 10,000 bps denominator are not FY tax policy, but the 80CCD percentage must come from rule data.

**Final verdict: NOT IMPLEMENTATION-READY.** Resolve the contradictory review-1 text, define exact shared dependency and response contracts, settle the special-rate/rebate/surcharge model, and expand P6/ACs before dispatching implementation.