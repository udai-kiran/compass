## Review verdict

The plan is broadly viable, but it has one material runtime blocker and several scope/test-design errors:

1. `GlideStep.projectedCorpusPaise` can be fractional, directly conflicting with AC6’s mandatory `.int()`.
2. The nested-schema inventory is incomplete.
3. Compile-time parity cannot validate refinements such as `.int()`, UUIDs, or ISO dates.
4. There is no existing `InstrumentCategory` collision.
5. The proposed tests need real runtime parsing, especially before Fastify response serialization is introduced.

## 1. Type transcription feasibility

All seven return shapes are structurally expressible in Zod v4 without `z.any()` or `z.unknown()`. There are no branded types, recursive return types, index signatures, or template-literal types.

### Income surplus

Types: [income-surplus.ts:7](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:7), [income-surplus.ts:16](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:16), [income-surplus.ts:23](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:23).

Straightforward:

- `CommittedOutflow.kind` is `"recurring" | "sip"` at line 19.
- `conservativeSurplusPaise` and `optimisticSurplusPaise` are required-but-nullable at lines 36 and 41.
- `confidence` is a three-value union at line 45.
- All returned money calculations are integral because percentile values are rounded before subtraction at lines 94–99.

The `Omit<IncomeSurplusResult, "months" | "committedOutflows">` appears only in the helper return type at lines 65–67. It does not complicate the top-level response schema or parity assertion.

### Data completeness

Types: [data-completeness.ts:28](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:28), [data-completeness.ts:53](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:53).

Straightforward but nullable-heavy:

- `lastImportedAt`
- `lastImportDaysAgo`
- `unmatchedStatementLines`
- `lastValuationAt`
- `lastValuationDaysAgo`
- `lastSnapshotAt`
- `lastSnapshotDaysAgo`

All are required properties whose values may be `null`, not optional properties.

All date fields in the response are ISO strings, not `Date`: lines 33, 46, 55, and 60. The implementation explicitly produces strings at lines 164–165, 175–180, 210–219, and 233–241.

`computeConfidence` uses `Pick<AccountReadiness, ...>[]` and `DataCompletenessReport["confidence"]` at [data-completeness.ts:78](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:78). This creates no Zod obstacle because neither helper parameter nor helper return wrapper is one of the seven response contracts. It does mean drift in the selected `AccountReadiness` fields already propagates into the helper at compile time.

### Multi-goal allocation

Types: [multi-goal-allocation.ts:13](/home/udai/common/compass/apps/api/src/modules/planning/services/multi-goal-allocation.ts:13), [multi-goal-allocation.ts:29](/home/udai/common/compass/apps/api/src/modules/planning/services/multi-goal-allocation.ts:29), [multi-goal-allocation.ts:44](/home/udai/common/compass/apps/api/src/modules/planning/services/multi-goal-allocation.ts:44).

The result is straightforward. `GoalAllocationResult.slipMonths` is required-but-nullable at line 41.

`GoalAllocationEntry` is an input to `allocateAcrossGoals`, not nested within `MultiGoalAllocationPlan`. A schema for it may be useful for task 059’s route/orchestration input, but it is not required to transcribe the response.

Likewise, its nullable fields are required-but-nullable:

- `monthsToTarget`
- `requiredMonthlyPaise`
- `targetPaise`

### Glide path

Types: [goal-plan.ts:10](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:10), [goal-plan.ts:32](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:32).

`GlideStep` is structurally easy, but there is a runtime contradiction:

- `projectedCorpusPaise` is declared as `number` at line 29.
- It is updated using compound-growth arithmetic at lines 169–173 without rounding.
- Subsequent steps therefore commonly contain fractional paise.

Consequently, `projectedCorpusPaise: z.number().int()` satisfies TypeScript parity—because Zod still infers `number`—but will reject genuine service output at runtime.

This conflicts directly with P1/AC6 at [TASK.md:53](/home/udai/common/compass/tasks/058-planning-api/TASK.md:53) and [TASK.md:88](/home/udai/common/compass/tasks/058-planning-api/TASK.md:88). This is the point where the plan’s stop-and-report policy should activate, even though the problem is a runtime semantic incompatibility rather than inability to express the TypeScript type.

Concrete resolution is needed:

- Round `projectedCorpusPaise` in the service, which violates AC8/non-goals for task 058; or
- Permit a non-integer number in the response schema, which violates AC6 and the stated money rule.

