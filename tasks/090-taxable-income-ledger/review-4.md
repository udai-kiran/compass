# Review outcome

Task 13.4 is not ready to complete. The persistence/state-machine implementation is mostly present, but two high-severity issues remain:

- The API contract does not expose `section` or `sourcePriority`, and manual entries cannot set `section`. The new columns are therefore largely unusable.
- PAN/TAN can enter application logs when a database operation fails because Drizzle includes bound parameters in its error and the global 5xx handler logs that error.

The focused service tests and lint pass, but the current repository does not typecheck.

## Findings by severity

### High

1. `section` and `sourcePriority` are missing from the API contract and DTO; manual entries cannot record a tax section.

   The table defines both fields at [schema.ts:233](/work/personal/compass/apps/api/src/modules/tax/schema.ts:233) and [schema.ts:242](/work/personal/compass/apps/api/src/modules/tax/schema.ts:242), but `IncomeEventSchema` omits both at [tax.ts:271](/work/personal/compass/packages/shared/src/schemas/tax.ts:271), and `buildIncomeEventDto` omits them at [income-events.ts:67](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:67). Consequently, list/get/create/accept/derive responses cannot expose deduction-section tagging or source precedence.

   More seriously, `CreateIncomeEventBodySchema` has no `section` field at [tax.ts:305](/work/personal/compass/packages/shared/src/schemas/tax.ts:305), and `createIncomeEvent` never inserts one at [income-events.ts:116](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:116). A manually entered 194A interest, 194K dividend, or 194-I rent event cannot carry the section required by the objective. `sourcePriority` is also never assigned anywhere, so all rows remain at the database default of zero.

2. PAN/TAN can be logged on unexpected database failures, violating AC7.

   Create and accept writes send PAN/TAN as bound query parameters at [income-events.ts:126](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:126) and [income-events.ts:225](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:225). Drizzle’s `DrizzleQueryError` embeds all parameters in both its message and `.params` at [errors.js:10](/work/personal/compass/node_modules/drizzle-orm/errors.js:10). The global unexpected-5xx path logs the complete error at [app.ts:241](/work/personal/compass/apps/api/src/app.ts:241). A connection failure, constraint failure, or other unexpected database error during either write can therefore place the PAN/TAN in logs.

   Normal validation errors do not echo the supplied identifier: the regex messages are generic at [tax.ts:310](/work/personal/compass/packages/shared/src/schemas/tax.ts:310), and the error handler returns only paths and messages at [app.ts:218](/work/personal/compass/apps/api/src/app.ts:218). No income-event code imports or calls an AI provider—the complete import surface is visible at [income-events.ts:25](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:25)—so I found no PAN/TAN path into an AI event payload.

### Medium

3. The P8 “concurrency,” ownership, and dedup tests do not test the database behavior they claim to cover.

   The test constructs a mocked Drizzle chain that ignores every `.where()` and `.onConflictDoNothing()` argument at [income-events.test.ts:122](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:122). Its “concurrent accept/reject” case merely returns an empty canned array at [income-events.test.ts:440](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:440); no concurrent calls occur. Likewise, the derivation tests simulate an empty `RETURNING` result at [income-events.test.ts:744](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:744) and [income-events.test.ts:844](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:844), but never exercise the partial unique index or two concurrent derives.

   These tests would still pass if the production code omitted the user/status predicates or omitted `onConflictDoNothing()`, because the stub does not inspect them. This directly conflicts with the repository rule against mocking Drizzle/database chains.

4. AC9 is false in the current worktree: full typecheck fails.

   `schemeOpenedDate` was made required in `AccountSchema` at [ledger.ts:204](/work/personal/compass/packages/shared/src/schemas/ledger.ts:204), after adding it to the unrelated `accounts` table at [hubs.ts:126](/work/personal/compass/apps/api/src/db/shared/hubs.ts:126) and migration [0018_breezy_doctor_octopus.sql:1](/work/personal/compass/apps/api/drizzle/0018_breezy_doctor_octopus.sql:1). Existing API and web fixtures were not updated, producing multiple type errors. This is not caused by migration 0017, but AC9 evaluates the current repository and therefore remains unsatisfied.

