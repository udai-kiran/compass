## High

- Blocking: the persisted and returned income-event model omits required fields. `section` and `source_priority` are absent from the Drizzle table and migration, while `afterTdsPaise` is absent from the DTO/shared schema. Consequently payslip derivation cannot set `section='192'`, and list/get responses do not compute `grossPaise - tdsPaise` as required. See [schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:215), [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:55), [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:269), and [0015_unknown_christian_walker.sql](/work/personal/compass/apps/api/drizzle/0015_unknown_christian_walker.sql:4). This leaves the task’s core tax-section/provenance contract incomplete.

- Blocking: the summary response does not satisfy AC3/TASK.md. It correctly aggregates monetary values only from accepted rows, but omits both `acceptedCount` and the required `notes` explaining that salary figures are gross rather than taxable salary. Therefore the summary is not actually labelled as required. See [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:263) and [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:367).

## Medium

- The required service/integration coverage was not implemented. [income-events.test.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.test.ts:1) contains only 14 tests for `lastDayOfMonth` and DTO conversion. There are no tests for the guarded state machine, concurrent acceptance, summary inclusion semantics, source deduplication, ownership, payslip derivation, null gross rejection, holding-event rejection, FY derivation, routes, or PAN/TAN request schemas. This does not meet the task’s P8/T3 or delegated AC9 verification requirements.

- `deriveFromPayslip` rejects a null `grossPaise`, but returns HTTP 400 instead of the explicitly required 422. See [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:332).

- The manual-create endpoint permits the client to choose `sourceKind`, and the service persists that value while always forcing `sourceId=null`. A caller can therefore create purported `payslip`, `holding_event`, or `ais` rows through the manual route, undermining provenance and bypassing source deduplication. The task specifies this route as `source_kind='manual'`. See [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:296) and [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:95).

- `accrualDate` validation checks only its textual shape. An impossible date such as `2025-02-30` passes Zod and then causes `fyOf()` to throw a raw error, which the application converts to a logged HTTP 500 rather than a validation 400. See [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:298), [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:85), and [app.ts](/work/personal/compass/apps/api/src/app.ts:241).

## Low

- No additional low-severity findings.

## Requirements disposition

- AC1: Not fully met. Constraints, enums, partial unique index, and absence of a generated column are correct, but required `section` and `source_priority` columns are missing.
- AC2: Met. Both transitions use `UPDATE ... WHERE user_id=? AND id=? AND status='pending' RETURNING`; acceptance stores the pre-correction payer/note values.
- AC3: Not met. Accepted-only/per-kind aggregation and `isEstimate` are correct, but gross-salary labelling, `notes`, and `acceptedCount` are missing.
- AC4: Partially met. Payslip ownership/status, last-day accrual, gross/TDS mapping, targetless `onConflictDoNothing()`, and conflict fetch are correct. `section='192'` is missing and null gross uses 400 rather than 422.
- AC5, delegated holding-event criterion: Met. Ownership is checked through the holding and non-dividend events receive HTTP 400.
- AC6: Met. `fy` is absent from the create body and every creation path computes it from `accrualDate`; payslip derivation does not use `payslip.fy`.
- AC7, delegated PAN/TAN criterion: Met. Regexes are exactly `^[A-Z]{5}[0-9]{4}[A-Z]$` and `^[A-Z]{4}[0-9]{5}[A-Z]$`, with trim/uppercase normalization. No logging was found.
- AC8, delegated backup/decomposition criterion: Met. `income_events` is in both backup arrays, and the 77-table decomposition test passes.
- AC9: Not fully verified/met. Typecheck, lint, targeted helper tests, shared tests, route snapshots, and decomposition tests pass. The API suite exits nonzero because `DATABASE_URL` is unavailable, and the task’s required DB integration tests do not exist.

No regression to the existing tax regime routes was observed: typecheck and lint pass, shared tests pass, and route snapshots remain green. The missing ledger fields and incomplete summary contract are blocking approval.