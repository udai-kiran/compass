## Verdict

The revision resolves most of the original 11 findings, and P0’s rounding location is fundamentally correct. However, the plan is not yet fully sound. Two material contradictions remain:

1. P6/AC5 promises “real service output” for DB-backed services without providing a database or mock DB strategy.
2. T5 incorrectly says removing `.int()` will make the runtime test fail. Once P0 makes real output integral, removing `.int()` will not make a positive `safeParse` test fail.

There are also smaller corrections needed around P0’s downstream effect, runtime date validation, and test baseline wording.

## 1. P0 rounding strategy

### The proposed location is correct

Rounding only at the exported `GlideStep` boundary is the right design:

```ts
projectedCorpusPaise: Math.round(corpusAtStepStart)
```

The internal projection should retain full precision at [goal-plan.ts:171](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:171). Rounding `corpusAtStep` after each band would compound rounding error through later bands.

The current flow is:

- Compute `requiredMonthlyPaise` from full-precision `corpusAtStep` at [goal-plan.ts:155](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:155).
- Snapshot it at [goal-plan.ts:160](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:160).
- Report the snapshot at [goal-plan.ts:166](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:166).
- Continue compounding the unrounded internal value at lines 171–173.

That preserves projection accuracy while enforcing integer paise at the response boundary.

### `requiredMonthlyPaise` is already integral

`computeRequiredMonthlyPaise` returns:

```ts
Math.max(0, Math.ceil((target - corpusFV) / factor))
```

at [goal-plan.ts:85](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:85). Its early returns are also integer zero at lines 80 and 83. No additional rounding is required.

### Minor reported-field inconsistency is possible but acceptable

`requiredMonthlyPaise` is calculated from the unrounded internal corpus, while `projectedCorpusPaise` will expose its rounded representation. A consumer independently recomputing the requirement from the reported corpus could theoretically differ by one paise near a `Math.ceil` boundary.

That does not make the strategy wrong: the exported corpus is necessarily a minor-unit approximation, while the requirement uses the more accurate projection state. The plan should explicitly document this rather than claiming the fields are derived from exactly the same exposed value.

### There is a downstream consumer

P0 does not affect only passive reporting. `buildRebalancingPlan` consumes `next.projectedCorpusPaise` at [rebalancing-plan.ts:197](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:197) and computes:

```ts
Math.round((next.projectedCorpusPaise * equityChangePct) / 100)
```

at lines 203–205.

Rounding `projectedCorpusPaise` first can therefore change `DeRiskingEvent.equityToSwitchPaise`, normally by at most one paise. The forward glide-path projection remains unchanged, but AC11’s “changes only the reported value” is too broad if it implies that downstream outputs cannot change.

### Other `goal-plan.ts` paise outputs

Within `GlideStep`, the only paise fields are:

- `requiredMonthlyPaise` — already integral.
- `projectedCorpusPaise` — currently fractional after the first band.

`targetAllocation` at [goal-plan.ts:210](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:210) returns only percentages.

`buildGoalPlan` returns several paise fields at lines 291–305. Its derived split uses `Math.round` for equity and subtraction for debt at lines 272–275. Gap and total fields are arithmetic over input paise. They remain integral provided the service inputs obey the existing integer-paise invariant. No new internally generated fractional paise field was found there.

## 2. Existing test impact

### `goal-plan.test.ts`

No existing assertion depends on a fractional `projectedCorpusPaise` value.

The glide-path assertions at [goal-plan.test.ts:211](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.test.ts:211) through line 310 check:

- Empty schedules.
- Step counts.
- Allocation percentages.
- Remaining months.
- Dates.
- Null, positive, or zero `requiredMonthlyPaise`.

There is no assertion on `projectedCorpusPaise`. Therefore, no existing assertion in this file needs updating.

The closest relevant assertions are:

```ts
assert.ok(steps[0]!.requiredMonthlyPaise !== null);
assert.ok(steps[0]!.requiredMonthlyPaise! > 0);
```

at lines 294–295, and:

```ts
assert.equal(steps[0]!.requiredMonthlyPaise, 0);
```

