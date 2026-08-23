# Review verdict

**Not implementation-ready.** Most review-3 textual contradictions are fixed, and the existing capital-gains/FY infrastructure can support the basic calculation. However, the current plan still has three blockers:

1. carry-forward eligibility does not capture timely filing;
2. “exact” target-FY allocations are not coherently modeled or concurrency-safe across multiple loss records;
3. declaration/upsert concurrency is not protected by the proposed parent-row lock.

## 1. Review-3 findings rechecked against current text

| Review-3 finding | Resolved? | Current-text verification |
|---|---:|---|
| Canonical service section contradicted recorded fixes | **Yes** | The canonical section now consistently calls the order a deterministic, non-statutory policy; removes the old BF materialization step and obsolete fields; uses `setoff_fy`; and distinguishes prior/all allocation scopes ([TASK.md:84](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:84)). |
| No route could set `loss_declared_in_itr` | **No, only partially** | `declareFiledLoss` and `POST .../declare-filed` now exist ([TASK.md:126](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:126)). But the operation is merely described as an upsert refused when allocations exist. It is not specified as a transaction with a parent lock. Moreover, `confirmSetOff` requires only `loss_declared_in_itr`, not `source='user_filed'`, even though the schema permits `source='derived_from_portfolio', loss_declared_in_itr=true`. Thus the requested atomicity and undeclared-source rejection are not guaranteed. |
| Materialization guard was non-atomic | **Yes for the original existing-row confirm race** | It now explicitly starts a transaction, locks the existing row, checks declaration/allocations under the lock, and writes before commit ([TASK.md:120](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:120)). A separate absent-row race remains, discussed below. |
| Three availability meanings were conflated | **Yes** | `advisoryOpening`, `confirmationHeadroom`, and `listAvailability` are now separately defined, including the intended out-of-order behavior ([TASK.md:86](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:86)). |
| Dated simulation conflicted with exact annual allocation | **Textually yes, operationally defective** | The plan chooses a treatment—apply on the first instalment on or after `confirmed_at`, with a limitation note ([TASK.md:114](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:114)). That resolves the omission identified in review-3, but the chosen timestamp is not a valid tax-realization date and normally falls after the relevant FY. |
| Persistence/concurrency tests missing | **Yes** | P7 now lists real-DB concurrent confirmation, materialize-versus-confirm, pure-read row-count, and exact confirmed-allocation tests ([TASK.md:152](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:152)). |
| Estimate/authoritative response contract unspecified | **Mostly yes** | The list, annual, and dated shapes now require `source`/`isEstimate` and the tests cover them ([TASK.md:112](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:112), [TASK.md:134](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:134)). The exact shared Zod shapes remain vague, but the missing semantic fields are now named. |
| Cutoff validation incomplete | **Yes** | It now requires a real ISO date inside the requested FY and includes an outside-FY test ([TASK.md:115](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:115)). |
| Availability formula used obsolete allocation columns | **Yes** | STCL and LTCL usage now use the three destination-breakdown columns ([TASK.md:16](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:16), [TASK.md:88](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:88)). |
| `source` domain unconstrained | **Yes** | The proposed table now has a database `CHECK` restricting it to `derived_from_portfolio` or `user_filed` ([TASK.md:59](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:59)). |

## Codebase assumptions verified

- The expiry calculation is achievable with the existing helpers. `parseFy("2023-24")` returns `2023`; adding eight gives `2031`, and `fyOf("2031-04-01")` produces `2031-32` ([financial-year.ts:23](/work/personal/compass/apps/api/src/lib/financial-year.ts:23), [financial-year.ts:53](/work/personal/compass/apps/api/src/lib/financial-year.ts:53)). There is no dedicated `formatFy(startYear)` helper, so the implementation should either use `fyOf` as above or add a tested pure formatter.

- The capital-gains service returns the assumed signed net totals, specifically `shortTermGainPaise` and `longTermGainPaise`, and retains signed dated slices ([capital-gains.ts:29](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:29), [capital-gains.ts:135](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:135)). The planned normalization is valid, although the plan should name the real properties instead of abstract `st`/`lg`. The statement does not return separate gross gain and loss totals or rate buckets.

