# Task: 058 — Glide-path paise invariant + shared Zod contract for v2.2.0

## Status
COMPLETE

## Outcome (verified — verification-2.md, all 11 ACs pass)
Both stages done. `typecheck` 0, `lint` 0. Suite **1386 total, 1359 pass, 26 fail,
1 skip** — all 26 `DATABASE_URL`-gated, none new. Files: `planning.ts` (263 lines),
`credit.ts` (91), `planning-schemas.test.ts` (812), `credit-schemas.test.ts` (328);
`index.ts:23-24` exports both. `goal-plan.ts:166` rounds; lines 171-173 byte-unchanged.
Both route snapshots byte-identical. No suppressions anywhere. Nothing staged or
committed; `screen-shots/` still untracked.

Parity assertions independently proven non-vacuous: mutating `planning.ts:152` to
`z.string()` fails typecheck with `TS2344: Type 'false' does not satisfy the constraint
'true'`; reverted with SHA256 identical before/after
(`d8aeab30c5af571c4eedd87461012c64b554a2e1684080a3085ccba5c4f3b125`).
Fractional-money rejection independently recounted at **26 distinct money paths**
(IncomeSurplus 5 + MultiGoalAllocation 3 + GlidePath 2 + Rebalancing 8 + RevolvingDebt 8;
DataCompleteness and InstrumentGuidance legitimately have none).

**Headline value:** Stage 1 caught a latent production bug — fractional paise in a
paise-named field. Fastify's global response serializer would have turned working
requests into 500s once the correct `.int()` contract landed, and no amount of
type-checking could have surfaced it because `.int()` still infers `number`.

## Objective
Two causally linked deliverables:
1. Fix `buildGlidePathSchedule` so every paise field it emits is an **integer**,
   restoring CLAUDE.md's money invariant.
2. Author the Zod response schemas in `packages/shared` for the 7 already-written
   v2.2.0 service return types, proven by **both** compile-time parity assertions
   **and** runtime `safeParse` tests against real service output.

This is the contract layer; it unblocks route wiring (059) and the UI tasks (07.x).

## Root Cause

**(a) The glide-path money bug — a real latent defect, not a schema problem.**
`apps/api/src/modules/planning/services/goal-plan.ts:171-173` projects the corpus
forward with compound-growth arithmetic and **no rounding**:
```ts
corpusAtStep = corpusAtStep * (1 + blendedBps / 10_000) ** (stepDuration / 12)
             + annuityFV(monthlyInflowPaise, stepDuration, rm);
```
That unrounded value is assigned straight into `projectedCorpusPaise` at line 166.
The first step equals `fundedPaise` (integer), but **every subsequent step carries
fractional paise**. This violates CLAUDE.md's "Money is always integer paise
(minor units) end to end — never float rupees."

Why it is blocking: Fastify installs a global `serializerCompiler`
(`apps/api/src/app.ts:163`), so a `.int()` response schema would **reject genuine
service output at runtime and turn a working request into a 500**. Compile-time
parity cannot detect this, because Zod's `.int()` still infers `number`.
Verified directly by me at `goal-plan.ts:160-176`; found by `review-1.md` §1.

**(b) No shared contract exists.** Commit `b829d87` landed 8 planning/credit
services with tests but no HTTP surface and no Zod schemas — a grep for
`GlidePath|IncomeSurplus|DataCompleteness|MultiGoalAllocation|RebalancingPlan|RevolvingDebt|InstrumentGuidance`
over `packages/shared/src/` returns zero matches (`investigation-1.md` §4). Per
CLAUDE.md the shared package is the contract "both sides consume", so it comes first.

## Scope
- `apps/api/src/modules/planning/services/goal-plan.ts` — round the reported paise.
- `apps/api/src/modules/planning/services/goal-plan.test.ts` — update only if it
  currently asserts fractional values.
- **New** `packages/shared/src/schemas/planning.ts` — the 6 planning schemas.
- **New** `packages/shared/src/schemas/credit.ts` — revolving-debt schemas.
- `packages/shared/src/index.ts` — export both new files.
- **New** parity + runtime schema tests (see P5/P6).

