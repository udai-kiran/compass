## High

1. **The proposed ordering is not statutory, and can preserve the wrong loss pool.**

   Sections 70(2)–(3) establish only the eligibility matrix:

   - STCL may offset either STCG or LTCG.
   - LTCL may offset only LTCG.

   Neither provision requires STCL to offset STCG first. Section 74 applies the same restrictions to brought-forward losses but likewise specifies no STCG-first priority. [Section 70](https://www.incometaxindia.gov.in/w/section-70-128), [Section 74](https://www.incometaxindia.gov.in/hi/w/section-74-63).

   Therefore, [TASK.md:42](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:42) and AC2 should not call `STCL → STCG → LTCG` “ordering per Section 70/74.” It is a permissible allocation policy, not a statutory ordering.

   More importantly, applying STCL to LTCG before available LTCL can waste flexibility: LTCL has no use against STCG, while STCL does. Subject to expiry and rate-bucket considerations, LTCL should normally consume LTCG before flexible STCL is diverted to LTCG. The plan needs an explicit allocation objective—expiry minimization, tax minimization, or ITR-compatible user-selected allocation—not a claimed statutory priority. Current-year losses should still be processed before brought-forward losses, matching the official CYLA-then-BFLA workflow.

2. **The proposed cumulative `absorbed_*` state does not prevent reuse of the same loss.**

   The plan contains no operation that atomically writes absorption when `getNetGainsAfterSetOff()` uses a brought-forward record. That method only loads records and returns `broughtForwardUsed` ([TASK.md:55](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:55)). Consequently, the same loss can be used again for another target FY or by 13.10 and 13.12, directly violating the original task’s “never double-counts” requirement.

   Even if cumulative columns are updated later, they do not identify:

   - the FY in which consumption occurred;
   - the target gain bucket/rate consumed;
   - which computation or filed return authorized it;
   - how to reverse/recompute consumption after a backdated holding edit;
   - how concurrent summaries avoid consuming the same balance.

   Use either an immutable allocation child table such as `(loss_record_id, setoff_fy, loss_term, gain_bucket, amount_paise)`, with transactional uniqueness/invariants, or deterministically recompute every year chronologically from filed opening balances. A GET summary should not silently mutate cumulative state.

3. **`carry_forward_eligible = is_return_filed` is legally incorrect.**

   Carry-forward requires more than the existence of a return. Section 139(3) requires a loss return within the time allowed by Section 139(1), and Section 80 requires the loss to have been determined pursuant to that return. [Section 139(3)](https://www.incometaxindia.gov.in/documents/20117/42998/Section-139_2025-11-01_09-36-05_a8fe49_en.pdf/8a76ffdb-7d50-c0a4-aeb1-a7e6b0b3b1bc), [Section 80](https://www.incometaxindia.gov.in/documents/20117/42998/Section-80_2026-05-05_11-51-34_8cd341_en.pdf/3393d817-0497-950d-4fa0-6ac04bba2679).

   A belated return would set `is_return_filed=true` while remaining ineligible. The schema should capture at least `filed_within_due_date` or a richer filing status, and ideally the loss amounts actually declared/determined in the return. Live portfolio calculations are estimates and may differ from the filed loss.

4. **Materialization risks storing the raw loss instead of the legally carryable residual.**

   `computeCurrentFyLosses()` extracts raw signed bucket losses, while `materializeCurrentFy()` says it upserts the current FY loss “only if net loss” ([TASK.md:36](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:36), [TASK.md:50](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:50)). That is insufficiently defined.

   Example: STCL ₹100 and LTCG ₹80 leaves only ₹20 STCL eligible for carry-forward. Storing ₹100 while `absorbed_stcl_paise` represents only later-year absorption makes ₹80 available twice. Conversely, “only if net loss” must mean an eligible residual in either term—not simply `short + long < 0`; STCG cannot absorb LTCL.

   The record should distinguish original/computed loss, current-year set-off, and closing carry-forward balance, or store only the filed closing balance.

5. **The proposed LTCL arithmetic is wrong.**

   [TASK.md:45](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:45) first mutates `remaining_ltcg`, then calculates:

   ```text
   ltcl_remaining = max(0, ltcl - remaining_ltcg)
   ```

   using the post-set-off gain. With LTCG ₹100 and LTCL ₹150, it produces zero LTCG but still reports ₹150 LTCL instead of ₹50. Calculate the consumed amount from the pre-update balance, or use a shared `consume(loss, gain)` helper returning both residuals. Add conservation invariants: gain reduction equals loss consumed, and no paise is created or consumed twice.

6. **The existing statement is too coarse to be the promised tax-engine source of truth.**

   `getCapitalGains()` does preserve negative values: `sumSlices()` adds signed `gainPaise` into short, long, and exempt buckets ([capital-gains.ts:29](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:29)), and the FY statement returns signed `shortTermGainPaise` and `longTermGainPaise` ([capital-gains.ts:135](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:135)). Thus `computeCurrentFyLosses()` mechanically works as proposed.

   However, the actual `CapitalGainsStatement` contains:

   - `fy`, `availableFys`;
   - signed short-term, long-term, and exempt totals;
   - taxable total, proceeds, and cost;
   - per-holding rollups and FIFO slices.

   The schema is at [wealth.ts:645](/work/personal/compass/packages/shared/src/schemas/wealth.ts:645), not `schemas/investments.ts`.

   It does not retain tax-rate buckets or even `gainsTaxClass` in the slices. Once STCG/LTCG are collapsed, the set-off engine cannot say whether a loss reduced Section 111A equity STCG, ordinary-rate STCG, Section 112A LTCG, or other LTCG. Returning only `netStcgPaise` and `netLtcgPaise` is therefore inadequate for accurate advance-tax computation and harvesting recommendations. It also covers only modeled holding events, not all possible capital-gain sources reported in an ITR.

## Medium

1. **The capital-loss record belongs more naturally in the tax module.**

   FIFO realization remains an investments concern, but filing eligibility, filed loss balances, statutory expiry, and loss allocations are tax-return facts. The repository already has a dedicated tax schema/plugin registered under `/api/tax`, while the investments plugin contains portfolio, holdings, SIP, net-worth, NPS, and deposit routes ([plugin.ts:27](/work/personal/compass/apps/api/src/modules/investments/plugin.ts:27)).

   Recommended boundary:

   - Keep `getCapitalGains()` in investments.
   - Put `capital_loss_records`, allocation records, service, and routes in tax.
   - Have the tax service consume the investments calculation as one estimate source.
   - Expose `/api/tax/capital-loss-records/...`.

   Investments is mechanically possible, but it conflates an ITR/legal record with the investment ledger. Also, because `investmentsRoutes` is registered without a prefix, routes placed there must declare `/api/...` themselves. The paths shown in [TASK.md:61](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:61) would otherwise be exposed without `/api`.

2. **The generated-column SQL is not correct as written, and the column is redundant.**

   PostgreSQL requires:

   ```sql
   GENERATED ALWAYS AS (is_return_filed) STORED
   ```

   not `GENERATED AS ... STORED`. [PostgreSQL generated-column syntax](https://www.postgresql.org/docs/17/ddl-generated-columns.html).

   With the installed Drizzle 0.45.2 PostgreSQL API, the corresponding declaration is approximately:

   ```ts
   boolean("carry_forward_eligible")
     .notNull()
     .generatedAlwaysAs(sql`"is_return_filed"`)
   ```

   PostgreSQL’s Drizzle builder does not take a `{ mode: "stored" }` argument; stored is the PostgreSQL default emitted by this API.

   Nevertheless, the generated column adds no information and encodes the incorrect legal rule noted above. Prefer storing the actual filing facts and deriving eligibility in the service/query.

3. **The eight-year result is correct only if `expires_fy` is inclusive.**

   A loss arising in FY 2023-24 is first computed for AY 2024-25. Section 74 permits carry-forward through the eight immediately succeeding assessment years—AY 2025-26 through AY 2032-33—which correspond to gain FYs 2024-25 through 2031-32. Therefore `expires_fy = "2031-32"` is correct as the last usable FY, not the first unusable FY. Queries must use `targetFy <= expiresFy`; the first unusable FY is 2032-33.

   The task should state this inclusive convention explicitly and test both FY 2031-32 and FY 2032-33.

4. **The plan lacks essential database invariants.**

   In addition to nonnegative original losses, add checks that:

   - absorbed amounts are nonnegative;
   - absorbed STCL does not exceed the corresponding carryable STCL;
   - absorbed LTCL does not exceed the corresponding carryable LTCL;
   - canonical FY labels are valid;
   - expiry is consistent with origin, if stored rather than derived;
   - an empty zero-loss record is either prohibited or intentionally supported.

   The current proposal allows negative absorbed values and balances below zero.

5. **The implementation must normalize signed statement totals before calling `applySetOff()`.**

   The actual statement does not return separate gain and loss fields. Callers must derive all four nonnegative inputs:

   ```ts
   stcg = Math.max(0, statement.shortTermGainPaise);
   stcl = Math.max(0, -statement.shortTermGainPaise);
   ltcg = Math.max(0, statement.longTermGainPaise);
   ltcl = Math.max(0, -statement.longTermGainPaise);
   ```

   The plan specifies only the loss half. Passing signed statement values directly into an API expecting nonnegative gains would break its arithmetic.

6. **The statutory references need FY-aware updating.**

   Section 70/74 remains the relevant citation for FYs governed by the Income-tax Act, 1961. From 1 April 2026, the Income-tax Act, 2025 governs Tax Year 2026-27 onward, where the corresponding provisions are Sections 108 and 111. The eligibility matrix and eight-year duration remain substantively the same. [Official transition guidance](https://www.incometaxindia.gov.in/documents/20117/43120/FAQs-on-Interplay-and-Transition.pdf/dda21cfd-28be-d931-ad5c-6459ecbd2ea7?download=true&t=1773992684592&version=1.0), [2025 Act Section 111 text](https://www.incometaxindia.gov.in/documents/d/guest/income_tax_act_2025_as_amended_by_fa_act_2026-pdf).

## Low

1. **The root-cause wording is inaccurate.**

   `capital-gains.ts` does not ignore realized losses; it includes negative `gainPaise` in its signed rollups. What it lacks is current-year set-off, carry-forward, expiry, filing eligibility, and tax-rate allocation.

2. **The cited shared-schema file does not exist.**

   Investment contracts currently live in [wealth.ts](/work/personal/compass/packages/shared/src/schemas/wealth.ts), exported through `packages/shared/src/index.ts`. The plan should name that file or intentionally create a new tax-focused schema file and export it.

3. **Plugin-specific route coverage must be updated.**

   [plugin.test.ts](/work/personal/compass/apps/api/src/modules/investments/plugin.test.ts) hardcodes four expected route groups even though the plugin already registers five. Adding another route file without updating this test weakens the intended registration guard. Route-surface snapshots alone do not replace a focused plugin-registration assertion.

No files were modified, and no test suite was run for this read-only review.