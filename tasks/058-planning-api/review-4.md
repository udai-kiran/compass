## Review outcome

Stage 2 is functionally complete and safe to proceed to Task 059. I found no schema mismatch, export collision, test gap, serializer blocker, or prohibited suppression.

One non-blocking documentation defect remains: the comments claim `.int()` alone permits non-finite/unsafe integers. With installed Zod 4.4.3, that is false; `.safe()` is valid but redundant after `.int()`.

## 1. Export collisions

No collision exists.

A complete scan of every explicit export reachable through the flat barrel at [index.ts:1](/home/udai/common/compass/packages/shared/src/index.ts:1) found zero duplicate names, including every requested type and every new `*Schema`.

In particular:

- Current and commit-`b829d87` versions of `wealth.ts` export `AssetClass`, not `InstrumentCategory`.
- The `b829d87` change to `wealth.ts` only added four card-detail fields: `aprBps`, `cashAprBps`, `lateFeePaise`, and `interestFreeDays`.
- The earlier claim that `b829d87` added `InstrumentCategory` to `wealth.ts` was incorrect.
- `InstrumentCategory` previously existed only in API-local [instrument-rules.ts:1](/home/udai/common/compass/apps/api/src/lib/instrument-rules.ts:1), which is not part of the shared barrel.
- `InstrumentCategorySchema` and `InstrumentCategory` now originate solely from [planning.ts:216](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:216).

This explains why typecheck produces no TS2308.

Both new barrel entries are exactly the requested two lines at [index.ts:23](/home/udai/common/compass/packages/shared/src/index.ts:23).

## 2. Zod API verification

Installed version: Zod `4.4.3`.

`.safe()` exists on `ZodNumber`. Runtime probes showed:

- `NaN`: rejected
- `Infinity`: rejected
- `-Infinity`: rejected
- `Number.MAX_SAFE_INTEGER`: accepted
- `Number.MAX_SAFE_INTEGER + 1`: rejected
- `-Number.MAX_SAFE_INTEGER`: accepted
- `-Number.MAX_SAFE_INTEGER - 1`: rejected
- fractional numbers: rejected by `.int()`

However:

- Bare `z.number()` already rejects NaN and ±Infinity.
- In Zod 4.4.3, `.int()` already enforces the safe-integer range as well.
- Therefore `.safe()` is real and behaves safely, but it adds nothing after `.int()`.

The statement at [planning.ts:8](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:8) and [credit.ts:8](/home/udai/common/compass/packages/shared/src/schemas/credit.ts:8) that “`.int()` alone does not exclude” those values is overstated. This is documentation-only and does not weaken validation.

`z.iso.date()` exists and strictly validates calendar-valid `YYYY-MM-DD` strings:

- `2026-08-18`: accepted
- `2026-02-29`: rejected
- `2024-02-29`: accepted
- missing zero padding, invalid months/days, and datetime strings: rejected

Its use at [planning.ts:36](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:36) is appropriate.

## 3. Schema fidelity

All seven response contracts match their service-side types field-for-field.

| Contract | Result |
|---|---|
| `IncomeSurplusResult` | Exact: all fields present; both surplus fields required-but-nullable; confidence enum exact. Schema starts at [planning.ts:62](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:62), service type at [income-surplus.ts:23](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:23). |
| `DataCompletenessReport` | Exact, including all five nullable account fields and both nullable snapshot fields. Schema at [planning.ts:79](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:79), service at [data-completeness.ts:28](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:28). |
| `MultiGoalAllocationPlan` | Exact; `slipMonths` is required-but-nullable. Schema at [planning.ts:115](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:115), service at [multi-goal-allocation.ts:29](/home/udai/common/compass/apps/api/src/modules/planning/services/multi-goal-allocation.ts:29). |
| `GlideStep[]` | Exact seven fields; `requiredMonthlyPaise` required-but-nullable. Schema at [planning.ts:135](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:135), service at [goal-plan.ts:10](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:10). |
| `RebalancingPlan` | Exact drift, actions, and de-risking schedule shapes. Both union members and enum sets match. Discriminated union at [planning.ts:188](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:188), service types at [rebalancing-plan.ts:8](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:8). |
| `InstrumentGuidance` | Exact fields and all 15 instrument categories; `lockInSummary` required-but-nullable. Schema at [planning.ts:216](/home/udai/common/compass/packages/shared/src/schemas/planning.ts:216), service at [instrument-guidance.ts:38](/home/udai/common/compass/apps/api/src/modules/planning/services/instrument-guidance.ts:38). |
| `HouseholdRevolvingDebt` | Exact card, statement, aggregate, nullable, and enum shapes. Schema at [credit.ts:43](/home/udai/common/compass/packages/shared/src/schemas/credit.ts:43), service at [revolving-debt.ts:9](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:9). |

No field was missed, invented, made optional, or assigned the wrong nullable/type/enum shape.

The additional format constraints are compatible with actual production generation:

- Data-completeness dates come from `toISOString().slice(0, 10)`, SQL `to_char(..., 'YYYY-MM-DD')`, or date columns at [data-completeness.ts:165](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:165).
- Statement periods come directly from the `YYYY-MM` persistence field at [revolving-debt.ts:170](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:170).

## 4. Parity assertions

There are exactly seven bidirectional response-contract assertions:

- Six at [planning-schemas.test.ts:76](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:76)
- One at [credit-schemas.test.ts:37](/home/udai/common/compass/apps/api/src/modules/credit/services/credit-schemas.test.ts:37)

They:

- Use `z.output`
- Alias every response service type
- Use tuple-wrapped mutual assignability:
  `A extends B` and `B extends A`
- Constrain the result through `Assert<T extends true>`

This detects:

- Missing fields
- Extra required fields
- Required versus optional differences
- Nullable versus non-nullable/optional differences
- Wrong nested field types and enum members

It is not vacuous. Neither side is `any`, `unknown`, or `never`; both sides are concrete object/array types. The recorded mutation check changing a money field to `z.string()` produced TS2344, confirming the assertion bites.

As expected, the helper cannot detect runtime refinements such as `.int()`, safe ranges, regexes, or ISO-date validity; runtime tests provide that coverage.

## 5. Runtime tests

The required two-tier arrangement is implemented correctly.

Tier A calls real pure service functions:

- Glide path: [planning-schemas.test.ts:141](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:141)
- Both rebalancing branches: [planning-schemas.test.ts:161](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:161)
- Instrument guidance: [planning-schemas.test.ts:224](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:224)
- Multi-goal allocation: [planning-schemas.test.ts:239](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:239)

Tier B uses `satisfies`-checked fixtures and exported helpers:

- `computeIncomeSurplus`: [planning-schemas.test.ts:273](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:273)
- `computeConfidence`: [planning-schemas.test.ts:314](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:314)
- `derivePaymentState` and `estimateMonthlyCharge`: [credit-schemas.test.ts:61](/home/udai/common/compass/apps/api/src/modules/credit/services/credit-schemas.test.ts:61)

Required cases are present:

- ≥3-step glide path
- Real `redirect_contributions` output
- Real `switch_corpus` output
- Required-nullable omission failures
- Enum rejection
- NaN and ±Infinity rejection
- Planning and credit barrel smoke tests
- Strict date/year-month failures

Fractional-money coverage is complete: 26 distinct response money paths.

- Income surplus: 5
- Data completeness: 0
- Multi-goal allocation: 3
- Glide path: 2
- Rebalancing plan: 8
- Instrument guidance: 0
- Household revolving debt: 8

The tables begin at [planning-schemas.test.ts:583](/home/udai/common/compass/apps/api/src/modules/planning/services/planning-schemas.test.ts:583) and [credit-schemas.test.ts:264](/home/udai/common/compass/apps/api/src/modules/credit/services/credit-schemas.test.ts:264). This is exhaustive, not sampled.

Targeted execution: 61 tests, 61 passed.

## 6. Exact rebalancing assertion

The `10_800_000` value is correct and meaningful at [rebalancing-plan.test.ts:179](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.test.ts:179).

Independent derivation:

- Starting corpus: `50_000_000`
- Current band: 20% equity at 12% and 80% debt at 7%
- Blended annual rate: `(20×12 + 80×7)/100 = 8%`
- One-year projection with no inflow: `50_000_000 × 1.08 = 54_000_000`
- Equity allocation change: `20% → 0%`
- Switch: `54_000_000 × 20% = 10_800_000`

This directly locks the service’s glide-path-to-rebalancing calculation rather than merely asserting positivity.

## 7. Scope and repository state

Stage 2 changes are limited to the four new files, two barrel exports, and the one exact test assertion.

No Stage 2 service implementation, route, plugin, existing shared schema, or `money.ts` change exists.

The eight earlier tracked modifications remain present with their recorded diffs:

- Six Task 057 files
- Stage 1 `goal-plan.ts` and `goal-plan.test.ts`

They were not reverted. Nothing is staged.

Both route snapshots have empty Git diffs and retain their recorded hashes:

- `route-surface.snapshot.txt`: `74d21cf3d9e471a11b5b6ca9f5068f226401b0a05791c652522771adaeb603de`
- `route-table.snapshot.txt`: `2801291aac23c0b94321d6d01a1b30a25b1bc911d1b73bf56ebeaf255ec049b2`

Their byte-for-byte snapshot tests also pass.

## 8. Suppression audit

No occurrence was found in any Stage 2 file of:

- `z.any()`
- `z.unknown()`
- `as any`
- `@ts-ignore`
- `@ts-expect-error`
- `eslint-disable`

`git diff --check` is clean.

## 9. Verification

- `npm run typecheck`: exit 0 across all seven configured typecheck workspaces, including docs.
- `npm run lint`: exit 0, zero warnings.
- `npm run test`: exit 1 as expected without `DATABASE_URL`.

Exact totals across the six test workspaces:

| Workspace | Tests | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| API | 786 | 760 | 25 | 1 |
| Extractor | 74 | 73 | 1 | 0 |
| Ingestor | 12 | 12 | 0 | 0 |
| Web | 270 | 270 | 0 | 0 |
| AI | 32 | 32 | 0 | 0 |
| Shared | 212 | 212 | 0 | 0 |
| Total | 1,386 | 1,359 | 26 | 1 |

All 26 failures are the known `DATABASE_URL`-gated baseline: 25 API plus one extractor. There is no new failure.

## 10. Completion and route-wiring safety

No implementation issue blocks marking Task 058 complete or proceeding to Task 059.

The schemas are safe for Fastify response serialization against current service outputs:

- All pure service outputs parse successfully.
- Stage 1 removed the known fractional glide-corpus hazard.
- DB-derived response formats match the stricter date/month schemas.
- All service money calculations currently materialize integer paise.
- The safe-integer restriction is consistent with JavaScript’s reliable numeric range and should be retained.

Recommendation: proceed to Task 059. Correct the two `.int()`/`.safe()` explanatory comments opportunistically, but they are not a completion blocker.