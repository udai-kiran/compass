# Closing review — Task 059

## Verdict: COMPLETE

No blocking defects remain. The two review-4 defects are correctly fixed. Task 059 can be marked **COMPLETE**.

### 1. `historyMonths`

The new assertions are correct.

- `historyMonths` is `months.length`: [income-surplus.ts:69](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:69).
- The service unconditionally generates exactly `lookbackMonths` entries, including zero-income months: [income-surplus.ts:170](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:170).
- The route defaults `lookbackMonths` to 12: [planning-analysis.ts:37](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.ts:37).
- This test calls the route without a query string: [planning-analysis.route.test.ts:228](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:228).

Therefore both users receive `historyMonths === 12`, regardless of whether income rows exist. The assertions at [planning-analysis.route.test.ts:247](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:247) and [planning-analysis.route.test.ts:257](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:257) will pass against Postgres.

A non-default query would change the count, but this test does not supply one. Transaction-window boundaries affect income values, not the generated array length.

### 2. Isolation test

The test is now correct and non-vacuous.

The two meaningful assertions remain:

- User A must contain the exact inserted income: [planning-analysis.route.test.ts:248](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:248).
- User B must contain no positive-income month: [planning-analysis.route.test.ts:258](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:258).

The service’s ownership predicate is [income-surplus.ts:155](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:155). Removing it would allow A’s transaction into B’s grouped query, making B’s positive-income assertion fail.

There is no material month-boundary/timezone flake:

- Both fixture and service use UTC-derived dates/month keys: [planning-analysis.route.test.ts:132](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:132), [income-surplus.ts:136](/home/udai/common/compass/apps/api/src/modules/planning/services/income-surplus.ts:136).
- PostgreSQL `date` has no timezone conversion.
- Even if execution crosses UTC midnight or a month boundary, the just-inserted date remains inside the trailing 12-calendar-month window.

### 3. Exact amount

The `100_000` exact-match assertion is safe.

The fixture creates one positive bank posting and one excluded system-account counter-posting: [planning-analysis.route.test.ts:120](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:120). Queries are scoped to the newly generated user UUID. No other fixture inserts income for that user, so no row can inflate that month’s sum.

### 4. FK teardown

The claimed FK facts are correct:

- `accounts.user_id → users`, no action: [0000_nosy_lizard.sql:768](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:768)
- `card_details.user_id → users`, no action: [0000_nosy_lizard.sql:717](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:717)
- `statement_reconciliations.user_id → users`, no action: [0000_nosy_lizard.sql:786](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:786)
- `transactions.user_id → users`, no action: [0000_nosy_lizard.sql:792](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:792)
- `postings.transaction_id → transactions`, cascade: [0000_nosy_lizard.sql:789](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:789)
- `postings.account_id → accounts`, no action: [0000_nosy_lizard.sql:790](/home/udai/common/compass/apps/api/drizzle/0000_nosy_lizard.sql:790)

Planning’s order—transactions, reconciliations, accounts, user—is correct: [planning-analysis.route.test.ts:77](/home/udai/common/compass/apps/api/src/modules/planning/routes/planning-analysis.route.test.ts:77).

Credit’s order—reconciliations, card details, accounts, user—is correct: [revolving-debt.route.test.ts:77](/home/udai/common/compass/apps/api/src/modules/credit/routes/revolving-debt.route.test.ts:77).

All tables directly populated by these fixtures are covered. No fixture creates another referencing row indirectly. Deletes against users with no child rows are harmless.

### 5. Established teardown pattern

The changes follow the repository’s child-before-parent pattern, including:

- [ingest.route.test.ts:215](/home/udai/common/compass/apps/api/src/modules/ingest/routes/ingest.route.test.ts:215)
- [protection.route.test.ts:89](/home/udai/common/compass/apps/api/src/modules/protection/routes/protection.route.test.ts:89)

The added explicit reconciliation/card deletion is appropriate because those tables also have direct no-action user FKs.

### 6. Final-pass scope

The recorded final pass changed only:

- `planning-analysis.route.test.ts`
- `revolving-debt.route.test.ts`

The route handlers, validator, hermetic tests, plugin registration/order, snapshots, plugin enumeration tests, services, `CLAUDE.md`, and `package.json` were not changed by this pass. Because the new test files are untracked, Git cannot independently reconstruct their prior revision; this conclusion is supported by the explicit final-pass record in `implementation-4.md` and inspection of the resulting source.

### 7. Regression gates

All requested runnable gates pass:

- Route snapshot suite: **7/7**
- `route-surface.snapshot.txt`: **319 lines**
- Snapshot comparisons: **byte-exact**
- Plugin enumeration: planning **9**, credit **5**
- Hermetic route tests: **11/11**
- Typecheck: **exit 0**
- Lint: **exit 0**, no warnings
- No suppression was introduced in the two fixed tests.
- No test was weakened, skipped, or deleted.

### 8. Root test

Literal `npm run test` result: **exit 1**, solely from environment-gated tests.

| Workspace | Tests | Pass | Fail | Skipped |
|---|---:|---:|---:|---:|
| API | 799 | 771 | 27 | 1 |
| Extractor | 74 | 73 | 1 | 0 |
| Ingestor | 12 | 12 | 0 | 0 |
| Web | 270 | 270 | 0 | 0 |
| AI | 32 | 32 | 0 | 0 |
| Shared | 212 | 212 | 0 | 0 |
| **Total** | **1399** | **1370** | **28** | **1** |

Classification: **26 pre-existing environment-gated failures plus 2 new AC4b database-gated files**. There are **0 genuine regressions**.

### 9. Open risks, by design

For the record, these remain **OPEN by design** and are honestly documented, not closed:

- Real-Postgres response-serializer behavior has not been executed here.
- Unsafe bigint/JavaScript-number values can exceed the safe-integer contract.
- `statement_reconciliations.period` remains unconstrained text while the API contract requires strict `YYYY-MM`: [spines.ts:205](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:205).

The AC4b tests would genuinely exercise the happy paths when run with Postgres and Redis:

- They create real ledger/card/reconciliation rows.
- They issue authenticated route requests.
- They pass responses through the actual shared schemas.
- They use safe bigint values and valid `YYYY-MM` periods.
- Their teardown is now FK-safe.

Nothing remains outstanding for Task 059 itself.