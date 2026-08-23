## High severity

1. **The privacy requirement is impossible for the proposed vision path.**

   AC6 requires PII to be redacted before every model call, but vision sends the original payslip pixels as base64. `redactPii` operates only on text. The HTTP redactor explicitly changes only the observer/audit copy; the actual request is posted unchanged ([http.ts](/work/personal/compass/packages/ai/src/http.ts:19), [types.ts](/work/personal/compass/packages/ai/src/types.ts:134)). Suppressing image bytes and the response from `ai_events` prevents logging, but it does not prevent disclosure to the provider.

   The plan must choose one of these honest contracts:

   - Locally OCR/render the document, redact the resulting text, and send only redacted text externally.
   - Allow raw remote vision only behind explicit user consent and change AC6 to state that raw documents leave the server.
   - Restrict vision to a trusted local provider with an implemented image path.

   Existing `redactPii` is also transaction-oriented, not payslip-complete. It covers known names/emails/UPIs, phone numbers, PAN, Aadhaar, long account numbers and labelled addresses ([redact.ts](/work/personal/compass/packages/shared/src/redact.ts:1)), but not reliably employee IDs, PF member IDs, isolated/unknown name variants, DOB, designation/department, work location, IFSC/branch information, signatures, photos, QR/barcodes, or identifiers embedded in images. Payslip-specific redaction and fixtures are required.

