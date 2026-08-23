# Task 087 re-review — fix round 2

## Final verdict

**NOT COMPLETE-ready.**

The functional defects from H1/H2 and M1–M6 are substantially corrected, and I found no new tax-rule or capital-gains runtime regression. However, prior finding **M7 remains partially unresolved and blocking** under the repository’s TDD requirements: concurrent chosen/inferred upserts are not tested, and the promised route-level invalid-FY/demo-mode coverage was neither added nor given the documented skip rationale required by G9.

No files were modified during this review.

## High severity

| Prior finding | Resolution | Evidence |
|---|---|---|
| **H1 — senior/super-senior variants** | **RESOLVED** | Rules are keyed by FY, regime, and taxpayer type at [tax-rules.ts:128](/work/personal/compass/apps/api/src/lib/tax-rules.ts:128). Old-regime senior slabs correctly use a ₹3 lakh exemption and four slabs; super-senior rules use a ₹5 lakh exemption and omit the 5% slab. The four FY blocks are at [tax-rules.ts:181](/work/personal/compass/apps/api/src/lib/tax-rules.ts:181), [tax-rules.ts:246](/work/personal/compass/apps/api/src/lib/tax-rules.ts:246), [tax-rules.ts:309](/work/personal/compass/apps/api/src/lib/tax-rules.ts:309), and [tax-rules.ts:381](/work/personal/compass/apps/api/src/lib/tax-rules.ts:381). New-regime senior types intentionally map to ordinary at [tax-rules.ts:623](/work/personal/compass/apps/api/src/lib/tax-rules.ts:623). All four FYs are covered by the cross-FY test at [tax-rules.test.ts:219](/work/personal/compass/apps/api/src/lib/tax-rules.test.ts:219). The old-regime ₹5 lakh/₹12,500 87A fields are consistently present for ordinary, senior, and super-senior records; the rebate remains subject to residency and eligible-income rules in the later computation phase. |
| **H2 — 80CCD(2) matrix and 80D variants** | **RESOLVED** | Old regime has private 10% and government 14% for every covered FY at [tax-rules.ts:460](/work/personal/compass/apps/api/src/lib/tax-rules.ts:460). New regime is 10%/14% in FY 2023–24 at [tax-rules.ts:476](/work/personal/compass/apps/api/src/lib/tax-rules.ts:476), then 14%/14% from FY 2024–25 at [tax-rules.ts:487](/work/personal/compass/apps/api/src/lib/tax-rules.ts:487). All four 80D variants are populated for each FY at [tax-rules.ts:500](/work/personal/compass/apps/api/src/lib/tax-rules.ts:500). Tests cover both regimes, the transition year, and the four 80D caps at [tax-rules.test.ts:244](/work/personal/compass/apps/api/src/lib/tax-rules.test.ts:244) and [tax-rules.test.ts:283](/work/personal/compass/apps/api/src/lib/tax-rules.test.ts:283). |

No unresolved high-severity implementation defects were found.

## Medium severity