- Neither [tax/schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:1) nor [db/schema.ts](/work/personal/compass/apps/api/src/db/schema.ts:1) currently defines `capital_loss_records`, `capital_loss_allocations`, `capitalLossRecords`, or `capitalLossAllocations`. There is no naming collision.

- Tax routes are registered under `/api/tax`, and each route plugin is registered without another prefix inside `taxRoutes` ([plugin.ts:5](/work/personal/compass/apps/api/src/modules/tax/plugin.ts:5), [app.ts:155](/work/personal/compass/apps/api/src/app.ts:155)). The task’s relative `/capital-loss-records/...` paths and planned tax-plugin registration follow convention.

## High findings

### H1 — Carry-forward eligibility is still legally incomplete

`loss_declared_in_itr=true` proves neither that the loss return was timely nor that the loss was determined pursuant to the qualifying return. Under the 1961 Act, Section 139(3) requires the loss return within the Section 139(1) time, and Section 80 prevents carry-forward unless the loss was determined pursuant to that return. The current Income-tax Act, 2025 preserves the same concept by tying carry-forward to a return under its filing provision. [Official Section 139](https://www.incometaxindia.gov.in/w/section-139-12), [official Section 80](https://www.incometaxindia.gov.in/w/section-80-59), [official Income-tax Act, 2025](https://incometaxindia.gov.in/Documents/Act/Income-tax-Act-2025.pdf).

This task’s objective expressly includes a “filing-eligibility gate,” but the gate now tests only:

```text
loss_declared_in_itr && source == user_filed
```

That would treat a loss declared in a belated return as eligible.

The schema/route must record an explicit assertion such as `filed_within_due_date`, `carry_forward_eligible`, or a richer filed-return status. Eligibility should require both the filed loss balance and the applicable timely-return assertion.

### H2 — “Exact confirmed target-FY allocation” is not a defined algorithm

The annual algorithm says:

1. simulate every eligible BF record using `advisoryOpening`;
2. if an allocation exists for the target FY, apply it exactly and do not re-simulate ([TASK.md:107](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:107)).

Those instructions do not define:

- whether records with exact allocations are skipped during step 3;
- whether exact allocations are applied before simulations for other records;
- whether one confirmed record makes the target FY final, or only that record;
- how a mixture of exact and advisory records should be labeled;
- what happens when exact destination amounts exceed the gains visible in Compass.

This needs a target-FY filing/allocation aggregate, not merely independent `(loss_record_id, setoff_fy)` rows. Ideally, confirmation finalizes an ITR-level allocation batch for one user/FY containing all record breakdowns. Otherwise the annual service cannot know whether it is reading a complete filed result or a partial collection of confirmed rows.

### H3 — The parent lock protects source balances, but not target-gain conservation

For a single existing loss record, `SELECT ... FOR UPDATE` followed by `SUM(all allocations)` correctly serializes source-side STCL/LTCL headroom. Thus the three availability formulas themselves are implementable.

It does not protect a target-FY invariant across different records. Two transactions can lock different loss-record parents and concurrently insert allocations that both consume the same target STCG/LTCG. For example, two records can each confirm `stcl_to_stcg=₹100` against only ₹100 of target STCG. Neither sees or blocks the other.

If destination breakdowns are intended to be exact filed facts, use a user/FY allocation parent or a transaction-level advisory lock keyed by `(userId, setoffFy)`, and validate aggregate destination totals under that lock. If external/unmodeled gains mean target totals cannot be validated, the response must not subtract those rows blindly from the portfolio statement; it should expose a reconciliation limitation instead.

### H4 — Declaration and absent-row upserts still have uncovered races

PostgreSQL cannot row-lock a row that does not exist. Therefore:

- `materializeCurrentFy` and `declareFiledLoss` can both find no row;
- both pass their guards;
- both attempt the same unique `(user_id, origin_fy)` upsert;
- the later conflict update can overwrite the filed fact with a derived estimate, or vice versa.

For an existing record, `declareFiledLoss` is also not required to lock the parent before checking allocations. A concurrent `confirmSetOff` can insert after declaration checks and before it changes balances.

All three mutation paths—materialize, declare, confirm—must share one serialization strategy. Options include a transaction advisory lock keyed by `(userId, originFy)`, a pre-existing user/FY parent row, or carefully specified conditional insert/upsert behavior followed by a locked re-read. Merely saying “SELECT existing row FOR UPDATE” is insufficient for the absent-row case.

## Medium findings

### M1 — `confirmed_at` is not a defensible as-of allocation date

Users will normally confirm an ITR allocation after the financial year ends. Consequently, “first instalment on or after `confirmed_at`” will often identify no instalment in `setoff_fy`. It also makes historical advance-tax results depend on when data happened to be entered into Compass.

The dated service should either:

- remain an advisory simulation from slices at every cutoff and reserve exact allocations for annual results; or
- store a separately asserted effective/as-of date with clear tax semantics.

`confirmed_at` should remain an audit timestamp, not a realization date.

### M2 — Confirmation validates loss sources but not the claimed filed allocation

`confirmSetOff` validates nonnegative source headroom, but does not require:

- a nonzero total;
- destination amounts to fit target gains;
- aggregate target-FY consistency;
- the allocation breakdown to correspond to a complete finalized ITR result.

An all-zero confirmation is especially problematic: it consumes the unique `(loss_record_id, setoff_fy)` key while recording no set-off, and there is no update/delete/correction operation. Specify whether confirmations are immutable, replaceable, or reversible, and reject meaningless zero rows if they are immutable.

### M3 — The lifecycle columns permit contradictory states

The database permits all four combinations of:

- `source = derived_from_portfolio | user_filed`
- `loss_declared_in_itr = false | true`

Yet BFLA queries require both filed values while `confirmSetOff` requires only the boolean. Add a database check tying the states together, or replace them with one lifecycle enum. At minimum, confirmation must explicitly require both `source='user_filed'` and the filing-eligibility state.

### M4 — “Current FY” materialization accepts an arbitrary `fy`

The endpoint takes `?fy=` but the operation is named `materializeCurrentFy` and described as deriving the current-FY residual ([TASK.md:120](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:120), [TASK.md:135](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:135)). The plan never says whether past or future FYs are allowed.

Either enforce `fy === currentFy()` or rename it to historical materialization and specify its valuation/as-of behavior. Future FYs should not create empty derived records.

### M5 — Functional-core separation is not planned strongly enough

P3 places pure allocation/date logic and DB orchestration together in `services/capital-loss.ts` ([TASK.md:148](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:148)). It also repeatedly calls DB-reading functions “PURE,” which is inaccurate.

Per [tasks/TDD.md:28](/work/personal/compass/tasks/TDD.md:28), allocation, availability, expiry, and application of exact breakdowns should live in a DB-free module such as `capital-loss-math.ts`. A service shell should load rows and slices, invoke the core, and persist within transactions. “Pure read” should be renamed “read-only.”

### M6 — Safe integer contracts are under-specified

All amounts are correctly described as integer paise, and `consume` rejects unsafe inputs. But P2 does not explicitly require every request/response paise field to be a safe integer. With Drizzle `bigint(..., { mode: "number" })`, values outside JavaScript’s safe range cannot be represented reliably.

Shared contracts should use `z.number().int().safe()` plus nonnegative constraints where applicable. SQL `SUM(bigint)` also returns `numeric` in PostgreSQL, so aggregate reads must be deliberately cast/decoded and safe-range checked.

### M7 — Acceptance criteria violate the task-board TDD structure

The acceptance criteria are written as plain `- AC1:` bullets, not unchecked `- [ ]` items ([TASK.md:154](/work/personal/compass/tasks/097-loss-carryforward/TASK.md:154)). That conflicts with [tasks/TDD.md:14](/work/personal/compass/tasks/TDD.md:14), where every unchecked criterion is the test-driven unit of work and is ticked only after its test passes.

Convert every AC to a checkbox and ensure each behavioral AC maps to an observed-failing test before implementation.

## Low findings

### L1 — Zero-loss records are unspecified

Both materialization and declaration can apparently create `(stcl=0, ltcl=0)` records. Specify whether those are omitted/deleted or intentionally retained. Otherwise the list and expiring-loss views accumulate meaningless records.

### L2 — FY storage needs explicit validation boundaries

Canonical labels compare lexicographically only because they have a fixed `YYYY-YY` format. Every stored `origin_fy`, `expires_fy`, and `setoff_fy` must pass `parseFy`. Deriving `expires_fy` also needs a defined response for start years above 9991, because `start+8` can no longer fit the four-digit format.

### L3 — Response contracts remain less exact than the persistence contract

`perRecordSource` and `broughtForwardSummary` are names, not defined shared Zod structures. P2 should enumerate the exact list, annual, dated, limitation, and per-record allocation fields. In particular, `isEstimate` needs defined semantics for mixed exact/advisory output.

## Missing tests beyond P7

Add at least:

- real-DB `declareFiledLoss` versus `confirmSetOff` race;
- real-DB declaration versus materialization for both existing and initially absent rows;
- concurrent confirmations on different records for the same target FY;
- exact-allocation destination conservation across multiple records;
- mixed exact and advisory target-FY behavior;
- timely versus belated filed-return eligibility;
- `source`/eligibility invalid-state database checks;
- duplicate and all-zero confirmation behavior;
- rollback if allocation insertion or `updatedAt` touch fails;
- malformed FY labels on every route, not only wrong FY ordering;
- exact FY start/end cutoff dates, impossible dates, and leap-day validation;
- historical confirmation where `confirmed_at` is after every target-FY instalment;
- no-gain, no-loss, only-STCL, only-LTCL, and both-loss-pool cases;
- safe-integer boundaries and aggregate overflow handling;
- zero-loss materialization/declaration behavior;
- cross-user isolation for list, summary, simulation, declaration, and materialization—not only confirmation;
- database cascade, uniqueness, backup/restore, barrel identity, decomposition count, and route-registration coverage.

## Unnecessary complexity

The three availability scopes are justified; they encode genuinely different questions. The unnecessary complexity lies elsewhere:

- `source` plus a loosely related boolean creates invalid lifecycle combinations; one constrained status is simpler.
- `perRecordSource` in the annual BFLA result is nearly redundant because step 2 admits only `source='user_filed'`.
- `expires_fy` is derivable from `origin_fy`. Keeping it for query convenience is reasonable, but it needs a strong consistency invariant rather than service convention alone.
- Applying annual confirmed facts according to `confirmed_at` introduces temporal machinery without a valid domain date.
- `notes` is proposed in the table but has no route or contract behavior.

## Repository-convention assessment

- **Integer paise:** Units are correct, but safe-number Zod/Drizzle handling must be made explicit.
- **Functional core:** Not yet compliant; DB-free calculation/date/allocation logic should be extracted from the DB service.
- **Real-DB tests:** P7 now correctly asks for real concurrency tests and does not propose mocking Drizzle. Additional mutation races remain untested.
- **Module schema boundary:** Correct. The new resident tables belong in `modules/tax/schema.ts`; that file may import `users` from `db/core-schema.ts` and must not import another module’s `schema.ts`. Runtime use of the investments capital-gains service is allowed. The central `db/schema.ts` should only re-export the new residents.
- **Plugin convention:** Correct—add a capital-loss route plugin to `taxRoutes`, with paths relative to `/api/tax`.
- **Backup/decomposition:** P5 correctly assigns the parent to `ALL_TABLES`/`USER_TABLES`, the child to `ALL_TABLES`/`LINKED_TABLES`, and calls for the barrel/decomposition updates.

## Required changes before implementation

1. Model timely filed-return eligibility, not declaration alone.
2. Define exact target-FY semantics—preferably an atomic user/FY finalized allocation batch—and specify how exact and advisory records interact.
3. Serialize destination totals across records, or explicitly stop treating destination breakdowns as validated deductions from the portfolio statement.
4. Give materialization, declaration, and confirmation one shared concurrency strategy that also protects absent rows.
5. Replace the `confirmed_at` instalment rule with a defensible dated policy.
6. Constrain lifecycle states and require both filed source and eligibility in confirmation.
7. Extract a DB-free functional core and specify safe-integer shared contracts.
8. Convert acceptance criteria to TDD checkboxes and add the missing race, legal-eligibility, exact-allocation, and boundary tests above.

**Explicit verdict: not implementation-ready.**