### Complete required export list (AC3 is checked against exactly this)
There are **7 response contracts** (one per planned endpoint) but **8** top-level
schema names, because the glide-path response is an *array*: `GlideStepSchema` is the
array **element** schema and `GlidePathScheduleSchema = z.array(GlideStepSchema)` is
the actual response contract. Parity assertions are written against the 7 contracts.

Response contracts (7): `IncomeSurplusResultSchema`, `DataCompletenessReportSchema`,
`MultiGoalAllocationPlanSchema`, `GlidePathScheduleSchema`, `RebalancingPlanSchema`,
`InstrumentGuidanceSchema`, `HouseholdRevolvingDebtSchema`.
Plus the element schema `GlideStepSchema`.

Nested: `MonthlyIncomeSchema`, `CommittedOutflowSchema`, `AccountReadinessSchema`,
`GoalAllocationResultSchema`, `DriftAnalysisSchema`, `RebalancingActionSchema`,
`ContributionRedirectionActionSchema`, `CorpusSwitchActionSchema`,
`DeRiskingEventSchema`, `InstrumentSuggestionSchema`, `SuitabilityTierSchema`,
`InstrumentCategorySchema`, `AllocationLegSchema`, `StatementPaymentStatusSchema`,
`CardRevolvingStatusSchema`, `PaymentStateSchema` — each with its inferred type alias.

## Dependencies
- 057 (COMPLETE) — green baseline.
- Blocks 059 (route wiring) and 07.x (UI).

## Plan
- **P0 (money invariant, do first)**: In `goal-plan.ts`, make every paise field of
  `GlideStep` an integer. Round **at the point of assignment into the step**
  (`projectedCorpusPaise: Math.round(corpusAtStepStart)`), *not* by rounding
  `corpusAtStep` inside the projection chain — that preserves the accuracy of the
  forward compounding while making the reported contract value integral. Also
  audit `requiredMonthlyPaise` (via `computeRequiredMonthlyPaise`) and confirm it
  is already integral; if not, round it too. Report which fields needed changing.
- **P1**: Transcribe each of the 7 service return types (and every nested type)
  into Zod. Money → `z.number().int()`. **Nullable vs optional is not
  interchangeable** — these types are overwhelmingly *required-but-nullable*
  (`.nullable()`, not `.optional()`); getting this backwards is the most likely
  silent error. Confirmed required-but-nullable include: `conservativeSurplusPaise`,
  `optimisticSurplusPaise`, all 7 nullable `AccountReadiness`/report date+count
  fields, `slipMonths`, `lockInSummary`, `latestStatement`, `totalDuePaise`,
  `minDuePaise`, `estimatedMonthlyChargePaise`.
- **P2**: All response temporal fields are **strings, not `Date`** (`data-completeness.ts`
  produces strings at lines 159+; `goal-plan.ts` `toISODate` at line 55). Do **not**
  use `z.coerce.date()` anywhere in these response schemas. The only real `Date` is
  `GlidePathInput.today`, a service *input*, out of scope.
  **Two distinct formats — do not conflate them**, and use format-aware schemas
  rather than bare `z.string()` (which would accept arbitrary text and fail to
  encode the contract):
  - `YYYY-MM-DD` (glide `fromDate`/`toDate`, data-completeness dates): `z.iso.date()`
    if available in the installed Zod v4, else a project-consistent regex refinement.
  - `YYYY-MM` (`MonthlyIncome.month` at `income-surplus.ts:8`,
    `StatementPaymentStatus.period` at `revolving-debt.ts:13`): explicit regex,
    e.g. `/^\d{4}-(0[1-9]|1[0-2])$/`. These are year-month strings, **not** ISO dates.
- **P3**: `RebalancingAction` is a genuine discriminated union — model it with
  `z.discriminatedUnion("type", [ContributionRedirectionActionSchema, CorpusSwitchActionSchema])`
  on the `type` key (`"redirect_contributions"` / `"switch_corpus"`).
- **P4**: Place the 6 planning schemas in new `schemas/planning.ts`; revolving-debt
  in new `schemas/credit.ts`. Register both in `index.ts`. Before adding, check each
  new exported name for collisions — the barrel is a flat `export *`, so a duplicate
  export is a build break. (review-1 §2 found no existing collisions; re-verify.)