5. There are no shared-contract tests for the income-event schemas.

   The implementation added contracts at [tax.ts:239](/work/personal/compass/packages/shared/src/schemas/tax.ts:239), but there are no `IncomeEventSchema`, `CreateIncomeEventBodySchema`, or `AcceptIncomeEventBodySchema` references in any `packages/shared/src/**/*.test.ts`. Thus the passing shared workspace suite does not verify PAN/TAN normalization, invalid character positions, impossible dates, rejection of `fy`/provenance fields, `afterTdsPaise`, or the summary shape.

### Low

6. Route registration does not fully follow the stated static-before-parameterized convention.

   The important GET ordering is correct: `/summary` is registered at [income-events.ts:82](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:82) before `/:id` at [income-events.ts:99](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:99). However, parameterized POST routes begin at [income-events.ts:146](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:146), while the static `/derive/...` branches are not registered until [income-events.ts:190](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:190). Fastify’s specificity rules currently resolve the routes correctly and both snapshots pass, but the source contradicts its own statement that derive routes “must be registered before `/:id`” at [income-events.ts:187](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:187).

7. The holding-event route contains an unreachable fallback.

   `deriveFromHoldingEvent` returns `Promise<IncomeEvent>` or throws at [income-events.ts:432](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:432), so the `if (!event)` check at [income-events.ts:223](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:223) can never execute. It adds route-level logic and an unused defensive branch without changing behavior.

8. Six touched files are not formatted with the repository Prettier configuration.

   `prettier --check` failed for `packages/shared/src/schemas/tax.ts`, `income-events.ts`, `income-events.test.ts`, `backup.ts`, `schema.decomposition.test.ts`, and `db/schema.ts`. Examples include the long refinement declaration at [tax.ts:23](/work/personal/compass/packages/shared/src/schemas/tax.ts:23) and compressed resident arrays at [schema.decomposition.test.ts:84](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:84).

## Acceptance criteria

| Criterion | Result | Evidence |
|---|---|---|
| AC1 | Satisfied | Three pgEnums are defined at [schema.ts:168](/work/personal/compass/apps/api/src/modules/tax/schema.ts:168), [schema.ts:178](/work/personal/compass/apps/api/src/modules/tax/schema.ts:178), and [schema.ts:193](/work/personal/compass/apps/api/src/modules/tax/schema.ts:193). The table, checks, partial unique index, and FY index are at [schema.ts:216](/work/personal/compass/apps/api/src/modules/tax/schema.ts:216) and [schema.ts:267](/work/personal/compass/apps/api/src/modules/tax/schema.ts:267). There is no generated column. |
| AC2 | Satisfied in production code | Accept uses a guarded `UPDATE ... status='pending' RETURNING` at [income-events.ts:230](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:230); rejection does the same at [income-events.ts:258](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:258). Corrections and the pre-correction snapshot are placed in the same update set at [income-events.ts:202](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:202). Tests do not prove the SQL predicates against a database. |
| AC3 | Satisfied | Summary counts pending separately, aggregates only accepted rows, ignores rejected rows, and initializes all five kinds at [income-events.ts:297](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:297). It returns `isEstimate`, `acceptedCount`, `pendingCount`, and notes at [income-events.ts:327](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:327). |
| AC4 | Satisfied under the 400 adjudication | Ownership/accepted/null-gross guards are at [income-events.ts:363](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:363); null gross returns 400 at [income-events.ts:373](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:373). Section 192, month-end date, and server-derived FY are set at [income-events.ts:377](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:377). Targetless conflict handling and scoped re-fetch are at [income-events.ts:381](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:381). |
| AC5 | Satisfied | Ownership is obtained through the `holdingEvents`→`holdings` join at [income-events.ts:437](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:437), wrong-user rows become 404 at [income-events.ts:452](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:452), and non-dividends return 400 at [income-events.ts:456](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:456). |
| AC6 | Satisfied | The create contract has no `fy` and uses `z.iso.date()` at [tax.ts:305](/work/personal/compass/packages/shared/src/schemas/tax.ts:305). The service revalidates the date and invokes `fyOf()` at [income-events.ts:110](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:110). Both derivation paths compute FY from their derived accrual date at [income-events.ts:377](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:377) and [income-events.ts:460](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:460). |
| AC7 | Not satisfied | PAN/TAN schemas have the exact normalization and positional regexes at [tax.ts:310](/work/personal/compass/packages/shared/src/schemas/tax.ts:310) and [tax.ts:342](/work/personal/compass/packages/shared/src/schemas/tax.ts:342), and I found no AI path. However, failed DB writes can log Drizzle parameters through [app.ts:241](/work/personal/compass/apps/api/src/app.ts:241), as described in High finding 2. |
| AC8 | Satisfied for current schema evolution | `income_events` is in `ALL_TABLES` at [backup.ts:52](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:52) and `USER_TABLES` at [backup.ts:83](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:83). The decomposition resident list includes the table and enums at [schema.decomposition.test.ts:84](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:84). The current count is 78 rather than historical 77 because the subsequent EPF table is also present; the current decomposition test passes at [schema.decomposition.test.ts:127](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:127). |
| AC9 | Not satisfied | Lint and focused tests pass, and both route snapshots contain all eight endpoints at [route-surface.snapshot.txt:158](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:158) and [route-table.snapshot.txt:107](/work/personal/compass/apps/api/src/route-table.snapshot.txt:107). Full typecheck fails because of the unrelated account-schema regression described above. Full API tests could not be run without `DATABASE_URL`. |

