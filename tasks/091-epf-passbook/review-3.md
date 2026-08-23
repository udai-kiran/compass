# Review verdict

**Changes required. Task 13.5 should not be considered complete.**

The basic table, routes, backup registration, VPF parser fix, and user scoping exist, but the core reconciliation behavior is not faithful to the specification. Same-payslip re-import does not refresh corrected expected values, reconciliation mishandles partial actuals and VPF, gap aging is absent, the employer EPF/EPS invariant is neither enforced nor tested, and projection does not implement the specified interface or account validation.

No files were modified.

## Findings by severity

### High

1. **Same-payslip re-import never refreshes corrected expected amounts.**

   `importFromPayslip` returns the existing row before loading the current payslip components, so its advertised `onConflictDoUpdate` is unreachable for the normal same-payslip re-import case ([epf-contributions.ts:187](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:187), [epf-contributions.ts:198](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:198)). This contradicts the requirement that re-import update expected values ([TASK.md:104](/work/personal/compass/tasks/091-epf-passbook/TASK.md:104)).

   The upsert itself does preserve `actual_*` because those columns are omitted from its update set ([epf-contributions.ts:263](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:263)), but a same-payslip call never reaches it. It also ignores a corrected `epfoMemberId`, returning the row tied to the old member ID.

   The payslip index is non-unique ([schema.ts:354](/work/personal/compass/apps/api/src/modules/tax/schema.ts:354), [0016 migration:25](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:25)). Concurrent imports of the same payslip with different member IDs can therefore both pass the pre-check and insert separate rows.

2. **The reconciliation state machine does not implement H4.**

   `computeStatus` treats only a null employee actual as pending. Once employee actual is present, missing employer/EPS actuals are silently considered comparable-success and can produce `matched` ([epf-contributions.ts:65](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:65), [epf-contributions.ts:68](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:68)). The tests explicitly lock in this incorrect partial-confirmation behavior ([epf-contributions.test.ts:82](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:82)).

   VPF is absent from `computeStatus` altogether: its input and comparisons cover only employee, employer, and EPS ([epf-contributions.ts:57](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:57), [epf-contributions.ts:74](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:74)). A materially wrong VPF deposit can still be `matched`.

   `confirmed` is declared in the shared contract ([tax.ts:424](/work/personal/compass/packages/shared/src/schemas/tax.ts:424)) but deliberately never produced by `confirmActual` ([epf-contributions.ts:282](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:282)). That conflicts with both the contract description and H4’s all-actuals-confirmed rule.

3. **Gap detection has no 45-day grace period and does not return or persist a gap status.**

   `getGaps` selects every row with expected employee present and actual employee absent, regardless of age ([epf-contributions.ts:367](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:367), [epf-contributions.ts:378](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:378)). It has no as-of date or wage-month-end calculation.

   The result schema contains no status or gap-age metadata ([tax.ts:494](/work/personal/compass/packages/shared/src/schemas/tax.ts:494)), while the persisted status schema does not even admit `gap` ([tax.ts:424](/work/personal/compass/packages/shared/src/schemas/tax.ts:424)). This fails both the explicit 45-day H4 rule ([TASK.md:33](/work/personal/compass/tasks/091-epf-passbook/TASK.md:33)) and AC5’s stated `reconciliation_status='gap'` expectation ([TASK.md:148](/work/personal/compass/tasks/091-epf-passbook/TASK.md:148)). The task itself is contradictory about whether gap is persisted, but the implementation satisfies neither interpretation fully.

4. **The employer EPF/EPS invariant is documented but not enforced or tested.**

   Import correctly maps `employer_epf` and `eps` into separate accumulators ([epf-contributions.ts:227](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:227)). However, its only “invariant check” adds them and logs when the total is zero ([epf-contributions.ts:241](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:241)); it validates no relationship and returns no gross-employer value.

   The EPF tests contain no employer/EPS invariant assertion; their values only happen to add to the employee amount ([epf-contributions.test.ts:24](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:24)).

   More seriously, the AI system prompt still requests “Employer PF (12% basic)” and “EPS (8.33% basic)” separately ([payslip-parse.ts:290](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:290)). It never tells the model that `employer_epf` must be the net PF credit after EPS diversion. That preserves the double-counting ambiguity identified in review-2.