`GlidePathInput.today` is the only actual `Date` field among the examined types and is optional at line 45. It can be represented as `z.date().optional()` without coercion. But `GlidePathInput` is a service input, not the HTTP response, and the task does not currently list it among required schemas.

Also, the actual service return is `GlideStep[]` at line 97. `GlideStepSchema` is an element schema, not itself the complete response schema. The investigation suggested `GlidePathScheduleSchema`; the task silently dropped it. Either add `GlidePathScheduleSchema = z.array(GlideStepSchema)` now or explicitly state that task 059 will use `z.array(GlideStepSchema)`.

### Rebalancing plan

Types: [rebalancing-plan.ts:8](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:8), [rebalancing-plan.ts:19](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:19), [rebalancing-plan.ts:29](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:29), [rebalancing-plan.ts:36](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:36), [rebalancing-plan.ts:42](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:42), [rebalancing-plan.ts:76](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:76).

This contains the one discriminated union:

- `ContributionRedirectionAction.type = "redirect_contributions"`
- `CorpusSwitchAction.type = "switch_corpus"`
- `RebalancingAction` is their union.

Use `z.discriminatedUnion("type", [...])`. The plan lists only `RebalancingAction` as a nested schema, but faithful reusable modeling also implies:

- `ContributionRedirectionActionSchema`
- `CorpusSwitchActionSchema`
- Their inferred aliases

All generated paise values are rounded/integral in this service: current/target values at lines 124–127 and de-risking switch value at lines 202–205.

### Instrument guidance

Types: [instrument-guidance.ts:37](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:37), [instrument-guidance.ts:41](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:41), [instrument-guidance.ts:59](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:59).

Straightforward unions:

- `SuitabilityTier = "ideal" | "suitable" | "caution"`
- `InstrumentCategory`, defined at [instrument-rules.ts:1](/home/udai/common/compass/apps/api/src/lib/instrument-rules.ts:1)
- `AllocationLeg = "equity" | "debt"` at [instrument-rules.ts:18](/home/udai/common/compass/apps/api/src/lib/instrument-rules.ts:18)

`lockInSummary` is required-but-nullable; no other suggestion fields are nullable or optional.

The task omits `SuitabilityTierSchema` and its inferred alias from its nested-component list. It is needed for a complete decomposition unless its enum is embedded directly.

### Revolving debt

Types: [revolving-debt.ts:9](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:9), [revolving-debt.ts:11](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:11), [revolving-debt.ts:32](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:32), [revolving-debt.ts:43](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:43).

Straightforward, but the task omits a required nested response type:

- `StatementPaymentStatus`
- `StatementPaymentStatusSchema`

`CardRevolvingStatus.latestStatement` is required-but-nullable at line 36. Within `StatementPaymentStatus`, these are required-but-nullable:

- `totalDuePaise`
- `minDuePaise`
- `estimatedMonthlyChargePaise`

`PaymentState` is a simple five-value enum.

### P5 conclusion

No type is structurally impossible in Zod. However, P5 should effectively stop the task over `GlideStep.projectedCorpusPaise`: the real service emits fractional money while AC6 mandates integer validation. Compile-time parity will not expose that mismatch.

## 2. Name collisions

The current barrel is flat and exports 19 schema files at [index.ts:4](/home/udai/common/compass/packages/shared/src/index.ts:4) through [index.ts:22](/home/udai/common/compass/packages/shared/src/index.ts:22).

I checked all identifiers named in the request and the additional implied nested names. None currently exists in `packages/shared/src`.

In particular, the reported `InstrumentCategory` collision is false. `wealth.ts` does not export `InstrumentCategory` or `InstrumentCategorySchema`. Its investment classification is `AssetClass`, beginning around [wealth.ts:350](/home/udai/common/compass/packages/shared/src/schemas/wealth.ts:350).

No existing collision was found for:

- All seven top-level schema names and inferred aliases
- `MonthlyIncome`
- `CommittedOutflow`
- `AccountReadiness`
- `GoalAllocationEntry`
- `GoalAllocationResult`
- `GlideStep`
- `GlidePathInput`
- `DriftAnalysis`
- `ContributionRedirectionAction`
- `CorpusSwitchAction`
- `RebalancingAction`
- `DeRiskingEvent`
- `InstrumentSuggestion`
- `SuitabilityTier`
- `InstrumentCategory`
- `AllocationLeg`
- `StatementPaymentStatus`
- `CardRevolvingStatus`
- `PaymentState`