at line 309. P0 does not alter these first-step results because the first internal corpus equals the integer `fundedPaise`.

No documented invariant currently protected by this test file is broken. A new test should be added asserting `Number.isInteger(step.projectedCorpusPaise)` for every step in a nontrivial schedule.

### Other consumers and tests

The only other production consumer found is `buildRebalancingPlan`, described above.

`rebalancing-plan.test.ts` calls `buildGlidePathSchedule` at lines 146 and 159. Those results feed rebalancing-plan construction, so the tests should be run because `equityToSwitchPaise` can change by one paise. There is no direct fractional-corpus assertion, but exact `DeRiskingEvent` assertions may be indirectly affected.

The plan’s Scope currently says `goal-plan.test.ts` may be updated, but AC9 permits only `goal-plan.ts` “(+ its test if needed)” among existing service files. If an exact assertion in `rebalancing-plan.test.ts` changes, the plan currently forbids updating it. The likely outcome is that no assertion changes, but the scope should acknowledge this possible one-paise downstream effect.

## 3. Export inventory

For the seven response contracts, the revised list is complete.

### Income surplus

Service types at [income-surplus.ts:7](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:7):

- `MonthlyIncome`
- `CommittedOutflow`
- `IncomeSurplusResult`

`IncomeSurplusComputation` at line 48 is a pure-helper input, not part of the response.

### Data completeness

At [data-completeness.ts:28](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:28):

- `AccountReadiness`
- `DataCompletenessReport`

### Multi-goal allocation

At [multi-goal-allocation.ts:13](/home/udai/common/compass/apps/api/src/modules/planning/services/multi-goal-allocation.ts:13):

- `GoalAllocationResult`
- `MultiGoalAllocationPlan`

`GoalAllocationEntry` is an input and is correctly excluded.

### Glide path

At [goal-plan.ts:10](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:10):

- `GlideStep`
- `GlideStep[]`, represented by `GlidePathScheduleSchema`

`GlidePathInput` is correctly excluded.

### Rebalancing plan

At [rebalancing-plan.ts:8](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:8):

- `DriftAnalysis`
- `ContributionRedirectionAction`
- `CorpusSwitchAction`
- `RebalancingAction`
- `DeRiskingEvent`
- `RebalancingPlan`

`RebalancingPlanInput` is correctly excluded.

### Instrument guidance

At [instrument-guidance.ts:13](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:13):

- `InstrumentCategory`
- `AllocationLeg`
- `SuitabilityTier`
- `InstrumentSuggestion`
- `InstrumentGuidance`

### Revolving debt

At [revolving-debt.ts:9](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:9):

- `PaymentState`
- `StatementPaymentStatus`
- `CardRevolvingStatus`
- `HouseholdRevolvingDebt`

No listed schema/type name currently exists under `packages/shared/src`, so no collision was found.

One terminology issue remains: the Scope labels both `GlideStepSchema` and `GlidePathScheduleSchema` as “Top-level.” `GlideStep` is the nested item type and the schedule array is the response contract. This is harmless operationally but should be worded accurately.

## 4. P5 parity idiom

The proposed helper catches the required distinction:

```ts
type Equal<A, B> =
  [A] extends [B]
    ? ([B] extends [A] ? true : false)
    : false;
```

For:

```ts
{ x?: number }
```

versus:

```ts
{ x: number | null }
```

mutual assignability fails because an optional property does not satisfy a required property, and `null` does not satisfy `number | undefined`. Thus the helper detects optional-versus-required-nullable drift.

It is not a universally perfect type-identity operator—`any`, overloads, and some intersection/union normalization cases can defeat mutual-assignability tests—but none of the seven service return types contains those pathological forms. It is sufficient here.

`z.output<typeof Schema>` is correct. It explicitly compares the schema’s post-parse response type. `z.infer` would currently be equivalent for schemas without transforms, but `z.output` expresses the intended contract more clearly.

The `_` prefix is valid. [eslint.config.js:12](/home/udai/common/compass/eslint.config.js:12) configures:

```ts
{ argsIgnorePattern: "^_", varsIgnorePattern: "^_" }
```