| Prior finding | Resolution | Evidence |
|---|---|---|
| **M1 — read-modify-write race** | **RESOLVED** | Both writes are now single-statement `INSERT … ON CONFLICT DO UPDATE` operations. PUT changes only chosen/effective/source at [regime-preference.ts:131](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:131); inference changes only inferred fields/effective/source and resolves against the locked current `chosen` value at [regime-preference.ts:180](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:180). Simultaneous first inserts are also handled by the composite conflict target. Enum casts and `excluded.chosen`/`excluded.inferred_regime` references are valid PostgreSQL expressions, and first-insert placeholder values correctly represent chosen-only or inferred-only rows. |
| **M2 — duplicate epoch guards** | **RESOLVED** | Duplicate regime keys throw before `Map.set` at [tax-rules.ts:136](/work/personal/compass/apps/api/src/lib/tax-rules.ts:136); deduction keys are guarded at [tax-rules.ts:430](/work/personal/compass/apps/api/src/lib/tax-rules.ts:430); advance-tax FYs are guarded at [tax-rules.ts:530](/work/personal/compass/apps/api/src/lib/tax-rules.ts:530). |
| **M3 — FY suffix validation and HTTP 400** | **RESOLVED** | `FySchema` now checks suffix consistency at [tax.ts:13](/work/personal/compass/packages/shared/src/schemas/tax.ts:13). The service converts `parseFy` failures to `HttpError(400)` at [regime-preference.ts:40](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:40). Direct service tests cover malformed and unsupported FYs at [regime-preference.test.ts:31](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:31). Route-level verification is still missing under M7 below. |
| **M4 — uncovered FY failures** | **RESOLVED** | `getDeductionCap` checks `coveredFys()` and throws outside the data set at [tax-rules.ts:652](/work/personal/compass/apps/api/src/lib/tax-rules.ts:652). All three preference operations call the shared covered-FY guard before DB access at [regime-preference.ts:82](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:82), [regime-preference.ts:121](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:121), and [regime-preference.ts:169](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:169). |
| **M5 — inclusive slab/surcharge boundaries** | **RESOLVED** | Slab boundaries now use inclusive statutory thresholds and begin the next band one paise later, documented at [tax-rules.ts:10](/work/personal/compass/apps/api/src/lib/tax-rules.ts:10). Surcharge starts only above ₹50 lakh/₹1 crore/etc. at [tax-rules.ts:144](/work/personal/compass/apps/api/src/lib/tax-rules.ts:144). The validator uses the same `previous upper + 1` convention at [tax-rules.ts:576](/work/personal/compass/apps/api/src/lib/tax-rules.ts:576), with slab and surcharge contiguity tests at [tax-rules.test.ts:374](/work/personal/compass/apps/api/src/lib/tax-rules.test.ts:374). |
| **M6 — enum columns, migration, barrel/decomposition** | **PARTIALLY RESOLVED** | The substantive persistence defect is fixed: chosen, inferred, and effective use `tax_regime`, while source uses `regime_source`, at [schema.ts:21](/work/personal/compass/apps/api/src/modules/tax/schema.ts:21) and [schema.ts:45](/work/personal/compass/apps/api/src/modules/tax/schema.ts:45). Migration 0013 creates/casts all four columns at [0013_same_angel.sql:1](/work/personal/compass/apps/api/drizzle/0013_same_angel.sql:1), and the barrel exports both enums at [schema.ts:144](/work/personal/compass/apps/api/src/db/schema.ts:144). The residual issue is test consistency: `regimeSourceEnum` is counted among 58 enums but omitted from both `taxResidents` and the enum identity map at [schema.decomposition.test.ts:84](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:84) and [schema.decomposition.test.ts:270](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:270). Thus the test’s stated “every enum is Object.is-identical” invariant does not cover the newly added enum. |
| **M7 — service and route tests** | **PARTIALLY RESOLVED — BLOCKING** | DB-backed tests now cover idempotent sequential upserts, resolution order, inference preservation, and user isolation at [regime-preference.test.ts:117](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:117). They are conditionally registered only when `DATABASE_URL` exists at [regime-preference.test.ts:89](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.test.ts:89), so they were not executed or reported as skipped in this environment. No test launches concurrent chosen/inferred writes—the exact M1 failure mode. There is also no tax route test proving `"2025-27"` becomes HTTP 400 or that demo PUT returns 403, despite established hermetic route-test patterns elsewhere. G9 required those route tests unless a skip rationale was documented; none is present at [TASK.md:174](/work/personal/compass/tasks/087-tax-rule-data/TASK.md:174). |

### Blocking medium finding

M7 remains a completion blocker. The implementation appears concurrency-safe, but this repository explicitly requires acceptance behavior to be captured by tests. At minimum, completion needs:

- A real-Postgres test executing chosen and inferred writes concurrently and asserting the persisted row remains internally consistent.
- A route-level test for invalid-FY HTTP 400.
- A route-level demo-session PUT 403 test, or the G9-required documented rationale for omitting it.
- Preferably, inclusion of `regimeSourceEnum` in the decomposition identity map.

## Low severity