5. **The absence of DB integration coverage is a completion blocker.**

   The test file claims DB-backed behavior is exercised by integration tests ([epf-contributions.test.ts:10](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:10)), but it contains only tests for `computeStatus`, `fyToWageMonthRange`, and `buildEpfContributionDto`; it ends without exercising any service I/O ([epf-contributions.test.ts:181](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:181), [epf-contributions.test.ts:286](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:286)).

   Consequently, no automated test covers:

   - import ownership/accepted-state checks;
   - multiple component summing;
   - re-import refresh and actual preservation;
   - conflict/concurrency behavior;
   - cross-user confirmation/list isolation;
   - gap queries;
   - posted-balance projection;
   - account-type validation;
   - migration constraints.

   The repository explicitly requires real-DB service integration tests and says every acceptance criterion needs corresponding coverage ([TDD.md:9](/work/personal/compass/tasks/TDD.md:9), [TDD.md:16](/work/personal/compass/tasks/TDD.md:16), [TDD.md:41](/work/personal/compass/tasks/TDD.md:41)). Existing ledger EPF tests demonstrate the expected real-Postgres pattern ([ledger EPF test:19](/work/personal/compass/apps/api/src/modules/ledger/services/epf-contributions.test.ts:19)).

   The absent `DATABASE_URL` explains why those tests cannot be executed locally; it does not justify not writing them. CI has Postgres and should execute them.

### Medium

6. **Projection accepts any owned account, not specifically an EPF account.**

   The ownership query selects only `accounts.id` and never checks `accounts.type` ([epf-contributions.ts:421](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:421)). The account model has an explicit `epf` type ([hubs.ts:23](/work/personal/compass/apps/api/src/db/shared/hubs.ts:23), [hubs.ts:33](/work/personal/compass/apps/api/src/db/shared/hubs.ts:33)). A bank, loan, credit-card, PPF, or system-account balance can therefore be presented as an “EPF corpus.”

7. **The corpus projection does not implement the specified interface or pure-computation seam.**

   The task requires `monthsToRetirement`, `rateApplicableFy`, and `disclaimer` ([TASK.md:107](/work/personal/compass/tasks/091-epf-passbook/TASK.md:107)). The current shared response instead returns `yearsToRetirement` and omits the latter two fields ([tax.ts:512](/work/personal/compass/packages/shared/src/schemas/tax.ts:512)). It also weakens fixed labels to arbitrary `boolean` and `string`, rather than `z.literal(true)` and `z.literal("last_known_official")` ([tax.ts:517](/work/personal/compass/packages/shared/src/schemas/tax.ts:517)).

   The calculation is embedded inside a DB service and depends on `new Date()`, so there is no pure projection function to test ([epf-contributions.ts:415](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:415), [epf-contributions.ts:456](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:456)). Missing DOB silently invents a 20-year horizon ([epf-contributions.ts:468](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:468)), rather than reporting a missing input or clearly exposing that fallback assumption.

8. **Projection and mismatch financial arithmetic use floating point.**

   Projection multiplies integer paise by `Math.pow` using `0.0825` and rounds afterward ([epf-contributions.ts:475](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:475)). Mismatch uses floating division by expected paise ([epf-contributions.ts:67](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:67)). This violates the repository convention that financial arithmetic remain integer-paise based; rational basis-point arithmetic or a documented deterministic fixed-point method should be used.

   There is also no safe-integer check on `projectedCorpusPaise`; only the starting aggregate is checked ([epf-contributions.ts:445](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:445)).

9. **Updating expected values can leave reconciliation status stale.**

   Both `createManual` and import upserts change expected amounts without recomputing or resetting `reconciliationStatus` ([epf-contributions.ts:151](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:151), [epf-contributions.ts:263](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:263)). Thus a previously `matched` row can acquire different expected values while remaining `matched`.

   `confirmActual` also reads expected values and updates status in separate statements without a transaction or compare-and-set guard ([epf-contributions.ts:296](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:296), [epf-contributions.ts:320](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:320)). A concurrent expected-value update can persist a status computed against the old values.

10. **The table lacks database-level integrity constraints needed for imported data.**

   The EPF table uses unrestricted `bigint`/`text` columns with no nonnegative checks, status check/enum, wage-month check, or source-linkage constraint ([schema.ts:311](/work/personal/compass/apps/api/src/modules/tax/schema.ts:311), [schema.ts:337](/work/personal/compass/apps/api/src/modules/tax/schema.ts:337)). The migration matches that absence ([0016 migration:7](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:7), [0016 migration:16](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:16)).

   Route bodies reject negative manual EPF values, but payslip component contracts permit negative current amounts ([tax.ts:183](/work/personal/compass/packages/shared/src/schemas/tax.ts:183)), and import sums them without validation ([epf-contributions.ts:222](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:222)). Invalid negative contributions can therefore reach the table through the principal import path.