- **P5 (compile-time parity)**: Use an exactness helper, not bare assignments:
  ```ts
  type Equal<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
  type Assert<T extends true> = T;
  type _IncomeSurplusParity = Assert<Equal<z.output<typeof IncomeSurplusResultSchema>, ServiceIncomeSurplusResult>>;
  ```
  Use `z.output<>` (not `z.infer`) to name the response contract explicitly.
  Prefix with `_` — `eslint.config.js:12` sets `varsIgnorePattern: "^_"`. **Alias the
  service-side types** on import (e.g. `IncomeSurplusResult as ServiceIncomeSurplusResult`);
  importing both same-named types into one module is illegal.
- **P6 (runtime tests — the criterion that actually protects production)**. Two
  tiers, because "real service output" is **not** achievable for all 7 without a
  database:
  - **Tier A — 4 pure contracts** (`GlidePathSchedule`, `RebalancingPlan`,
    `InstrumentGuidance`, `MultiGoalAllocationPlan`): call the real service function
    and `safeParse` its **actual output**.
  - **Tier B — 3 DB-backed contracts** (`IncomeSurplusResult`,
    `DataCompletenessReport`, `HouseholdRevolvingDebt`): these need a `Db` handle and
    the repo's DB tests are all `DATABASE_URL`-gated, so parse a **realistic typed
    fixture assembled using the exported pure helpers**, annotated `satisfies <ServiceType>`
    so the compiler enforces shape:
    - `IncomeSurplusResult`: `{ ...input, ...computeIncomeSurplus(input) }` (`income-surplus.ts:65`).
    - `DataCompletenessReport`: hand-build `accounts`/dates/counts, deriving the two
      computed fields via `computeConfidence` (`data-completeness.ts:78`).
    - `HouseholdRevolvingDebt`: assemble a card + aggregate using real
      `derivePaymentState` and `estimateMonthlyCharge` (`revolving-debt.ts:62,79`).
    Do **not** build an elaborate fake `Db` — disproportionate for a contract task.
  Must also include: a nontrivial multi-step `buildGlidePathSchedule` result parsed by
  `GlidePathScheduleSchema` (this is what would have caught P0); **both** branches of
  the rebalancing union (drift closable within 18 months with an available SIP →
  `redirect_contributions`; no suitable SIP or closure beyond 18 months →
  `switch_corpus`); negative tests that omitting a required-nullable field fails;
  enum-rejection tests; and a **table-driven negative test that feeds a fractional
  value to every money field** and asserts rejection (this is the only thing that
  actually proves AC6's `.int()` requirement). Add a barrel import smoke test proving
  every name in the Scope export list is reachable from `@compass/shared`.
- **P7**: Add a test asserting `Number.isInteger(step.projectedCorpusPaise)` for every
  step of a nontrivial schedule — `goal-plan.test.ts` currently has **no** assertion
  on `projectedCorpusPaise` at all, so this coverage gap is why P0's bug survived.

## Acceptance Criteria
- **AC1**: `npm run typecheck` exits 0 across all workspaces.
- **AC2**: `npm run lint` exits 0, 0 errors 0 warnings.
- **AC3**: Every name in the Scope export list exists and is importable from
  `@compass/shared`, proven by the P6 barrel smoke test.
- **AC4**: Compile-time parity assertions exist for all 7 contracts and compile.
  *Scoped claim:* these prove TypeScript **output-shape** parity only. They do
  **not** prove runtime validation correctness — `.int()`, `z.uuid()`, enum
  narrowing, transforms and unknown-key stripping all still infer as plain
  `number`/`string`. AC5 is what covers that.
- **AC5**: Runtime `safeParse` tests pass for all 7 contracts — **Tier A (4 pure)
  against actual service output; Tier B (3 DB-backed) against `satisfies`-checked
  fixtures built from the exported pure helpers**. Includes the multi-step glide-path
  case, both union branches, negative required-nullable cases, and enum rejection.
- **AC6**: Every money field is `z.number().int()`, **and** the glide path actually
  emits integers so the constraint holds at runtime. Proven by two things, since
  compile-time parity cannot see `.int()` at all:
  (a) `GlidePathScheduleSchema.safeParse(buildGlidePathSchedule(multiStepInput)).success === true`;
  (b) the table-driven negative test rejecting a fractional value in **every** money
  field across all 7 schemas.
- **AC7**: No `z.any()`, `z.unknown()`, `as any`, `@ts-expect-error`, `@ts-ignore`,
  or `eslint-disable` used anywhere to force parity or silence a failure.
- **AC8**: Baseline-relative test health (not a hardcoded count): **no test that
  passed before this task fails after it**, and the only failures are the known
  `DATABASE_URL`-gated set. Capture the pre-task baseline first, then compare.
- **AC9**: Apart from `goal-plan.ts` (+ `goal-plan.test.ts`, and
  `rebalancing-plan.test.ts` **only if** the ≤1-paise downstream effect below changes
  an exact assertion), **no service, route, or plugin file is modified**. No route is
  added. Any such test edit must be itemised and justified, never silently rewritten.
- **AC10**: No route added ⇒ `route-surface.snapshot.txt` and
  `route-table.snapshot.txt` are **byte-identical**.
- **AC11**: P0 does **not** round or otherwise modify the internal forward projection
  chain (`goal-plan.ts:171-173` unchanged); it rounds **only** when materialising each
  `GlideStep.projectedCorpusPaise`. It is *not* claimed that no downstream output can
  change: `buildRebalancingPlan` consumes this public field at `rebalancing-plan.ts:197`
  and computes `Math.round((next.projectedCorpusPaise * equityChangePct) / 100)` at
  lines 203-205, so `DeRiskingEvent.equityToSwitchPaise` may shift by up to 1 paise.
  That downstream output must be **re-verified**, and any resulting assertion change
  itemised (see AC9).

## Verification
- **T0**: **Before any edit**, capture: (a) `git status --short`; (b) the full
  `git diff` output for the six tracked files already modified by task 057, so their
  content is on record; (c) the test baseline (totals + failing-file list); (d) the
  current contents/hashes of both route snapshot `.txt` files. A later whole-tree diff
  cannot distinguish task ownership without this — the tree is **already dirty**.
  ⚠ Note `apps/api/src/modules/planning/services/income-surplus.test.ts` is one of
  057's six modified files and sits inside the planning area this task touches. Do
  **not** mistake that pre-existing modification for 058 work, and do not revert it.
- **T1**: `npm run typecheck` — full output + exit code.
- **T2**: `npm run lint` — full output + exit code.
- **T3**: `npm run test` — per-workspace totals; diff the failing-file set against T0.
- **T4**: `git status --short` and `git diff -- <task-owned paths>`. **Note the tree
  is already dirty with task 057's 6 uncommitted files**, so a whole-tree diff cannot
  prove cleanliness — verify per-path that 058 touched only its allowed files, and
  that 057's six files are unchanged by this task.
- **T5**: Prove the assertions are not vacuous, and document their limit. **Corrected
  after review-2 — my earlier version of this step was wrong.**
  (a) Change a schema money field to `z.string()` → `npm run typecheck` **must fail**
      (proves compile-time parity bites).
  (b) Remove an `.int()` → typecheck **still passes**, *and* the **positive** parse
      test also still passes, because removing a refinement only makes the schema
      *less* restrictive. What must fail is the **table-driven negative test** that
      feeds a fractional value (e.g. `{ ...valid, projectedCorpusPaise: 123.5 }`)
      and expects `safeParse(...).success === false`.
  Revert both. Together these show exactly why AC5/AC6's negative tests exist and
  why compile-time parity alone is insufficient.
- **T6**: `grep -nE "z\.any\(|z\.unknown\(|as any|ts-expect-error|ts-ignore|eslint-disable"`
  over the new/changed files — expect no matches.
- **T7**: `git diff` on both snapshot `.txt` files — expect empty.
- **T8**: Show the literal `safeParse` result for a ≥3-step glide path **and** print
  the raw steps with an explicit `Number.isInteger` check per step, evidencing integer
  `projectedCorpusPaise` throughout.
- **T9**: Re-run `rebalancing-plan.test.ts` specifically (it calls
  `buildGlidePathSchedule` at lines 146 and 159) and report whether any
  `DeRiskingEvent.equityToSwitchPaise` assertion shifted by the ≤1-paise effect.

## Non-Goals
- **Route wiring** — task 059 owns `plugin.ts`, the route files, and snapshot
  regeneration. 058 adds no route.
- **Input schemas** (`GoalAllocationEntry`, `GlidePathInput`): explicitly out of
  scope. They are route-orchestration inputs; 059 decides whether they need
  contracts. 058 covers *response* shapes only.
- `GET /api/instrument-rules/:category` — not exposed (see Decisions).
- UI work (07.01–07.04).
- The 3 unwritten services: 5.4 AI narrative, 6.5 lever advisor, 6.7 tax-aware rebalancing.
- Refactoring services to import their types *from* shared (see Decisions).
- Fixing the `DATABASE_URL`-gated failures. Committing anything, incl. `screen-shots/`.

## Decisions / Notes
- **Fold P0 into this task rather than loosening the schema.** The two candidate
  resolutions were: round in the service, or allow non-integer paise in the
  contract. The latter was rejected — it would enshrine a violation of CLAUDE.md's
  central money rule in the public API. Since a correct contract is impossible while
  the service emits fractional paise, the fix belongs here, as an explicit scope
  expansion that amends the earlier "no service file modified" criterion (now AC9).
- **Revolving-debt goes in a new `schemas/credit.ts`, not `wealth.ts`** — reversing
  my earlier call, on Codex's evidence that `wealth.ts` is already a large mixed
  file (cards, retirement, NPS, EMIs, holdings, tax lots, net worth). The service
  and its future route live in the credit module, so a credit contract file is the
  right domain ownership. Not the credit module's own `schema.ts` — that is Drizzle
  persistence, whereas shared Zod files are HTTP contracts.
- **New `schemas/planning.ts` confirmed appropriate** — these 6 groups do not belong
  in `goals.ts` (already CRUD + projection + cashflow + bills + preferences) or
  `insights.ts` (dashboard cards only).
- **No `InstrumentCategory` collision exists.** I had assumed `wealth.ts` exported
  it; review-1 §2 disproved that — `wealth.ts` uses `AssetClass`. My assumption was
  wrong and the plan no longer depends on it.
- **Duplicate-then-assert, not shared-as-single-source-of-truth.** Making services
  import `z.output<typeof Schema>` from shared would make drift structurally
  impossible, but churns 8 already-tested service files. Deferred; the parity
  assertions plus runtime tests make drift unable to land silently. Revisit after 059.
- Endpoint paths reserved for 059 (not implemented here): `/api/planning/income-surplus`,
  `/api/planning/data-completeness`, `/api/planning/allocation`,
  `/api/planning/instrument-guidance`, `/api/goals/:id/glide-path`,
  `/api/goals/:id/rebalancing-plan`, `/api/credit/revolving-debt`.
- **059 must add route-level tests asserting a real 200, not a 500** — an over-strict
  response schema fails only at serialization time, which is invisible to 058.
- No backup/schema-decomposition impact: no Drizzle table or enum is added
  (`backup.test.ts:39`, `schema.decomposition.test.ts:140` cover DB tables only).
  No shared-schema registry snapshot exists to update.

## Stage 1 (P0/P7) — implemented, reviewed, PASS
Single production change: `goal-plan.ts:166`
`projectedCorpusPaise: corpusAtStepStart` → `Math.round(corpusAtStepStart)`.
Projection chain at lines 171-173 byte-unchanged. P7 integer test added at
`goal-plan.test.ts:315`. Verified integer output on a 5-step schedule:
`100000000, 116783545, 154475653, 196581751, 242224196`.
`requiredMonthlyPaise` confirmed already integral. `buildGoalPlan`'s paise fields
audited — no other fractional value. typecheck 0, lint 0, goal-plan 21/21,
rebalancing-plan 11/11.

**P7 test proven non-vacuous** by two independent reproductions, both confirming that
every step after the first was fractional pre-fix, so reverting line 166 fails the test:
- `review-3.md`: `115756969.69569434, 150580082.9709159, 190256828.9219609, 234846807.19431105`
- `verification-1.md`: `116783545.39255677, 154475653.36787066, 198328521.7918907, 246467484.81298295`

⚠ **Caveat, recorded honestly:** those two sets differ from each other and from the
implementer's post-fix values (`116783545, 154475653, 196581751, 242224196`) at the
later steps, because Codex and the verifier each *re-derived* the arithmetic in a
throwaway script rather than calling the real function with the real band boundaries.
The qualitative claim (steps 2+ fractional pre-fix, all integral post-fix) is robust
and triply confirmed; the exact digits are **not** mutually corroborated and should not
be cited as if they were. Authoritative evidence is the real function's post-fix output
plus the passing P7 assertion.

### Stage 1 independently verified (verification-1.md)
Lines 171-173 byte-unchanged; only `goal-plan.ts` + `goal-plan.test.ts` touched; all
six task-057 files intact and unreverted; `packages/shared`, routes, plugins and both
snapshot files untouched; no suppressions; nothing staged; `screen-shots/` untracked.
Suite: **1336 total, 1309 pass, 26 fail, 1 skip**; `npm run test` exits **1**.
**Exit-code dispute settled against the implementer's report** — it exits 1 (26 DB-gated
files throw `needs DATABASE_URL set` at module load), not 0.

