Verdict: **Not implementation-ready.** Review-1’s findings are recorded, but several are only summarized at the top and are contradicted or left unimplementable by the operative schema, algorithm, routes, acceptance criteria, and test plan.

## High severity

### H1 — Promotion idempotency is described but not implementable as written

The intended claim → insert/fetch → link transaction is sound and matches the existing email-review claim pattern in [review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:56). The existing partial unique index on `(user_id, source_kind, source_id)` can support `sourceKind="ais", sourceId=aisLine.id` with untargeted `onConflictDoNothing()`, as used by payslip derivation in [income-events.ts](/work/personal/compass/apps/api/src/modules/tax/services/income-events.ts:347).

However, the plan is internally inconsistent:

- H1’s claim predicate uses `ais_lines.user_id`, but M7 and the proposed schema explicitly remove that column ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:8), [TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:68)). The guarded update must scope ownership through an `ais_documents` join/`EXISTS`.
- H1 transitions the line to `promoting`, but `promoting` is absent from the declared status values and status/link check rules ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:83)).
- The final states for promotion failure, an already-promoted replay, and a promoted event subsequently rejected by the user are unspecified.
- The existing comments saying AIS has null `source_id` genuinely still exist and need updating in [schema.ts](/work/personal/compass/apps/api/src/modules/tax/schema.ts:200). The shared manual-create comments are not wrong—they describe only that endpoint—but implementation must not route AIS promotion through `createIncomeEvent()`, which forces manual provenance ([tax.ts](/work/personal/compass/packages/shared/src/schemas/tax.ts:307)).
- Content-hash dedup does not define the concurrent upload/storage sequence. Two requests can store two blobs before the unique insert decides the winner unless the loser performs compensating deletion. It also needs defined behavior when identical bytes are submitted with conflicting FY or document-kind metadata.

Specify the exact ownership-qualified claim query, complete status machine/check constraint, replay response, conflict lookup predicate, and duplicate-upload compensation.

### H2 — Aggregate reconciliation cannot be represented by the proposed schema

Review-1 requested one AIS aggregate ↔ multiple monthly income events. The current plan repeats that requirement ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:128)) but provides only one `matched_income_event_id` on each line and makes that column globally unique ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:85)). That can represent only one line ↔ one event.

A link table is required if aggregate matches are in scope, containing at least the AIS line, income event, match group/type, and allocated or compared amounts. Otherwise aggregation must be removed from the requirement.

The global uniqueness also creates a second problem: importing AIS, 26AS, and Form 16 for the same FY prevents the same income event from reconciling against more than one artifact. The second document will necessarily appear unmatched even when it corroborates the first. The plan needs document-source precedence, cross-document deduplication, or reconciliation uniqueness scoped by document/source kind.

The algorithm also remains under-specified:

- H2 says “identifier pass, then aggregate-grouping pass,” while the operative algorithm groups before pass 1 and calls amount proximity pass 2 ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:122)).
- It does not define stable input ordering or global tie resolution. A sequential candidate-consuming implementation can remain input-order dependent.
- Aggregate subset ambiguity is not defined: several combinations of monthly events can sum within tolerance.
- “Zero-amount lines handled explicitly” is recorded only in H2, with no actual rule. The ₹100 floor could otherwise match a zero line to a nonzero event.
- The 1% calculation must be specified using integer arithmetic, including which side is the denominator.
- Missing identifiers, differing PAN/TAN, normalized section aliases, accrual periods, corrected/reversal records, and TDS ties need explicit rules.
- TDS is merely “secondary evidence”; the plan does not define whether a gross match with a different TDS is a match with discrepancy or an ambiguous/unmatched result.

This remains a correctness blocker because a false match hides precisely the discrepancy the feature is meant to expose.

### H3 — The operative privacy contract still contradicts the recorded tokenization design

The H3 summary contains the right overall architecture: local text only, no AIS vision, tokenized identifiers, post-validation rehydration, and sanitization of both audit-log directions. But that design is not carried into the rest of the plan:

- The AI section still says “Redact PAN, Aadhaar, phone, address,” not tokenize PAN/TAN/account identifiers ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:94)).
- It does not mention TAN there at all.
- AC1 still says “PAN/income detail redacted before any AI call” ([TASK.md](/work/personal/compass/tasks/099-ais-reconciliation/TASK.md:145)), contradicting H3’s statement that amounts must be sent. The claimed AC rewording did not happen.
- H3 mentions `[ACCT_n]`, but specifies detection and validation only for PAN/TAN. It never defines account-number recognition, false-positive avoidance, or rehydration.
- Aadhaar, phone, address, email, names, UAN, IFSC, acknowledgement/document numbers, certificate IDs, demat/client IDs, and Form 16 employee identifiers have no complete pre-call and post-response policy.
- The observer receives the provider response before application-level structured-output validation. A provider can echo or hallucinate a raw identifier, so “sanitize response” needs a concrete fail-closed sanitizer and tests, not only a sentence.
- Predictable tokens such as `[PAN_1]` can collide with literal uploaded text. Use per-document collision-resistant placeholders or explicitly escape/reserve token syntax.
- The mapping must remain request-local and must never be persisted in logs, errors, source quotes, or parse-error rows.
- The plan should inherit the payslip prompt-injection warning that uploaded text is untrusted; the current payslip prompt has that protection in [payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:286).

Tokenization is sufficient only if every identifier needed after extraction is tokenized and locally rehydrated, while every identifier not needed is irreversibly redacted. The current text does not establish that boundary.

## Medium severity

### M4/M5 — The claimed staged-import precedent exists, but no single existing service supplies the whole lifecycle

The real precedents are:

- Generic imports provide a parent batch plus staged child rows, per-row `error`, `include`, dedupe metadata, ownership through the parent, guarded transactional commit, and rollback ([schema.ts](/work/personal/compass/apps/api/src/modules/ingest/schema.ts:41), [imports.ts](/work/personal/compass/apps/api/src/modules/ingest/services/imports.ts:536)).
- Email extraction provides pending review drafts and concurrency-safe accept/reject transitions ([review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:51)).
- Payslips provide Zod-validated structured AI extraction, text redaction, deterministic paise conversion, transactional pending parent/children, and storage compensation ([payslip-parse.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-parse.ts:305), [payslip-review.ts](/work/personal/compass/apps/api/src/modules/tax/services/payslip-review.ts:313)).

No existing tax, email, or document service implements `uploaded → processing → staged|failed`, retained partial line failures, per-line promotion, retries, and document storage throughout processing. Therefore the plan should explicitly say:

- AI seam from payslips.
- Review/promotion claim from email inbox.
- Parent/row staging, ownership, and guarded writes from generic imports.

The proposed lifecycle still lacks a processing trigger, retry/reprocess route, crash recovery for documents left `processing`, line-replacement behavior on retry, and a definition of when a partially promoted document is complete. “Committed implicit via line promotion” leaves every successfully processed document permanently `staged`.

### M7 — Tenant integrity is not fully specified

Dropping `ais_lines.user_id` correctly avoids document/line owner drift and matches the backup scoping pattern. But the FK to `income_events.id` still permits a cross-user link at the database level.

Every match, manual link, unmatch, ignore, and promotion operation must load the line through its owned parent and constrain the target event by the same `userId`. Integration tests should attempt a foreign-document line ID and a foreign income-event ID.

The match-status check must cover every declared state, including `promoting` if retained and `promoted`. It must define whether `promoted` requires a link and whether `include=false` can coexist with `matched` or `promoted`.

### M8 — Provenance and reconciliation are distinguished conceptually, but lifecycle consistency is not defined

The summary correctly says:

- `sourceKind/sourceId` is creation provenance.
- `matchedIncomeEventId` is reconciliation.
- Promotion writes both.
- Matching an existing event writes only the link.

That is genuinely reflected conceptually. However, the operative behavior remains unclear for:

- A promoted pending event later accepted or rejected.
- Ignoring a line currently matched to an event.
- Unmatching before deleting an event under `ON DELETE RESTRICT`.
- Editing amounts/identifier/date after matching.
- Re-running reconciliation after a user-confirmed match.
- Restoring data where the polymorphic `sourceId` has no FK.
- Aggregate matches, which the single reverse link cannot represent.

These transitions need an explicit state table and transactional service rules.

### M6 — Backup ordering is correct, but the test plan does not enforce it

The proposed order `income_events` before `ais_documents` before `ais_lines` correctly respects both foreign keys. Scoping `ais_documents` through `USER_TABLES`, `ais_lines` through `LINKED_TABLES`, and registering `document_key` in `FILE_COLUMNS` matches the real backup implementation in [backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:32).

P8 should explicitly add:

- Schema table coverage.
- Per-user export coverage.
- File-column coverage.
- Parent-first ordering assertions for `income_events < ais_lines` and `ais_documents < ais_lines`.
- Backup/restore round-trip with a matched line and its blob reference.

### Raw AIS storage lacks a sensitivity policy proportionate to the stated risk

M9 mentions opaque keys, authorized routes, replacement cleanup, and orphan sweeping, but not encryption at rest or retention. The current `Storage` implementation writes raw bytes to disk or S3-compatible storage without application-level encryption ([storage.ts](/work/personal/compass/apps/api/src/lib/storage.ts:38)).

For the stated “most sensitive artifact class,” the plan should explicitly choose one of:

- Application-level envelope encryption with per-user or installation-held keys.
- A documented reliance on encrypted disks/MinIO volumes, with deployment requirements and residual risk.

It should also define retention after parse, deletion behavior, backup inclusion, authorization tests for download/delete, cache headers, content disposition, and whether raw PDFs are ever returned inline. The routes list currently contains neither download nor delete endpoints despite M9 claiming them.

Also, the existing “orphan sweep” is a report-only mechanism, not automatic deletion ([backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:293)); the plan should not imply otherwise.

### AI-disabled and deterministic behavior remain ambiguous

M9 says deterministic/manual import is primary and AI is optional, but the operative flow still says “Upload AIS PDF → AI extracts,” and P3 is explicitly “AI-based extraction.” The manual route is listed without its request format, document creation flow, validation, dedupe rules, or partial-row result shape.

Define whether `/ais/import` only stores/stages the document, whether parsing is synchronous or queued, and how a user with AI disabled supplies CSV/JSON rows. Local deterministic parsing should be attempted before AI where supported; otherwise call it “manual structured import,” not deterministic extraction.

### P8 is substantially inadequate

P8 names only PAN redaction, matching rules, partial tolerance, and promotion. It does not cover most acceptance criteria or the newly recorded design constraints.

At minimum it needs:

- Lowercase/mixed-case PAN and TAN detection.
- Aadhaar, account, phone, address, Form 16 identifiers, and observer request/response sanitization.
- No vision call and no HTTP call when tokenization/redaction cannot be proven.
- Token collision, unresolved-token dropping, and no raw identifier in errors, titles, logs, or source quotes.
- Malformed/multiple tool calls, disabled provider, unavailable provider, and malformed structured output.
- Safe-integer paise conversion, missing versus zero, TDS invariants, FY/date validation, and row-level partial errors.
- Deterministic input-order invariance, repeated identical amounts, missing/mismatched identifiers, zero/small amounts, multiple candidates, aggregate ambiguity, and one-to-one consumption.
- TDS-discrepancy totals and pending/rejected event behavior.
- Cross-user access and cross-user link attempts.
- Promotion replay, genuine concurrent double promotion, rollback after insert/link failure, event rejection/deletion, ignore/unmatch/rematch consistency.
- Concurrent duplicate document uploads and blob cleanup.
- Backup ordering/export/file restoration and route-surface snapshots.
- File-size, MIME/magic-byte, encrypted/password-protected PDF, parser failure, and resource-limit cases.

Money reconciliation and aggregate sums should receive invariant/property-style coverage, as required by [TDD.md](/work/personal/compass/tasks/TDD.md:35).

