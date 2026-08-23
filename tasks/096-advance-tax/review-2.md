## High

1. **H3 is still technically wrong: 12%/36% are waiver gates, not the interest bases.**  
   [TASK.md:12](/work/personal/compass/tasks/096-advance-tax/TASK.md:12) says interest is charged “on shortfall below these cumulative floors.” For June and September, interest is triggered when payment is below 12%/36%, but once triggered the shortfall is measured against the statutory instalment of 15%/45%. The official computation describes June as `15% − paid` when paid is below 12%, and September as `45% − paid` when paid is below 36%. [Income Tax Department calculation guidance](https://www.incometaxindia.gov.in/w/how-to-calculate-interest-under-section-234c-).  
   The plan must model both `interestTriggerPct` = 12/36/75/100 and `requiredInstalmentPct` = 15/45/75/100.

2. **H2/M5 do not yield a computable capital-gains liability and remain internally contradictory.**  
   Actual slices do have `sellDate` in the shared contract ([wealth.ts:613](/work/personal/compass/packages/shared/src/schemas/wealth.ts:613)) and are returned by the service ([capital-gains.ts:87](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:87)). Task 097 also plans the stronger `simulateSetOffAsOf(..., cutoffDate)` using positive and negative dated slices ([097 TASK.md:114](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:114)); 096 should consume that API rather than independently regrouping raw slices.

   However, slices do not expose `gainsTaxClass`, and task 094 expressly says correct capital-gains tax cannot currently be computed and accepts only caller-supplied `capitalGainsTaxPaise` ([094 TASK.md:8](/work/personal/compass/tasks/094-regime-comparison/TASK.md:8)). Therefore:

   - Annual net gain paise cannot simply be added to a tax-liability snapshot.
   - Per-cutoff net STCG/LTCG paise cannot be converted into incremental tax correctly without effective-dated rate buckets, exemptions, surcharge, cess, and marginal effects.
   - H2 says annual 13.11 totals feed liability, while M5/P3 say 13.8 is run without gains and dated gains are added separately ([TASK.md:10](/work/personal/compass/tasks/096-advance-tax/TASK.md:10), [TASK.md:27](/work/personal/compass/tasks/096-advance-tax/TASK.md:27), [TASK.md:122](/work/personal/compass/tasks/096-advance-tax/TASK.md:122)).

   A dependency must first expose annual and as-of-cutoff **tax attributable to capital gains**, or a reusable tax computation that accepts correctly classified dated gain buckets. Until then, M5 cannot be implemented safely.

3. **The capital-gains relief is treated as unconditional, which is wrong for the zero-payment scenario.**  
   Section 234C relief depends not only on when the gain arose but also on paying the whole associated tax through the remaining instalments, or by 31 March when none remain. [The statutory text states that condition explicitly](https://www.incometaxindia.gov.in/w/section-234c-12). The plan says later gains are excluded from earlier obligations and “remaining instalments must cover” them, but does not specify an algorithm that verifies that condition. In the sourced `scenario: "no_payments"`, the condition necessarily fails by year-end, so the calculator cannot grant relief unconditionally. Tests must cover timely full payment, partial payment, late payment, and no payment after a late gain.

4. **M1 is not consistently reflected and can still silently produce a false exemption.**  
   The review section introduces the tri-state result, but the canonical Scope still directs implementers to infer no business income from `income_events` and exempt outright ([TASK.md:62](/work/personal/compass/tasks/096-advance-tax/TASK.md:62)); the current enum has no business kind ([tax.ts:256](/work/personal/compass/packages/shared/src/schemas/tax.ts:256)). The response still exposes only `isSeniorCitizenExempt: boolean` ([TASK.md:83](/work/personal/compass/tasks/096-advance-tax/TASK.md:83)), and AC3 retains unconditional boolean wording.

   The plan also does not define the result for missing DOB. It should be `unknown`, as should residency unless the product deliberately accepts a clearly disclosed resident assumption. Choose either a validated request attestation or a persisted profile field—“query param / profile flag” is not an implementable decision—and update Scope, response, schemas, and AC3.

5. **234B lacks the calculation endpoint needed to determine months.**  
   M2 correctly says the trigger is `<90%` while the base is the full assessed-tax shortfall ([TASK.md:21](/work/personal/compass/tasks/096-advance-tax/TASK.md:21)); this matches the statutory rule. [Section 234B](https://wmstatic-prd.incometaxindia.gov.in/documents/20117/42998/Section-234B_2025-11-01_03-38-59_3787f9_en.pdf/d4d08790-86b9-950c-888b-03af0d68cef9?download=true&t=1775798963957&version=1.0). But neither route nor input defines an `asOfDate`, assessment date, or final payment date. Consequently a no-payment estimate cannot determine the number of months, and `estimatedPaise` is undefined for both current and historical FYs. Payment semantics also need to distinguish:

   - Advance-tax payments through 31 March for the 90% trigger.
   - Payments through each 234C due date.
   - Self-assessment/other payments after 1 April that reduce the 234B base prospectively.
   - Any residual balance through the estimate’s explicit `asOfDate`.

## Medium

1. **H1 is only partially reconciled.**  
   The review text and P4 correctly introduce a no-payments GET plus a payment-scenario POST. But Scope still lists `GET /advance-tax/234c-estimate` ([TASK.md:105](/work/personal/compass/tasks/096-advance-tax/TASK.md:105)), the response has no `scenario`, payment assumptions, or as-of date, and the Non-Goals call user-entered payments “deferred” ([TASK.md:137](/work/personal/compass/tasks/096-advance-tax/TASK.md:137)). Clarify that persistence is deferred while request-scoped scenario inputs are in scope, and remove the stale second GET.

2. **M2 remains ambiguous in AC4.**  
   AC4 says “234B: 1%/month on shortfall from 90% threshold” ([TASK.md:131](/work/personal/compass/tasks/096-advance-tax/TASK.md:131)), which invites the exact bug review-1 corrected. It must say: “triggered below 90%; charged on assessed tax minus advance tax/TDS, not on the gap to 90%.”

3. **P6 is inadequate for statutory rounding and currently leaves the rule unresolved.**  
   L2 literally says “round down?” ([TASK.md:30](/work/personal/compass/tasks/096-advance-tax/TASK.md:30)). Under Rule 119A, the interest base discards any fraction of ₹100—it is truncation/down, not nearest-half-up. The resulting interest is rounded to the nearest ₹10. [Income Tax Department guidance](https://www.incometaxindia.gov.in/w/interest-and-fees). “Rounding boundaries” is too vague. P6 should explicitly test:

   - Base ₹99.99 → ₹0, ₹100 → ₹100, ₹199.99 → ₹100, ₹200 → ₹200.
   - Interest ₹4.99 → ₹0, ₹5 → ₹10, ₹14.99 → ₹10, ₹15 → ₹20.
   - Each instalment independently, plus total-of-rounded-components versus rounding only the final total.
   - Integer-only bps arithmetic with no floating point.

4. **P6 omits important statutory and date boundaries.**  
   Add tests for all four 234C trigger boundaries—not just 12%/36%—at exact equality and one paise below; payment exactly on and one day after each due date; gain exactly on and one day after each cutoff; 15 March versus 16–31 March; the ₹10,000 liability threshold at one paise below and exact equality; 234B at exactly 90% and one paise below; part-of-month treatment; overpayment and zero/negative-clamped liabilities.

5. **The ₹10,000 threshold belongs in `tax-rules.ts`, but other statutory constants are still left inline.**  
   The existing `AdvanceTaxSchedule` is already keyed by FY and can straightforwardly hold `advanceTaxLiabilityThresholdPaise` ([tax-rules.ts:101](/work/personal/compass/apps/api/src/lib/tax-rules.ts:101), [tax-rules.ts:530](/work/personal/compass/apps/api/src/lib/tax-rules.ts:530)). It does not contain that field yet, which is appropriate for P1. But 12/36 trigger percentages, 3/3/3/1 month counts, the 90% trigger, and rounding units are also statutory rule data and should be effective-dated there rather than hardcoded in `advance-tax.ts`. The threshold’s `>=` condition is correct; the official department confirms ₹10,000 remains the threshold under the 2025 Act. [Tax Payments FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tax-payments-faq?mobile-app=1).

6. **AC7 is stale and contradicts M4.**  
   AC7 requires 13.10 to write deduped `alert_ledger` entries ([TASK.md:134](/work/personal/compass/tasks/096-advance-tax/TASK.md:134)), while M4 and the Alert section explicitly defer all writing and scheduling to 13.9. Replace AC7 with an acceptance criterion for pure `computeDueAlerts()` output: threshold equality, lead-window boundaries, senior `unknown`/`exempt` behavior, deterministic kind/refKey inputs, and no database writes. The actual `(userId, kind, refKey)` dedup criterion belongs solely in task 095. Task 095 also needs its stale statement that advance-tax alerts are “already handled by 096” corrected ([095 TASK.md:44](/work/personal/compass/tasks/095-deadline-nudges/TASK.md:44)).

7. **M3 overstates available TCS support.**  
   `totalTdsPaise` genuinely sums accepted TDS across all income kinds ([tax.ts:393](/work/personal/compass/packages/shared/src/schemas/tax.ts:393)), so using all TDS is feasible. There is no TCS field, however, so the plan cannot claim “TDS/TCS coverage.” It should explicitly say TCS, MAT/AMT credit, section 89 relief, and foreign-tax credits are not sourced and may overstate assessed tax.

8. **The response and shared-contract work are underspecified and stale.**  
   The proposed response lacks the tri-state exemption, scenario, as-of date, payment summary, 234B basis/months, 234C trigger/required bases, and limitation fields. P4 does not mention adding shared Zod request/response schemas, tests, and exports, contrary to repository conventions. This is also a compatibility risk for task 101, whose UI currently assumes the boolean “show nothing if exempt” behavior ([101 TASK.md:37](/work/personal/compass/tasks/101-tax-ui/TASK.md:37)).

9. **India-facing deadline calculations need an IST business date.**  
   The repository explicitly warns that its current UTC ledger-day convention is unsuitable for advance-tax deadlines ([tasks/README.md:255](/work/personal/compass/tasks/README.md:255)). The plan should require an injected IST business date for statuses, cutoff grouping, alerts, and 234B month boundaries rather than `new Date().toISOString()`.

10. **Input validation and tenant-isolation requirements are absent.**  
    The POST schema should reject negative, non-integer, unsafe-integer, malformed, irrelevant-FY, and implausibly future payments; cap array length to prevent request-amplification; and define duplicate/same-day aggregation. Orchestration and integration tests should prove every DOB, income, and investment query is scoped by `userId`. No cross-user identifiers should be accepted from the estimate body.

11. **TDD/task-format compliance is incomplete.**  
    The file uses a heading for status rather than frontmatter and its ACs are plain bullets rather than unchecked checkboxes. That conflicts with the contributor guide’s “frontmatter is source of truth” rule and `tasks/TDD.md`, which requires every unchecked AC to be driven by an observed-failing test. The plan should identify shared-schema tests, pure calculator tests, service integration/user-scoping tests, and route-surface snapshots.

12. **Pure-core separation is directionally correct but not concrete enough.**  
    P2/P3 recognize pure calculation versus orchestration, which complies in spirit. Name separate modules/functions so the calculator accepts plain validated values and imports no DB/service code, while orchestration alone takes `Db` and `userId`. Money remains integer paise, but explicit safe-integer and invariant coverage is required.

## Low

1. The rule-data type `AdvanceTaxSchedule` and proposed API response `AdvanceTaxSchedule` use the same name for different concepts. Rename the response to something like `AdvanceTaxEstimate` to avoid aliasing and confusion.

2. `computeDueAlerts(schedule, today)` hides its effective-dated rule dependency. Either accept the resolved rule/threshold as a plain input or accept `fy` and document that it performs the `getAdvanceTaxSchedule(fy)` lookup. The former keeps the function more purely testable.

3. The old Scope repeatedly says “capital gains by quarter,” while review-1 deliberately rejected quarter buckets. Replace that terminology with “as-of-cutoff set-off result” throughout.

## Review-1 disposition

- H1: **Partial**
- H2: **Partial; `sellDate` exists, but tax-at-cutoff does not**
- H3: **Not correctly addressed**
- H4: **Plan direction valid; current rule structure can hold it**
- M1: **Partial and contradicted by Scope/response/AC**
- M2: **Partial; corrected in review text but contradicted by AC4 and missing duration semantics**
- M5: **Not implementable as written and internally contradictory**

## Verdict

**Not implementation-ready.** The blocking issues are the incorrect 234C trigger-versus-base formula, absence of a computable effective-dated capital-gains tax liability at each cutoff, unconditional capital-gains relief in no/partial-payment scenarios, unresolved senior-eligibility inputs, and undefined 234B end-date/payment semantics. AC7 must also be moved to task 095 before implementation begins.