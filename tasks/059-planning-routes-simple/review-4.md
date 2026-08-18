# Final review — NOT COMPLETE

FIX A’s fixture is genuinely recognized as income, but the rewritten test is broken for a different reason: `historyMonths` is always the requested window length—12 by default—even for an empty user. Therefore the user-B `historyMonths === 0` assertion cannot pass against the current service.

## 1. FIX A: fixture validity and non-vacuity

The inserted transaction does satisfy the production income predicate:

- Bank account: `type: "bank"`, implicit `systemKind: null` at [planning-analysis.route.test.ts:114](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:114).
- Income system account: `type: "system", systemKind: "income"` at [planning-analysis.route.test.ts:120](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:120).
- Current-date transaction owned by user A at [planning-analysis.route.test.ts:126](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:126).
- Positive bank posting of `100_000` paise at [planning-analysis.route.test.ts:135](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:135).
- Negative income-system counter-posting at [planning-analysis.route.test.ts:142](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:142).

The SQL at [income-surplus.ts:148](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:148):

- groups this transaction into its `YYYY-MM`;
- sums only positive postings on non-liability, non-system accounts;
- excludes the negative counter-posting through `a.system_kind is null`;
- accepts the transaction because `hasCategoryDimension()` finds the income-system posting at [ledger-sql.ts:26](/home/udai/common/compass/apps/api/src/lib/ledger-sql.ts:26).

Thus user A legitimately gets one month with exactly `100_000` income paise. If `t.user_id = userId` at [income-surplus.ts:155](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:155) were removed, the fourth assertion would detect user A’s income in user B’s response.

However, the test fails even with correct production code. The service fills all 12 requested months, including zero-income months, at [income-surplus.ts:170](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:170), then defines:

```ts
const historyMonths = months.length;
```

at [income-surplus.ts:69](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:69). Consequently, both A and empty B have `historyMonths === 12`, not `0`.

Verdict: the fixture is genuinely non-vacuous, but the rewritten test is broken, not ready.

## 2. The four assertions

The assertions are:

- [planning-analysis.route.test.ts:239](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:239):

  ```ts
  assert.ok(bodyA.historyMonths > 0, ...)
  ```

  This passes, but is not evidence of inserted data because the default response always contains 12 months.

- [planning-analysis.route.test.ts:240](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:240)-244:

  ```ts
  const userAIncomingMonth = bodyA.months.find((m) => m.incomePaise === amountPaise);
  assert.ok(userAIncomingMonth !== undefined, ...)
  ```

  Meaningful and correctly written. Exactly `100_000` is robust here: only the positive bank posting is summed; the negative system leg is excluded. Values are already paise, with no rupee conversion.

- [planning-analysis.route.test.ts:248](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:248):

  ```ts
  assert.equal(bodyB.historyMonths, 0, ...)
  ```

  Incorrect. Expected value is 12 under the current service.

- [planning-analysis.route.test.ts:249](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:249)-254:

  ```ts
  const leakedMonth = bodyB.months.find((m) => m.incomePaise > 0);
  assert.equal(leakedMonth, undefined, ...)
  ```

  Correct, meaningful, and sufficient to catch removal of the ownership filter.

The blocker can be resolved by replacing the incorrect B-history assertion with an expectation consistent with the service, while retaining the positive-income exclusion assertion.

## 3. Obsolete comment

Yes. The old comment admitting that both users had `historyMonths = 0` was removed.

The replacement comments at [planning-analysis.route.test.ts:210](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:210) and [planning-analysis.route.test.ts:246](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:246) now claim B has zero history, but that claim is itself incorrect.

## 4. Other tests

No other test was weakened or removed by the final small pass.

The previously meaningful data-completeness isolation test remains intact at [planning-analysis.route.test.ts:309](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:309)-351:

- user A receives a real account;
- A must have a non-empty account list;
- B must have zero accounts;
- account IDs are explicitly checked for leakage.

There is an additional real-Postgres teardown concern already present in this file: `cleanupUser()` directly deletes the user at [planning-analysis.route.test.ts:77](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:77), but both `accounts.user_id` and `transactions.user_id` use `ON DELETE no action` in [0000_nosy_lizard.sql:768](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:768) and [0000_nosy_lizard.sql:792](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:792). Tests that insert accounts or transactions appear likely to fail during `t.after` cleanup unless the live database differs from the checked-in migration.

