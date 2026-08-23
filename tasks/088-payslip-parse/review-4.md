## High

1. **H3 remains unresolved: text-path PII can still leak.** `redactPayslipText()` only masks names present in `identity`; labelled values such as `Employee Name: Rahul Sharma` and `DOB: 1990-01-02` remain unchanged when identity loading fails, is missing, or contains a different display name. Structural redaction does not cover either field, so AC6 still fails open. [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:217)

## Medium

1. **M-NEW2 is only partially resolved: database failures still orphan stored documents.** Storage is correctly deferred until parsing and amount validation succeed, but `storage.put()` occurs before `createExtractedPayslip()`. If the transactional database creation fails, the stored object is never deleted. Wrap creation with compensating `storage.delete(documentKey)` on failure. [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:487)

## Low

None.

H1, H2’s persistence path, and H4 are otherwise resolved. M-NEW1 and M-NEW3 are resolved. FY consistency covers both manual and AI paths; both `ai.chat()` paths catch exceptions; and both creation services use database transactions.