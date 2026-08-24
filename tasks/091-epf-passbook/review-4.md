# Review verdict

**Changes still required. Task 13.5 is not complete.**

The main Review-3 fixes are present, but two reconciliation defects remain:

1. `computeStatus` can leave `pending` without all required actuals and can classify a completely unconfirmed zero-valued row as `matched`.
2. Re-importing corrected expected values preserves the old persisted reconciliation status, so a previously `matched` contribution can remain `matched` after becoming a mismatch.

No files were modified during this review.

## High-severity findings

### 1. `computeStatus` still does not faithfully implement H4

The implementation only requires an actual when the expected amount is non-null **and non-zero** ([epf-contributions.ts:74](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:74)). Consequently:

- Expected EPS `0` with actual EPS `null` is allowed to leave `pending`.
- The same exception applies to employee and employer components, not just default-zero VPF.
- If every actual is null and every nullable expected is null while VPF is zero, the function returns `matched`, contradicting “All `actual_*` NULL → pending” in the specification ([TASK.md:30](/work/personal/compass/tasks/091-epf-passbook/TASK.md:30)).
- The tests explicitly encode zero expected as not needing confirmation ([epf-contributions.test.ts:125](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:125)) and never test the all-actuals-null case; their closest case supplies an employee actual ([epf-contributions.test.ts:141](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:141)).

The Review-3 blocker was explicit that every **non-null** expected component requires its actual before leaving pending ([TASK.md:192](/work/personal/compass/tasks/091-epf-passbook/TASK.md:192)); zero was to be skipped only during mismatch calculation ([TASK.md:195](/work/personal/compass/tasks/091-epf-passbook/TASK.md:195)).

The coordinator’s VPF adjudication is defensible in isolation: because `expected_vpf_paise` is non-null and defaults to zero ([schema.ts:323](/work/personal/compass/apps/api/src/modules/tax/schema.ts:323)), zero is the only representation of “no VPF component,” and requiring `actualVpfPaise: 0` on every ordinary EPF row would be needless ceremony. It is not defensible as a general zero exemption for employee, employer, and EPS, nor may it override the unconditional “all actuals null means pending” rule.

A faithful implementation needs at least:

- an initial all-actuals-null → `pending` rule;
- non-null expected employee/employer/EPS requiring an actual even when expected is zero;
- the documented VPF-specific exception for its default zero;
- zero expected skipped only in mismatch division/comparison.

### 2. Corrected re-imports leave persisted reconciliation status stale

The preflight-return bug is removed, and the upsert refreshes expected amounts. However, its update set changes `expected_*` without resetting or recomputing `reconciliationStatus` ([epf-contributions.ts:314](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:314)). `createManual` has the same defect ([epf-contributions.ts:219](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:219)).

For example:

1. Expected and actual employee contribution are both 180,000; status becomes `matched`.
2. Corrected payslip changes expected employee to 185,000.
3. Re-import preserves actual 180,000 but also preserves `matched`, even though the difference exceeds 1%.

The new preservation integration test performs essentially that sequence but asserts only the expected and actual amounts, not the resulting status ([epf-contributions.integration.test.ts:272](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:272), [epf-contributions.integration.test.ts:291](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:291)). It therefore misses the resulting stale-state bug.

`confirmActual` also still reads expected values and writes actuals/status in separate statements without a transaction or compare-and-set predicate ([epf-contributions.ts:347](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:347), [epf-contributions.ts:373](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:373)). A concurrent re-import can persist a status calculated against the previous expectations.

## Medium-severity findings

### 3. The H1 idempotency constraints remain incomplete

AC1’s narrow triple uniqueness requirement exists ([schema.ts:348](/work/personal/compass/apps/api/src/modules/tax/schema.ts:348)), but the stronger H1 decision says both a deferrable triple constraint and a partial unique payslip fallback are enforced ([TASK.md:16](/work/personal/compass/tasks/091-epf-passbook/TASK.md:16)).

Current reality:

- The triple is an ordinary unique index, not a deferrable constraint ([0016_mighty_blonde_phantom.sql:24](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:24)).
- The payslip index is non-unique ([schema.ts:354](/work/personal/compass/apps/api/src/modules/tax/schema.ts:354), [0016_mighty_blonde_phantom.sql:25](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:25)).

Thus the same payslip imported with a corrected/different member ID can create another contribution row. There is no integration test for that case or for concurrent imports.

### 4. Money arithmetic can still lose paise through unsafe intermediates

