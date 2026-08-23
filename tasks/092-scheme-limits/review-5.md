## Review outcome

Task 13.6 is **not complete**. Most of the intended API and rule surface exists, and the highlighted PPF/SSY/NPS joins and boundaries are mostly implemented correctly, but there is one material financial-output defect and the mandatory persistence/scoping cases are not genuinely tested.

No Critical findings.

## High findings

### H1 — Data-quality/lifecycle errors incorrectly erase real contribution totals

`annualContributedPaise` is defined as the sum of qualifying FY postings, independent of whether lifecycle metadata is missing or invalid ([TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:86)). Instead, several branches return `0` before querying postings:

- Missing PPF opening date: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:147)
- Missing SSY opening date, holder, or DOB: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:206), [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:213), [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:220)
- Invalid SSY age and outside deposit window: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:227), [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:237)
- Missing NPS detail: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:284)

Consequences:

- An account with ₹1 lakh of real contributions but a missing opening date reports zero.
- `eligible80CPaise`, deficit, and headroom are consequently calculated from the fabricated zero.
- A missing NPS detail row reports both annual and employee contribution as zero rather than the actual raw ledger amount.
- This makes the output unsafe as the data layer for task 13.7.

The service should obtain the FY aggregate regardless of lifecycle metadata, then assign the appropriate status and notes.

### H2 — P8’s persistence/security cases are mocked away, contrary to the repository’s explicit TDD rules

The service test constructs a fake Drizzle interface that ignores every SQL predicate and returns a preset total or row batch ([scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:105), [scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:114), [scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:123)).

Therefore:

- The “different user owns the NPS detail” test merely supplies an empty result; it never creates or passes a wrong-user row through the real join ([scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:377)).
- Cross-user transaction, soft-delete, and opening-balance exclusion are collapsed into one fake aggregate of zero ([scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:486), [scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:500)).
- There is no list-service test exercising the actual NPS `LEFT JOIN` and post-retrieval Tier II classification.
- The fake builder does not inspect generated SQL or join predicates.

This directly conflicts with the required test list in [TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:151) and repository rules that scoping/persistence behavior uses real-database integration tests and that database chains must not be mocked ([TDD.md](/work/personal/compass/tasks/TDD.md:36), [TDD.md](/work/personal/compass/tasks/TDD.md:101)).

The arithmetic/status state machine should be extracted into pure DB-free functions and unit-tested. SQL ownership/exclusion behavior needs real-Postgres integration tests.

## Medium findings

### M1 — Invalid `fy` query values pass route validation and become server errors

The new query schema uses unrestricted `z.string()` ([tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:666)), despite the existing canonical `FySchema` validating format and suffix consistency ([tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:13)).

The route accepts that schema at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/routes/scheme-compliance.ts:45), after which `fyRange()` throws a plain error on malformed input ([financial-year.ts](/work/personal/compass/apps/api/src/lib/financial-year.ts:53), [financial-year.ts](/work/personal/compass/apps/api/src/lib/financial-year.ts:75)). A request such as `?fy=nonsense` therefore risks a 500 instead of a validation 400.

Use `FySchema.optional()`.

### M2 — PPF status for a historical FY changes when the wall clock passes maturity

PPF lifecycle is compared to today rather than to the requested FY ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:153)). Consequently, querying FY 2023-24 for an account that matures in 2026 returns normal compliance before maturity, then `lifecycle_unknown` after maturity, even though the requested FY was pre-maturity.

That is inconsistent with an FY-specific result and makes historical reports time-dependent. The tests explicitly rely on the review date instead of injecting or passing an evaluation date ([scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:236)).

The underlying maturity arithmetic itself is correct: it computes 15 years from the end of the opening FY at [scheme-limits.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.ts:116).

### M3 — SSY’s FY that straddles the deposit-window end is mishandled

The implementation checks only whether `fyStart > windowEnd` ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:237)). If the 15-year window ends midway through an FY, the account is treated as in-window and the aggregate includes postings through the entire FY because `sumContributions` uses `fyEnd` unmodified ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:247)).

The test covers only an FY starting years after the window closed ([scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:311)). It does not cover the exact window-end boundary or an FY spanning the deadline.

### M4 — PPF revival terms were incorrectly copied onto SSY

The canonical rules define `revivalPenaltyPerYear` specifically as ₹50 fee plus ₹500 arrears for PPF ([TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:69), [TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:74)). The SSY section does not specify that PPF amount ([TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:76)).

Nevertheless:

- SSY rule data assigns the PPF `55_000` constant: [scheme-limits.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.ts:66)
- SSY’s note states ₹500 arrears per default year: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:253)
- The unit test codifies the unsupported value: [scheme-limits.test.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.test.ts:33)

This is an incorrect assumption relative to `TASK.md`. Either SSY revival must be explicitly specified with its own rule, or this task should not report a PPF-specific amount for SSY.

### M5 — The opening-account subquery is not user-scoped

