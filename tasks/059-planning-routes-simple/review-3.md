# Review verdict: NOT COMPLETE

The tooling change is acceptable, but one required isolation test remains vacuous. Task 059 should not be marked complete until that test is fixed.

## Blocking finding

1. Income-surplus cross-user isolation still has no user-A income data.

At [planning-analysis.route.test.ts:151](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:151), user A receives only a bank account—not ledger transactions. The comment at lines 156–158 explicitly admits both responses retain `historyMonths = 0`.

The only isolation assertion is:

```ts
assert.equal(bodyB.historyMonths, 0, "user B (empty user) must have 0 history months; user A data must not leak");
```

That would still pass if the income-surplus ownership filter were removed because user A contributes no income history. Insert a user-A transaction/posting that makes A’s response non-empty, assert that A contains it, then assert B does not.

The data-completeness and revolving-debt isolation tests are meaningful:

- [planning-analysis.route.test.ts:269](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:269): A has accounts; B asserts `accounts.length === 0`, followed by account-ID exclusion.
- [revolving-debt.route.test.ts:216](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:216): A has cards; B asserts `cards.length === 0`, followed by card-ID exclusion.

## Unauthorized experimental flag

Recommendation: **ACCEPT the flag globally**, subject to explicit maintainer authorization and documentation.

It is not the only practical solution, but it is the least invasive solution under the iteration’s prohibition on changing production route logic.

- Dependency injection into each route plugin would be architecturally clean and eliminate the flag, but changes production plugin APIs solely for testing.
- A fake `Db` would require brittle emulation of several Drizzle fluent/relational query shapes; revolving debt additionally uses `db.query` and potentially `db.execute`.
- A Fastify decorator cannot override the current lexical ESM imports without first refactoring production code to obtain services from decorators.
- A separately flagged script is viable only if the ordinary API `test` script invokes it. Otherwise CI could silently omit these tests—the exact failure this pass was intended to prevent. Splitting the existing glob cleanly would also add shell/glob orchestration complexity.

CI does run the root test script: [.github/workflows/ci.yml:46](/home/udai/common/compass/.github/workflows/ci.yml:46) uses `npm test`, which is npm’s alias for `npm run test`; the root script dispatches every workspace at [package.json:20](/home/udai/common/compass/package.json:20). API tests consequently use the flag at [apps/api/package.json:14](/home/udai/common/compass/apps/api/package.json:14).

Risk assessment:

- CI pins Node major 24 at [.github/workflows/ci.yml:38](/home/udai/common/compass/.github/workflows/ci.yml:38). Node 24 officially provides the flag, but classifies module mocking as “Stability 1.0 — Early development.” [Node 24 documentation](https://nodejs.org/download/release/v24.15.0/docs/api/test.html)
- Root `engines.node` is only `>=24` at [package.json:6](/home/udai/common/compass/package.json:6), so local/future environments are not pinned. A future removal or rename would make the entire API test command fail immediately with an unknown-option error; it would not silently change results.
- The flag enables module-mocking infrastructure globally, but ordinary tests do not call it. I found no demonstrated semantic change to the other tests and no evidence of significant runtime cost.
- It does pollute output. The full run emitted exactly two warnings, one for each hermetic file:

```text
ExperimentalWarning: Module mocking is an experimental feature and might change at any time
```

Document in the repository’s contributor/testing documentation:

- why the global flag exists;
- which two files require it;
- that CI intentionally runs them through the normal API test command;
- its Node experimental status and warning;
- the supported CI Node major;
- how to migrate if Node changes or stabilizes the API.

A named `test:module-mocks` script is reasonable for direct execution, but `test` must continue to invoke it.

## Fix verification

### FIX 1 — genuine hermetic tests

Confirmed.

- Planning mocks the service URLs before dynamically importing the real plugin at [planning-analysis.hermetic.test.ts:75](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts:75)-95, then registers it at line 118.
- Revolving debt does the same at [revolving-debt.hermetic.test.ts:66](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.hermetic.test.ts:66)-73 and registers it at line 96.
- The “real route plugin” comments are now true.
- All six lookback cases exercise the real route and its actual `querystring` validator at [planning-analysis.hermetic.test.ts:142](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts:142)-206.
- `new URL("../services/…", import.meta.url).href` resolves to the same canonical absolute file URLs imported by the adjacent route module. This is correct and robust to working-directory changes, though moving either test outside `routes/` would require updating the relative URL.

Required non-vacuity proof, performed independently:

Before and after restoration:

```text
5374d2b08ec0b440661c8762d352e7ec090ccd20b908d2df6e7c6173f6534610
```

Temporary route-path break:

```text
ℹ tests 9
ℹ pass 2
ℹ fail 7
EXIT_CODE=1
```

Representative failure:

```text
expected 200, got 404:
{"message":"Route GET:/api/planning/income-surplus not found","error":"Not Found","statusCode":404}
```

After exact restoration:

```text
ℹ tests 9
ℹ pass 9
ℹ fail 0
EXIT=0
```

The temporary change is fully reverted; the checksum matches byte-for-byte.

### FIX 2 — service comments only

Confirmed owner-only comments at:

- [income-surplus.ts:117](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:117)
- [data-completeness.ts:159](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:159)
- [revolving-debt.ts:89](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:89)

The service diffs contain only comments. No executable service logic changed.

### FIX 3 — AC4b fixtures

The meaningful revolving-debt coverage is now present:

- account insertion: [revolving-debt.route.test.ts:95](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:95)
- `cardDetails`: line 106
- current `YYYY-MM` period and non-null monetary fields: lines 119–126
- non-empty response assertion: line 176

With Postgres, this reaches the real statement lookup and serializer with `5_000_000` paise, exercising the safe Drizzle-number path and strict period happy path. It does not prove malformed or unsafe database values are handled—the risks remain correctly documented.

The planning test’s statement insertion at [planning-analysis.route.test.ts:203](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:203) is superficial: data-completeness does not serialize statement period or due amounts. It adds no coverage for those two revolving-debt risks, although the credit integration test supplies the necessary coverage.

### FIX 5 — `today`

The production explanation is accurate at [planning-analysis.ts:51](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:51)-59: no `querystring` schema, no Zod stripping claim, and the handler omits the third service argument at line 63.

The hermetic test asserts both:

```ts
assert.notEqual(body.asOf, "2020-01-01");
assert.equal(body.asOf, "2026-08-18");
```

at [planning-analysis.hermetic.test.ts:243](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.hermetic.test.ts:243)-244. The real-DB test also asserts the supplied date is not returned.

### FIX 6 — plugin comments/order

Comments now distinguish relocated routes from newly added routes:

- [planning/plugin.ts:15](/home/udai/common/compass/apps/api/src/modules/planning/plugin.ts:15)
- [credit/plugin.ts:11](/home/udai/common/compass/apps/api/src/modules/credit/plugin.ts:11)

No registration was reordered. Planning analysis remains last after projection settings; revolving debt remains last after overdraft details.

## Regression evidence

- `route-surface.snapshot.txt`: exactly 319 lines and only six additions—three GET plus three HEAD.
- Snapshot test: 7/7 pass, including both byte-exact comparisons.
- Plugin enumeration: 9 planning and 5 credit files; 2/2 pass.
- The three handlers remain single direct service returns at [planning-analysis.ts:43](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:43), line 63, and [revolving-debt.ts:33](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.ts:33).
- Validator remains exactly `z.coerce.number().int().min(1).max(120).default(12)`.
- Route checksums/evidence in the iteration report and current inspection show no iteration-2 handler or validator change.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` introduced.
- No test was skipped, weakened, or deleted to obtain green.
- `git diff --check` is clean.
- Lint: exit 0, no warnings.
- Typecheck: all seven workspace `tsc --noEmit` commands completed without diagnostics.

Root test literal result:

```text
EXIT=1

@compass/api        799 total / 771 pass / 27 fail / 1 skip
@compass/extractor   74 total /  73 pass /  1 fail / 0 skip
@compass/ingestor    12 total /  12 pass /  0 fail / 0 skip
@compass/web        270 total / 270 pass /  0 fail / 0 skip
@compass/ai          32 total /  32 pass /  0 fail / 0 skip
@compass/shared     212 total / 212 pass /  0 fail / 0 skip

TOTAL              1399 total / 1370 pass / 28 fail / 1 skip
```

Classification:

- 26 pre-existing environment-gated failures: 25 API files and extractor’s `statement-duplicate.test.ts`.
- 2 new-by-design environment-gated failures: `planning-analysis.route.test.ts` and `revolving-debt.route.test.ts`.
- 0 genuine regressions.

Task 059 remains blocked only by the vacuous income-surplus cross-user isolation test. The experimental flag requires explicit authorization/documentation but is not, on technical grounds, a reason to reject the implementation.