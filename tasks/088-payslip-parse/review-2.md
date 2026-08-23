## High

1. **H — The required server-side PDF text path does not exist.**  
   `POST /payslips` trusts an optional client-supplied `extractedText` field instead of extracting text from the uploaded PDF ([payslips.ts:151](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:151), [payslip-parse.ts:308](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:308)). No PDF parser is called anywhere. Consequently:

   - The redacted text need not correspond to the uploaded document.
   - Ordinary text PDFs without `extractedText` are sent down the vision branch.
   - The vision branch casts `application/pdf` to an image MIME union ([payslip-parse.ts:324](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:324)); the AI package accepts only JPEG/PNG/WebP image blocks, so consented PDF vision parsing fails before the provider call.
   - P4 and AC1/AC2/AC6 are not satisfied for the primary PDF use case.

2. **H — Uploaded documents are never retained or associated with payslip rows, violating AC7.**  
   Storage is used only transiently for vision: the buffer is stored, read directly from memory for the model, and the storage key is always deleted ([payslip-parse.ts:321](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:321), [payslip-parse.ts:347](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:347)). `createExtractedPayslip` never receives or writes `documentKey` ([payslip-review.ts:315](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:315)). Thus every parsed row has `document_key = NULL`, despite the schema, backup wiring, and AC7 requiring documents stored via `Storage`.

3. **H — Text-path PII redaction fails open for common payslip identity fields.**  
   Identity loading catches every error and silently substitutes an empty identity ([payslips.ts:337](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:337), [payslips.ts:353](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:353)). Structural redaction does not recognize an unregistered `Employee Name:` value or DOB. A direct check leaves this unchanged:

   ```text
   Employee Name: Rahul Sharma
   DOB: 1990-01-02
   ```

   This also occurs when the account display name differs from the legal name printed on the payslip. D1/AC6 says PII must be redacted before the call; a missing profile or transient DB error must not weaken that guarantee. Tests only cover a name explicitly supplied in `identity`, not the empty/mismatched/failure cases ([payslip-parse.test.ts:280](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.test.ts:280)).

4. **H — Validated model output can create an invalid payslip that cannot be serialized.**  
   The tool and Zod model schemas require only `components`, allow that array to be empty, and make `payMonth` optional ([payslip-parse.ts:131](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:131), [payslip-parse.ts:147](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:147)). Missing month is persisted as `""` ([payslip-review.ts:345](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:345)), while the response contract requires `YYYY-MM` ([tax.ts:129](/work/personal/compass/packages/shared/src/schemas/tax.ts:129)). For example, `{ "components": [] }` passes parsing but produces a row that fails the route’s response serializer. Unknown/incomplete layouts should instead return the manual-entry fallback under AC2.

## Medium

1. **M — Reviewer corrections can be silently ignored while the payslip is accepted.**  
   The pending-row claim is correctly guarded and transactional, but component updates do not verify affected-row counts ([payslip-review.ts:197](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:197)). A nonexistent or wrong-payslip component ID updates zero rows, yet the transaction commits the header as accepted. Corrections are also limited to amounts; reviewers cannot correct `payMonth`, `canonicalKind`, `category`, labels, add/remove components, or clear nullable values ([tax.ts:192](/work/personal/compass/packages/shared/src/schemas/tax.ts:192)). This only partially satisfies AC3/D3.

2. **M — Payslip creation is not atomic.**  
   Both manual and AI creation insert the header first and components afterward without a transaction ([payslip-review.ts:273](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:273), [payslip-review.ts:340](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:340)). A component insert failure leaves an accepted manual header or incomplete pending extraction behind. The two inserts should commit or roll back together.

3. **M — Database constraints do not preserve the domain invariants.**  
   The status, canonical kind, and category columns are unrestricted text, and amounts/confidence lack database checks ([schema.ts:98](/work/personal/compass/apps/api/src/modules/tax/schema.ts:98), [schema.ts:138](/work/personal/compass/apps/api/src/modules/tax/schema.ts:138)). In addition, PostgreSQL’s ordinary unique index treats `NULL` employer names as distinct, so repeated `(user, pay_month, NULL)` rows are allowed ([schema.ts:114](/work/personal/compass/apps/api/src/modules/tax/schema.ts:114)). This can duplicate monthly TDS in the aggregate. The migration reproduces these weaknesses ([0014_smiling_ezekiel_stane.sql:16](/work/personal/compass/apps/api/drizzle/0014_smiling_ezekiel_stane.sql:16)).

