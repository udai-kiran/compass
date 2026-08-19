# Sonnet Worker Delegation

Task 058 is delegated in **two sequential stages**, because the Zod contract cannot
be correct until the glide path actually emits integer paise. Stage 2 is not started
until Stage 1 is verified.

---

## Iteration 1 — Stage 1: P0 money invariant fix

### Task
058 / P0 + P7 — make `buildGlidePathSchedule` emit integer paise, and add the
missing integer coverage.

### Approved Plan
- **P0**: In `apps/api/src/modules/planning/services/goal-plan.ts`, round
  `projectedCorpusPaise` **at the point of assignment into the step** (line ~166):
  `projectedCorpusPaise: Math.round(corpusAtStepStart)`.
- **P7**: Add a test asserting `Number.isInteger(step.projectedCorpusPaise)` for every
  step of a nontrivial (≥3-step) schedule.

### Root cause (already confirmed — do not re-litigate)
`goal-plan.ts:171-173` compounds `corpusAtStep` with no rounding, and line 166 assigns
that value straight into `projectedCorpusPaise`. Step 1 equals integer `fundedPaise`,
but every later step carries fractional paise. This violates CLAUDE.md's "Money is
always integer paise end to end". Because Fastify installs a global
`serializerCompiler` (`apps/api/src/app.ts:163`), a `.int()` response schema would
reject real output and return a **500**.

### Files and Symbols
- `apps/api/src/modules/planning/services/goal-plan.ts` — `buildGlidePathSchedule`,
  the `steps.push({...})` object around line 161-167.
- `apps/api/src/modules/planning/services/goal-plan.test.ts` — add the P7 test.
- `apps/api/src/modules/planning/services/rebalancing-plan.test.ts` — **only if** an
  exact assertion shifts (see below).

### Required Changes
1. Change only the `projectedCorpusPaise` value in the pushed step object to
   `Math.round(corpusAtStepStart)`.
2. **Do NOT** round `corpusAtStep` in the projection at lines 171-173. Rounding there
   would compound error across bands. The internal chain must keep full precision.
3. `requiredMonthlyPaise` is **already integral** (`computeRequiredMonthlyPaise` ends
   in `Math.max(0, Math.ceil(...))` at `goal-plan.ts:85`, with integer-zero early
   returns at lines 80 and 83). Confirm this and change nothing. Report confirmation.
4. Audit every other paise-named field that `goal-plan.ts` *exports* and report whether
   any other fractional value exists (check `buildGoalPlan` around lines 272-275 and
   291-305; `targetAllocation` at line 210 returns only percentages).
5. Add the P7 integer test.

### Known downstream effect — verify, do not suppress
`buildRebalancingPlan` consumes `next.projectedCorpusPaise` at
`rebalancing-plan.ts:197` and computes
`Math.round((next.projectedCorpusPaise * equityChangePct) / 100)` at lines 203-205.
Rounding the input can therefore shift `DeRiskingEvent.equityToSwitchPaise` by **up to
1 paise**. `rebalancing-plan.test.ts` calls `buildGlidePathSchedule` at lines 146 and
159. Run that file and report whether any assertion changed. If one did, you MAY update
it — but you must itemise exactly which assertion, its old and new value, and why the
new value is correct. Never adjust an expected value just to make a test pass.

### Must Not Change
- The projection arithmetic at `goal-plan.ts:171-173`.
- Any Zod schema, `packages/shared`, any route, plugin, or other service.
- The six files already modified by task 057 (see below) — leave them exactly as they are.
- No `eslint-disable`, `@ts-ignore`, `@ts-expect-error`, `as any`.
- Do not stage, commit, or delete anything. Do not touch `screen-shots/`.

### ⚠ The working tree is already dirty
Six tracked files are modified by completed task 057 and are **not yours**:
`household/routes/splits.ts`, `household/routes/settlements.ts`,
`household/services/grants.ts`, `household/services/membership.ts`,
`planning/services/income-surplus.test.ts`, `web/src/lib/household-queries.ts`.
Note the fifth is inside the planning area — do **not** revert it or count it as your work.