### Carried into Stage 2 (from review-3)
- **`.int()` is not a safe-integer or finiteness guarantee.** `Math.round(NaN)` is
  `NaN` and `Math.round(Infinity)` is `Infinity`; values past
  `Number.MAX_SAFE_INTEGER` satisfy `Number.isInteger` while being unsafe as paise.
  Stage 2 money schemas must therefore **reject non-finite values** and should
  constrain to the safe-integer range rather than relying on `.int()` alone.
- **Coverage gap to close**: `DeRiskingEvent.equityToSwitchPaise` is asserted only
  `> 0` (`rebalancing-plan.test.ts:177`) and nowhere exactly, so a substantial
  calculation regression could stay positive and pass. Add an exact-value assertion.
- **Worker report inaccuracy** (not a code defect): `implementation-1.md` claims the
  full root `npm run test` exits 0. It exits **1**, because `DATABASE_URL` is absent.
  Codex's totals are otherwise consistent; its table omitted the extractor (74) and
  ingestor (12) rows, so the real total is 1336 = the prior 1335 + the new P7 test.

## Stage 2 (P1-P6) — implemented, reviewed, PASS
New: `packages/shared/src/schemas/planning.ts` (6 groups),
`packages/shared/src/schemas/credit.ts`, plus `planning-schemas.test.ts` (36 tests)
and `credit-schemas.test.ts` (14 tests). Modified: `index.ts` (2 export lines) and
`rebalancing-plan.test.ts` (one exact assertion).
Zod APIs used: `.safe()` for money, `z.iso.date()` for `YYYY-MM-DD`, regex for `YYYY-MM`.
Suite: **1386 total, 1359 pass, 26 fail, 1 skip** (API 736→786, +50 new tests);
`npm run test` exits 1 by design. typecheck 0, lint 0, no suppressions, both route
snapshots byte-identical (hashes recorded in `review-4.md` §7).

