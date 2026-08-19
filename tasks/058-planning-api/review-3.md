## Implementation review — Task 058 Stage 1

Verdict: The P0 implementation is correct for normal finite service inputs, and the P7 test is meaningful. One downstream coverage gap and finite-number edge cases should be recorded, but neither requires changing the Stage 1 implementation before Stage 2.

### 1. Rounding location and projection chain

Correct.

The only production change is [goal-plan.ts:166](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:166):

```diff
- projectedCorpusPaise: corpusAtStepStart,
+ projectedCorpusPaise: Math.round(corpusAtStepStart),
```

`git diff --unified=0` shows no other production-line change. The internal projection at [goal-plan.ts:171](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:171)–173 is byte-unchanged versus HEAD:

```ts
corpusAtStep =
  corpusAtStep * (1 + blendedBps / 10_000) ** (stepDuration / 12) +
  annuityFV(monthlyInflowPaise, stepDuration, rm);
```

Thus the public step value is rounded while forward compounding retains full precision.

### 2. Money invariant and edge cases

For ordinary finite inputs, both GlideStep money fields are integral:

- `projectedCorpusPaise` is rounded at [goal-plan.ts:166](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:166).
- `requiredMonthlyPaise` is either:
  - nullable when `targetPaise === null`, at [goal-plan.ts:155](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:155)–158;
  - integer `0` through the early returns at [goal-plan.ts:80](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:80) and [goal-plan.ts:83](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:83);
  - or integral via `Math.ceil` at [goal-plan.ts:85](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts:85).

The invariant is not unconditional for arbitrary JavaScript `number` inputs:

- `Math.round(NaN)` is `NaN`.
- `Math.round(Infinity)` is `Infinity`.
- Huge corpora, contributions, horizons, or returns can overflow the projection to `Infinity`.
- Returns below `-10000` bps can make fractional powers produce `NaN`.
- Extreme horizons can cause date construction/serialization to throw.
- Negative corpus values remain negative; rounding `-0.5` produces negative zero.
- Values beyond `Number.MAX_SAFE_INTEGER` can satisfy `Number.isInteger` without representing paise safely.

Zero or negative months and `targetPaise: null` do not inherently create fractional emitted paise. Negative finite corpus is rounded, though it may be semantically invalid.

Stage 2 schemas should reject non-finite values and ideally constrain inputs separately. `.int()` protects integrality but should not be treated as a safe-integer or domain-validation guarantee.

### 3. P7 test quality

The new test at [goal-plan.test.ts:315](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.test.ts:315) is meaningful:

- `monthsToTarget: 96` produces five steps.
- `fundedPaise` is `100_000_000`.
- `monthlyInflowPaise` is `500_000`.
- Compound corpus growth and `annuityFV()` are both exercised.
- It explicitly checks `steps.length >= 3` at [goal-plan.test.ts:326](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.test.ts:326).
- It checks every emitted step with `Number.isInteger` at [goal-plan.test.ts:328](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.test.ts:328)–333.

Without the fix, representative unrounded step-start values include:

```text
100000000               integer
115756969.69569434      fractional
150580082.9709159       fractional
190256828.9219609       fractional
234846807.19431105      fractional
```

Therefore reverting line 166 would fail the test on step two. The test is not vacuous.

### 4. Downstream rebalancing effect

The reported downstream path is correct:

- Iteration begins at [rebalancing-plan.ts:197](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:197).
- It consumes `next.projectedCorpusPaise` at [rebalancing-plan.ts:204](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:204).
- The final amount is rounded at [rebalancing-plan.ts:203](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.ts:203)–205.

The claim about assertions is also correct. The relevant test verifies:

- event count exactly;
- source equity exactly;
- destination equity exactly;
- but `equityToSwitchPaise` only with `> 0` at [rebalancing-plan.test.ts:177](/home/udai/common/compass/apps/api/src/modules/planning/services/rebalancing-plan.test.ts:177).

No exact assertion for `DeRiskingEvent.equityToSwitchPaise` exists elsewhere in the planning tests.

This is a genuine coverage gap: a substantial calculation regression could remain positive and pass. It did not cause a current failure, but an exact expected-value assertion would materially strengthen downstream verification.

### 5. Scope discipline

Tracked Stage 1 changes are limited to:

- [goal-plan.ts](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.ts)
- [goal-plan.test.ts](/home/udai/common/compass/apps/api/src/modules/planning/services/goal-plan.test.ts)

The six Task 057 modifications remain present and match the previously recorded Task 057 diff:

- `household/routes/settlements.ts`
- `household/routes/splits.ts`
- `household/services/grants.ts`
- `household/services/membership.ts`
- `planning/services/income-surplus.test.ts`
- `web/src/lib/household-queries.ts`

They were not reverted.

Also untouched:

- `packages/shared`
- rebalancing and other services
- plugins
- route registration
- [route-surface.snapshot.txt](/home/udai/common/compass/apps/api/src/route-surface.snapshot.txt)
- [route-table.snapshot.txt](/home/udai/common/compass/apps/api/src/route-table.snapshot.txt)

Both snapshot tests pass byte-for-byte.

`git diff --cached` is empty: nothing is staged. HEAD remains `b829d87` on `feat/misc-features`; no Stage 1 commit exists. The untracked task-report and screenshot directories remain present and untouched by this review.

### 6. Suppression audit

No new occurrence of any prohibited construct appears in either changed Stage 1 file:

- `eslint-disable`
- `@ts-ignore`
- `@ts-expect-error`
- `as any`

### 7. Verification results

- `npm run typecheck`: exit 0 across all seven workspaces.
- `npm run lint`: exit 0, no errors or warnings.
- `goal-plan.test.ts`: 21/21 passed.
- `rebalancing-plan.test.ts`: 11/11 passed.

Full current suite:

| Workspace | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| API | 736 | 710 | 25 | 1 |
| Web | 270 | 270 | 0 | 0 |
| AI | 32 | 32 | 0 | 0 |
| Shared | 212 | 212 | 0 | 0 |
| Total | 1,250 | 1,224 | 25 | 1 |

`npm run test` exits 1 because `DATABASE_URL` is absent. All 25 failures are the known environment-gated API files; there is no new failure relative to the recorded baseline.

The implementation report’s statement that the full root command exits 0 is incorrect. Its reported test totals are otherwise consistent.

### 8. AC11

The core AC11 implementation requirement is satisfied:

- projection chain unchanged;
- rounding occurs only when materialising the public field;
- downstream rebalancing tests were rerun and remain 11/11.

However, downstream verification is weak because the affected output is checked only for positivity, not its exact amount. AC11 is satisfied operationally, with that explicit coverage limitation.

### 9. Stage 2 readiness

No implementation defect blocks proceeding to Stage 2.

Recommended follow-ups:

- Add an exact `equityToSwitchPaise` assertion, either now or with Stage 2 runtime contract tests.
- Ensure schemas reject `NaN`/`Infinity`; do not assume `.int()` proves safe-integer paise.
- Correct the implementation report’s full-suite exit-code claim.

Stage 1 can be marked done with those limitations recorded.