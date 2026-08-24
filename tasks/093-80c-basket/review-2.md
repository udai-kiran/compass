## High severity

1. **13.5 and 13.6 are not complete dependencies, so the task’s own dispatch gate is not satisfied.**  
   Both dependency task files remain `IMPLEMENTING`, not `COMPLETE`: [13.5](/work/personal/compass/tasks/091-epf-passbook/TASK.md:4) and [13.6](/work/personal/compass/tasks/092-scheme-limits/TASK.md:4). More importantly, `npm run typecheck -w apps/api` currently fails in `epf-contributions.test.ts` because the VPF fields added to `computeStatus()` were not added to the test fixtures. This directly violates the task’s H5 dependency requirement and AC9. Implementation should not begin until both dependencies are complete and green.

2. **H2 is not genuinely resolved: the plan lacks the inputs needed to cap 80CCD(2).**  
   `tax-rules.ts` does contain employer-type-, regime-, and FY-aware rates, but they are not the simple “private 10% / government 14%” rule stated at [TASK.md:16](/work/personal/compass/tasks/093-80c-basket/TASK.md:16):

   - Old regime: private 10%, government 14%.
   - New regime FY 2023-24: private 10%, government 14%.
   - New regime FY 2024-25 onward: 14% for both employer types.

   See [tax-rules.ts:460](/work/personal/compass/apps/api/src/lib/tax-rules.ts:460). `getDeductionCap()` also returns an array, so callers must select the correct regime entry and employer rate.

   No current model supplies `employerType`, and the proposed `deduction_entries` row supplies neither employer type nor the Basic+DA base. Payslips have `basic`, but no canonical DA component. Therefore `claimedPaise <= Basic+DA × rate` cannot be implemented reliably. The plan must define either per-entry `employerType` and `salaryBasePaise`, or a concrete, tested derivation and fallback policy. It must also say whether an over-cap contribution is rejected or recorded as contributed with only `min(contributed, cap)` treated as deductible; “advisory validation” conflicts with AC5’s “capped.”

3. **M9 cannot be met with `tax-rules.ts` as it exists.**  
   Existing rule data covers 80C, 80CCD(1B), regime-specific 80CCD(2), and the four 80D group limits. It does not contain:

   - The employee 80CCD(1) salary rate.
   - The ₹5,000 preventive-checkup sub-limit.
   - Any helper that resolves one 80CCD(2) rate from FY, regime, and employer type.

   Yet the plan says all caps come exclusively from `tax-rules.ts`, while its algorithm directly uses `5_000_000` at [TASK.md:75](/work/personal/compass/tasks/093-80c-basket/TASK.md:75) and ₹5,000 at line 87. Extend `tax-rules.ts` first, or explicitly narrow M9. Otherwise implementers must hardcode rules despite being told not to.

4. **M3 cannot work against the insurance implementation today.**  
   `policy_covered_persons` exists, but the insurance service never writes or reads it. `toPolicy()` always returns `coveredPersonIds: []` at [insurance.ts:53](/work/personal/compass/apps/api/src/modules/protection/services/insurance.ts:53), while create/update simply spread the parsed request into the policy row and perform no normalized covered-person maintenance. Consequently, almost every existing policy is unclassifiable as self/family versus parents.

   Task 13.7 must either depend on a prerequisite fix to insurance CRUD or include that work explicitly: validate each person belongs to the policy owner, replace junction rows transactionally on create/update, and return them on reads. Existing unclassified policies need a defined `dataMissing`/manual-allocation outcome; they must not be silently assigned to a bucket.

5. **The 80CCD(1)/80CCE handoff to 13.8 is circular and leaves the 80C basket incorrect.**  
   The plan allocates ₹50,000 to 80CCD(1B), then says the remainder goes to 80CCD(1), but AC4 defers its salary cap to 13.8. At the same time, task 13.8 consumes the completed basket and applies the shared 80C/80CCD(1) ₹1.5 lakh ceiling. The 13.7 80C source list does not include the NPS 80CCD(1) remainder at all.

   Define the 13.7 contract explicitly: it should expose the raw remaining NPS pool separately from capped 80C totals, and 13.8 should return the final 80CCD(1)/80CCE allocation; or move salary-base resolution into 13.7. As written, “correct headroom” cannot be calculated and downstream consumers have no unambiguous field to use.

6. **The proposed basket response is underspecified.**  
   P3 names `DeductionBasket` but gives no field-level contract distinguishing:

   - Contributed versus eligible/capped/claimed amounts.
   - 80C sources versus the pending 80CCD(1) amount.
   - Self/family and parent 80D sub-buckets.
   - Old-only headroom versus both-regime 80CCD(2).
   - Actual, expected, estimated, and data-missing provenance.
   - Cap-validation failures and assumptions.

   These distinctions drive 13.8, 13.9, and the tax UI. Without an explicit schema, different implementations can satisfy the prose while producing incompatible semantics.