The decimal rate and `Math.pow` are gone, and year-by-year rounding follows the requested formula ([epf-contributions.ts:148](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:148)). Nevertheless, this claim is too strong:

> “every intermediate value is an exact integer”

At [epf-contributions.ts:156](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:156), `corpus * 10825` can exceed JavaScript’s safe-integer range even when both the starting and final corpus are safe integers. For example, `8_000_000_000_200` paise compounds to `8_660_000_000_216` through the current `number` expression, while exact integer rounding gives `8_660_000_000_217`.

The final safe-integer check ([epf-contributions.ts:556](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:556)) cannot detect precision already lost in the multiplication. The mismatch product has the same theoretical risk at [epf-contributions.ts:94](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:94).

Therefore integer paise is used at API boundaries, and decimal-rate arithmetic is removed, but there is still IEEE-754 arithmetic on money. Exact quotient/remainder arithmetic or `bigint` intermediates are needed to substantiate “no floating-point arithmetic on money.”

### 5. The projection invents a retirement horizon when DOB is missing

The route specification says projection requires account balance plus DOB from the profile ([TASK.md:128](/work/personal/compass/tasks/091-epf-passbook/TASK.md:128)). Instead, missing DOB silently becomes 240 months and a retirement date twenty years from today ([epf-contributions.ts:531](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:531), [epf-contributions.ts:542](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:542)).

That remains an undocumented financial assumption. It should either reject missing DOB or expose the fallback assumption explicitly in the response.

### 6. The integration suite is substantive but does not cover every claimed boundary

It is a genuine real-Postgres suite:

- It constructs a real pool and Drizzle database ([epf-contributions.integration.test.ts:50](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:50)).
- It throws at module load when `DATABASE_URL` is missing rather than skipping ([epf-contributions.integration.test.ts:50](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:50)).
- It contains no Drizzle mocks.
- It creates and cleans up throwaway users and data ([epf-contributions.integration.test.ts:70](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:70), [epf-contributions.integration.test.ts:82](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:82)).

Its important cases are real:

- Re-import refresh: [epf-contributions.integration.test.ts:240](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:240)
- Actual employee preservation: [epf-contributions.integration.test.ts:272](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:272)
- Confirm/list cross-user isolation: [epf-contributions.integration.test.ts:298](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:298), [epf-contributions.integration.test.ts:328](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:328)
- Wrong account-type rejection: [epf-contributions.integration.test.ts:387](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:387)
- Posted-balance projection: [epf-contributions.integration.test.ts:409](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:409)

The gap integration test injects a pre-threshold `asOf` and uses the real current date for the after-threshold case ([epf-contributions.integration.test.ts:353](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.integration.test.ts:353)). It does **not** call `getGaps` exactly at day 44/day 45; those exact boundaries are tested only against the pure helper ([epf-contributions.test.ts:164](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:164)). That is reasonable layered testing, but it does not literally exercise the DB service at the exact boundary as claimed.

Other missing integration coverage includes:

- stale status after corrected re-import;
- all employer/EPS/VPF actuals preserved, rather than employee only;
- `createManual`;
- same-payslip/different-member identity;
- archived EPF accounts;
- missing DOB behavior;
- concurrent confirm/re-import behavior.

### 7. The route specification remains internally contradictory

The coordinator adjudication says keep POST and correct the stale task line ([TASK.md:276](/work/personal/compass/tasks/091-epf-passbook/TASK.md:276)). The code and snapshots correctly use POST ([epf-contributions.ts:177](/work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts:177), [route-surface.snapshot.txt:412](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:412)), but the route list still specifies PUT ([TASK.md:126](/work/personal/compass/tasks/091-epf-passbook/TASK.md:126)).

The intended runtime behavior is clear, but blocker 9’s required spec correction was not made. Generated or independently implemented clients could still choose PUT from the authoritative route list.

## Low-severity findings

### 8. Several comments retain the disallowed unconditional 12% assumption

H2 explicitly removes an unconditional 12%-of-wage check ([TASK.md:18](/work/personal/compass/tasks/091-epf-passbook/TASK.md:18)), but the service header still says gross employer share is 12% of basic ([epf-contributions.ts:12](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:12)), as do the persistence and DTO comments ([schema.ts:315](/work/personal/compass/apps/api/src/modules/tax/schema.ts:315), [tax.ts:476](/work/personal/compass/packages/shared/src/schemas/tax.ts:476)).