4. **M — FY and pay month are validated independently but not for consistency.**  
   Manual input can associate `payMonth: "2030-01"` with `fy: "2025-26"`, and that row will contribute to the queried FY total. The shared body schema has no cross-field refinement ([tax.ts:165](/work/personal/compass/packages/shared/src/schemas/tax.ts:165)), and the AI path likewise validates the two values separately. This compromises D4 even though the accepted/current-only summation itself is correct.

5. **M — EPF classification is advisory only, and category/kind combinations are unconstrained.**  
   The prompt explains employee versus employer EPF, but no downstream 80C consumer exists in this implementation; references are confined to schemas, comments, prompts, and tests. Therefore AC4’s “flows to 80C basket” is not implemented. Additionally, `employee_epf` can be paired with `category: "earning"` and `basic` with `category: "deduction"` because neither model nor manual schemas refine the combination ([payslip-parse.ts:137](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:137), [tax.ts:174](/work/personal/compass/packages/shared/src/schemas/tax.ts:174)).

6. **M — “Gross salary” is incorrectly described as a monthly CTC equivalent.**  
   The tool says `grossRupees` is “Total gross salary (CTC monthly equivalent)” ([payslip-parse.ts:60](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:60)). Gross pay and CTC are not interchangeable because employer contributions and benefits may be outside gross. This prompt can cause systematic overstatement or inconsistent extraction.

7. **M — Exact source provenance is not preserved on the text path.**  
   The model sees only redacted text ([payslip-parse.ts:308](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:308)), and its returned `sourceQuote` is persisted verbatim ([payslip-parse.ts:393](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:393)). Therefore source quotes may contain `[name]`, `[account]`, etc., rather than the “exact text from document” required by the table design and AC3. A local mapping from redacted evidence back to the original document is needed without sending the original PII to the provider.

8. **M — Provider failures do not degrade to the documented manual fallback.**  
   `ai.chat()` exceptions are not caught on either text or vision paths ([payslip-parse.ts:312](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:312), [payslip-parse.ts:326](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:326)). Only successfully returned but malformed model output gets the manual-entry message. Network errors, timeouts, and provider rejection become generic server errors, contrary to the repository’s AI unavailable-path rule.

9. **M — P8 test coverage is substantially incomplete.**  
   The new tests exercise only pure parsing, conversion, DTO, and in-memory TDS helpers. Despite the comment claiming CI integration coverage, there are no state-machine integration tests in the file ([payslip-review.test.ts:9](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.test.ts:9)) and no route tests at all. Missing coverage includes:

   - Real `pending → accepted/rejected` transitions and repeated transitions.
   - Concurrent accept/accept and accept/reject races.
   - Rollback when a component correction fails.
   - Unknown component IDs.
   - Atomic manual/extracted creation.
   - User/FY isolation and a real-DB TDS aggregate.
   - PDF text extraction and PDF vision rejection.
   - AI-disabled and AI-unavailable orchestration.
   - Vision consent with assertions that chat/storage are untouched without consent.
   - Actual observed `ai_events` request/response bodies.
   - Request wiring: exactly one named tool and matching `toolChoice`.
   - Zod and real DB insertion coverage for `payslip_parse`.
   - Shared payslip schema tests and component kind/category consistency.

10. **M — AC8 is not demonstrated as complete.**  
    The implementation report records the full API suite exiting nonzero with 33 failures. They are described as infrastructure-related, but TASK.md requires the full test gate green. In this review, the 34 focused tests, decomposition test, route snapshot test, typecheck, and lint passed; that does not replace a successful database-backed full suite.

