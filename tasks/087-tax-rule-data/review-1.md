## High

1. **The plan creates a parallel tax registry instead of extending the existing source of truth.**  
   The task specification explicitly says to extend the existing registry rather than start a second one, and includes capital-gains rates, exemptions, and holding periods in that registry ([task specification](/work/personal/compass/tasks/13.01-tax-rule-data.md:12)). The plan instead creates `lib/tax-rules.ts` while leaving capital-gains data in `instrument-rules.ts` as “cross-reference only” ([plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:15), [plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:36)). It also does not modify `tax-lots.ts`, which still hardcodes the grandfathering date, §50AA acquisition date, transfer-date reform, and holding periods ([tax-lots.ts](/work/personal/compass/apps/api/src/modules/investments/services/tax-lots.ts:18), [tax-lots.ts](/work/personal/compass/apps/api/src/modules/investments/services/tax-lots.ts:100)). Therefore AC1 cannot be met: tax facts remain split among at least three sources. Make one authoritative tax registry, or extract a shared effective-dated registry kernel and have both instrument and tax-lot consumers delegate to it. The plan must explicitly include refactoring and characterization tests for existing consumers.

2. **A single `getRule(date)` model cannot express the required acquisition/transfer/assessment axes.**  
   P1 specifies ordinary `effectiveFrom`/`effectiveTo` entries and `getRule(date)` ([plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:41)), but §50AA already depends on acquisition date while unlisted-bond and holding-period reforms depend on transfer date ([tax-lots.ts](/work/personal/compass/apps/api/src/modules/investments/services/tax-lots.ts:117)). Income slabs and deductions apply by tax/FY or assessment basis. The statement “separate applicability where they differ” has no corresponding type, data shape, or lookup API. Define explicit applicability dimensions and lookup inputs—such as acquisition date, transfer date, income/tax year, regime, and taxpayer class—rather than choosing one generic date. Tests must cover combinations spanning different acquisition and transfer epochs.

3. **The regime-preference schema is missing the constraints required for a safe per-user/per-FY upsert.**  
   Listing only `(userId, fy, chosen, inferredFromTds, updatedAt)` ([plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:52)) does not establish a primary/unique key. Without a composite primary key or unique constraint on `(userId, fy)`, duplicate preferences are possible and the proposed upsert has no deterministic conflict target. The plan should require:

   - `userId` non-null FK to `users.id` with `ON DELETE CASCADE`.
   - Strictly validated `fy`.
   - Composite PK/unique constraint on `(userId, fy)`.
   - A database enum or check constraint for both regime values.
   - `createdAt` as well as `updatedAt`.

   It must also state how FY is supplied to GET/PUT. A fixed `/regime-preference` URL without an FY query, path parameter, or request field cannot access historical rows despite the table’s FY dimension.

4. **The plan exposes no ownership boundary between user choice and computed TDS inference.**  
   `inferredFromTds` is described as computed, but the shared PUT contract is not defined and could allow clients to write it. That would let an API caller inject a supposedly trusted inference and affect downstream tax guidance. PUT should accept only `fy` and `chosen`—including `null` if clearing is intended—while inference is written only by the payslip/TDS service. The response should distinguish `chosen`, `inferredRegime`, and the resolved effective preference/source. The current name also sounds boolean despite storing `"old" | "new" | null`.

## Medium

1. **The plan does not move `fyOf`/`fyRange` out of the investments service.**  
   These are general Indian financial-year utilities but currently live in `modules/investments/services/capital-gains.ts` ([capital-gains.ts](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:7)). Tax tasks 13.1 and 13.6 will need them. Importing from the investments service would create the wrong domain dependency. Add a shared API utility such as `apps/api/src/lib/financial-year.ts`, move its existing tests, and update capital gains to import it. If shared contracts also validate FY labels, put a reusable `FinancialYearSchema` in `packages/shared` rather than maintaining separate validation.

2. **The existing FY helpers are permissive and should not be copied unchanged.**  
   `fyOf` does not validate a real ISO date, while `fyRange` merely parses the first four characters and ignores whether the suffix matches the following year ([capital-gains.ts](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:8)). Invalid inputs can become malformed ranges rather than fail loudly. The extraction should add strict calendar-date and canonical `YYYY-YY` validation, including century rollover such as `1999-00`.

3. **Blindly copying the existing `Date` lookup API introduces timezone boundary errors.**  
   `getInstrumentRule` converts a `Date` through UTC using `toISOString()` ([instrument-rules.ts](/work/personal/compass/apps/api/src/lib/instrument-rules.ts:510)). A local-midnight `Date` in India can serialize to the previous UTC date, selecting the wrong rule on an effective-date boundary. Tax rules should accept validated ISO civil-date strings, or normalize with an explicitly documented timezone. Tests should cover IST local-midnight and offset-bearing inputs.

4. **The rule registry has no protection against overlapping epochs.**  
   The existing lookup uses `.find()` ([instrument-rules.ts](/work/personal/compass/apps/api/src/lib/instrument-rules.ts:515)); if two applicable rules overlap, the first silently wins. “Missing rules fail loudly” is only half the invariant. The plan should validate at module initialization or in tests that every key/dimension has non-overlapping, correctly ordered epochs and that lookups throw when more than one rule matches.

5. **The supported-history and future-date policy is inconsistent.**  
   The plan loads only FY 2023-24 through 2026-27 but claims reproducible historical FYs ([plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:30), [plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:65)). It should name the supported historical window and deliberately throw outside it. Annual slab/deduction rules should normally end on 31 March rather than use an open-ended `effectiveTo: null`; otherwise the latest known FY can silently become the rule for every future year, contradicting AC4.

