# Implementation review — Task 087

Overall verdict: **BLOCKING**

The implementation has several correctness gaps against P2/P4 and AC1–AC6. The independent verification report’s conclusion that task 087 is “implementation-complete and internally consistent” is not supported by the current code.

## High severity

### H1 — Old-regime taxpayer variants are absent — BLOCKING

P2 explicitly requires senior-citizen slab variants, and AC2 requires taxpayer-type variants where necessary ([TASK.md:103](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:103), [TASK.md:120](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:120)). Instead:

- `RegimeRules` contains no taxpayer-type dimension ([tax-rules.ts:35](/work/personal/compass/apps/api/src/lib/tax-rules.ts:35)).
- `getRegimeRules` accepts only `fy` and `regime` ([tax-rules.ts:490](/work/personal/compass/apps/api/src/lib/tax-rules.ts:490)).
- Every old-regime entry uses the ordinary-individual ₹2.5 lakh exemption ([tax-rules.ts:117](/work/personal/compass/apps/api/src/lib/tax-rules.ts:117), [tax-rules.ts:172](/work/personal/compass/apps/api/src/lib/tax-rules.ts:172), [tax-rules.ts:227](/work/personal/compass/apps/api/src/lib/tax-rules.ts:227)).

Resident senior citizens require a ₹3 lakh old-regime basic exemption and super-senior citizens ₹5 lakh; the official department tables show these separately. [Income Tax Department senior-citizen slabs](https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-2)