## 5. FIX B: `CLAUDE.md`

The new documentation at [CLAUDE.md:39](/home/udai/common/compass/CLAUDE.md:39)-43 is substantially accurate:

- The flag enables `node:test` module mocking.
- The two dependent files are named correctly.
- The API test script includes both through its normal glob at [apps/api/package.json:14](/home/udai/common/compass/apps/api/package.json:14).
- Root `npm test` dispatches workspace tests at [package.json:20](/home/udai/common/compass/package.json:20), and CI invokes it at [.github/workflows/ci.yml:46](/home/udai/common/compass/.github/workflows/ci.yml:46).
- CI pins Node 24 at [.github/workflows/ci.yml:38](/home/udai/common/compass/.github/workflows/ci.yml:38), while `engines.node` is `>=24` at [package.json:6](/home/udai/common/compass/package.json:6).
- The combined hermetic run emitted exactly two module-mocking `ExperimentalWarning` messages.
- An unknown flag fails loudly: verified exit code 9 with `node: bad option`.
- “Stability 1.0 — Early development” matches Node’s classification.

Minor wording caveat: “two warning lines per run” is true for a normal API/root run containing both files; directly running only one hermetic file would emit one warning.

The diff adds only this documentation block; no unrelated `CLAUDE.md` content was restructured.

## 6. Regression checks

- `route-surface.snapshot.txt`: exactly 319 lines.
- `route-table.snapshot.txt`: 174 lines; it was not previously expected to contain 319.
- Snapshot suite: 7/7 passing, including both byte-exact comparisons.
- Plugin enumeration: planning 9, credit 5; 2/2 passing.
- The three route handlers remain direct service returns at [planning-analysis.ts:43](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:43), [planning-analysis.ts:63](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:63), and [revolving-debt.ts:33](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.ts:33).
- Query validator remains exactly `z.coerce.number().int().min(1).max(120).default(12)` at [planning-analysis.ts:37](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:37).
- Both hermetic files are unchanged by this pass and pass together: 11/11.
- Service owner-only comments remain at [income-surplus.ts:117](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:117), [data-completeness.ts:159](/home/udai/common/compass/apps/api/src/modules/planning/services/data-completeness.ts:159), and [revolving-debt.ts:89](/home/udai/common/compass/apps/api/src/modules/credit/services/revolving-debt.ts:89).
- `apps/api/package.json` was not part of this final pass; its existing flag change remains.
- `git diff --check` is clean.

## 7. Root test result

Literal result:

```text
EXIT=1
```

| Workspace | Tests | Pass | Fail | Skip |
|---|---:|---:|---:|---:|
| API | 799 | 771 | 27 | 1 |
| Extractor | 74 | 73 | 1 | 0 |
| Ingestor | 12 | 12 | 0 | 0 |
| Web | 270 | 270 | 0 | 0 |
| AI | 32 | 32 | 0 | 0 |
| Shared | 212 | 212 | 0 | 0 |
| **Total** | **1399** | **1370** | **28** | **1** |

Classification:

- 26 pre-existing environment-gated failures: 25 API files plus extractor’s `statement-duplicate.test.ts`.
- 2 new AC4b environment-gated files: `planning-analysis.route.test.ts` and `revolving-debt.route.test.ts`.
- All 28 are database-environment failures, but saying all 28 are “pre-existing” is incorrect.
- Zero failures are demonstrated regressions in the runnable suite.

## 8. Typecheck, lint, suppressions

- Typecheck: literal exit 0.
- Lint: literal exit 0, no warnings.
- No `as any`, `@ts-ignore`, `@ts-expect-error`, or `eslint-disable` was introduced in the reviewed files.
- No test was newly skipped, weakened, or deleted by this pass.

## Final verdict

Task 059 is still blocked.

The new income fixture is correct and would register exactly `100_000` paise, but the isolation test incorrectly asserts that an empty user has `historyMonths === 0`; production currently returns 12. The test therefore cannot pass when finally run against Postgres. The cleanup foreign-key issue should also be resolved or demonstrated safe against the actual CI schema.

The real-Postgres serializer risk remains open by design. The AC4b tests are present but cannot be executed in this environment, and the source comments honestly describe those residual risks rather than claiming them closed.