### review-4.md — Stage 2 implementation review: PASS
- **All 7 contracts match their service types field-for-field** — no field missed,
  invented, wrongly optional, or wrong enum set. Every required-but-nullable field
  correctly uses `.nullable()`.
- 7 bidirectional parity assertions, non-vacuous (mutating a money field to
  `z.string()` yields TS2344).
- Runtime tests: two tiers correct; Tier A genuinely calls the real services; both
  discriminated-union branches come from real `buildRebalancingPlan` output.
  Fractional-money coverage is **exhaustive, not sampled — 26 distinct money paths**
  (data-completeness and instrument-guidance legitimately have 0, having no money fields).
- The exact `equityToSwitchPaise = 10_800_000` assertion independently re-derived:
  `50_000_000 × 1.08 = 54_000_000`, then `× 20% = 10_800_000`. Legitimate, and it locks
  the glide-path→rebalancing calculation instead of merely asserting positivity.
- **Export-collision question settled definitively.** My earlier explorer's claim that
  `b829d87` added `InstrumentCategory` to `wealth.ts` was **wrong** — that commit added
  only `aprBps`, `cashAprBps`, `lateFeePaise`, `interestFreeDays`. `wealth.ts` exports
  `AssetClass`. `InstrumentCategory` existed only in API-local `instrument-rules.ts`,
  outside the shared barrel. Hence no TS2308.