The main contribution query correctly scopes the transaction, but the structural subquery accepts an opening account belonging to any user:

[scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:56)

Specifically, the join at line 69 checks only `a2.system_kind = 'opening'`; it does not include `a2.user_id = userId`. The canonical construction first identifies opening accounts for the user ([TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:109)).

Under normal application invariants, cross-user postings should not exist, so the common path works. With imported, legacy, or corrupted data, however, a posting to another user’s opening account can suppress the owner’s contribution. This is a defense-in-depth ownership gap in a financial aggregate.

## Low findings

### L1 — Shared contracts added by this task have no shared-schema tests

The scheme contract ends at [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:671), but [tax.test.ts](/work/personal/compass/packages/shared/src/schemas/tax.test.ts:345) ends without testing:

- The exact nine-value status enum
- Required nullability of the two deduction/contribution fields
- `isEstimate: true`
- Absence of CCD allocation fields
- FY query validation

This conflicts with the schema/contract test level prescribed at [TDD.md](/work/personal/compass/tasks/TDD.md:42).

Likewise, existing `CreateAccountSchema` tests verify defaults only through currency and do not cover `schemeOpenedDate`’s default, ISO validation, or update clear semantics ([wealth.test.ts](/work/personal/compass/packages/shared/src/schemas/wealth.test.ts:81)).

### L2 — Clock-dependent tests will age into failure

The tests hard-code FY 2026-27 as “open” and explain their expected behavior in terms of 2026-08-23 ([scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:168)). After 2027-03-31, the same test will classify that FY as completed.

The service’s claim that it needs no clock injection is also inaccurate ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:79)). A pure classification function accepting an evaluation date would be deterministic and follow the repository’s functional-core convention.

### L3 — The list implementation performs N+1 contribution queries

PPF, SSY, and NPS accounts are fetched in batches, but each result then separately calls `sumContributions` ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:330), [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:340), [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:359)). This is unnecessary complexity and may become slow for users with many scheme accounts. It is not currently an acceptance-criterion failure.

## Highlighted implementation checks

### Structural opening-balance exclusion

Confirmed:

- `transactions` has no `type` column; its columns are declared at [ledger.ts](/work/personal/compass/apps/api/src/db/shared/ledger.ts:22), with `source` rather than `type` at [ledger.ts](/work/personal/compass/apps/api/src/db/shared/ledger.ts:43).
- The query scopes `t.user_id`, excludes `deleted_at`, requires a positive posting, uses inclusive FY bounds, and applies structural `NOT EXISTS`: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:56).
- The structural approach works for ordinary valid ledger data.
- It lacks the opening-account ownership predicate described in M5.
- Its behavior is not proven by the current tests.

### NPS `LEFT JOIN` and wrong-user detail

The list path is implemented correctly:

- `LEFT JOIN`, not inner join: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:361)
- Join predicates include both account ID and `detail.userId = userId`: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:364)
- SQL `WHERE` filters only account owner and account type; it does not filter tier: [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:371)
- Classification occurs after retrieval: missing detail at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:284), Tier II exclusion at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:291), Tier I processing at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:296).

Because `account_nps_details.accountId` is the primary key but `userId` is an independent column ([investments/schema.ts](/work/personal/compass/apps/api/src/modules/investments/schema.ts:44)), a detail row with the account ID but a different owner does not satisfy the join and is classified as `data_missing`. The implementation is correct; the current mock test does not prove it.

### PPF maturity arithmetic

Correct. `ppfMaturityDate()` derives the opening FY and adds 15 years to its March 31 end ([scheme-limits.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.ts:116)). The June 2010 → March 31, 2026 boundary is tested at [scheme-limits.test.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.test.ts:108).

The separate historical-FY evaluation issue remains M2.

### SSY exact tenth birthday

Correct. `completedYearsBetween()` increments age on the birthday ([scheme-limits.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.ts:139)), while the service rejects only `ageAtOpening > 10` ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:227)). Exact age 10 is therefore accepted. Tests cover the exact birthday at [scheme-limits.test.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.test.ts:142) and through the service at [scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:292).

### CCD allocation fields

Confirmed absent from the new result schema. The only NPS-specific output is `npsEmployeeContributionPaise`; `eligible80CPaise` remains required but nullable ([tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:627)). The service sets NPS `eligible80CPaise` to null and raw employee contribution to the aggregate ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:310)).

Repository-wide matches for 80CCD exist in pre-existing tax-rule and explanatory code, but no new `eligibleCcd1Paise`, `eligibleCcd1bPaise`, or `eligibleCcd2Paise` allocation field exists.

## Migration and regression scope

The migration is safe and appropriately narrow:

- Journal entry 0018 follows 0017: [_journal.json](/work/personal/compass/apps/api/drizzle/meta/_journal.json:125)
- Migration 0018 consists solely of the nullable column addition: [0018_breezy_doctor_octopus.sql](/work/personal/compass/apps/api/drizzle/0018_breezy_doctor_octopus.sql:1)
- Comparing migration snapshots 0017 and 0018 showed no table additions/removals and only `accounts.scheme_opened_date`, nullable with no default.
- DB declaration: [hubs.ts](/work/personal/compass/apps/api/src/db/shared/hubs.ts:126)
- Shared read/create/update contracts: [ledger.ts](/work/personal/compass/packages/shared/src/schemas/ledger.ts:183), [ledger.ts](/work/personal/compass/packages/shared/src/schemas/ledger.ts:250), [ledger.ts](/work/personal/compass/packages/shared/src/schemas/ledger.ts:264)
- Mapping: [accounts.ts](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:136)
- Create and update paths naturally persist the field through object spreading: [accounts.ts](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:243), [accounts.ts](/work/personal/compass/apps/api/src/modules/ledger/services/accounts.ts:555)

No task-specific change to the EPF or income-events implementations is required or present in migration 0018. The working tree contains earlier, currently uncommitted EPF/income-events work and their route snapshots, so Git provenance cannot independently attribute every dirty file to a task. The 13.6 implementation itself only imports the NPS persistence schema, not EPF or income-events services ([scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:17)).

Both required route snapshots include the two new endpoints:

- [route-surface.snapshot.txt](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:164)
- [route-table.snapshot.txt](/work/personal/compass/apps/api/src/route-table.snapshot.txt:119)

## Acceptance criteria

- **AC1 — Satisfied.** The library is DB/I/O/clock-free and exposes correct PPF, SSY, and NPS minimums and maximums at [scheme-limits.ts](/work/personal/compass/apps/api/src/lib/scheme-limits.ts:57). The extra SSY revival assumption remains M4.
- **AC2 — Satisfied.** One nullable DB column, all three ledger schemas, mapper, and narrow migration are present at the locations cited above. Existing rows become null.
- **AC3 — Satisfied in implementation, inadequately verified.** Holder join is user-scoped at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:340), age rejects only values over 10 at line 230, and the gender-gap note is unconditional at line 201. No real-DB ownership test exists.
- **AC4 — Satisfied.** Tier I returns raw contribution equality and null 80C at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:310); the schema contains no CCD allocation fields at [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:627). Missing-detail totals remain wrong under H1.
- **AC5 — Satisfied for PPF.** `<50_000` becomes risk/current or discontinued/completed and the PPF revival terms are stated at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:168). Boundaries are tested at [scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:183).
- **AC6 — Satisfied for ordinary contribution paths.** Deficit and headroom formulas are correct at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:100), with boundary examples in [scheme-compliance.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.test.ts:183). H1 causes incorrect inputs on data-error branches.
- **AC7 — Satisfied.** `isEstimate` is always literal true and notes are required at [scheme-compliance.ts](/work/personal/compass/apps/api/src/modules/tax/services/scheme-compliance.ts:119); data-gap branches supply explanatory notes.
- **AC8 — Satisfied in implementation, inadequately verified.** Structural `NOT EXISTS` is present and no transaction `type` column exists. The owner-scope hardening gap M5 remains, and P8 has no real test.
- **AC9 — Not satisfied.** Typecheck, lint, focused tests, shared tests, and route snapshots pass, but the mandatory P8 persistence tests are fake, the full test command did not finish green, and all acceptance boxes remain unchecked while status remains `IMPLEMENTING` ([TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:3), [TASK.md](/work/personal/compass/tasks/092-scheme-limits/TASK.md:153)).

## Commands run

- `npm run typecheck` — **exit code 0**
- `npm run lint` — **exit code 0**
- `node --test apps/api/src/lib/scheme-limits.test.ts` — **exit code 0**, 25 passed
- `node --test apps/api/src/modules/tax/services/scheme-compliance.test.ts` — **exit code 0**, 38 passed, but with the deficiencies described in H2
- `node --test apps/api/src/app.route-snapshot.test.ts` — **exit code 0**, 7 passed
- `npm run test -w packages/shared` — **exit code 0**, 387 passed; none cover the new scheme-compliance contracts
- `npm run test` — **exit code 1** because the environment had no `.env`/`DATABASE_URL`; `apps/api/src/app.test.ts` and other real-DB boot tests explicitly aborted. This does not identify a 13.6 regression, but it means the literal full green gate required by AC9 was not established.

## Verdict

**Task 13.6 is incomplete.** Before completion:

1. Preserve real contribution aggregates on all `data_missing`, `data_invalid`, `outside_deposit_window`, and lifecycle-error results.
2. Replace the mocked Drizzle-chain “proofs” with real-Postgres tests for opening-balance exclusion, soft deletes, transaction ownership, SSY holder ownership, and wrong-owner NPS detail rows.
3. Extract and unit-test the status/date arithmetic as a pure functional core.
4. Use `FySchema` for route queries.
5. Define and test correct selected-FY semantics for PPF maturity and SSY’s window-ending FY.
6. Remove or correct the unsupported SSY revival terms.
7. Add shared contract tests and run the full verification gate in an environment with Postgres/Redis.