6. **The tax data dimensions are too shallow for the listed deductions and rates.**  
   “80CCD(2) salary-%” is not one cap: it varies by employer type and regime, and its salary base has a specific definition. The Income Tax Department currently documents 14% for government employees, 14% under the new regime for other employers, and 10% otherwise ([official deductions guidance](https://www.incometaxindia.gov.in/w/deductions)). Likewise, old-regime slabs vary for senior and super-senior citizens, 87A is residency-sensitive, standard deduction applies to eligible salary/pension income, and most Chapter VI-A deductions are unavailable under §115BAC. The registry needs applicability conditions—not just amounts—so later services cannot apply a correct cap in an ineligible context.

7. **Advance-tax data is not one universal four-instalment schedule.**  
   The four cumulative percentages apply generally, but presumptive-tax taxpayers under 44AD/44ADA pay 100% by 15 March ([official ITR-4 guidance](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr%204-faqs)). Senior citizens without business income are another eligibility branch identified by task 13.10. Encode schedule variants and eligibility predicates now, or explicitly defer them while ensuring the registry can represent them.

8. **FY 2026-27 crosses a governing-Act compatibility boundary absent from the plan.**  
   The Income Tax Department states that income and advance tax for FY 2026-27 are governed by the Income-tax Act, 2025, with the former 234B/234C concepts corresponding to sections 424/425 ([official tax-payment FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/tax-payments-faq?mobile-app=1)). Storing only labels `"234B"`/`"234C"` through FY 2026-27 will produce stale statutory references. Effective-dated rule metadata should include governing Act and section identifier while retaining a stable internal semantic key.

9. **Percentage representation is unspecified and risks violating the repository’s integer-arithmetic rule.**  
   The instrument registry stores values such as `12.5` in percentage fields ([instrument-rules.ts](/work/personal/compass/apps/api/src/lib/instrument-rules.ts:97)). Reusing that representation in future liability calculations encourages floating-point financial arithmetic. Store rates in basis points or an exact numerator/denominator and keep all computed tax in integer paise with explicit rounding rules.

10. **The test plan omits critical database, contract, authorization, and migration cases.**  
    P2 covers mostly lookup/slab examples. It should also require:

    - Composite-key upsert behavior and no duplicates.
    - Same user/different FY and different user/same FY isolation.
    - User deletion cascade.
    - Clearing `chosen` without overwriting inference, and vice versa.
    - Strict invalid-FY and unknown-field rejection.
    - Unauthenticated GET/PUT rejection.
    - Demo-session PUT rejection with no database effect, matching existing mutation behavior.
    - Proof that clients cannot write computed inference.
    - Missing, overlapping, and exact boundary-day rule cases for every epoch.
    - Acquisition-before/after × transfer-before/after matrices.
    - Schema-barrel object identity and generated migration constraints.
    - Backup export and restore round-trip, not merely `backup.test.ts` passing.

11. **The implementation order violates the repository’s mandatory TDD workflow.**  
    The plan creates rule data in P1 and writes tests in P2 ([plan](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:50)). `tasks/TDD.md` requires each unchecked acceptance criterion to be expressed as a failing test before implementation. Reorder the plan criterion-by-criterion, including characterization tests before moving tax-lot or fiscal-year behavior.

## Low

1. **The prefix approach is correct, but the route-file path is ambiguous and could double-prefix the endpoint.**  
   Shopping is registered with `{ prefix: "/api/shopping" }` in `app.ts` ([app.ts](/work/personal/compass/apps/api/src/app.ts:152)), and its route files declare relative paths ([shopping plugin](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:24)). Tax should therefore register `taxRoutes` with `{ prefix: "/api/tax" }`, while the route file declares `"/regime-preference"`. P5 currently says the route itself is `/api/tax/regime-preference`, which should be clarified as the final public URL.

2. **Route snapshot and module-plugin tests are missing from the plan.**  
   Adding GET/PUT routes is an intentional route-surface change, so both `route-surface.snapshot.txt` and `route-table.snapshot.txt` must be reviewed and updated. A `modules/tax/plugin.test.ts` should also assert the prefixed final routes, following other module-local registration tests.

3. **The schema-barrel convention should be explicit.**  
   `db/schema.ts` is a pure barrel with explicit domain exports and documented table/enum counts ([schema.ts](/work/personal/compass/apps/api/src/db/schema.ts:1)). The plan should require an explicit `taxRegimePreferences`/enum export, update the header counts, and add `modules/tax/schema.smoke.test.ts` proving object identity through the barrel. Avoid introducing inline Drizzle definitions or an unreviewed wildcard export there.

4. **Backup wiring is directionally correct but should name the exact scoping rule.**  
   Because the preference table has a direct `user_id`, it belongs once in `ALL_TABLES` after `users` and in `USER_TABLES` as `"user_id"` ([backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:32), [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:52)). It should not be added to `LINKED_TABLES`. The existing coverage test will catch omission, but the plan should include restore verification as well.

5. **`inferredFromTds` needs provenance or freshness metadata.**  
   Employer TDS treatment is an inference, not necessarily the user’s eventual filing choice. At minimum, preserve `inferredAt` and a source reference or source period once payslips exist, so a stale inference can be explained and recomputed. The resolution order should be explicit: user choice first, then current inference, then an identified statutory/default state rather than silently treating `null` as either regime.