- Schemas confirmed **safe for Fastify response serialization** against current outputs.
- **One defect, fixed separately:** the doc comments claimed `.int()` alone does not
  exclude non-finite/unsafe values. In Zod 4.4.3 that is **false** — `z.number()`
  already rejects NaN/±Infinity and `.int()` already enforces the safe-integer range,
  so `.safe()` is redundant (retained deliberately as an explicit guard). Comments
  corrected; `.safe()` kept per Codex's recommendation.

## Review log
### review-1.md — plan review (all findings valid; plan revised)
1. **BLOCKING**: `GlideStep.projectedCorpusPaise` is fractional → `.int()` would 500
   at runtime. → Folded in as P0; verified myself at `goal-plan.ts:160-176`.
2. Nested-schema inventory incomplete (missing `StatementPaymentStatus`,
   `SuitabilityTier`, `ContributionRedirectionAction`, `CorpusSwitchAction`) and
   `GlidePathScheduleSchema` was silently dropped (service returns `GlideStep[]`).
   → Full explicit export list now in Scope.
3. Compile-time parity cannot validate `.int()`/uuid/date refinements. → AC4 rescoped
   to an explicit "shape only" claim; runtime tests added as P6/AC5.
4. No `InstrumentCategory` collision — my assumption was wrong. → Corrected.
5. `null as unknown as X` is *not* vacuous, and `_`-prefixed vars satisfy lint
   (`eslint.config.js:12`). Better idiom: `Equal`/`Assert` with `z.output`. → Adopted as P5.