7. **`scheme-compliance.annualContributedPaise` is not always a usable raw PPF/SSY contribution total.**  
   Its shape does match the plan: `annualContributedPaise` exists for PPF, SSY, and NPS. However, PPF returns zero before querying contributions when `schemeOpenedDate` is missing; SSY similarly returns zero for missing holder/opening metadata. See [scheme-compliance.ts:147](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:147) and [scheme-compliance.ts:206](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:206). Thus real ledger contributions can be silently omitted from the deduction basket.

   Either make 13.6 always calculate the ledger total even when lifecycle metadata is missing, or have 13.7 source contribution totals independently while carrying the compliance status.

## Medium severity

1. **M8 misstates the existing API.**  
   `getRegimePreference()` does not return `"old" | "new"`; it returns `RegimePreferenceResult`. The effective value is `result.effective`, with default `"new"` when no row exists. See [regime-preference.ts:82](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:82). The plan should state this explicitly.

2. **New-regime suppression is too broad.**  
   AC6 says “Headroom suppressed for new-regime users,” but 80CCD(2) is available under both regimes. Only 80C, 80CCD(1), 80CCD(1B), and 80D headroom should be suppressed. The 80CCD(2) eligible amount/cap status must remain visible under the new regime using the new-regime rate.

3. **H3 is directionally correct but not implementation-complete.**  
   The current scope correctly says to use FY-filtered, non-deleted, policy-linked transactions. However, transactions have no amount column; the signed amount is on postings. The existing premium service obtains the user-facing posting and takes its magnitude at [insurance.ts:285](/work/personal/compass/apps/api/src/modules/protection/services/insurance.ts:285). The plan should require reuse of that logic or specify the posting query so an implementer does not sum a balanced transaction to zero or double-count legs. The “annualized fallback estimate” appears only in the review note, not in the response contract, acceptance criteria, or P8 tests.

4. **H4 is reflected in 13.7 but conflicts with the adjacent 13.8 plan.**  
   The current text properly calls the field `emiInterestEstimatePaise`, excludes it from deduction claims, and requires amortization from inception. Existing `listEmiInstallments()` already loads all linked, non-deleted installment transactions from `startDate` before splitting them, at [emis.ts:463](/work/personal/compass/apps/api/src/modules/credit/services/emis.ts:463). But task 13.8 still says section 24(b) computation is deferred. Resolve ownership between the tasks and add an acceptance criterion/test here if 13.7 owns it.

5. **M6 needs month/component-level precedence and an accepted-payslip rule.**  
   The EPF DTO already implements per-component `actual ?? expected ?? 0`, including VPF, at [epf-contributions.ts:161](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:161). There is no aggregate service and no third fallback to raw payslip components. If 13.7 adds that fallback, it must operate per wage month and only for accepted payslips lacking an EPF row; a global “EPF rows exist, otherwise payslips” switch will undercount partially imported years or double-count imported months. Zero actuals must win because confirmation is represented by non-nullness, not truthiness.

6. **The 80D allocation model does not cover mixed, empty, or manual cases.**  
   The proposed rules cover only policies whose covered people are all parents or contain no parents. They do not define:

   - A policy covering both parents and self/spouse/children.
   - A policy with no normalized covered-person rows.
   - DOB missing for a covered parent, self, or spouse.
   - Which FY date determines age 60.
   - Which 80D group receives `preventive_checkup` or `other_80d` manual entries.

   `deduction_entries` needs an explicit 80D group, or separate kinds for self/family and parents. Ambiguous policies should be reported as unallocated rather than guessed.

7. **Manual kinds can double-count automatic sources.**  
   `elss_manual`, `nsc_additional`, and `nps_additional` overlap with automatic holding/deposit/scheme sources, but there is no source identity, replacement semantics, or duplicate warning. In particular, it is unclear whether `nps_additional` participates in the same pool as `npsEmployeeContributionPaise`. Define additive versus override behavior and expose provenance.

8. **M2 is only partially reflected.**  
   The review note correctly requires `isElss` in `HoldingSchema`, create, update, and `toHolding()`, but P1 omits `UpdateHoldingSchema`. Validation also needs to consider the resulting state during updates: setting `isElss=true` on a non-MF must fail, and changing an ELSS holding’s asset class away from `mutual_fund` must either fail or clear the flag. A DB check such as `NOT is_elss OR asset_class='mutual_fund'` would protect imports and future callers.

9. **Life and health premiums are being presented too strongly as deductible amounts.**  
   Not every life premium is fully 80C-eligible; eligibility can depend on issue date and premium-to-sum-assured limits. Health-premium eligibility also has payment-mode and covered-person qualifications. The existing data does not model all of these. Unless this scope is expanded, the basket should expose these as “recorded potentially eligible premiums” or an estimate requiring confirmation, not silently claim the whole sum as deductible.