### Acceptance Criteria
- AC-a: Every `GlideStep.projectedCorpusPaise` is an integer for a ≥3-step schedule.
- AC-b: `goal-plan.ts:171-173` is byte-unchanged.
- AC-c: `npm run typecheck` exits 0; `npm run lint` exits 0 (0 errors, 0 warnings).
- AC-d: No test that passed before this change fails after it, except an itemised and
  justified ≤1-paise `equityToSwitchPaise` update.
- AC-e: P7 integer test exists and passes.

### Commands
1. `git status --short` and `git diff --stat` (BEFORE any edit — record the baseline)
2. `npm run test -w apps/api 2>&1 | tail -40` (BEFORE — baseline)
3. (make the edits)
4. `node --test apps/api/src/modules/planning/services/goal-plan.test.ts`
5. `node --test apps/api/src/modules/planning/services/rebalancing-plan.test.ts`
6. `npm run typecheck`
7. `npm run lint`
8. `npm run test 2>&1 | tail -40`
9. `git diff -- apps/api/src/modules/planning/`

### Required Evidence
- files changed, complete diff
- every command with literal output and exit code
- explicit confirmation that lines 171-173 are unchanged
- the actual printed `projectedCorpusPaise` values for a ≥3-step schedule, with
  `Number.isInteger` per step
- confirmation that `requiredMonthlyPaise` was already integral
- the result of the other-paise-field audit (item 4)
- whether any `rebalancing-plan.test.ts` assertion shifted, itemised if so
- before/after test totals and failing-file sets
- any deviation or blocker, stated not worked around

Write full details to `tasks/058-planning-api/implementation-1.md` and return a digest
of at most 20 lines plus that path.

---

## Iteration 2 — Stage 2: the shared Zod contract

### Task
058 / P1-P6 — author the v2.2.0 response contract in `packages/shared`, with
compile-time parity assertions **and** runtime `safeParse` tests.

### Prerequisite
Stage 1 is complete and verified: `goal-plan.ts:166` now rounds
`projectedCorpusPaise`, so `.int()` on that field is safe at runtime.

### Files you own
- **New** `packages/shared/src/schemas/planning.ts` — the 6 planning schema groups.
- **New** `packages/shared/src/schemas/credit.ts` — revolving-debt schemas.
- `packages/shared/src/index.ts` — add exactly two `export *` lines.
- **New** parity + runtime test files under `apps/api/src/modules/planning/services/`
  and `apps/api/src/modules/credit/services/` (the API workspace is the only one that
  can import both the services and `@compass/shared`).
- `apps/api/src/modules/planning/services/rebalancing-plan.test.ts` — add one exact
  assertion (see item 8).

### Source of truth for every shape
Read the real service files and transcribe their **exported** types. Do not invent
fields, and do not "improve" a shape:
- `apps/api/src/modules/planning/services/income-surplus.ts` — `MonthlyIncome`, `CommittedOutflow`, `IncomeSurplusResult`
- `apps/api/src/modules/planning/services/data-completeness.ts` — `AccountReadiness`, `DataCompletenessReport`
- `apps/api/src/modules/planning/services/multi-goal-allocation.ts` — `GoalAllocationResult`, `MultiGoalAllocationPlan`
- `apps/api/src/modules/planning/services/goal-plan.ts` — `GlideStep`
- `apps/api/src/modules/planning/services/rebalancing-plan.ts` — `DriftAnalysis`, `ContributionRedirectionAction`, `CorpusSwitchAction`, `RebalancingAction`, `DeRiskingEvent`, `RebalancingPlan`
- `apps/api/src/modules/planning/services/instrument-guidance.ts` — `SuitabilityTier`, `InstrumentSuggestion`, `InstrumentGuidance`
- `apps/api/src/lib/instrument-rules.ts` — `InstrumentCategory`, `AllocationLeg`
- `apps/api/src/modules/credit/services/revolving-debt.ts` — `PaymentState`, `StatementPaymentStatus`, `CardRevolvingStatus`, `HouseholdRevolvingDebt`

`GoalAllocationEntry`, `GlidePathInput`, `RebalancingPlanInput`, and
`IncomeSurplusComputation` are service **inputs** — explicitly OUT of scope.

### Required Changes

