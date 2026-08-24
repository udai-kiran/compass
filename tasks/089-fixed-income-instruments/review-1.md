The plan is not implementation-ready. Its biggest gaps are the absence of an FD/RD/NSC discriminator, an insufficient RD model, and underspecified financial math. The accrual schedule should be computed, not persisted.

## High severity

### 1. The model cannot distinguish FD, RD, and NSC

`deposit_details` has no instrument-kind column. The only proposed discriminator is `isTaxSaver`, which distinguishes ordinary and tax-saver FD but says nothing about RD or NSC.

This cannot be inferred from `holdings.assetClass`: the enum contains `fd` but not `rd`, `nsc`, or `tax_saver_fd` ([spines.ts](/work/personal/compass/apps/api/src/db/shared/spines.ts:26)). The shared `AssetClassSchema` has the same limitation, while the separate planning/instrument-rule vocabulary contains all four categories. Consequently P5 cannot know which algorithm to execute, and downstream consumers cannot reliably select NSC or RD holdings.

The plan must choose and document one model:

- Prefer a required `depositKind: "fd" | "rd" | "nsc" | "tax_saver_fd"` while retaining `holdings.assetClass = "fd"` as the existing broad fixed-deposit/fixed-income bucket.
- Alternatively expand `assetClass`, but that has a much larger regression surface across shared schemas, portfolio allocation, return assumptions, event validation, imports, and UI.

If `depositKind` is added, `isTaxSaver` becomes redundant and should be derived from `depositKind === "tax_saver_fd"` rather than allowing contradictory combinations.

### 2. The proposed columns cannot model an RD

`principalPaise` is meaningful for a lump-sum FD or NSC certificate, but an RD requires at least the installment amount and installment schedule. P5’s “monthly deposit + interest compounding” cannot be calculated from the proposed data.

The plan must define:

- `installmentPaise` for RD, distinct from opening principal.
- First installment date and whether the start date includes the first installment.
- Number of installments or an exact derivation from dates.
- Deposit timing relative to interest calculation.
- Treatment of missed, late, or additional installments, or explicitly declare that only perfectly regular contractual schedules are projected.
- Whether historical installments are contractual projections or actual cash flows.

Without this, the 12-installment verification fixture can be made to pass with arbitrary assumptions while producing the wrong maturity value for real products.

### 3. The financial calculation specification is inadequate

“Compound interest formula,” “paise precision,” and “day-count convention explicit” do not specify an implementable algorithm ([TASK.md](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:45)). The plan needs to fix:

- The actual day-count convention, such as Actual/365 Fixed, Actual/Actual, or product-configurable—not merely promise that one will be explicit later.
- Whether regular monthly/quarterly periods use a nominal periodic rate and day count is used only for stub periods.
- Start-date inclusion, maturity-date inclusion, and treatment of partial first/last periods.
- End-of-month rolling: January 31 plus one month, February maturity, leap day, and weekends/holidays.
- Rounding rule and point of rounding: each accrual, each payout, or only maturity.
- Whether the rate is nominal or effective annual.
- The relationship between compounding and payouts. A monthly payout FD ordinarily does not compound the paid interest into principal, so applying one compound-interest formula to every payout mode is wrong.
- Schedule row semantics: opening balance, contribution, gross interest, payout/reinvestment, closing balance, taxable interest, and maturity amount.
- Safe arithmetic. “Integer paise throughout” does not prevent intermediate floating-point errors; use rational/integer arithmetic with an explicit rounding function.

This is financial correctness, not merely missing test detail.

### 4. Ownership and subtype authorization are not specified

The existing subtype service first loads the holding by both `holdingId` and `userId` and verifies its asset class before reading or writing details ([holding-details.ts](/work/personal/compass/apps/api/src/modules/investments/services/holding-details.ts:35)). The new service plan only says “CRUD.”

The deposit service must similarly:

- Resolve the parent with both ID and authenticated `userId`.
- Return 404 for another user’s holding without revealing its existence.
- Reject non-deposit parent holdings.
- Include `userId` in detail-row reads, not merely trust the globally unique holding ID.
- Prevent or handle changing a holding’s asset class after deposit details exist.
- Ensure the stored detail `userId` cannot disagree with the parent holding’s owner.

The proposed independent FKs to `holdings.id` and `users.id` do not enforce that both rows belong to the same user. A service bug, import, or restore could create inconsistent ownership. At minimum, add integration tests for that invariant; stronger database enforcement would require a composite parent key/FK or removing the redundant `userId`.

### 5. AC4 claims TDS is recorded, but the design does not record it

`tdsSectionApplies` is only an applicability flag. It does not record TDS deducted, its date, certificate/reference, gross interest, or net interest. This directly conflicts with AC4’s “bank TDS on interest recorded,” while the non-goals say TDS computation and ledger linkage are deferred ([TASK.md](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:71), [TASK.md](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:87)).

Resolve the contradiction:

- For this task, rename/reword the criterion to “TDS applicability captured” and leave actual deductions to 13.4/13.10.
- Or add a separate actual TDS/accrual record model, which materially expands scope.

A boolean is also too coarse for declarations, thresholds aggregated by bank, senior-citizen treatment, and changes over time. Those should not be silently treated as part of the accrual calculator.

## Medium severity

### 6. `deposit_details` should be a `USER_TABLE` as currently designed

The plan is internally contradictory: the table includes `userId`, but AC7 mentions both `USER_TABLES` and “`LINKED_TABLES` — scoped via holdingId” ([TASK.md](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:27), [TASK.md](/work/personal/compass/tasks/089-fixed-income-instruments/TASK.md:74)).

Under the current backup convention:

- Tables carrying `user_id` belong in `USER_TABLES`.
- `LINKED_TABLES` is specifically for children with no `user_id` ([backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:52), [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:79)).
- Existing holding subtypes `nps_details` and `gold_details` contain `userId` and are `USER_TABLES` ([schema.ts](/work/personal/compass/apps/api/src/modules/investments/schema.ts:61), [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:67)).
- A table must not appear in both arrays; an existing test enforces that.

Therefore `deposit_details` should be added to `ALL_TABLES` immediately after `holdings` and to `USER_TABLES`. If the design instead removes `userId`, then and only then should it be a `LINKED_TABLE` with `{ fk: "holding_id", parent: "holdings" }`.

Placement after `holdings` matters for full and per-user restore FK order.

### 7. The accrual schedule should be computed on demand

The plan does not propose a schedule table, which is the correct direction, but it should explicitly state this decision.

A projected schedule is a deterministic derivative of terms. Persisting it would create invalidation and consistency problems whenever the rate, dates, contribution, frequency, or rounding convention changes. Compute it in a pure DB-free module and expose it through a response schema or dedicated endpoint.

Persist only actual facts—credited interest, payouts, TDS, or ledger entries—when those later enter scope. If performance eventually requires caching, make the cache versioned by calculation convention and invalidated from all input changes.

The API plan currently names only GET/PUT detail routes, so it is unclear how consumers obtain the generated schedule. Define whether GET embeds it or add an explicit schedule endpoint and shared response contract.

### 8. The frequency enums conflate different concepts

The compounding enum covers common monthly, quarterly, half-yearly, and annual products, but it is not sufficient as a general contract:

- It lacks `none`/`simple`, which may be needed for non-compounding or simple-interest products.
- It lacks daily compounding if the scope intends to represent arbitrary bank products.
- Product restrictions are unspecified: NSC should be annual and cumulative; RD generally has fixed product rules rather than arbitrary payout choices.

More importantly, `cumulative` is not a payout frequency. Separate:

- `interestDisposition: "reinvest" | "payout"`
- `payoutFrequency: "monthly" | "quarterly" | "half_yearly" | "annually" | "at_maturity" | null`

Then enforce compatible combinations. If the project deliberately supports only a constrained product subset, document and validate that subset rather than accepting nonsensical combinations.

### 9. Tax-saver and NSC invariants are not enforced

The plan says tax-saver deposits are “flagged distinctly,” but does not require:

- A five-year term.
- No premature closure or auto-renewal combinations that conflict with the intended rules.
- FD-only applicability.
- Consistency with the `tax_saver_fd` instrument-rule category.
- NSC’s annual reinvested taxable-interest schedule and maturity-only payout.

The instrument-rule registry existing is not enough: no proposed field links a holding/detail row to its `InstrumentCategory`. Its rules will not automatically govern the new service.

### 10. Auto-renewal and premature-closure fields are oversimplified

A boolean does not fully capture an auto-renewal instruction. Commonly relevant distinctions include principal-only versus principal-plus-interest renewal and the renewal tenure. If those are intentionally deferred, rename the field/criterion to reflect the limited “enabled” flag.

Likewise, a premature-closure penalty is not always simply booked rate minus `penaltyBps`; banks may apply the rate applicable to the actual completed tenure and then subtract a penalty. The schedule should not claim to calculate an early-closure amount from this field unless the exact rule is modelled. Store it as advisory metadata if rebalancing only needs awareness.

### 11. Holder modelling is incomplete and inconsistent with the existing person model

The objective asks for a holder, but the table only provides one free-text `jointHolder`; it does not identify the primary holder and cannot represent multiple joint holders. The codebase already has `family_members`, which is used by other typed records.

The plan should decide whether this task needs:

- Primary holder plus zero or more joint holders.
- A `familyMemberId` relationship with an optional display fallback.
- Holding mode/order, if relevant.

At minimum, bound and normalize the text field. Holder names are PII and must remain covered by authenticated access, encrypted backups, and no logging.

### 12. Missing database and contract validation

The plan lists columns but no constraints. Required validation includes:

- `principalPaise > 0`; `installmentPaise > 0` for RD.
- `0 <= annualRateBps <= 10000`, consistent with retirement upserts.
- Non-negative penalty, with a defined maximum.
- `maturityDate > startDate`.
- Valid kind-specific frequency and payout combinations.
- Tax-saver five-year term and FD-only restriction.
- Nullable fields rejected where inapplicable.
- Reasonable text lengths.
- Cascade deletion through the parent holding.

Use shared Zod cross-field validation plus database checks for invariants that must survive imports/restores.

### 13. No lifecycle rule for changing or deleting the parent holding

Existing holding updates permit changing `assetClass`. The plan does not say what happens when an FD with deposit details is changed to stock, mutual fund, or another incompatible class.

Choose one:

- Reject incompatible asset-class changes while details exist.
- Delete details transactionally after explicit confirmation.
- Preserve but hide them, which is least desirable because stale financial data remains.

This needs a service integration test, not only calculator unit tests.

### 14. `annualRateBps` complements rather than conflicts with `retirementDetails.annualRateBps`

There is no storage conflict: `retirement_details` is keyed by `accountId`, while `deposit_details` would be keyed by `holdingId`. Both represent the contractual rate of different domain entities. The shared retirement contract already uses basis points and caps writes at 100% ([wealth.ts](/work/personal/compass/packages/shared/src/schemas/wealth.ts:34)).

The new schema should reuse the same unit, bounds, comments, and rounding semantics. It should not reuse the retirement table or treat PPF/EPF/SSY as holdings—the holdings schema explicitly says those are accounts, not holdings ([spines.ts](/work/personal/compass/apps/api/src/db/shared/spines.ts:21)).

Potential confusion is semantic, not a naming collision: clearly document that the deposit rate is issue-specific and fixed for that holding, whereas retirement-account rates may be updated over time.

### 15. Downstream exposure is not actually specified

AC5 says maturity and break penalty are “exposed,” but GET/PUT per holding is not enough to define how maturity calendar and rebalancing will consume them efficiently. The plan should specify exported response schemas and either:

- A portfolio/deposit listing query suitable for downstream consumers, or
- A clear future service interface that returns all user deposit maturities without N+1 GETs.

Similarly, “for 13.7” is not satisfied merely by storing `isTaxSaver`; deduction logic needs a stable discriminator and contribution amount/date semantics.

## Low severity

### 16. Required regression tests and repository bookkeeping are missing

Beyond the three example schedules, the plan should include:

- Shared schema tests for defaults, bounds, invalid cross-field combinations, and response serialization.
- Real-database service tests for ownership isolation, incompatible parent class, upsert behavior, cascade deletion, duplicate prevention, and no writes on rejected requests.
- Backup tests proving the new table is included, exported only for its owner, restored after `holdings`, and absent from `exportGaps()`.
- Schema decomposition and investments schema smoke-test updates; these tests hard-code resident tables/enums.
- Investments plugin test updates—the current test explicitly expects exactly four route files.
- Global route-surface/route-table snapshot updates if a new route file adds endpoints.
- Holding asset-class change characterization.
- Arithmetic property tests: non-negative balances, maturity reconciliation, sum of contributions plus interest minus payouts equals closing balance, deterministic rounding, and no paise creation/loss.
- Month-end, leap-year, partial-period, zero-rate, one-paise, large-safe-integer, and invalid-date cases.
- Payout FD tests showing paid interest is not reinvested.
- Tax-saver and NSC rule-invariant tests.
- RD first/last installment timing tests.

### 17. The task’s TDD format does not follow the repository workflow

`tasks/TDD.md` says acceptance criteria should be unchecked checklist items, written as failing tests and checked only after passing. This task’s ACs are plain bullets, so it cannot follow the prescribed status workflow as written.

### 18. The route/file plan departs from the nearby subtype convention without justification

Existing NPS and gold holding-detail routes are in `routes/holdings.ts`, backed by `services/holding-details.ts`. A dedicated deposit route/service is defensible because accrual math is larger, but registering another top-level route plugin introduces additional plugin-test and snapshot maintenance. The plan should state why it is separate or keep detail CRUD with the existing holding-detail route group and place only the pure calculator in its own module.

### 19. Several plan descriptions are inaccurate or ambiguous

- `apps/api/src/modules/investments/schema.ts` and `packages/shared/src/schemas/wealth.ts` are listed under “New files,” but both already exist.
- P3 calls the API “CRUD,” while P6 specifies only GET/PUT; deletion behavior is unstated.
- “Principal” is ambiguous for RD.
- “Holder” is claimed by AC1 but only a joint-holder name is proposed.
- The existing instrument rules being present does not mean the new persistent model is connected to them.
- `tdsSectionApplies` is a misleading name: section 194A applicability is not equivalent to TDS actually being deducted.

Overall, the plan should first settle the domain contract—instrument kind, RD installment model, payout versus reinvestment semantics, exact day-count and rounding rules—then define schemas, pure schedule output, ownership behavior, and database constraints around that contract.