The executable parser guidance correctly clarifies net employer EPF versus EPS ([payslip-parse.ts:295](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:295)), so this is documentation drift rather than current double-counting logic.

### 9. Route documentation still describes the deleted preflight behavior

The import route comment says a second call returns an existing row by `payslip_id` ([routes/epf-contributions.ts:141](/work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts:141)). The service now always reloads components and reaches the triple-key upsert ([epf-contributions.ts:258](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:258), [epf-contributions.ts:301](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:301)).

### 10. TDD and invariant-test conventions are only partially met

The 49 pure tests are useful and all pass, but the projection and employer-sum checks are example-based ([epf-contributions.test.ts:193](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:193), [epf-contributions.test.ts:412](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:412)). There is no generated/property coverage for rounding, overflow, monotonicity, or gross-sum invariants, despite the repository rule that money/reconciliation invariants receive invariant coverage ([TDD.md:46](/work/personal/compass/tasks/TDD.md:46)).

No EPF contract tests exercise the tightened Zod literals and newly required response fields; the schema itself is at [tax.ts:544](/work/personal/compass/packages/shared/src/schemas/tax.ts:544).

The real-DB re-import test could not have been observed failing in this environment because `DATABASE_URL` is unavailable. The current artifact proves the test exists, but not the fail-first step required by [TDD.md:20](/work/personal/compass/tasks/TDD.md:20).

### 11. Persisted but unreachable fields add state-model complexity

`confirmed` remains a public/persisted status but is deliberately unreachable from the current state machine ([tax.ts:436](/work/personal/compass/packages/shared/src/schemas/tax.ts:436)). `gapReason` is returned ([tax.ts:472](/work/personal/compass/packages/shared/src/schemas/tax.ts:472)) but neither create nor confirm accepts it ([tax.ts:488](/work/personal/compass/packages/shared/src/schemas/tax.ts:488), [tax.ts:514](/work/personal/compass/packages/shared/src/schemas/tax.ts:514)). These are acknowledged non-goals, but they leave unnecessary public states and fields.

## Acceptance criteria

| AC | Verdict | Current evidence |
|---|---|---|
| **AC1** | **Satisfied narrowly** | All four expected/actual pairs and triple unique index exist at [schema.ts:311](/work/personal/compass/apps/api/src/modules/tax/schema.ts:311) and [schema.ts:348](/work/personal/compass/apps/api/src/modules/tax/schema.ts:348). H1’s deferrable/unique-payslip details remain absent. |
| **AC2** | **Satisfied for same key, with correctness caveat** | Preflight is gone; all imports read current components and reach the upsert ([epf-contributions.ts:258](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:258), [epf-contributions.ts:301](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:301)). Employee/employer/EPS/VPF mapping is correct ([epf-contributions.ts:280](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:280)). Persisted status is not refreshed. |
| **AC3** | **Satisfied under amended H2; literal AC wording is stale** | Employer and EPS remain separate and gross is their sum ([epf-contributions.ts:168](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:168)); prompt semantics are explicit ([payslip-parse.ts:295](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:295)); tests cover the sum ([epf-contributions.test.ts:413](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:413)). No 12%-of-wage enforcement exists, correctly following H2. |
| **AC4** | **Mostly satisfied, precision issue remains** | Response matches the requested interface and fixed literals ([tax.ts:544](/work/personal/compass/packages/shared/src/schemas/tax.ts:544)); compounding is extracted and pure ([epf-contributions.ts:148](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:148)). Unsafe numeric intermediates and undocumented DOB fallback remain. |
| **AC5** | **Satisfied under H4 endpoint semantics; not under literal AC wording** | `getGaps` filters eligible rows after 45 days and leaves persisted status pending ([epf-contributions.ts:424](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:424)). It does not return or persist `reconciliation_status='gap'`, contrary to the literal AC at [TASK.md:148](/work/personal/compass/tasks/091-epf-passbook/TASK.md:148), but consistent with H4 at [TASK.md:33](/work/personal/compass/tasks/091-epf-passbook/TASK.md:33). |
| **AC6** | **Satisfied** | DTO uses employee plus VPF and excludes employer/EPS ([epf-contributions.ts:165](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:165), [epf-contributions.ts:188](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:188)); tests verify exclusion ([epf-contributions.test.ts:326](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:326)). |
| **AC7** | **Satisfied** | `epf_contributions` follows payslip tables in `ALL_TABLES` and is in `USER_TABLES` ([backup.ts:50](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:50), [backup.ts:81](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:81)). |
| **AC8** | **Not established** | Typecheck, lint, pure tests, parser tests, shared tests, and route snapshots pass. The real-Postgres suite could not run here and exited 1 as designed; substantive logic findings remain. |