11. **The confirm route has the wrong HTTP method relative to the route specification.**

   TASK.md specifies `PUT /epf-contributions/:id/confirm-actual` ([TASK.md:126](/work/personal/compass/tasks/091-epf-passbook/TASK.md:126)). The implementation and both snapshots expose POST ([epf-contributions.ts route:177](/work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts:177), [route surface:408](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:408), [route table:118](/work/personal/compass/apps/api/src/route-table.snapshot.txt:118)). Clients generated from the task contract will be incompatible.

12. **The current repository route gate is red for unrelated work.**

   `tax/plugin.ts` registers `schemeComplianceRoutes` ([plugin.ts:14](/work/personal/compass/apps/api/src/modules/tax/plugin.ts:14), [plugin.ts:21](/work/personal/compass/apps/api/src/modules/tax/plugin.ts:21)), but neither snapshot includes those routes after the EPF entries ([route table:114](/work/personal/compass/apps/api/src/route-table.snapshot.txt:114), [route surface:155](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:155)). The byte-for-byte route gate is defined at [app.route-snapshot.test.ts:80](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:80) and currently fails both comparisons.

   This appears attributable to concurrent task 13.6 work, not EPF reconciliation, but it means AC8 is false for the current tree.

### Low

13. **Several persisted/API states and fields are dead or misleading.**

   `confirmed` is advertised as a user-confirmed state ([tax.ts:417](/work/personal/compass/packages/shared/src/schemas/tax.ts:417)) but no operation sets it. `gapReason` is persisted and returned ([schema.ts:343](/work/personal/compass/apps/api/src/modules/tax/schema.ts:343)), but neither create nor confirm request accepts it ([tax.ts:460](/work/personal/compass/packages/shared/src/schemas/tax.ts:460), [tax.ts:486](/work/personal/compass/packages/shared/src/schemas/tax.ts:486)). The field is consequently unreachable through this API.

14. **The idempotency pre-query is unnecessary complexity and creates the principal re-import bug.**

   A correctly constrained upsert is already present ([epf-contributions.ts:249](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:249)). The separate preflight query adds a round trip, makes behavior race-dependent, and prevents corrected component refresh ([epf-contributions.ts:187](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:187)).

15. **Comments continue to contradict H2 and the current schema counts.**

   The EPF schema still says employer EPF plus EPS is “12% of basic” ([schema.ts:314](/work/personal/compass/apps/api/src/modules/tax/schema.ts:314)), despite H2 explicitly removing an unconditional 12% check ([TASK.md:18](/work/personal/compass/tasks/091-epf-passbook/TASK.md:18)). The DB barrel header also claims 71 tables/53 enums ([db/schema.ts:11](/work/personal/compass/apps/api/src/db/schema.ts:11)), while its decomposition test now expects 78/61 ([schema.decomposition.test.ts:127](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:127)).

16. **VPF is reachable from AI parsing, but extraction recall remains weaker than necessary.**

   The tool enum and adjacent description now include `vpf` ([payslip-parse.ts:94](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:94), [payslip-parse.ts:107](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:107)), and the test asserts this ([payslip-parse.test.ts:167](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.test.ts:167)). The higher-priority system prompt’s explicit deduction list still omits VPF ([payslip-parse.ts:290](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:290)). This is not reachability failure, but it may reduce model recall.

## Acceptance criteria