## Review-3 blocker adjudication

1. **Satisfied.** `section` and `sourcePriority` are in the Drizzle table at [schema.ts:233](/work/personal/compass/apps/api/src/modules/tax/schema.ts:233) and [schema.ts:242](/work/personal/compass/apps/api/src/modules/tax/schema.ts:242). Migration 0017 contains exactly the two required statements and nothing else at [0017_common_terror.sql:1](/work/personal/compass/apps/api/drizzle/0017_common_terror.sql:1). The original table creation is in migration 0015 at [0015_unknown_christian_walker.sql:4](/work/personal/compass/apps/api/drizzle/0015_unknown_christian_walker.sql:4); apart from initial creation and the two-column 0017 alteration, no SQL migration mentions `income_events`.

2. **Satisfied.** `IncomeEventSchema.afterTdsPaise` is defined at [tax.ts:283](/work/personal/compass/packages/shared/src/schemas/tax.ts:283), and the DTO computes it at [income-events.ts:78](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:78).

3. **Satisfied.** The shared summary includes `acceptedCount` and `notes` at [tax.ts:374](/work/personal/compass/packages/shared/src/schemas/tax.ts:374), and the service populates them at [income-events.ts:327](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:327).

4. **Not satisfied, although substantially expanded.** There are now 56 service tests, but concurrent transitions and concurrent derivation are not actually executed, ownership predicates are not inspected, and no real database exercises the partial unique index. The mocked chain at [income-events.test.ts:122](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:122) cannot establish the blocker’s concurrency/dedup guarantees.

5. **Satisfied under the coordinator override.** Null payslip gross produces HTTP 400 at [income-events.ts:373](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:373), with a matching test at [income-events.test.ts:692](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:692). It is not re-flagged for failing to return stale 422.

6. **Satisfied.** The create contract no longer accepts provenance at [tax.ts:305](/work/personal/compass/packages/shared/src/schemas/tax.ts:305), and the service unconditionally writes `manual`/`null` at [income-events.ts:123](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:123).

7. **Satisfied.** The route contract uses `z.iso.date()` at [tax.ts:307](/work/personal/compass/packages/shared/src/schemas/tax.ts:307), and the service independently rejects impossible dates with 400 before `fyOf()` at [income-events.ts:110](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:110).

## 1. Incorrect assumptions relative to the specification

- The implementation assumes adding `section` and `sourcePriority` to persistence is sufficient. It is not: both disappear at the DTO boundary, and manual creation cannot populate `section`. See High finding 1.
- The tests assume replaying an empty `RETURNING` array is equivalent to testing a concurrent race. The stub at [income-events.test.ts:136](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:136) never executes SQL or coordinates concurrent operations.
- The implementation treats `sourcePriority` as a future-only field. It is given a default in persistence at [schema.ts:238](/work/personal/compass/apps/api/src/modules/tax/schema.ts:238), but there is no derivation priority assignment, input, output, or ordering logic anywhere in the service.
- The route comments assume the derive routes precede parameterized routes, but the actual registration order is the reverse at [income-events.ts:146](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:146) and [income-events.ts:190](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:190).