### Task-board and TDD conventions are not met

The canonical task file is [13.13-ais-reconciliation.md](/work/personal/compass/tasks/13.13-ais-reconciliation.md:1), with frontmatter `status: todo`; the reviewed `TASK.md` instead uses a free-form `## Status PLAN_REVIEW`. CLAUDE.md and the task board say frontmatter is the source of truth.

More importantly, the reviewed acceptance criteria are plain bullets rather than unchecked `- [ ]` criteria. [TDD.md](/work/personal/compass/tasks/TDD.md:16) requires every unchecked criterion to correspond to a test written and observed failing before implementation. The canonical task’s criteria remain stale as well: it still promises a “reversible import path” and redaction of “income detail,” conflicting with the reviewed plan.

Before implementation, consolidate the authoritative specification or update the canonical task and make every criterion an explicit checkbox with corresponding P8 coverage.

## Low severity

### The PAN case-sensitivity bug genuinely exists

H3 is correct about the current shared utility: PAN uses `/\b[A-Z]{5}\d{4}[A-Z]\b/g` without the `i` flag in [redact.ts](/work/personal/compass/packages/shared/src/redact.ts:155). Existing tests cover uppercase only in [redact.test.ts](/work/personal/compass/packages/shared/src/redact.test.ts:50). A lowercase and mixed-case regression test is required before adding `i`.

The AIS tokenizer should not rely solely on the generic redactor because TAN is not currently covered and identifiers needed for reconciliation must be preserved through tokens.

### `AiEventKindSchema` and the database enum both exist; `ais_parse` is a clean additive change

The shared schema currently ends at `payslip_parse` in [ai-events.ts](/work/personal/compass/packages/shared/src/schemas/ai-events.ts:4), and the PostgreSQL enum does likewise in [automation/schema.ts](/work/personal/compass/apps/api/src/modules/automation/schema.ts:60). The repository already adds event kinds through additive `ALTER TYPE ... ADD VALUE` migrations, as shown by the payslip migration [0014_smiling_ezekiel_stane.sql](/work/personal/compass/apps/api/drizzle/0014_smiling_ezekiel_stane.sql:1).

Adding `ais_parse` to both is clean and appropriate. However, the existing decomposition test checks export identity, not the enum’s value count or contents. Add explicit shared-schema and DB-enum-value assertions rather than describing this as an existing “decomposition enum count” test.

### Unnecessary or conflicting state complexity remains

`include=false`, `ignored`, `ambiguous`, `matched`, and `promoted` overlap as row disposition mechanisms. The plan should define a single source of truth or a valid combination matrix. Otherwise a line may be excluded yet matched, ignored yet included, or edited after promotion.

A persisted `promoting` state may also be unnecessary if the guarded update and all following work occur in one database transaction: other transactions cannot observe the intermediate state, and rollback restores the original row. If retained for clarity, it must be a real enum value with checks and recovery semantics.

### Route and schema details need cleanup

- P5 says “7 endpoints,” but nine are listed.
- M9 additionally promises download/delete routes that are not listed.
- “Store with pending match_status” uses a nonexistent `pending` status; the declared default is `unmatched`.
- Statuses and document kinds should be explicit shared Zod schemas and PostgreSQL enums/checks rather than loosely documented text.
- The upload route should inherit the existing file-size, MIME, and magic-byte protections demonstrated by payslips in [payslips.ts](/work/personal/compass/apps/api/src/modules/tax/routes/payslips.ts:68).
- AI may transcribe amounts, but all rupee-to-paise conversion, totals, tolerance arithmetic, TDS comparison, and reconciliation decisions must remain deterministic local code.

**Final verdict: NOT IMPLEMENTATION-READY.** H1, H2, and H3 are acknowledged but not genuinely resolved in the executable specification. The aggregate relationship model and privacy contract are blockers; promotion/status contradictions, incomplete staging lifecycle, storage policy, and P8/TDD gaps must also be corrected before implementation begins.