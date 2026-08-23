The plan is not implementation-ready. The main blockers are reconciliation correctness, promotion idempotency, and the privacy model for AI extraction.

## High severity

### 1. “Create income event” is not idempotent and can create duplicates

The proposed promotion endpoint has no replay/concurrency protection. Existing manual creation always writes `sourceId: null` ([income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:79)), while the schema explicitly documents AIS events as having a null source ID ([schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:205)). The existing unique index only protects rows whose `source_id IS NOT NULL` ([schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:260)).

Consequently, retrying the endpoint—or two concurrent requests—can create multiple pending income events from one AIS line.

Required design:

- Create the event with `sourceKind: "ais"` and `sourceId: aisLine.id`; update the existing comments/contracts that currently say AIS has no source ID.
- Perform promotion in one transaction.
- First atomically claim the line with an `UPDATE ... WHERE match_status='unmatched' AND matched_income_event_id IS NULL RETURNING`.
- Insert using the existing `(user_id, source_kind, source_id)` unique index with `onConflictDoNothing`, then fetch the existing event on conflict, matching the established derivation pattern ([income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:314)).
- Link the line to the resulting event in the same transaction.
- A repeated request should return the existing event or a deterministic 409, never insert another.

The ingest inbox already demonstrates the correct claim-before-create transaction pattern ([review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:51)).

This only prevents replay of the same line. Re-importing the same document creates new line IDs, so document or line-level deduplication is also needed: preferably a document content digest plus stable AIS-record/dedupe keys with per-user unique constraints.

### 2. The proposed matcher can silently hide real discrepancies

The four rules in the task ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:53)) are insufficient for safe one-to-one reconciliation.

False positives include:

- Two interest payments from the same bank, in the same FY, with similar amounts.
- Recurring dividends or salary payments with identical amounts.
- Missing PAN on either side: the plan makes PAN non-restrictive when one value is absent.
- Multiple candidate events inside the 1% band.
- Greedy “prefer exact” matching whose result depends on input order.
- Matching against pending or rejected income events; eligible event statuses are unspecified.
- Matching multiple AIS lines to the same income event because neither the algorithm nor schema declares one-to-one consumption.

False negatives include:

- AIS/26AS source identity being TAN rather than payer PAN; `ais_lines` does not even store TAN.
- One annual/quarterly AIS aggregate corresponding to several monthly income events.
- One income event corresponding to multiple corrected or split AIS rows.
- Section/classification differences, such as AIS interest or dividend data mapped to a different `income_kind`.
- Timing differences within an FY.
- Gross-versus-paid-versus-taxable amount differences greater than 1% despite representing the same income.
- Corrected/reversal rows that the proposed non-negative-only representation cannot express.

Use a deterministic, global one-to-one matcher:

1. Define eligible event statuses explicitly—normally accepted events, or surface pending ones separately.
2. Match stable identifiers first: normalized payer PAN or TAN plus section/source record key.
3. Use accrual period/date and TDS as additional evidence.
4. Consume each line and event at most once.
5. If more than one candidate remains, return `ambiguous`; do not select one.
6. Support aggregation by payer/source identifier + section + FY before comparing amounts.
7. Record match reason, amount delta, confidence/type (`exact`, `aggregate`, `approximate`, `ambiguous`) rather than only `matched`.
8. Define proximity precisely, including zero/small amounts and an absolute-paise cap.

The ingest reconciler already follows the important rules of consuming candidates one-for-one and refusing ambiguity ([import-reconciliation.ts](/work/personal/compass/apps/api/src/modules/ingest/services/import-reconciliation.ts:27)). The receipt reconciler similarly maintains unmatched-ID sets and has an explicit ambiguous result ([receipt-reconcile.ts](/work/personal/compass/apps/api/src/modules/shopping/services/receipt-reconcile.ts:123)).

### 3. The proposed AI redaction contract is internally inconsistent and incomplete

The payslip text path does redact before calling the provider ([payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:348)), but it cannot be copied unchanged for AIS.

Current base redaction covers:

- Known user names and emails.
- General email addresses.
- User-associated UPI handles.
- Grouped Aadhaar.
- PAN in uppercase `ABCDE1234F` form.
- Indian mobile numbers.
- 9–19 digit account/card-like runs.
- Explicitly labelled address blocks and PIN codes.

See [redact.ts](/work/personal/compass/packages/shared/src/redact.ts:80).

Payslip-specific redaction adds:

- Labelled employee name.
- DOB and parent names.
- Labelled addresses.
- UAN.
- IFSC.
- Employee code/ID.

See [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:206).

Gaps relevant to AIS:

- TAN is not redacted at all, despite the task objective explicitly requiring PAN/TAN redaction.
- PAN matching is case-sensitive and only catches uppercase PANs ([redact.ts](/work/personal/compass/packages/shared/src/redact.ts:155)).
- Deductor/source PAN and TAN need treatment, not just the taxpayer PAN.
- AIS-specific identifiers such as acknowledgement/document numbers, bank account identifiers, demat/client IDs, and other labelled tax IDs are not covered.
- Form 16 can contain employee ID, DOB, address, employer TAN/PAN and certificate identifiers.
- Raw-image/vision parsing cannot satisfy “redacted before any AI call.” Payslip vision sends raw pixels after consent ([payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:366)); that path must not be reused where pre-call redaction is mandatory.
- The AI audit log stores the exact request and raw response ([automation/schema.ts](/work/personal/compass/apps/api/src/modules/automation/schema.ts:74), [events.ts](/work/personal/compass/apps/api/src/modules/automation/services/events.ts:33)). Sanitizing only the request is insufficient if the response contains a PAN/TAN or other identifier.

There is also a functional contradiction: if payer PAN/TAN and “income detail” are removed before extraction, the model cannot return the identifiers and amounts required for matching. The plan should specify deterministic tokenization:

- Extract text locally.
- Detect and validate identifiers locally.
- Replace each with stable opaque tokens such as `[payer_pan_1]` and `[tan_1]`.
- Let the model associate tokens with lines.
- Rehydrate validated identifiers locally after structured-output validation.
- Sanitize both observer request and response before writing `ai_events`.
- Never put raw identifiers in event titles, errors, logs, or source quotes.

If AC1 literally requires amounts/income details to be redacted too ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:86)), external AI cannot perform the proposed extraction. In that case parsing must be local/deterministic or limited to a local model. This requirement needs clarification before implementation.

## Medium severity

### 4. `payslip-parse.ts` is only a partial staged-import pattern

It matches the AIS proposal in these respects:

- Structured tool output with Zod validation.
- Fail-closed handling of multiple matching tool calls ([payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:180)).
- Deterministic rupee-to-paise conversion.
- PII redaction before the text-model call.
- Transactional creation of a pending parent and child rows ([payslip-review.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:313)).
- Document storage through `Storage`, with compensation if DB persistence fails ([payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:508)).

It does not implement the staged import lifecycle described for AIS:

- There is no document `processing`/`failed` state.
- Failed parses are not retained for retry/review.
- There is no per-line parse error, include/exclude flag, dedupe state, or edit step.
- Storage happens only after successful parsing, whereas the AIS schema expects a document record throughout processing.
- Payslip acceptance is document-level, not line-by-line.
- There is no commit/rollback lifecycle.

The AIS implementation should borrow AI seams from payslip parsing, but lifecycle and concurrency semantics from the ingest module.

### 5. Reuse the ingest module’s staging and guarded-commit concepts

The generic import schema already models parent batches and staged rows ([ingest/schema.ts](/work/personal/compass/apps/api/src/modules/ingest/schema.ts:41)). Its useful patterns are:

- Parent status transition: `staged → committed → rolled_back`.
- Raw row preservation.
- Per-row error, duplicate, include, dedupe hash, and promoted target ID.
- Ownership checks on the parent before child access.
- Atomic guarded commit; only one concurrent commit can claim a batch ([imports.ts](/work/personal/compass/apps/api/src/modules/ingest/services/imports.ts:538)).
- One-to-one matching and explicit ambiguity.
- Rollback/audit linkage to created records.

AIS should remain in tax-specific tables rather than forcing tax rows into transaction-import shapes, but it should reuse these semantics. Suggested AIS states are `uploaded → processing → staged → committed`, plus `failed` and optionally `rolled_back`. Parsing should leave valid rows staged even if some rows fail, with row-level errors satisfying partial-document tolerance.

### 6. Both new tables and the document blob must be added to backup metadata

P6/AC7 mentions backup but should name every required registry.

The implementation must add:

- `ais_documents` and `ais_lines` to `ALL_TABLES`.
- `ais_documents` to `USER_TABLES`.
- Preferably make `ais_lines` scoped only through `document_id` and add it to `LINKED_TABLES`, matching `payslip_components`. If `user_id` is retained on lines, it instead belongs in `USER_TABLES` and must not also be linked.
- `ais_documents.document_key` to `FILE_COLUMNS`; otherwise the raw PDF is absent from user archives and incorrectly considered orphaned.

See [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:32), [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:55), and [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:222). Existing tests enforce table, per-user export, and storage-column coverage ([backup.test.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:46), [backup.test.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:94), [backup.test.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:106)).