## 2. Missing scope and edge cases

- Manual section entry is missing, and section/source priority are absent from all returned events.
- No shared-schema tests exist for PAN/TAN transforms and invalid positions, impossible dates, `fy`/provenance stripping, DTO shape, or summary shape.
- No real concurrent accept-versus-reject test exists.
- No real repeated/concurrent derive test exercises `income_events_source_unique_idx`.
- No test proves `getIncomeEvent` itself returns a cross-user 404; the only accept/reject ownership cases use canned empty selections.
- There is no test confirming that response serialization includes all intended provenance fields. This omission allowed `section` and `sourcePriority` to disappear unnoticed.
- No test covers PAN/TAN non-disclosure in logs on a forced database error.

## 3. Regressions outside intended task scope

No income-event fix regression was found in the named EPF surfaces:

- Migration 0016 contains only EPF table/FK/index creation at [0016_mighty_blonde_phantom.sql:1](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:1).
- Migration 0017 contains only the two `income_events` column additions at [0017_common_terror.sql:1](/work/personal/compass/apps/api/drizzle/0017_common_terror.sql:1).
- The EPF service imports only EPF/payslip schema residents at [epf-contributions.ts:30](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:30), while the income-event service imports only income events/payslips at [income-events.ts:27](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:27). I found no cross-task coupling between their service or route implementations.
- The 0016→0017 metadata delta changes only `income_events.section` and `income_events.source_priority`.

There is, however, a current out-of-scope regression from migration 0018 and the unrelated `accounts.scheme_opened_date` change: making that field required in `AccountSchema` at [ledger.ts:204](/work/personal/compass/packages/shared/src/schemas/ledger.ts:204) broke existing API and web fixtures and causes full typecheck to fail. Because the worktree contains multiple uncommitted tasks, that defect cannot responsibly be attributed to task 13.4, but it prevents the current branch from meeting AC9.

## 4. Security and compatibility risks

- **PAN/TAN logging:** Unsafe on unexpected DB errors, as detailed in High finding 2.
- **Error-message echo:** No direct echo found. Regex failures use only `"Invalid PAN format"`/`"Invalid TAN format"` at [tax.ts:314](/work/personal/compass/packages/shared/src/schemas/tax.ts:314), and the global validation response excludes received values at [app.ts:223](/work/personal/compass/apps/api/src/app.ts:223).
- **AI event payload:** No income-event route or service calls AI or constructs an AI observer. PAN/TAN are therefore not currently sent to a model or AI event payload.
- **Authenticated response exposure:** PAN/TAN are intentionally returned to the owning user at [income-events.ts:75](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:75). All get/list/update queries scope by `userId`, including list at [income-events.ts:148](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:148) and get at [income-events.ts:168](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:168).
- **API compatibility:** Adding `section` and `sourcePriority` to the response would be additive. Their current omission is more dangerous than the compatibility cost because downstream tax work cannot consume the section or precedence data.
- **Money representation:** Gross, TDS, and derived after-TDS remain integer paise end to end: bigint-number columns at [schema.ts:249](/work/personal/compass/apps/api/src/modules/tax/schema.ts:249), integer Zod fields at [tax.ts:281](/work/personal/compass/packages/shared/src/schemas/tax.ts:281), and integer subtraction at [income-events.ts:82](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:82).

## 5. Actual P8 test coverage