**1. Money fields.** Integer paise only. `.int()` alone is NOT sufficient: it does not
exclude non-finite or unsafe values (`Math.round(NaN)` is `NaN`; values past
`Number.MAX_SAFE_INTEGER` still satisfy `Number.isInteger`). Define a small
**non-exported** local helper in each new file and use it for every paise field:
reject `NaN`/`Infinity` and constrain to the safe-integer range. Use Zod v4's
`.safe()` if the installed version provides it — **verify first** — otherwise use
explicit `.min(-Number.MAX_SAFE_INTEGER).max(Number.MAX_SAFE_INTEGER)`. Report which
you used and why. Do **not** add a new public `PaiseSchema` export, and do not modify
`packages/shared/src/money.ts`.

**2. Nullable vs optional — the likeliest silent error.** These types are
overwhelmingly *required-but-nullable*: use `.nullable()`, **not** `.optional()`.
Confirmed required-but-nullable: `conservativeSurplusPaise`, `optimisticSurplusPaise`,
all nullable `AccountReadiness` date/count fields, `lastSnapshotAt`,
`lastSnapshotDaysAgo`, `slipMonths`, `lockInSummary`, `latestStatement`,
`totalDuePaise`, `minDuePaise`, `estimatedMonthlyChargePaise`. Check each against the
service type; the parity assertion will catch a mistake, so trust it over your memory.

**3. Temporal fields are strings, never `Date`.** Never use `z.coerce.date()`. Two
distinct formats — do not conflate:
- `YYYY-MM-DD`: glide `fromDate`/`toDate`, data-completeness dates → `z.iso.date()`
  if the installed Zod v4 has it, else a regex refinement.
- `YYYY-MM`: `MonthlyIncome.month`, `StatementPaymentStatus.period` → regex
  `/^\d{4}-(0[1-9]|1[0-2])$/`. These are year-month strings, not ISO dates.
Report which API you used.

**4. `RebalancingAction` is a discriminated union** on `type`
(`"redirect_contributions"` / `"switch_corpus"`). Use
`z.discriminatedUnion("type", [ContributionRedirectionActionSchema, CorpusSwitchActionSchema])`
and export both member schemas.

**5. Exports.** Every name listed in `TASK.md`'s "Complete required export list" must
be exported, each with its inferred type alias. `GlidePathScheduleSchema = z.array(GlideStepSchema)`
is the response contract; `GlideStepSchema` is the element schema. `index.ts` is a flat
`export *` barrel — **check every new name for collisions before adding**; a duplicate
export is a build break. Do not modify any existing schema file.

**6. Compile-time parity (P5).** Use the exactness helper, not bare assignments:
```ts
type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Assert<T extends true> = T;
type _IncomeSurplusParity = Assert<Equal<z.output<typeof IncomeSurplusResultSchema>, ServiceIncomeSurplusResult>>;
```
- Use `z.output<>`, not `z.infer`.
- **Alias the service-side type on import** (`IncomeSurplusResult as ServiceIncomeSurplusResult`) —
  importing both same-named types into one module is illegal.
- `_` prefix satisfies `eslint.config.js:12` (`varsIgnorePattern: "^_"`).
- One assertion per **response contract** (7 total).

**7. Runtime tests (P6) — two tiers.**
- **Tier A — 4 pure contracts** (`GlidePathSchedule`, `RebalancingPlan`,
  `InstrumentGuidance`, `MultiGoalAllocationPlan`): call the real service function and
  `safeParse` its **actual** output.
- **Tier B — 3 DB-backed** (`IncomeSurplusResult`, `DataCompletenessReport`,
  `HouseholdRevolvingDebt`): these need a `Db` and the repo's DB tests are all
  `DATABASE_URL`-gated, so build a realistic fixture annotated
  `satisfies <ServiceType>`, deriving what you can from the exported pure helpers:
  `computeIncomeSurplus`; `computeConfidence`; `derivePaymentState` +
  `estimateMonthlyCharge`. **Do not build a fake `Db`.**
Also required:
- A ≥3-step `buildGlidePathSchedule` result parsed by `GlidePathScheduleSchema`.
- **Both** union branches: one input whose drift closes within 18 months with an
  available SIP → `redirect_contributions`; one with no suitable SIP or closure beyond
  18 months → `switch_corpus`.