| AC | Verdict | Evidence |
|---|---|---|
| **AC1** | **Satisfied, with caveat** | Dual expected/actual columns and the triple unique index exist ([schema.ts:311](/work/personal/compass/apps/api/src/modules/tax/schema.ts:311), [schema.ts:327](/work/personal/compass/apps/api/src/modules/tax/schema.ts:327), [schema.ts:348](/work/personal/compass/apps/api/src/modules/tax/schema.ts:348)); migration matches ([0016 migration:7](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:7), [0016 migration:24](/work/personal/compass/apps/api/drizzle/0016_mighty_blonde_phantom.sql:24)). The exact H1 request for a deferrable constraint/unique payslip fallback is not implemented. |
| **AC2** | **Not satisfied** | Canonical mapping is correct, including VPF ([epf-contributions.ts:222](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:222)), but same-payslip re-import returns before refreshing values ([epf-contributions.ts:187](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:187)). |
| **AC3** | **Not satisfied** | EPF and EPS are mapped separately, but the “invariant check” only warns on zero and has no test ([epf-contributions.ts:241](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:241), [epf-contributions.test.ts:36](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:36)). Parser semantics remain ambiguous ([payslip-parse.ts:293](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:293)). |
| **AC4** | **Not satisfied** | Calculation is embedded in a DB service, lacks a pure seam, and response omits required fields ([epf-contributions.ts:415](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:415), [tax.ts:512](/work/personal/compass/packages/shared/src/schemas/tax.ts:512)). |
| **AC5** | **Not satisfied** | No 45-day rule and no `gap` status in either DTO or persisted status ([epf-contributions.ts:367](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:367), [tax.ts:424](/work/personal/compass/packages/shared/src/schemas/tax.ts:424)). |
| **AC6** | **Satisfied, with caveat** | DTO computes employee plus VPF and excludes employer/EPS ([epf-contributions.ts:102](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:102), [epf-contributions.ts:121](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:121)); tests cover both ([epf-contributions.test.ts:201](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:201), [epf-contributions.test.ts:207](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:207)). It is classification only, not old-regime/cap integration. |
| **AC7** | **Satisfied** | `epf_contributions` follows `payslips` in `ALL_TABLES` and is present in `USER_TABLES` ([backup.ts:50](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:50), [backup.ts:81](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:81)). |
| **AC8** | **Not satisfied** | Typecheck and lint pass, but route snapshots currently fail; full/API DB tests cannot run without `DATABASE_URL`, and required EPF integration tests do not exist. |

## Re-verification of verification-1 claims

### (a) Projection uses posted ledger postings, never opening balance — confirmed

The balance query sums `postings.amountPaise`, joins transactions, scopes transaction ownership, excludes deleted transactions, and excludes future-dated transactions ([epf-contributions.ts:429](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:429)). There is no use of `accounts.openingBalancePaise`; `accounts` is only used for the ownership lookup ([epf-contributions.ts:421](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:421)).

### (b) Idempotent via upsert and preserves actuals — only partially true

The upsert exists and omits actual columns from the update set ([epf-contributions.ts:263](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:263)). However, same-payslip re-import is actually handled by an early return ([epf-contributions.ts:187](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:187)), not by that upsert. It preserves actuals but also prevents expected-value refresh. The verification-1 wording is therefore materially misleading.

### (c) Triple uniqueness and required non-null member ID — confirmed

The DB column is non-null and the unique index is on `(user_id, wage_month, epfo_member_id)` ([schema.ts:309](/work/personal/compass/apps/api/src/modules/tax/schema.ts:309), [schema.ts:348](/work/personal/compass/apps/api/src/modules/tax/schema.ts:348)). The import body requires a non-empty member ID ([tax.ts:472](/work/personal/compass/packages/shared/src/schemas/tax.ts:472)), and the route forwards it to the service ([routes/epf-contributions.ts:160](/work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts:160)).

Caveat: the DB accepts whitespace-only or unnormalized variants, and the payslip-ID index is not unique.

### (d) VPF is reachable from the AI tool schema — confirmed

`vpf` is present in both the shared canonical enum ([tax.ts:76](/work/personal/compass/packages/shared/src/schemas/tax.ts:76)) and `PARSE_PAYSLIP_TOOL`’s JSON-schema enum ([payslip-parse.ts:94](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:94)). The parse test verifies the tool advertisement and accepts a VPF component ([payslip-parse.test.ts:167](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.test.ts:167)). This follow-up is real.

## Requested assessments

### 1. Incorrect implementation assumptions relative to TASK.md

- Same-payslip idempotency was assumed to mean “return stale existing row,” whereas the spec requires expected values to refresh ([epf-contributions.ts:187](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:187)).
- Separate canonical kinds were assumed sufficient to enforce net employer EPF semantics; the AI prompt remains ambiguous and the service only logs ([payslip-parse.ts:293](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:293), [epf-contributions.ts:241](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:241)).
- Employee actual was assumed to be the sole confirmation marker; H4 describes all-component reconciliation ([epf-contributions.ts:65](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:65)).
- Any owned account was assumed suitable for EPF projection ([epf-contributions.ts:421](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:421)).
- Missing DOB was assumed to permit an undocumented 20-year fallback ([epf-contributions.ts:468](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:468)).

### 2. Missing scope and edge cases

Missing cases include corrected re-imports, concurrent imports, member-ID correction/normalization, partial actual confirmations, VPF mismatch, 45-day boundaries, as-of-date control, status recomputation after expected updates, negative imported components, projection overflow, wrong account types, missing DOB, archived accounts, and cross-user DB integration coverage. The current test inventory covers none of the I/O operations ([epf-contributions.test.ts:1](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.test.ts:1)).

