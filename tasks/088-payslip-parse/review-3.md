## High

None.

## Medium

1. **Component IDs can still bypass validation when no amount is supplied.** `AcceptPayslipBodySchema` permits `{ id }` without `currentPaise` or `ytdPaise`. The service then skips the update entirely, so a nonexistent or wrong-payslip component ID is silently accepted and the payslip transitions to accepted. Require at least one corrected field or validate every supplied ID. [tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:217) [payslip-review.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:198)

2. **Persisted documents become orphaned whenever parsing does not create a payslip.** `storage.put()` runs before vision-consent/provider-capability checks and AI parsing, but all subsequent fallback/error returns leave the object stored without a database row. Database insertion failures similarly leave the object behind. This affects declined vision parsing, provider errors, malformed output, missing months, empty components, and unsafe amounts. Add compensating deletion unless `createExtractedPayslip` succeeds. [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:319)

3. **AI-extracted `payMonth` is still not checked against the requested FY.** The new refinement protects manual creation only. The extraction path validates the month’s syntax but can persist, for example, `2030-01` under FY `2025-26`, corrupting FY-scoped reporting after acceptance. [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:409) [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:467)

## Low

1. **Storage failures are silently swallowed.** Task 088 explicitly permits continuing without `documentKey` if storage fails, but requires the failure to be logged. The empty `catch` makes successful payslips with missing audit documents undiagnosable. [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:321)