2. **Employer EPF must not be classified as §80CCD(2).**

   AC4’s statement that employer EPF is “80CCD(2)-style” is financially incorrect ([TASK.md](/work/personal/compass/tasks/088-payslip-parse/TASK.md:60)). §80CCD(2) covers employer contribution to the Central Government pension scheme/NPS, not employer EPF; the Income Tax Department’s [official deductions guidance](https://www.incometaxindia.gov.in/w/deductions) says the same. Employer EPF needs its own recognized-provident-fund tax treatment and must not be exposed to downstream code as an 80CCD(2) deduction.

   There is a second ambiguity: current `recordEpfContribution` adds employee share, employer share and EPS together ([epf-contributions.ts](/work/personal/compass/apps/api/src/modules/ledger/services/epf-contributions.ts:45)). Payslips may show employer PF either inclusive of the EPS diversion or exclusive of it. Without an explicit semantic field/invariant, adding `employerEpf + eps` can double-count the employer contribution. The extraction contract must define whether employer EPF excludes EPS and preserve the printed total for reconciliation.

3. **The staged-review design does not yet match `extracted_transactions`.**

   The existing review flow stores provenance and confidence and atomically claims a pending row using `UPDATE ... WHERE userId AND status='pending' RETURNING`, preventing double acceptance ([ingest schema](/work/personal/compass/apps/api/src/modules/ingest/schema.ts:155), [review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:51)). Its accept request carries reviewer-corrected fields into the ledger in the same transaction.

   The payslip plan only says `PUT accept/reject`; it does not define:

   - How the reviewer corrects extracted values before acceptance.
   - A guarded, transactional state transition and 404/409 behavior.
   - Which data is the pending draft versus the trusted accepted record.
   - Whether all downstream queries are restricted to `status='accepted'`.
   - Per-field `sourceQuote` and confidence, even though AC3 requires quoted provenance.
   - Manual creation/editing when extraction fails, despite AC2 promising manual fallback.
   - Duplicate/revised payslips and concurrent acceptance.

   This is especially dangerous because a misread payslip can immediately affect tax guidance. Acceptance should atomically persist the corrected snapshot and mark it accepted; rejected or pending rows must never feed tax calculations.

   AC4 also claims employee EPF “flows to the 80C basket,” but the scope modifies neither the basket nor the existing EPF service. The downstream integration and its tests are missing. Auto-posting to the EPF ledger would also conflict with the explicit non-goal at [TASK.md](/work/personal/compass/tasks/088-payslip-parse/TASK.md:75).

4. **“TDS-to-date accumulates across months” is underspecified and can materially overstate tax paid.**

   `tdsYtd` is normally an already cumulative snapshot. Summing January YTD plus February YTD plus March YTD is wrong. The plan must define whether FY TDS is:

   - The sum of validated monthly `tdsCurrent` values, or
   - The latest/max valid YTD snapshot per employer, with consistency checks.

   It also needs rules for job changes, multiple employers, missing months, revised payslips, negative adjustments, YTD resets, and March belonging to the preceding FY start year. Tests should assert that YTD snapshots are never summed and that inconsistent current/YTD sequences degrade to review rather than silently calculating a total.

## Medium severity

1. **The table design is contradictory and the proposed flat row is insufficient.**

   Scope promises both `payslips` and `payslip_components` ([TASK.md](/work/personal/compass/tasks/088-payslip-parse/TASK.md:15)), while P1 defines only a flat `payslips` table ([TASK.md](/work/personal/compass/tasks/088-payslip-parse/TASK.md:47)).

   A purely flat table is not well-designed for varying Indian payroll labels, multiple allowances/deductions, arrears, reimbursements, employer benefits, and per-component current/YTD provenance. A better design is:

   - `payslips`: user, employer, pay period, FY, document metadata, parse/review status, accepted timestamp, document hash, gross/net totals.
   - `payslip_components`: payslip FK, raw label, canonical kind, earnings/deduction/employer-contribution category, current amount, optional YTD amount, source quote/page or location, confidence, and display order.

   Canonical downstream values can be derived from classified components or stored as one reviewed projection, but the plan must avoid two independently editable copies that can drift.

   Missing database protections include user cascade behavior, component FK cascade, nonnegative/safe money rules where appropriate, month/FY validity, indexes for `(userId, fy, status)`, and a duplicate/revision policy for the same employer/pay period. Amount columns should follow the repository’s bigint/safe-integer conventions.

2. **PDF ingestion is not designed.**

   `ImageBlock` supports PNG/JPEG/WebP/GIF, not PDF ([types.ts](/work/personal/compass/packages/ai/src/types.ts:114)). PDF text extraction currently lives inside the separate `apps/extractor` workspace; the API workspace does not currently depend on its PDF library. The plan needs to specify:

   - Text PDF extraction and where the reusable code lives.
   - Scanned/mixed PDFs and multi-page rendering.
   - Encrypted/password-protected PDFs.
   - Page, character, decoded-image and upload-size limits.
   - MIME allowlisting plus magic-byte validation.
   - Behavior for truncated, corrupt, empty or extremely complex PDFs.

   The existing upload services validate both MIME and magic bytes; payslips should reuse that behavior rather than trusting multipart metadata.

3. **Adding the AI event kind requires both schema layers and a database migration.**

   Yes: `"payslip_parse"` must be added to the shared Zod enum ([ai-events.ts](/work/personal/compass/packages/shared/src/schemas/ai-events.ts:4)) and the Drizzle PostgreSQL enum ([automation/schema.ts](/work/personal/compass/apps/api/src/modules/automation/schema.ts:60)). A generated migration must alter `ai_event_kind`; changing only Zod lets application validation pass while PostgreSQL rejects inserts, and changing only PostgreSQL prevents typed API filtering/serialization.

   Tests should cover Zod parsing and a real database `ai_events` insert/list/filter using the new value.

4. **The extraction service only partially follows existing conventions.**

   The intended forced-tool pattern is correct: exactly one matching named call is validated, zero matching calls use prose JSON fallback, and two or more fail closed ([parse-list.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-list.ts:104)). The service should also follow the existing separation:

   - Route: upload validation, AI-event metadata/observer, thin delegation.
   - Orchestrator: user-scoped provider resolution, disabled/unavailable behavior, storage and DB I/O.
   - Pure module: tool-output parsing, rupee-to-paise conversion, date/FY normalization, component classification and invariants.

   Image capability must be gated by `ai.supportsVision`, as the image service does ([parse-image.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-image.ts:71)), not merely `ai.name !== "ollama"`. The provider-name gate remains relevant to forced tool calling for text-only Ollama fallback.

   Model amounts should be requested in rupees and converted deterministically to integer paise, matching the extractor convention. Zod must reject non-finite/unsafe figures. The document must be treated as untrusted data in the system prompt to reduce prompt-injection risk.

5. **Backup scope must include the stored document, not just database tables.**

   Adding tables to `ALL_TABLES`/`USER_TABLES` is insufficient. File-bearing tables must also be registered in `FILE_COLUMNS`, which controls encrypted backup inclusion and orphan detection ([backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:215)). If the column is called `documentKey`, the existing drift test—which recognizes `stored_path` and `document_path`—will not automatically catch the omission.

   The plan also needs:

   - `payslip_components` in `LINKED_TABLES` if it lacks `user_id`.
   - Backup/restore ordering tests.
   - Document binary archive/restore coverage.
   - Storage compensation if DB insertion fails.
   - Authenticated document read/download.
   - Deletion/rejection retention policy and storage cleanup.

6. **The proposed test scope is far too narrow.**

   “Unit tests for extraction logic” does not cover the acceptance criteria or repository TDD rules. Missing coverage includes:

   - Payslip-specific redaction with assertions against the exact outbound request body.
   - A test proving the vision path cannot claim pre-call PII redaction unless local sanitization exists.
   - One/zero/multiple/wrong-name tool calls and malformed output.
   - Disabled, unavailable and non-vision providers without unintended storage/model calls.
   - Rupee rounding, unsafe integers, negative adjustments and impossible periods.
   - Common-layout recorded fixtures and an unknown-layout/manual fallback fixture.
   - Real-database user isolation, status transitions, concurrent double accept, duplicate periods and rollback.
   - Components/totals invariants without assuming net pay equals gross minus only the listed deductions.
   - Employee EPF versus employer EPF/EPS downstream classification.
   - Monthly versus YTD TDS aggregation across FY boundaries and multiple employers.
   - Event logging without raw text/image leakage.
   - Table, child-table and document backup/restore coverage.
   - Upload MIME, magic bytes, size, corruption and PDF cases.

7. **The title promises CTC, but the data model cannot represent it.**

   Monthly gross is not CTC. The plan omits annual CTC and common employer-cost components such as gratuity, insurance, bonus/variable pay, superannuation and NPS. Either narrow the objective/title to monthly payroll extraction or explicitly model CTC and employer-cost components. Inferring annual CTC from one month’s gross would be unreliable.

## Low severity

1. **The route surface is ambiguous.**

   `PUT accept/reject` should be replaced with explicit contracts such as `POST /:id/accept`, `POST /:id/reject`, and a separate pending-draft edit operation, or a clearly defined state-transition schema. List endpoints need status/FY pagination and deterministic ordering. Document access should return metadata rather than exposing opaque storage keys directly.

2. **Identity loading is duplicated and not planned as reusable infrastructure.**

   Both the extractor and API categorization code independently load `RedactionIdentity`. Payslip parsing would create a third copy unless this is extracted into a user-scoped shared API service. Reusing only `redactPii` without reliably loading all user names/account-holder names undermines its name masking.

3. **Audit timing should not be treated as a completion guarantee.**

   `AiObserver` is explicitly best-effort and fire-and-forget ([types.ts](/work/personal/compass/packages/ai/src/types.ts:320), [http.ts](/work/personal/compass/packages/ai/src/http.ts:234)). AC7 can require an attempted event record, but the acceptance transaction must not depend on the event row being present immediately, and tests should not introduce timing-sensitive assumptions.

No files were modified.