11. **M — The implementation report maps the acceptance criteria incorrectly.**  
    Its AC1–AC8 table at [implementation-1.md:325](/work/personal/compass/tasks/088-payslip-parse/implementation-1.md:325) describes a different sequence than TASK.md’s actual AC1–AC8. For example, it calls manual entry AC7, while actual AC7 is enum plus document storage. This led it to report AC7 as passing despite documents never being persisted.

## Low

1. **L — Image upload limits do not match the AI image limit.**  
   The route accepts images up to 20 MB ([payslips.ts:74](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:74)), while the AI layer has a smaller image limit. Oversized images pass route validation, are transiently stored, then fail inside `ai.chat()`. This should be rejected as 413 before storage/provider orchestration.

2. **L — AI-disabled behavior contradicts the route documentation.**  
   The file states that disabled AI returns 503 ([payslips.ts:17](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:17)), but the route only declares and returns a 200 `{ available: false }` response ([payslips.ts:117](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:117), [payslips.ts:203](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:203)). The payload is clear, but the contract and comments should agree.

3. **L — Extremely large valid rupee values can silently become zero for components.**  
   `rupeesToPaise` correctly returns `null` when multiplying by 100 exceeds the safe integer range, but required component conversion replaces that failure with `0` ([payslip-parse.ts:391](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:391)). It should reject the model result rather than manufacture a zero-valued component.

4. **L — FY TDS summation has no aggregate safe-integer guard.**  
   Each individual value is safe through Zod/Drizzle conventions, but `computeFyTdsPaise` uses an unchecked number reduction ([payslip-review.ts:72](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:72)). A sufficiently large collection can exceed `Number.MAX_SAFE_INTEGER` and lose paise.

5. **L — A helper described as pure mutates its input.**  
   `buildPayslipDto` sorts the supplied component array in place ([payslip-review.ts:43](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:43)). This is harmless for current local arrays but violates the stated pure-helper contract; use a copied array or `toSorted()`.

## P1–P8 / AC1–AC8 summary

| Item | Status |
|---|---|
| P1 | Partial — Zod enum, Drizzle enum, and migration are present; requested validation/DB-insert tests are absent. |
| P2 | Partial — tables and FKs exist, but domain checks, null-safe uniqueness, and cross-field integrity are missing. |
| P3 | Partial — guarded terminal transitions are sound; correction validation and integration/concurrency tests are missing. |
| P4 | Failing for PDFs — helpers/tool calling exist, but no server PDF extraction; privacy also fails open for unknown identity. |
| P5 | Partial — all six routes are registered, but upload/parse behavior has the PDF, fallback, and invalid-output failures above. |
| P6 | Partial — plugin and backup arrays/`FILE_COLUMNS` are correctly wired, but no row ever receives a document key. |
| P7 | Pass — migration includes both tables, FKs/indexes, and `ALTER TYPE ... ADD VALUE 'payslip_parse'`; metadata exists. |
| P8 | Failing — pure helper tests pass, but comprehensive route, orchestration, DB, privacy-event, and concurrency tests are absent. |
| AC1 | Partial — component vocabulary/prompt exists; the normal PDF flow is not implemented and classification consistency is unenforced. |
| AC2 | Partial — malformed output points to manual entry; empty/incomplete “valid” output instead creates invalid rows. |
| AC3 | Partial — pending review and source-quote fields exist; provenance and correction capabilities are incomplete. |
| AC4 | Partial — semantic labels are present, but no 80C flow exists and kind/category consistency is not enforced. |
| AC5 | Functionally correct in the pure helper — accepted/current-only sum, never YTD — but lacks DB integration/property coverage and schema protections against duplicates/misassigned months. |
| AC6 | Partial — image consent and underlying image omission from AI events are correctly gated; text PII redaction can fail open. |
| AC7 | Partial — event kind is correct in Zod/Drizzle/migration; document persistence is absent. |
| AC8 | Not established — focused tests, snapshots, typecheck, and lint pass; the required full test gate is not green in the supplied evidence. |

Confirmed positives: the accept/reject status claim predicates are user-scoped and concurrency-safe; D4 does not sum `tds_ytd_paise`; tax schema FKs follow the expected core/within-module pattern; there is no ingest-module coupling; imports use explicit `.ts` extensions; and persisted monetary fields are integer paise after deterministic conversion.