10. **User scoping requirements need to be explicit for every cross-domain source.**  
    The service must defensively scope:

    - Holdings through `holdings.userId`.
    - Deposit detail and its parent holding to the same user.
    - Policies and transactions to `userId`.
    - Covered persons through both an owned policy and `family_members.userId`.
    - EPF rows and deduction entries directly by `userId`.
    - EMI templates/details by `userId`.

    `policy_covered_persons` itself has no `user_id`, and its FKs do not prevent cross-user policy/person pairs. This makes the ownership checks particularly important.

11. **`source_doc_key` has no secure lifecycle.**  
    The proposed CRUD accepts an opaque storage key without defining upload, authorization, download, replacement, deletion, or backup behavior. If it is a real object-storage reference, P6 must add it to `FILE_COLUMNS` and ensure clients cannot choose arbitrary keys. Otherwise remove it until document support exists.

12. **P8 is not adequate.**  
    Five broad tests do not cover nine acceptance criteria or the number of source and security rules involved. At minimum add:

    - Shared Zod deep-equality tests and section/kind compatibility.
    - `isElss` create/update/asset-class transition tests.
    - Real-DB CRUD, user isolation, foreign-ID update/delete, and backup coverage.
    - Every automatic 80C source, FY boundaries, and archived/deleted behavior.
    - PPF/SSY metadata-missing behavior.
    - EPF actual/expected/raw-payslip precedence per month, including zero and partial actuals.
    - NPS boundary and non-overlap invariants, manual/automatic duplication, and 80CCE handoff.
    - Every FY/regime/employer-type 80CCD(2) rate and missing salary/employer inputs.
    - 80D self, spouse, parents, mixed policy, missing DOB, exact 60th-birthday boundary, empty coverage, and preventive sub-limit/group allocation.
    - New-regime suppression only for old-exclusive deductions.
    - Actual premium posting selection, FY boundaries, and soft deletion.
    - NSC/tax-saver FD start-date FY boundaries.
    - EMI inception reconstruction and proof it is excluded from claimed totals.
    - Unknown FY failing loudly.
    - Money invariants: claimed ≤ cap, headroom ≥ 0, and NPS allocations never exceed the source pool.

## Low severity

1. **`section` and `deduction_kind` duplicate classification state.**  
   Keeping both requires permanent compatibility validation. If fast section queries are not demonstrably needed, derive section from kind. If both remain, enforce the mapping at the database level as well as with Zod/service validation.

2. **The 24(b) estimate adds avoidable cross-domain complexity to the basket service.**  
   It is not one of the four deduction buckets and already belongs naturally to the EMI service. Prefer a small credit-domain aggregate that 13.7 calls, or a separate estimate endpoint, rather than duplicating EMI queries and amortization knowledge inside tax aggregation.

3. **The plan should reuse existing service outputs instead of repeating their rules.**  
   EPF already exposes `eligible80cPaise`, and scheme compliance already exposes raw contribution fields. Adding narrow aggregate helpers to those owning services would reduce duplicated precedence/query logic in `deductions.ts`.

4. **Repository TDD conventions are not represented strongly enough.**  
   `tasks/TDD.md` requires one failing-first test per unchecked acceptance criterion, pure DB-free tax/allocation logic, and real-Postgres tests for persistence. P8 does not map tests to each AC or call out invariant coverage. Additionally, the current 13.6 tests use a stubbed Drizzle-like chain despite the repository’s explicit “do not mock the database” rule, so they do not prove the SQL exclusion/scoping behavior they claim to cover.

## Confirmed correct assumptions

- `depositKind` already contains both `tax_saver_fd` and `nsc`, and lump-sum instruments use `principalPaise` plus `startDate`: [investments/schema.ts:185](/work/personal/compass/apps/api/src/modules/investments/schema.ts:185).
- Adding `isElss BOOLEAN NOT NULL DEFAULT false` to holdings is structurally clean, subject to the validation issues above.
- `scheme-compliance` does expose `annualContributedPaise` and `npsEmployeeContributionPaise` in the expected shape.
- The EPF DTO’s current per-component actual-over-expected precedence matches the intended core rule.
- `tax-rules.ts` has the four 80D caps and regime-aware 80CCD(2) rate matrices.
- Actual insurance premiums are represented by non-deleted policy-linked ledger transactions, not by annualized policy terms.
- `getRegimePreference()` defaults its `effective` field to the new regime.
- The current H4 language correctly treats home-loan interest only as an estimate, not a deduction claim.
- M1 and M5 correctly reuse `depositKind`; no redundant FD/NSC booleans are needed.

## Verdict

**Not implementation-ready.**

The principal blockers are the incomplete and currently non-typechecking 13.5/13.6 dependencies, missing 80CCD(2) cap inputs, absent tax-rule data for rules M9 says must be centralized, the nonfunctional `policy_covered_persons` integration, and the unresolved 80CCD(1)/80CCE contract with task 13.8. P8 also needs substantial expansion before it can satisfy this repository’s TDD gate.