| Prior finding | Resolution | Evidence |
|---|---|---|
| **L1 — `fyOf` calendar validation** | **RESOLVED** | `fyOf` performs a UTC calendar round trip at [financial-year.ts:23](/work/personal/compass/apps/api/src/lib/financial-year.ts:23). Tests cover invalid months/days, non-leap February 29, valid leap day, and September 31 at [financial-year.test.ts:50](/work/personal/compass/apps/api/src/lib/financial-year.test.ts:50). |
| **L2 — missing `fyLabel`** | **RESOLVED** | Implemented and validated at [financial-year.ts:87](/work/personal/compass/apps/api/src/lib/financial-year.ts:87), with tests at [financial-year.test.ts:115](/work/personal/compass/apps/api/src/lib/financial-year.test.ts:115). |
| **L3 — stale FY 2026–27 comment** | **PARTIALLY RESOLVED** | The placeholder disclaimer was removed and the carried-forward rates are correct, but the replacement says the Finance Act 2026 was enacted “in February” at [tax-rules.ts:361](/work/personal/compass/apps/api/src/lib/tax-rules.ts:361). It was introduced in February but received presidential assent on **30 March 2026**, according to the [official Gazette](https://egazette.gov.in/WriteReadData/2026/271439.pdf). This is documentation-only and not independently blocking. |

## Regression scan

### Boundary convention and taxpayer-type keying

No new functional errors found.

- Every old-regime super-senior record has exactly three contiguous slabs: nil through ₹5 lakh, 20% through ₹10 lakh, then 30%. FY 2023–24 begins at [tax-rules.ts:196](/work/personal/compass/apps/api/src/lib/tax-rules.ts:196); FY 2026–27 is at [tax-rules.ts:396](/work/personal/compass/apps/api/src/lib/tax-rules.ts:396).
- Senior records have the correct ₹3 lakh nil band followed by 5%, 20%, and 30%.
- Old-regime 87A remains ₹12,500 up to ₹5 lakh for all taxpayer types. That is correct because age changes slab structure, not the resident-individual rebate threshold.
- New-regime taxpayer types intentionally resolve to the ordinary record rather than requiring duplicate entries.
- The FY 2026–27 carried-forward slab structure matches the official Finance Act 2026 tables: ₹4/8/12/16/20/24 lakh new-regime boundaries and unchanged old-regime senior/super-senior bands. The official memorandum likewise states the FY 2026–27 rates remain unchanged. [Finance Bill 2026 memorandum](https://www.indiabudget.gov.in/doc/memo.pdf)
- The boundary flip and contiguity validator agree: inclusive upper bound, next lower bound equal to upper plus one paise.
- The shared surcharge arrays are not mutated by consumers.

### Atomic-upsert SQL and enum migration

No runtime SQL defect found.

- `excluded.chosen` and `excluded.inferred_regime` reference the inserted row correctly.
- Existing inferred values survive PUT because they are absent from the conflict update set.
- Existing chosen values survive inference, and the inference conflict expression resolves against the current locked row.
- First insert values are internally consistent.
- Migration ordering is sound: 0012 creates the original table and `tax_regime`; 0013 creates `regime_source` and casts the four columns.
- Enum-backed Drizzle row types match the response result types. The remaining `as Regime` casts in [regime-preference.ts:71](/work/personal/compass/apps/api/src/modules/tax/services/regime-preference.ts:71) and [regime-preference.ts:48](/work/personal/compass/apps/api/src/modules/tax/routes/regime-preference.ts:48) are redundant but harmless.
- The only schema-test regression is the omitted `regimeSourceEnum` identity assertion described under M6.

### Capital-gains consumers

No regression found.

`capital-gains.ts` imports the extracted helpers and preserves its former public re-exports at [capital-gains.ts:6](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:6). Database `date` values supplied to `fyOf` are canonical ISO dates, and requested FYs now receive stricter validation before filtering at [capital-gains.ts:105](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.ts:105). Existing characterization tests pass at [capital-gains.test.ts:5](/work/personal/compass/apps/api/src/modules/investments/services/capital-gains.test.ts:5).

The read-only targeted run completed with **77 tests passed, 0 failed**, including financial-year, tax-rules, regime-preference hermetic checks, schema decomposition, and capital-gains tests. DB-backed preference tests were not run because no database is available.

**Final verdict: BLOCKED on M7 test coverage; otherwise the fix-round-2 implementation is functionally sound.**