### 3. Regressions outside task scope

No direct alteration to the pre-existing ledger EPF route was found; both old and new surfaces coexist ([route surface:345](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:345), [route surface:407](/work/personal/compass/apps/api/src/route-surface.snapshot.txt:407)).

The current tree nevertheless has an unrelated route regression: task 13.6’s scheme-compliance plugin is registered but missing from both snapshots, causing the route gate to fail ([plugin.ts:14](/work/personal/compass/apps/api/src/modules/tax/plugin.ts:14), [app.route-snapshot.test.ts:110](/work/personal/compass/apps/api/src/app.route-snapshot.test.ts:110)).

### 4. Security and compatibility risks

User scoping is generally sound: contribution operations filter `userId`, payslip import checks ownership, confirmation scopes its update, and projection scopes both account and transaction ownership ([epf-contributions.ts:200](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:200), [epf-contributions.ts:297](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:297), [epf-contributions.ts:436](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:436)). I found no cross-user disclosure path in the inspected service.

The material risks are correctness/compatibility:

- any owned account can masquerade as EPF;
- POST is used where the specified API says PUT;
- output labels are weakly typed and omit required fields;
- status may become stale under concurrent or later writes;
- an unnormalized member ID weakens identity consistency.

### 5. Is missing DB integration coverage acceptable?

**No. It should block completion.**

`DATABASE_URL` is unset here, so running DB-backed tests locally is impossible; even `backup.test.ts` deliberately throws when it is absent ([backup.test.ts:376](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:376)). That limits local verification, but it does not excuse omitting the tests. They should be written using the repository’s existing real-Postgres pattern and executed in CI, which provides Postgres.

This is especially important because inspection has already found a bug—early-return re-import—that a basic integration test for corrected re-import would have caught.

### 6. Unnecessary complexity

- The preflight payslip lookup duplicates the upsert’s purpose and causes stale re-imports ([epf-contributions.ts:187](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:187)).
- `confirmed` is modeled but unreachable ([tax.ts:424](/work/personal/compass/packages/shared/src/schemas/tax.ts:424)).
- `gapReason` is modeled but cannot be set through the API ([schema.ts:343](/work/personal/compass/apps/api/src/modules/tax/schema.ts:343)).
- `grossEmployerShare` exists solely for a warning that enforces nothing ([epf-contributions.ts:241](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:241)).
- Persisted status plus time-dependent/read-time gap classification creates two status models without a single authoritative computation.

### 7. CLAUDE.md convention compliance

- **Money as integer paise:** Partially compliant. API and DB amount fields use integer paise, but projection and mismatch calculations use floating-point financial arithmetic ([epf-contributions.ts:67](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:67), [epf-contributions.ts:475](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:475)).
- **Thin routes:** Compliant. Routes validate shared schemas, obtain the session user, and delegate to services ([routes/epf-contributions.ts:60](/work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts:60), [routes/epf-contributions.ts:151](/work/personal/compass/apps/api/src/modules/tax/routes/epf-contributions.ts:151)).
- **Module schema import boundary:** Compliant. `tax/schema.ts` imports only Drizzle utilities and `users` from `db/core-schema.ts`; it does not import another module’s `schema.ts` ([schema.ts:15](/work/personal/compass/apps/api/src/modules/tax/schema.ts:15), [schema.ts:32](/work/personal/compass/apps/api/src/modules/tax/schema.ts:32)).
- **Functional-core testing:** Not compliant for corpus projection and gap aging; both remain intertwined with DB/time logic and lack pure tests ([epf-contributions.ts:367](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:367), [epf-contributions.ts:415](/work/personal/compass/apps/api/src/modules/tax/services/epf-contributions.ts:415)).

## Verification run

- `npm run typecheck`: **pass**
- `npm run lint`: **pass**
- EPF contribution and payslip-parser tests: **51/51 pass**
- Schema decomposition test: **3/3 pass**
- Route snapshot test: **fail, 2 failures** due to unrelated registered scheme-compliance routes missing from snapshots
- Backup test: **not runnable**, because it requires `DATABASE_URL`
- Migration: source-level schema/SQL correspondence confirmed; not applied because no database is available

The passing pure tests do not change the verdict because several of them encode the incorrect current reconciliation behavior, while none reaches the DB-backed operations where the most consequential defects reside.