so `_IncomeSurplusParity` and similar aliases satisfy the unused-variable rule.

## 5. P6 feasibility

As written, P6 overpromises. Without a database or a deliberately implemented DB mock, the three DB-backed functions cannot all be called to produce “real output from the actual service.”

### `IncomeSurplusResult`

A workable DB-free test can use `computeIncomeSurplus` at [income-surplus.ts:65](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:65), then reconstruct exactly what the DB wrapper returns:

```ts
const input = { months, committedOutflows };
const result = {
  ...input,
  ...computeIncomeSurplus(input),
} satisfies IncomeSurplusResult;
```

This exercises the actual pure calculation and realistic nested values. It is service-derived output, though not output from calling `getIncomeSurplus`.

### `DataCompletenessReport`

`computeConfidence` at [data-completeness.ts:78](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:78) returns only:

- `confidence`
- `confidenceReasons`

It does not assemble `AccountReadiness`, dates, counts, or the complete report. A DB-free test must hand-construct realistic accounts and report fields, using `computeConfidence` for the two derived fields:

```ts
const result = {
  asOf,
  accounts,
  unresolvedDraftCount,
  lastSnapshotAt,
  lastSnapshotDaysAgo,
  ...computeConfidence({ accounts, unresolvedDraftCount, lastSnapshotDaysAgo }),
} satisfies DataCompletenessReport;
```

This is a realistic typed fixture partially produced by real service logic, but it is not actual output from `getDataCompletenessReport`.

Calling the full function would require either PostgreSQL or a fairly involved mock of several different Drizzle query chains.

### `HouseholdRevolvingDebt`

The pure helpers at [revolving-debt.ts:62](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:62) and line 79 can construct a realistic statement:

- `derivePaymentState`
- `estimateMonthlyCharge`

The test can then assemble a card and household aggregate using those actual helper results and `satisfies HouseholdRevolvingDebt`.

Again, this validates a realistic service-shaped fixture with real domain calculations, but not output from calling `getHouseholdRevolvingDebt`.

The full DB function uses both Drizzle query builders and raw `db.execute` at [revolving-debt.ts:89](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:89), making a faithful mock possible but disproportionate for a schema task.

### Required plan correction

P6 and AC5 should distinguish:

- Four pure contracts: parse actual outputs returned by their real service functions.
- Three DB-backed contracts: parse realistic typed fixtures assembled with the exported pure helpers wherever possible.

If literal full-service output is required, the task must add a `DATABASE_URL`-gated integration test or a substantial fake `Db`. The current plan promises neither.

## 6. AC/T coherence

Most criteria are checkable, but the following need correction.

### AC11 is only partly verifiable

It is easy to verify that lines 171–173 remain unchanged and that rounding happens only in the `steps.push` object. That proves the internal forward chain retains full precision.

It is not accurate to claim that only the reported value can change globally, because rebalancing consumes that reported value at [rebalancing-plan.ts:204](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:204). AC11 should say:

> P0 does not round or otherwise modify the internal forward projection chain; it rounds only when materializing each `GlideStep.projectedCorpusPaise`. Any downstream output derived from that public field is reverified.

### AC5 conflicts with P6 feasibility

“Actual service output” is not achievable for all three DB-backed services under the currently stated environment and scope. Revise as described above.

### T5 is technically wrong

T5 says:

> remove an `.int()` → typecheck still passes, but the P6 runtime test must fail.

Removing `.int()` makes a schema less restrictive. A positive test parsing integral service output will continue to pass. After P0, the glide-path output is specifically integral, so removing `.int()` cannot cause that positive parse to fail.

To prove `.int()` is enforced, add a negative test containing a fractional value:

```ts
const bad = { ...valid, projectedCorpusPaise: 123.5 };
assert.equal(GlideStepSchema.safeParse(bad).success, false);
```

Then temporarily removing `.int()` must make that negative test fail because parsing unexpectedly succeeds.

This is a material new defect in the revised verification plan.

### T0/AC8 baseline

The baseline-relative approach is workable despite the dirty tree, provided the baseline is captured immediately before task 058 implementation and the exact current working tree is preserved.

However, the tree currently includes a modified planning test:

- `apps/api/src/modules/planning/services/income-surplus.test.ts`

along with the task-057 household/web changes. T4’s phrase “task 057’s six uncommitted files” matches the six tracked modifications, but one of them is directly within the planning service area. The implementer must not mistake that pre-existing modification for task-058 work.

For stronger evidence, T0/T4 should record:

- `git status --short`
- hashes or copied `git diff --` output for all six pre-existing tracked files
- pre-task test result/failing-file set

A later whole-tree diff alone cannot distinguish task ownership.

### AC10/T7

Byte-identical route snapshots are checkable, but `git diff` only proves they are unchanged relative to Git, not necessarily unchanged relative to a dirty pre-task state. If they are clean at T0, this is sufficient. Recording their hashes at T0 would make the claim unambiguous.

### T8

T8 is sound but should display both the raw steps and explicit `Number.isInteger` checks. A successful schema parse alone proves the same fact if the schema definitely contains `.int()`, but showing the integer values is useful evidence.

## 7. New or remaining technical problems

### Runtime date validation is understated

The claim that response date values are strings is correct:

- Glide dates come from `toISODate` at [goal-plan.ts:55](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:55).
- Data-completeness dates are selected or generated as strings at [data-completeness.ts:159](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:159) onward.
- Revolving debt’s statement `period` is a `"YYYY-MM"` string at [revolving-debt.ts:13](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:13).
- Income `month` is also `"YYYY-MM"` at [income-surplus.ts:8](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:8).

Therefore, `z.coerce.date()` would be wrong.

But “use `z.string()`” does not validate the asserted ISO format. If these are intended as public contracts, use format-aware string schemas:

- `YYYY-MM-DD` fields: `z.iso.date()` if available in the installed Zod version, or a project-consistent regex/refinement.
- `YYYY-MM` period/month fields: an explicit regex such as `/^\d{4}-(0[1-9]|1[0-2])$/`.

This matters because AC4 explicitly recognizes that runtime refinements are not covered by TypeScript parity. Plain `z.string()` would accept arbitrary text and would not encode the documented response contract.

### “All response dates” needs careful wording

Not every temporal string is a full ISO date:

- `MonthlyIncome.month` is `"YYYY-MM"`.
- `StatementPaymentStatus.period` is `"YYYY-MM"`.

They are ISO-style year-month strings, not dates in `YYYY-MM-DD` form. The statement “all response date fields are strings, not `Date` objects” is correct; “all are ISO dates” is too imprecise.

### Scope count wording

The objective says “7 response contracts,” while the explicit top-level list contains eight schema names because both `GlideStepSchema` and `GlidePathScheduleSchema` are listed. There are seven endpoint response groups; `GlideStepSchema` is the array element schema. Clarify this to avoid parity-test counting confusion.

### Rebalancing union test requirement

P6 says actual service output must cover both union branches. That is achievable by calling `buildRebalancingPlan` with two inputs:

- A drift closable within 18 months using an available SIP, producing `redirect_contributions`.
- A drift with no suitable SIP or closure beyond 18 months, producing `switch_corpus`.

This part is sound.

### Money-field negative validation is missing

AC6 requires every money field to be `.int()`, but T5 discusses only “a schema money field” and P6 specifically emphasizes the glide-path case. Compile-time parity cannot prove any `.int()` refinements. A grep or schema review plus at least representative fractional-value rejection tests is needed. If AC6 literally means every money field, either test each schema’s money fields or define a systematic table-driven negative test.

## 8. Task sizing recommendation

Keep P0 in task 058.

It is a very small, causally necessary service correction: without it, the correct response schema rejects real glide-path output. Splitting it would create an artificial dependency and delay the contract task without meaningfully reducing risk.

The task remains appropriately sized if the plan is corrected to:

- Acknowledge the one-paise downstream rebalancing effect.
- Replace the impossible “actual DB service output” promise with realistic typed fixtures using pure helpers.
- Fix T5 to use fractional negative fixtures.
- Make temporal string validation explicit.
- Clarify the seven response groups versus eight top-level schema names.

With those amendments, the expanded scope is coherent and implementable.