The same missing taxpayer context affects section 87A, which is only available to resident individuals. The current unconditional `rebate87A` object cannot represent residency or special-rate-income eligibility; the Finance Act 2025 memorandum confirms that the rebate cannot offset tax on special-rate income. [Finance Bill 2025 memorandum](https://www.indiabudget.gov.in/budget2025-26/doc/memo.pdf)

This means the registry cannot fulfill the task’s multi-dimensional lookup contract and will supply incorrect old-regime rules to senior taxpayers.

### H2 — Deduction data is materially incomplete and 80CCD(2) is wrong from FY 2024-25 — BLOCKING

All four years receive the same single 80CCD(2) record, marked `"both"` with “10% private / 14% central government” ([tax-rules.ts:370](/work/personal/compass/apps/api/src/lib/tax-rules.ts:370), [tax-rules.ts:373](/work/personal/compass/apps/api/src/lib/tax-rules.ts:373)). This cannot represent the FY/regime/employer distinctions required by P2:

- From AY 2025-26/FY 2024-25, the deduction for other employers is 14% under the new regime, while the old-regime rule remains 10%.
- Central and state government employers have the 14% treatment; the current condition mentions only central government.

The Finance Bill 2024 amendment expressly substitutes 14% for the 10% limit when income is taxed under section 115BAC(1A). [Official Finance Bill 2024](https://www.indiabudget.gov.in/budget2024-25/doc/Finance_Bill.pdf)

The 80D records are also incomplete: only non-senior self/family ₹25,000 and senior parents ₹50,000 are represented ([tax-rules.ts:383](/work/personal/compass/apps/api/src/lib/tax-rules.ts:383)). There is no self/family senior ₹50,000 or non-senior parents ₹25,000 variant. This violates AC1’s requirement that caps and conditions be effective-dated data.

## Medium severity

### M1 — Concurrent chosen/inferred updates can persist an internally inconsistent row — BLOCKING

Both public choice and internal inference use a read-then-write sequence:

- PUT reads `inferredRegime`, computes `effective`, then updates ([regime-preference.ts:103](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:103), [regime-preference.ts:116](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:116)).
- The inference path separately reads `chosen`, computes its result, then updates ([regime-preference.ts:166](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:166), [regime-preference.ts:177](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:177)).

A valid interleaving is:

1. Inference reads `chosen = null`.
2. PUT reads the existing inference.
3. PUT writes `chosen = new`, `effective = new`, `source = chosen`.
4. Inference writes only its inference fields plus stale `effective = old`, `source = inferred`.

The final row then has `chosen = new` but `effective = old`. Concurrent creation can also make one of two inserts fail the composite-PK conflict.

Use atomic `INSERT ... ON CONFLICT DO UPDATE` statements that derive `effective/source` from the row as updated, or serialize the row in a transaction. This is directly relevant once the task-088 payslip inference caller is active.

### M2 — C1 confirmed: duplicate epochs silently overwrite — BLOCKING

`addRegimeRules` directly calls `Map.set` without checking `has(key)` ([tax-rules.ts:104](/work/personal/compass/apps/api/src/lib/tax-rules.ts:104), [tax-rules.ts:110](/work/personal/compass/apps/api/src/lib/tax-rules.ts:110)). The later slab validator only validates whichever value survived the overwrite ([tax-rules.ts:446](/work/personal/compass/apps/api/src/lib/tax-rules.ts:446)).

The same issue exists in the other registries:

- Deduction entries are appended without duplicate-key validation ([tax-rules.ts:342](/work/personal/compass/apps/api/src/lib/tax-rules.ts:342)).
- Advance-tax schedules overwrite by FY ([tax-rules.ts:404](/work/personal/compass/apps/api/src/lib/tax-rules.ts:404)).

Thus the accepted M4/P2 boot-time overlap requirement is only partially implemented. Duplicate `{fy, regime}`, `{section, fy, regime, condition}` and advance-schedule FY keys should fail during module initialization.

### M3 — C2 confirmed: canonical-looking invalid FYs produce HTTP 500 — BLOCKING

`FySchema` checks only the regex shape, so `"2025-27"` passes request validation ([tax.ts:13](/work/personal/compass/packages/shared/src/schemas/tax.ts:13)). Both services then call `parseFy`, which throws a plain `Error` ([regime-preference.ts:51](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:51), [regime-preference.ts:95](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:95), [financial-year.ts:38](/work/personal/compass/apps/api/src/lib/financial-year.ts:38)).

The global handler treats an error without a status code as an unexpected 500 and masks it ([app.ts:241](/work/personal/compass/apps/api/src/app.ts:241)). Therefore both GET and PUT return 500 for client input `"2025-27"`.

Prefer making the shared schema validate suffix consistency so the route rejects it as 400. The service should still translate invalid internal input to `HttpError(400)` if it remains part of the public service contract.

### M4 — Missing/future FYs do not consistently fail loudly — BLOCKING

Two APIs violate AC4/AC5:

- `getDeductionCap("80C", "2030-31")` returns `[]` because it only validates the label and filters the array ([tax-rules.ts:510](/work/personal/compass/apps/api/src/lib/tax-rules.ts:510)).
- Regime-preference GET/PUT validate only canonical formatting, not whether the FY is supported ([regime-preference.ts:56](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:56), [regime-preference.ts:101](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:101)). Consequently a future FY can return a fabricated statutory default or be persisted.

This contrasts with `getRegimeRules` and `getAdvanceTaxSchedule`, which correctly reject uncovered FYs ([tax-rules.ts:490](/work/personal/compass/apps/api/src/lib/tax-rules.ts:490), [tax-rules.ts:521](/work/personal/compass/apps/api/src/lib/tax-rules.ts:521)). All FY-keyed lookups should first assert that the FY is covered.

### M5 — Slab and surcharge inclusivity is off at exact thresholds — BLOCKING

The interface declares both lower and upper bounds inclusive ([tax-rules.ts:25](/work/personal/compass/apps/api/src/lib/tax-rules.ts:25)). The data nevertheless sets the nil slab’s upper bound to `threshold - 1 paise` and starts the next bracket at the exact threshold—for example FY 2025-26 new regime at ₹4 lakh ([tax-rules.ts:258](/work/personal/compass/apps/api/src/lib/tax-rules.ts:258)).

That contradicts the statutory “up to ₹4,00,000: nil; ₹4,00,001 onward: 5%” boundary. [Official Budget 2025 slab table](https://www.indiabudget.gov.in/budget2025-26/doc/Budget_Speech.pdf)

The surcharge consequence is more material: the code starts 10% at exactly ₹50 lakh, 15% at exactly ₹1 crore, and so on ([tax-rules.ts:131](/work/personal/compass/apps/api/src/lib/tax-rules.ts:131)). Surcharge applies only when income exceeds those thresholds; up to ₹50 lakh is nil. [Income Tax Department surcharge table](https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-1)

The existing contiguity test merely proves the entries join under the implementation’s convention ([tax-rules.test.ts:255](/work/personal/compass/apps/api/src/lib/tax-rules.test.ts:255)); it does not prove statutory boundary correctness. Rebate thresholds themselves are correctly represented as inclusive.

### M6 — C3 confirmed: the emitted enum is unused and persistence has no domain integrity — BLOCKING

`taxRegimeEnum` is declared ([schema.ts:21](/work/personal/compass/apps/api/src/modules/tax/schema.ts:21)), but `chosen`, `inferredRegime`, `effective`, and `source` are all unrestricted text ([schema.ts:40](/work/personal/compass/apps/api/src/modules/tax/schema.ts:40)). Migration 0012 consequently creates the enum but uses text columns ([0012_simple_nightshade.sql:4](/work/personal/compass/apps/api/drizzle/0012_simple_nightshade.sql:4), [0012_simple_nightshade.sql:31](/work/personal/compass/apps/api/drizzle/0012_simple_nightshade.sql:31)).

The service compensates with unchecked TypeScript casts when reading rows ([regime-preference.ts:76](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:76)). Invalid restored or manually inserted data can therefore become a response-serialization 500 or persist an impossible `effective/source` combination.

Recommendation: use `taxRegimeEnum` for `chosen`, `inferredRegime`, and `effective`, and add a separate enum or check constraint for `source`. Do not drop the enum: P3 explicitly requires a regime enum ([TASK.md:109](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:109)). Because migration 0012 is still untracked in this working tree, correcting and regenerating it now has substantially less churn than repairing a deployed migration later.

### M7 — Core preference behavior has no service or route tests — BLOCKING

There are no task-087 tests for:

- composite-PK upsert behavior;
- chosen > inferred > default resolution;
- preservation of inference during PUT;
- user isolation;
- concurrent chosen/inferred updates;
- invalid-FY HTTP status;
- demo-mode PUT rejection.

The only new tests cover pure FY and tax-rule helpers. This falls short of the repository’s TDD rule and leaves AC3 effectively unverified. The independent report’s statement that the regime service is complete ([verification-1.md:96](/work/personal/compass/tasks/087-tax-rule-data/verification-1.md:96)) is therefore too strong.

Real-Postgres integration tests should be added even if they cannot run in the present environment. A focused route test should cover the 400 and demo-403 paths.

## Low severity

### L1 — C4 confirmed: `fyOf` accepts impossible dates — BLOCKING

`fyOf` validates only `YYYY-MM-DD` shape and then branches on the numeric month ([financial-year.ts:20](/work/personal/compass/apps/api/src/lib/financial-year.ts:20)). For example, `fyOf("2025-13-40")` currently returns `"2025-26"`; zero months/days and dates such as February 30 are also accepted.

This contradicts P1/AC6’s strict ISO-date validation. Add a calendar-valid round trip and tests for invalid month, invalid day, leap day, and impossible month/day combinations. Century rollover coverage itself is good ([financial-year.test.ts:27](/work/personal/compass/apps/api/src/lib/financial-year.test.ts:27), [financial-year.test.ts:58](/work/personal/compass/apps/api/src/lib/financial-year.test.ts:58)).

### L2 — Required `fyLabel` helper was omitted — NON-BLOCKING

The task scope and delegation explicitly list `fyLabel` ([DELEGATION.md:24](/work/personal/compass/tasks/087-tax-rule-data/DELEGATION.md:24)), but the new utility exports only `fyOf`, `parseFy`, `fyRange`, and `currentFy` ([financial-year.ts:20](/work/personal/compass/apps/api/src/lib/financial-year.ts:20), [financial-year.ts:68](/work/personal/compass/apps/api/src/lib/financial-year.ts:68)).

Nothing currently calls `fyLabel`, so this is not a present runtime defect, but it is an undocumented plan deviation.

### L3 — FY 2026-27 is still described and tested as placeholder data — NON-BLOCKING

The registry says FY 2026-27 was copied before Budget 2026 was presented ([tax-rules.ts:282](/work/personal/compass/apps/api/src/lib/tax-rules.ts:282)). That comment is stale as of August 2026. The carried-forward rates appear consistent with current published slabs, but an effective-dated legal registry should cite the enacted source rather than retain a placeholder disclaimer.

## Confirmed-good areas

- Base ordinary-individual slabs, standard deductions, 87A headline thresholds/caps, cess, and surcharge rates for FY 2023-24 through 2025-26 otherwise match the published Finance Act material. FY 2025-26’s seven new-regime slabs and ₹60,000/₹12 lakh rebate are correct. [Income Tax Department AY 2026-27 FAQ](https://www.incometax.gov.in/iec/foportal/help/all-topics/e-filing-services/itr-2/itr-2-faqs)
- Advance-tax dates and cumulative percentages are correct. The senior-citizen exemption comment correctly includes the no-business-income qualification ([tax-rules.ts:410](/work/personal/compass/apps/api/src/lib/tax-rules.ts:410)); the official rule additionally requires a resident senior citizen. [Income Tax Department advance-tax guidance](https://www.incometax.gov.in/iec/foportal/help/individual/return-applicable-2)
- Resolution order is correctly implemented as chosen > inferred > new-regime default ([regime-preference.ts:32](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:32)).
- Every database query and update is scoped by both `userId` and `fy` ([regime-preference.ts:58](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:58), [regime-preference.ts:104](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:104), [regime-preference.ts:166](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:166)).
- Demo-mode PUT safety is provided by the global mutating-method guard ([auth.ts:64](/work/personal/compass/apps/api/src/plugins/auth.ts:64)).
- Backup coverage is correct in both `ALL_TABLES` and `USER_TABLES` ([backup.ts:50](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:50), [backup.ts:78](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:78)).
- Module registration, schema barrel exports, shared exports, ESM `.ts` imports, and module boundaries follow repository conventions.
- Migration 0012 and its journal entry are structurally consistent, apart from the enum-domain issue.
- Both route snapshots match the current route registration. Their additional deposit routes belong to co-resident task 089, not task 087.
- Read-only targeted verification passed 57/57 tests covering the two new pure helper suites, route snapshots, and schema decomposition. Full DB gates remain unavailable as stated, and the unrelated task-089 typecheck failure was excluded from this verdict.

No files were modified.