6. Response dates are ISO **strings**, not `Date`; no `z.coerce.date()`. → P2.
7. `wealth.ts` is a large mixed file; prefer new `schemas/credit.ts`. → Accepted, P4.
8. Service/shared same-name imports collide in the parity test. → Aliasing required, P5.
9. AC7's hardcoded "26 failures" is brittle. → Now baseline-relative (AC8/T0).
10. T4 said "4 files" but listed 5, and the tree is already dirty with 057's
    uncommitted changes. → T4 rewritten to verify per-path.
11. T5's example only proves primitive mismatch; removing `.int()` still typechecks.
    → T5 now proves both the assertion bites *and* its limitation.

### review-2.md — re-review of the revision (all findings valid; plan amended again)
Codex confirmed P0's rounding **location** is correct (rounding inside the projection
chain would compound error), that `requiredMonthlyPaise` is **already integral**
(`Math.ceil` at `goal-plan.ts:85`), that `goal-plan.test.ts` has **no** assertion on
`projectedCorpusPaise` so nothing there breaks, that the `Equal`/`Assert` helper **does**
catch optional-vs-required-nullable drift, and that P0 should **stay** in 058. New findings:
1. **My T5 was technically wrong.** Removing `.int()` makes the schema *less*
   restrictive, so a positive parse test still passes. Only a **negative** fractional
   fixture proves `.int()` is enforced. → T5 rewritten; table-driven negative test added.
2. **P6 overpromised.** "Real service output" is unachievable for the 3 DB-backed
   contracts without a DB or a heavy Drizzle mock. → Split into Tier A (pure, real
   output) / Tier B (`satisfies`-checked fixtures via exported pure helpers).
3. **P0 has a downstream consumer I had missed.** `buildRebalancingPlan` reads
   `projectedCorpusPaise` (`rebalancing-plan.ts:197,203-205`), so
   `DeRiskingEvent.equityToSwitchPaise` can shift ≤1 paise — and my AC9 would have
   *forbidden* fixing the resulting test. → AC9 widened, AC11 reworded, T9 added.
4. Bare `z.string()` does not validate the asserted formats, and `YYYY-MM`
   (`month`, `period`) is **not** the same as `YYYY-MM-DD`. → P2 now format-aware and
   distinguishes the two.
5. AC6 "every money field" needed systematic negative coverage, not just glide path.
   → Table-driven fractional-rejection test.
6. Terminology: 7 response groups vs 8 top-level schema names. → Clarified in Scope.
7. T0/T4 must record the pre-existing dirty state (incl. hashes/diffs of 057's six
   files and the snapshot files) or task ownership is unprovable. → T0 expanded, with
   an explicit warning that `income-surplus.test.ts` is 057's, not 058's.