- Negative tests: omitting a required-nullable field must fail.
- Enum-rejection tests.
- **A table-driven negative test feeding a fractional value (e.g. `123.5`) to EVERY
  money field across all 7 schemas**, asserting `safeParse(...).success === false`.
  This is the only thing that actually proves `.int()` — a positive parse test does not.
- Non-finite rejection tests (`NaN`, `Infinity`) for money fields.
- A barrel smoke test importing every required name from `@compass/shared`.

**8. Close the coverage gap found in review-3.** `DeRiskingEvent.equityToSwitchPaise`
is currently asserted only `> 0` (`rebalancing-plan.test.ts:177`) and nowhere exactly,
so a real calculation regression could stay positive and pass. Add one **exact-value**
assertion. Derive the expected number from the actual current output and state it
explicitly in your report — do not reverse-engineer a number just to make it pass.

### Must Not Change
- Any service implementation, including `goal-plan.ts` (Stage 1 is done and verified).
- Any route, any `plugin.ts`. **No route may be added** — both
  `route-surface.snapshot.txt` and `route-table.snapshot.txt` must stay byte-identical.
- Any existing file in `packages/shared/src/schemas/`, or `money.ts`.
- The six task-057 files (see warning below).
- No `z.any()`, `z.unknown()`, `as any`, `@ts-ignore`, `@ts-expect-error`, or
  `eslint-disable` — anywhere, for any reason. If a shape seems inexpressible, STOP and
  report it as a blocker rather than loosening the schema.
- Do not stage, commit, or delete anything. Do not touch `screen-shots/`.

### ⚠ The tree is already dirty — 8 files are NOT yours
Task 057 (complete): `household/routes/splits.ts`, `household/routes/settlements.ts`,
`household/services/grants.ts`, `household/services/membership.ts`,
`planning/services/income-surplus.test.ts`, `web/src/lib/household-queries.ts`.
Task 058 Stage 1 (complete): `planning/services/goal-plan.ts`, `goal-plan.test.ts`.
Do not revert, "clean up", or count any of these as your work. Note that
`income-surplus.test.ts` sits in the very area you are working in.

### Acceptance Criteria
See `TASK.md` AC1-AC11. In short: typecheck 0; lint 0; every required name exported;
7 bidirectional parity assertions compiling; runtime tests passing for all 7 contracts
including the fractional-money and non-finite negative tests; no new test failures vs
the baseline; snapshots byte-identical; no suppressions.

### Commands
1. `git status --short` (BEFORE any edit — record the baseline)
2. `npm run test 2>&1 | tail -40 ; echo "EXIT=$?"` (BEFORE — baseline totals)
3. (implement)
4. `npm run typecheck ; echo "EXIT=$?"`
5. `npm run lint ; echo "EXIT=$?"`
6. `npm run test -w packages/shared 2>&1 | tail -30`
7. `npm run test -w apps/api 2>&1 | tail -40`
8. `npm run test 2>&1 | tail -40 ; echo "EXIT=$?"`
9. `node --test apps/api/src/modules/planning/services/rebalancing-plan.test.ts`
10. `git diff --stat` and `git diff -- apps/api/src/route-surface.snapshot.txt apps/api/src/route-table.snapshot.txt` (expect empty)
11. `grep -rnE "z\.any\(|z\.unknown\(|as any|ts-expect-error|ts-ignore|eslint-disable" packages/shared/src/schemas/planning.ts packages/shared/src/schemas/credit.ts` plus your new test files

### Required Evidence
- files changed; complete `git diff`
- every command with literal output and **exit code** (report `npm run test`'s exit
  code accurately — it exits **1** because `DATABASE_URL` is absent; a previous report
  wrongly claimed 0)
- before/after test totals across **all six** workspaces (api, extractor, ingestor,
  web, ai, shared) and the failing-file sets
- which Zod API you used for safe-integer money and for date formats, and why
- the literal `safeParse` result for the ≥3-step glide path
- the exact `equityToSwitchPaise` value you asserted and how you derived it
- proof the parity assertions are not vacuous: temporarily change one money field to
  `z.string()`, show `npm run typecheck` FAILS, then revert and show it passes again
- confirmation both snapshot `.txt` files are unchanged
- any deviation or blocker, stated rather than worked around

Write full details to `tasks/058-planning-api/implementation-2.md` and return a digest
of at most 20 lines plus that path.