| P8 item | Covered? | Evidence |
|---|---|---|
| Guarded transitions | Partial only | Terminal-state and empty-returning branches are tested at [income-events.test.ts:422](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:422), but the stub ignores the actual `WHERE` predicate. |
| Concurrent accept vs reject | No | The alleged race test merely configures `updateReturning: []` at [income-events.test.ts:440](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:440). No concurrent calls or DB transaction occur. |
| Cross-user 404s | Partial only | Canned empty results cover accept/reject/payslip/holding paths at [income-events.test.ts:413](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:413), [income-events.test.ts:551](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:551), [income-events.test.ts:674](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:674), and [income-events.test.ts:791](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:791). They do not prove SQL scoping, and direct `getIncomeEvent` is untested. |
| Source dedup and concurrent derive | No | Conflict re-fetch branches are exercised at [income-events.test.ts:744](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:744) and [income-events.test.ts:844](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:844), but neither the unique index nor concurrency is exercised. |
| Accepted-only summary | Yes, at pure aggregation level | [income-events.test.ts:562](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:562). |
| Non-dividend rejection | Yes | Buy and sell cases are at [income-events.test.ts:800](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:800) and [income-events.test.ts:809](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:809). |
| Null-gross 400 | Yes | [income-events.test.ts:692](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:692). |
| FY boundary 31 March / 1 April | Yes for manual create | [income-events.test.ts:354](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:354). March payslip derivation is separately covered at [income-events.test.ts:734](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:734). |
| PAN/TAN normalization and invalid positions | No | The only PAN/TAN DTO test passes already-normalized values through at [income-events.test.ts:294](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:294). It does not call either shared request schema. |
| `original_values` capture | Yes at update-set level | [income-events.test.ts:468](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:468). It does not verify atomic persistence against a real DB. |

The fix-brief additions for `afterTdsPaise`, manual provenance forcing, real-date validation, summary counts, and notes are covered at [income-events.test.ts:234](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:234), [income-events.test.ts:316](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:316), [income-events.test.ts:364](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:364), and [income-events.test.ts:562](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:562).

## 6. Unnecessary complexity

- The custom query-builder stub spans [income-events.test.ts:122](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:122) through [income-events.test.ts:190](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:190), yet provides weaker guarantees than a focused real-Postgres integration fixture.
- The unreachable route fallback at [income-events.ts:223](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:223) should be removed.
- The route/service files contain extensive comments that assert properties the tests do not establish—particularly “concurrent-safe” and route ordering at [income-events.ts:14](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:14) and [income-events.test.ts:4](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:4).

## 7. Repository convention compliance

- **Integer paise:** Satisfied. No floating-point rupee conversion or hand-built currency formatting was introduced.
- **Thin routes:** Mostly satisfied. Handlers delegate to services at [income-events.ts:66](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:66), though the unreachable holding-event guard is unnecessary route logic.
- **Shared Zod contracts:** Structurally satisfied—routes consume `@compass/shared` at [income-events.ts:27](/work/personal/compass/apps/api/src/modules/tax/routes/income-events.ts:27)—but the shared DTO is incomplete because it omits `section` and `sourcePriority`.
- **No cross-module schema import from module `schema.ts`:** Satisfied. The tax schema imports only `users` from `db/core-schema.ts` at [schema.ts:32](/work/personal/compass/apps/api/src/modules/tax/schema.ts:32).
- **Pure schema barrel / exactly-once export:** Satisfied. `incomeEvents` and the three enums each appear exactly once in [db/schema.ts:144](/work/personal/compass/apps/api/src/db/schema.ts:144); the decomposition identity test passes.
- **No mocked Drizzle chains:** Violated by [income-events.test.ts:122](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:122).
- **Formatting:** Violated in six touched files according to `prettier --check`.
- **Explicit ESM extensions:** Satisfied in the reviewed API source.

## Verification results

- T1 `npm run typecheck`: **failed**, exit 2, due unrelated `schemeOpenedDate` fixture incompatibilities.
- T2 `npm run lint`: **passed**.
- T3 focused income-event test: **passed, 56/56**.
- T4 route snapshots and decomposition: **passed** when run directly. Full API workspace suite could not run because `DATABASE_URL` is unset.
- T5 shared workspace tests: **passed, 352/352**, but none test the income-event schemas.
- T6 backup arrays: **satisfied by inspection** at [backup.ts:52](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:52) and [backup.ts:83](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:83). The combined backup test file aborts without `DATABASE_URL` at [backup.test.ts:376](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:376).
- T7 migration review: **passed**. Migration 0015 creates only the three enums/table/FK/indexes for the initial ledger, and migration 0017 contains exactly the two requested column additions.