## Review-3 blocker disposition

1. **Re-import preflight:** **Satisfied mechanically.** Every call now reaches the upsert; refresh test exists. Persisted status remains stale.
2. **All-component state machine:** **Not satisfied.** All four fields appear in the function, but zero expected values bypass actual confirmation and all-actuals-null can become `matched`.
3. **45-day grace period:** **Satisfied.** Pure helper at [epf-contributions.ts:130](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:130), used by `getGaps` at [epf-contributions.ts:446](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:446), with day-44/day-45 tests.
4. **Employer EPF/EPS invariant:** **Satisfied under the adjudicated definition.** Gross field, DTO computation, tests, and prompt clarification exist. Stale 12% comments remain.
5. **Real-DB tests:** **Partially satisfied.** They are substantive, use real Postgres, and fail loudly without configuration. Exact DB boundary, status-refresh, and several edge cases are missing, and execution could not be verified.
6. **EPF account type:** **Satisfied.** Ownership and `type='epf'` are checked together ([epf-contributions.ts:487](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:487)); bank-account rejection is tested.
7. **Projection interface/pure seam:** **Satisfied.** Required fields and literals are present, and compounding is pure.
8. **Integer arithmetic:** **Partially satisfied.** Decimal-rate/`Math.pow` arithmetic is removed and the final result is checked, but unsafe `number` intermediates can still lose paise.
9. **POST adjudication/spec correction:** **Not fully satisfied.** Runtime remains correctly POST, but TASK.md still says PUT.
10. **Current typecheck/lint/route gates:** **Satisfied.** All three independently passed.

## Security, compatibility, and scope

User isolation is consistently enforced:

- Payslip ownership: [epf-contributions.ts:259](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:259)
- Confirmation ownership: [epf-contributions.ts:348](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:348)
- Listing and gaps: [epf-contributions.ts:396](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:396), [epf-contributions.ts:437](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:437)
- Projection account and transaction ownership: [epf-contributions.ts:491](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:491), [epf-contributions.ts:507](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:507)

Wrong account types and unowned accounts share the same 404 path, avoiding account-type disclosure ([epf-contributions.ts:484](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:484)). I found no cross-user disclosure path.

No EPF production operation writes another table: manual/import/confirmation target `epfContributions` only ([epf-contributions.ts:207](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:207), [epf-contributions.ts:301](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:301), [epf-contributions.ts:373](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:373)). Projection and import only read accounts, postings, profiles, payslips, and components.

I found no task-13.5 regression in income-event or scheme-compliance logic. The shared EPF section ends before scheme-compliance begins ([tax.ts:434](/work/personal/compass/packages/shared/src/schemas/tax.ts:434), [tax.ts:582](/work/personal/compass/packages/shared/src/schemas/tax.ts:582)); migration 0017 contains only the two income-event columns ([0017_common_terror.sql:1](/work/personal/compass/apps/api/drizzle/0017_common_terror.sql:1)). The working tree is broadly dirty with concurrent untracked work, however, so Git cannot independently attribute every current non-EPF file change to a particular implementation round.

Compatibility risks are the unresolved PUT/POST specification conflict, changed projection response shape for any client built against the prior implementation, stale persisted statuses, and the undocumented missing-DOB fallback.

## Verification run

Literal requested exit codes:

- `npm run typecheck`: **exit 0**
- `npm run lint`: **exit 0**

Additional verification:

- EPF pure tests: **49 tests, 49 passed, exit 0**
- Payslip-parser tests: **25 passed, exit 0**
- Shared tests: **387 passed, exit 0**
- Route snapshot tests: **7 passed, exit 0**
- EPF real-Postgres integration test: **exit 1**, because `DATABASE_URL` is unset. It failed loudly at module load as required rather than silently skipping.

## Final determination

Task 13.5 should remain in code review. At minimum, completion requires:

1. Correcting `computeStatus` so all-actuals-null remains pending and zero handling is limited to the deliberate VPF-default exception and mismatch guard.
2. Recomputing or resetting reconciliation status whenever expected values change, with race-safe confirm/re-import behavior.
3. Fixing TASK.md’s stale PUT route declaration.
4. Making projection and mismatch intermediates exact or demonstrably safe.
5. Running the integration suite against real PostgreSQL and adding a regression assertion for status after corrected re-import.