One practical collision will occur inside the parity test if it imports identically named service and shared types unaliased. For example, importing both `IncomeSurplusResult` definitions into one module is illegal. Alias the service types, e.g. `IncomeSurplusResult as ServiceIncomeSurplusResult`, or import service modules as type namespaces.

## 3. Parity assertion design

The `null as unknown as X` sequence does not make the assignment check vacuous. The final expression has static type `X`, and TypeScript still checks whether it is assignable to the declared target type.

The two assignments therefore detect structural widening/narrowing of the inferred output type.

Unused declarations also will not fail this repository’s lint if they begin with `_`: [eslint.config.js:12](/home/udai/common/compass/eslint.config.js:12) configures both `argsIgnorePattern` and `varsIgnorePattern` as `^_`.

Nevertheless, the proposed design has important limitations:

- It checks TypeScript shape only.
- It cannot detect `.int()`, `.min()`, `.max()`, `z.uuid()`, `z.iso.date()`, regex, or other runtime refinements because all still infer primitive `number` or `string`.
- It cannot detect defaulting, transforms, stripping, or coercion semantics when their output type happens to match.
- It proves only the types asserted in these permanent test files. A new service field breaks compilation only if the parity test remains included in the API tsconfig—which it will, because `apps/api/tsconfig.json` includes `src`.

Use `z.output<typeof Schema>` explicitly for response parity. `z.infer` is currently an alias for the schema output type, but `z.output` communicates the intended contract.

For `z.coerce.date()`:

- Output is `Date`.
- Input is broad/unknown unless the generic input is narrowed.
- `z.infer`/`z.output` therefore compares as `Date`.
- `z.input` describes the accepted wire input.

There is no reason to use `z.coerce.date()` for these responses. All response dates are strings. Only `GlidePathInput.today` is a `Date`, and plain `z.date().optional()` is faithful.

A cleaner type-only idiom is an exactness helper:

```ts
type Equal<A, B> =
  [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type Assert<T extends true> = T;

type _IncomeSurplusParity = Assert<
  Equal<z.output<typeof IncomeSurplusResultSchema>, ServiceIncomeSurplusResult>
>;
```

The leading underscore keeps ESLint satisfied. This avoids emitting meaningless runtime assignments. Keep one real `test()` only if the test runner requires the file to execute.

The repository has no established bidirectional Zod/service parity-test convention. The closest precedent is the recursive explicit annotation `z.ZodType<CategoryTreeNode>` at [ledger.ts:340](/home/udai/common/compass/packages/shared/src/schemas/ledger.ts:340), but that is not a complete exact-equality convention and should not replace bidirectional comparison.

## 4. File placement

`wealth.ts` is not merely a card schema file. It currently contains:

- Credit cards at [wealth.ts:3](/home/udai/common/compass/packages/shared/src/schemas/wealth.ts:3)
- Retirement accounts at line 72
- NPS at line 96
- Card summaries/activity/statements
- EMIs
- Holdings and tax lots
- Net-worth reports
- Goal-asset/net-worth grouping

It is already a large mixed wealth/credit/investments contract file. Appending revolving debt near `CardDetails` is locally consistent with historical placement, but it perpetuates that mixed ownership.

Recommendation:

- Prefer a new `schemas/credit.ts` for `HouseholdRevolvingDebt` and its components because the service and future route live in the credit module.
- If minimizing files is more important, `wealth.ts` is defensible, but the plan should describe it as compatibility with existing card-contract placement—not clean domain ownership.
- Do not place it in the existing credit module’s `schema.ts`; that file is persistence schema, whereas shared Zod files are HTTP contracts.

A new `schemas/planning.ts` is appropriate. These six groups span income analysis, readiness, allocation, glide paths, rebalancing, and instrument guidance. Putting all of them in `goals.ts` would overload a file that already includes CRUD, projection, cash flow, bills, and preferences. `insights.ts` contains dashboard insight/health cards only and is not a better fit.

## 5. Splitting 058 from 059

The split is sound only if task 058 includes runtime schema tests. Compile-only, consumer-free schemas are too weak.

Fastify installs `serializerCompiler` globally at [app.ts:163](/home/udai/common/compass/apps/api/src/app.ts:163). A schema that rejects the service output during response serialization can turn an otherwise successful request into a 500. Type parity cannot catch:

- Fractional `projectedCorpusPaise` rejected by `.int()`
- A malformed-but-TypeScript-typed ISO date rejected by `z.iso.date()`
- A non-UUID string rejected by `z.uuid()`
- Overly narrow enum values
- Refinements or transforms
- Unknown-key stripping behavior

Plain `z.object()` strips unknown object keys during parsing by default; it does not reject them unless made strict. That can silently omit an unmodeled service field. Bidirectional parity should catch a statically declared extra service field, but it cannot catch dynamically added properties or runtime query shapes hidden behind casts.

I would keep 058/059 separate because task 059 still needs route-specific orchestration decisions, especially for multi-goal allocation and instrument guidance. But 058 should add actual schema tests that parse representative outputs from every pure service and realistic fixtures for DB-backed results. That catches the contract/serializer class of failures before route wiring.

At minimum, resolve the glide-path fractional-paise issue before completing 058. A vertical slice would discover it, but a direct `GlideStepSchema.safeParse(buildGlidePathSchedule(...))` test discovers it more cheaply.

## 6. AC1–AC9 and T1–T7

They are not sufficient as written.

Specific issues:

- AC3’s “every nested component” is not checkable until the complete expected name list is explicit. The current list omits `StatementPaymentStatus`, `SuitabilityTier`, `ContributionRedirectionAction`, and `CorpusSwitchAction`.
- `GoalAllocationEntry` and `GlidePathInput` are inputs, not nested response components. Decide explicitly whether input schemas are in scope.
- The actual glide-path response is an array. AC3 should require `GlidePathScheduleSchema` or state that the route will use `z.array(GlideStepSchema)`.
- AC4 overstates what parity proves. It proves TypeScript output-shape parity, not runtime validation correctness.
- AC6 conflicts with the current glide-path implementation.
- AC7’s hard-coded “26 failures” is brittle. Prefer “no new failures relative to a captured baseline, with only the known `DATABASE_URL`-gated failures.”
- AC8’s “zero runtime behaviour change” is correct for task 058 but also means route-level serializer behavior remains untested.
- T4 says “only the 4 intended files” but lists five: `planning.ts`, `wealth.ts`, `index.ts`, and two parity tests at [TASK.md:101](/home/udai/common/compass/tasks/058-planning-api/TASK.md:101).

T5 is useful for proving the type assignments are active, but its example only proves primitive type mismatch detection. Changing `.int()` to plain `z.number()` would still typecheck, demonstrating the central limitation. T5 should include both observations:

- `z.string()` must fail type parity.
- Removing `.int()` will not fail type parity, so runtime tests must cover integer refinements.

Add:

- Runtime `safeParse` success tests for representative outputs from all seven contracts.
- A direct parse test of a nontrivial multi-step `buildGlidePathSchedule` result.
- Negative tests for omitted required-nullable fields.
- Discriminated-union tests for both rebalancing action branches.
- Enum rejection tests.
- ISO-date/UUID tests only where these restrictions are intentionally part of the public contract.
- A shared-barrel import smoke test proving every promised schema/type is exported.
- Eventually, task 059 route tests asserting real serialization returns 200 rather than 500.

## 7. Missed repository scope

No database schema or table is added, so backup coverage does not apply. The backup guard enumerates Drizzle tables at [backup.test.ts:39](/home/udai/common/compass/apps/api/src/modules/system/services/backup.test.ts:39), and the schema decomposition count covers database tables/enums at [schema.decomposition.test.ts:140](/home/udai/common/compass/apps/api/src/db/schema.decomposition.test.ts:140). Shared Zod contracts do not affect either.

There is no shared-schema registry/index snapshot that enumerates every exported Zod schema.

The CLAUDE.md `deepEqual` warning at [CLAUDE.md:56](/home/udai/common/compass/CLAUDE.md:56) applies when modifying an existing schema used by an existing fixture. Appending unrelated exports to `wealth.ts` does not require updating current expected objects. Existing wealth tests demonstrate field-level fixture assertions, for example required reconciliation fields at [wealth.test.ts:202](/home/udai/common/compass/packages/shared/src/schemas/wealth.test.ts:202), but there is no global expected export object.

One final missed concern: the workspace is already dirty with unrelated user changes. T4 cannot assert that the whole `git diff` contains only task-058 files. It must compare task-owned paths or record the pre-task baseline and verify that task 058 introduced changes only in its allowed files.