Restore order also matters: `ais_documents` must precede `ais_lines`, while an FK from `ais_lines.matched_income_event_id` requires `income_events` to precede linked lines or that column to be deferred during restore.

### 7. The proposed links do not enforce tenant integrity or consistent relationship state

A plain FK from `ais_lines.matched_income_event_id` to `income_events.id` prevents a missing event but does not prevent user A’s AIS line from pointing to user B’s event. Similarly, retaining both `ais_lines.user_id` and `document_id` allows a line’s user to differ from its document’s user.

Use one of:

- Remove `ais_lines.user_id` and always scope through the owned document; or
- Add composite unique keys and composite FKs involving `(id, user_id)` for both document and income-event relationships.

Other missing invariants:

- Unique `(document_id, line_number)`.
- A unique constraint on `matched_income_event_id` if matching is one-to-one.
- A check tying `match_status` to the link: `matched` requires a non-null ID; `unmatched`/`ignored` require null.
- Defined `ON DELETE` behavior. `SET NULL` alone leaves `match_status='matched'`; `RESTRICT` or an explicit service transition is safer.
- Match reruns must not overwrite ignored or user-confirmed matches.
- Reconciliation updates should be transactional so readers never see half-applied results.

### 8. The polymorphic income source and reverse AIS link can disagree

`income_events.source_id` is deliberately polymorphic and has no FK ([schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:228)). Adding `ais_lines.matched_income_event_id` creates two representations:

- “This event was created from this AIS line” through `income_events(source_kind='ais', source_id=line.id)`.
- “This AIS line matches this event” through `ais_lines.matched_income_event_id`.

Those relationships are not equivalent: an AIS line can match a pre-existing payslip/manual event without being its source. They can also drift independently.

The service should explicitly distinguish provenance from reconciliation:

- `sourceKind/sourceId` identifies creation provenance only.
- `matchedIncomeEventId` identifies reconciliation.
- Promotion writes both atomically.
- Matching an existing event writes only the reconciliation link.
- Tests should verify that reruns, deletes, ignores, and rematches cannot produce contradictory states.

A dedicated reconciliation/link table would be cleaner if aggregate or many-to-many matches are needed; the single FK cannot represent one AIS aggregate matched to several monthly events.

### 9. AI must be optional, and raw AIS storage needs a stronger sensitivity policy

The application contract says it works with AI disabled. The proposed routes have no manual, CSV/JSON, or deterministic parsing fallback, unlike payslips, which explicitly directs users to manual entry when AI is unavailable ([payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:324)).

For AIS/26AS, deterministic extraction should be preferred where possible because the documents are structured and highly sensitive. AI can remain an optional fallback for layout normalization or classification after tokenization. At minimum provide manual/CSV line import and editing.

Also, `Storage` provides opaque keys but no application-level encryption; disk storage writes raw bytes and S3 sends raw objects ([storage.ts](/work/personal/compass/apps/api/src/lib/storage.ts:38), [storage.ts](/work/personal/compass/apps/api/src/lib/storage.ts:67)). For documents described as the application’s most sensitive artifacts, the task should explicitly define encryption-at-rest expectations, authorization for download/delete, retention, replacement cleanup, and orphan handling.

## Low severity

### 10. Supporting enums/contracts need explicit plan coverage

A new AI event kind must be added in both places:

- Shared `AiEventKindSchema` currently ends at `payslip_parse` ([ai-events.ts](/work/personal/compass/packages/shared/src/schemas/ai-events.ts:3)).
- The database `ai_event_kind` enum also ends at `payslip_parse` ([automation/schema.ts](/work/personal/compass/apps/api/src/modules/automation/schema.ts:60)).

This requires a migration and schema tests. Reusing `payslip_parse` would make auditing misleading.

The shared AIS schemas should also use existing `FySchema`, `IncomeKindSchema`, PAN validation, integer-paise rules, and explicit status enums rather than unconstrained text.

### 11. The proposed line schema needs additional validation before promotion

`accrual_date` is nullable, but an income event requires a non-null accrual date and computes FY from it ([schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:223), [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:85)). Promotion therefore needs a review-supplied date or a documented deterministic fallback; it cannot merely copy every unmatched line.

Also add:

- `tds_paise >= 0` and normally `tds_paise <= gross_paise`.
- Safe-integer validation after rupee conversion.
- `rent` if AIS lines can map to the existing income-kind enum.
- PAN and TAN normalization/validation.
- Extracted-FY consistency checks against the requested/document FY.
- A distinction between missing fields and zero values.
- Row-level parse errors instead of inventing defaults for incomplete lines.

These should be acceptance criteria, particularly for partial documents and create-from-line behavior.