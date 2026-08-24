# Worker Delegation

## Task
088 — 13.2 Payslip Parsing → CTC, TDS & EPF

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: AI extraction with privacy redaction and consent gating, staged-review state machine mirroring `extracted_transactions`, cross-cutting wiring (Zod + pgEnum + migration ALTER TYPE, backup arrays incl. FILE_COLUMNS, Storage integration, route-snapshot regeneration). Multiple subtle invariants; not mechanical.

## Approved Plan
TASK.md P1–P8 exactly, incorporating review-1 H1–H4/M1–M4 (read tasks/088-payslip-parse/TASK.md and review-1.md first; also read tasks/TDD.md). Coordinator decisions:
- D1: Follow apps/extractor's structured-output conventions for the tool-calling extraction prompt; gate vision on the resolved provider's `supportsVision` capability AND an explicit user-consent flag on the request — never on provider name. Text path MUST redact PII before `postJson`; neither path logs raw document content into `ai_events`.
- D2: The app must run with AI fully disabled — parse route returns a clear capability error directing to `POST /payslips/manual`, which never calls the model.
- D3: Review state machine mirrors `extracted_transactions`: `pending → accepted | rejected` only, guarded `UPDATE … WHERE status='pending' RETURNING`, reviewer corrections applied atomically with acceptance; pending rows feed no downstream computation.
- D4: FY TDS aggregation = SUM(tds_current_paise) over ACCEPTED payslips per (user, fy); tds_ytd_paise is reconciliation-only, never summed. Expose the aggregate via GET /payslips response metadata.
- D5: Adding 2 tables changes schema.decomposition.test.ts counts (74→76 tables) — update deliberately, as an intended change.
- D6: New routes change the route surface — regenerate BOTH snapshots from the real app after registration (intentional change).

## Files and Symbols
### New
- apps/api/src/modules/tax/services/payslip-parse.ts (+ .test.ts)
- apps/api/src/modules/tax/services/payslip-review.ts
- apps/api/src/modules/tax/routes/payslips.ts

### Modified
- apps/api/src/modules/tax/schema.ts (payslips + payslip_components per TASK.md table design)
- apps/api/src/modules/tax/plugin.ts
- packages/shared/src/schemas/ai-events.ts ("payslip_parse" kind)
- packages/shared/src/schemas/tax.ts (payslip Zod schemas)
- apps/api/src/modules/automation/schema.ts (aiEventKind pgEnum value)
- apps/api/src/modules/system/services/backup.ts (ALL_TABLES, USER_TABLES for payslips, LINKED_TABLES for payslip_components, FILE_COLUMNS for document key)
- apps/api/src/db/schema.decomposition.test.ts (counts)
- route snapshots (regenerated)
- NEW migration via npm run db:generate (expect 0014 incl. ALTER TYPE … ADD VALUE)

## Must Not Change
- modules/tax/services/regime-preference*.ts, routes/regime-preference*, lib/tax-rules.ts, lib/financial-year.ts (13.1 COMPLETE — do not disturb)
- modules/investments/** deposit files (13.3 COMPLETE)
- apps/extractor pipeline behavior (pattern reference only)
- Existing ai_events kinds/semantics

## Acceptance Criteria
AC1–AC8 from TASK.md.

## Commands
1. node --experimental-test-module-mocks --test <new/changed test files>
2. npm run test -w packages/shared
3. DATABASE_URL="postgresql://localhost/dummy" node --test apps/api/src/modules/system/services/backup.test.ts
4. node --test apps/api/src/app.route-snapshot.test.ts apps/api/src/db/schema.decomposition.test.ts
5. npm run db:generate (from apps/api; dummy DATABASE_URL ok)
6. npm run typecheck && npm run lint

## Required Evidence
- files changed, complete diff, literal outputs, exit codes, deviations/blockers — to tasks/088-payslip-parse/implementation-1.md

---

## Iteration 4 — Fix round 2: review-3 M/L blockers

## Worker
`codex-worker`

## Routing Reason
Low-thinking: all four fixes are mechanically specified with exact insertion/replacement points. No design choices remain.

## Approved Plan
- R1 (M-NEW1): In `payslip-review.ts` `acceptPayslip` component correction loop — when `Object.keys(compSet).length === 0` (no fields to update), throw `new HttpError(400, \`Component correction for ${corr.id} must include at least one field to change (currentPaise or ytdPaise)\`)`. Add this check BEFORE the `if (Object.keys(compSet).length > 0)` block.
- R2 (M-NEW2): In `payslip-parse.ts` `parsePayslip` — REMOVE the early `storage.put()` call (the one before the text/vision branches, currently stored in `let documentKey`). Instead, move `documentKey` assignment to AFTER successful model output validation (after H4 checks: payMonth present, components non-empty, L3 rupeesToPaise loop succeeds). Right before `createExtractedPayslip` is called, add: `let documentKey: string | null = null; try { documentKey = await storage.put(input.buffer, input.contentType); } catch (err) { console.warn("payslip-parse: document storage failed", err); }`. Pass it to createExtractedPayslip as before. This eliminates all orphan paths — storage.put() only called when we know we'll create a row.
- R3 (M-NEW3): In `payslip-parse.ts` `parsePayslip` — after the existing `if (!modelOutput.payMonth)` check, add a FY-consistency check:
  ```typescript
  // Validate extracted payMonth falls within the requested FY (Apr–Mar range).
  const [payYearStr, payMonthStr] = modelOutput.payMonth.split("-");
  const payYear = Number(payYearStr);
  const payMonthNum = Number(payMonthStr);
  const [fyYearStr] = fy.split("-");
  const fyStartYear = Number(fyYearStr);
  const fyEndYear = fyStartYear + 1;
  const inFY =
    (payMonthNum >= 4 && payMonthNum <= 12 && payYear === fyStartYear) ||
    (payMonthNum >= 1 && payMonthNum <= 3 && payYear === fyEndYear);
  if (!inFY) {
    return {
      available: false,
      message: `AI extracted pay month ${modelOutput.payMonth} which does not fall within FY ${fy}. Use POST /api/tax/payslips/manual to enter data manually.`,
    };
  }
  ```
- R4 (L-NEW1): Already handled by R2 (console.warn in the storage catch). No separate action needed.

## Files and Symbols
- `apps/api/src/modules/tax/services/payslip-parse.ts` — R2, R3
- `apps/api/src/modules/tax/services/payslip-review.ts` — R1

## Must Not Change
- Schema, migration, routes, snapshots, backup.ts, test files, shared schemas

## Commands
1. npm run typecheck 2>&1
2. npm run lint 2>&1
3. node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/payslip-parse.test.ts apps/api/src/modules/tax/services/payslip-review.test.ts 2>&1
4. npm run test -w packages/shared 2>&1

## Required Evidence
- Complete diff of changed files
- All command outputs and exit codes
- Write to tasks/088-payslip-parse/fix-2.md

---

## Iteration 3 — Fix round: review-2 H/M/L blockers

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: H2 requires redesigning the storage persistence path (document must be kept, not deleted, and key threaded through createExtractedPayslip), H1 requires branching logic for PDF-without-text, H4 requires post-parse validation gates, M2 requires Drizzle transaction wrapping for two services, M4 requires cross-field Zod refinement. Multiple interacting changes across 3 files.

## Approved Plan (fix items)
- F1 (H1): In `payslip-parse.ts` `parsePayslip`: Before the text/vision branch, add: if contentType is "application/pdf" and `input.extractedText` is absent → return `{available: false, message: "PDF text extraction requires client-supplied extractedText field or use POST /api/tax/payslips/manual"}`. This prevents PDFs from falling through to the vision branch where they'd fail.
- F2 (H2): In `payslip-parse.ts`: After magic-byte check and before parsing, persist the document to storage permanently (`const documentKey = await storage.put(buffer, contentType).catch(() => null)`). Pass `documentKey` to `createExtractedPayslip`. In `payslip-review.ts`, add `documentKey?: string | null` to `createExtractedPayslip` input and write it to the row.
- F3 (H3): In `payslip-parse.ts` `loadUserIdentity`: Note that structural PII patterns (PAN/Aadhaar/phone/IFSC) run via regex regardless of identity. If identity load fails (empty identity), add a comment and ensure no uncaught exception blocks the parse. The current `catch (() => ({names:[], emails:[], upiIds:[]}))` pattern is acceptable since structural redaction still fires.
- F4 (H4): In `payslip-parse.ts` after `parsePayslipFromTurn`: If `modelOutput.payMonth` is missing → return `{available: false, message: "...could not extract pay month...use /manual"}`. If `modelOutput.components.length === 0` → return `{available: false, message: "...no components extracted...use /manual"}`.
- F5 (L3): In `payslip-parse.ts` at the component mapping: replace `rupeesToPaise(c.currentRupees) ?? 0` with explicit null check — if `rupeesToPaise(c.currentRupees)` returns null, reject the entire model output and return `{available: false, message: "...use /manual"}`.
- F6 (M8): In `payslip-parse.ts`: Wrap both `ai.chat(...)` calls in try/catch. Catch → return `{available: false, message: "AI provider error — use POST /api/tax/payslips/manual"}`.
- F7 (M2): In `payslip-review.ts`: Wrap `createManualPayslip` in a `db.transaction(async tx => {...})` so header + components commit or roll back together. Do the same for `createExtractedPayslip`.
- F8 (M1): In `payslip-review.ts` `acceptPayslip`: After `await tx.update(payslipComponents)...`, check the affected row count (`.returning({ id: payslipComponents.id })`); if 0 rows affected for a given correction, throw `new HttpError(400, \`Component \${corr.id} not found on payslip\`)`.
- F9 (M4): In `packages/shared/src/schemas/tax.ts` `CreateManualPayslipBodySchema`: Add `.refine()` that payMonth year (YYYY) falls within the FY. Indian FY "YYYY-YY" covers April(YYYY) through March(YYYY+1). Acceptable months: April–December of startYear, or January–March of (startYear+1).
- F10 (M6): In `payslip-parse.ts` `PARSE_PAYSLIP_TOOL`: Change `grossRupees` description from "Total gross salary (CTC monthly equivalent) in rupees" to "Total gross salary as printed on the payslip (in rupees). This is the gross pay before deductions, not CTC."

## Files and Symbols
- `apps/api/src/modules/tax/services/payslip-parse.ts` — F1, F2, F4, F5, F6, F10
- `apps/api/src/modules/tax/services/payslip-review.ts` — F2, F7, F8
- `packages/shared/src/schemas/tax.ts` — F9 (CreateManualPayslipBodySchema refinement)

## Must Not Change
- Schema (.ts Drizzle), migration files (0014), route snapshots, plugin.ts, backup.ts, decomposition test
- Other modules (investments, automation, ingest, system)

## Key design points
- For F2: `storage.put()` signature — look at lib/storage.ts to see if it takes (buffer, contentType) or something else. Probably `put(key, data)` or `put(data, contentType)`. Check existing storage usage in the codebase.
- For F7: Use `db.transaction(async (tx) => { ... })` — Drizzle transaction pattern; pass `tx` to the insert calls inside.
- For F8: Both the text path and vision path `ai.chat()` calls need try/catch. Vision path also needs the `finally` to still delete the transient storage key if we added one (careful: document_key is now permanent, but the in-memory buffer shouldn't create a second storage entry).

## Acceptance Criteria
- PDF upload without extractedText → returns {available: false, message} (no 500, no vision fallback)
- document_key is NOT NULL after a successful parse (verify in tests or by inspection)
- Missing payMonth → returns {available: false, message}
- Empty components → returns {available: false, message}
- Null rupeesToPaise result → rejects model output, returns {available: false}
- ai.chat() exception → returns {available: false, message}, not 500
- Manual payslip creation is atomic (header + components in one transaction)
- Component correction with unknown ID → throws 400
- CreateManualPayslipBodySchema rejects payMonth outside FY range
- npm run typecheck exits 0
- npm run lint exits 0
- node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/payslip-parse.test.ts apps/api/src/modules/tax/services/payslip-review.test.ts → all pass
- npm run test -w packages/shared → all pass

## Commands
1. First read lib/storage.ts to understand put() signature
2. npm run typecheck 2>&1 (after changes)
3. npm run lint 2>&1 (after changes)
4. node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/payslip-parse.test.ts apps/api/src/modules/tax/services/payslip-review.test.ts
5. npm run test -w packages/shared

## Required Evidence
- Complete diff per file
- All command outputs and exit codes
- Write to tasks/088-payslip-parse/fix-1.md

---

## Iteration 2 — Fix remaining issues + complete implementation

## Worker
`sonnet-worker`

## Routing Reason
High-thinking: the previous implementation agent wrote substantial code but ran out of API credits before fixing typecheck errors and completing migration/snapshot generation. Need to diagnose exact typecheck failures, fix them, complete the migration (0014), update decomposition test counts, regenerate route snapshots, and run full test suite. Type errors from partial agent run may involve @compass/ai import shapes, multipart field types, mailbox service imports, or ZodError property access patterns.

## Approved Plan
- F1: Run `npm run typecheck` to get the exact list of errors
- F2: Run `npm run lint` to get lint errors
- F3: Fix all typecheck and lint errors in the 088 files (routes/payslips.ts, services/payslip-parse.ts, services/payslip-review.ts, services/payslip-parse.test.ts, services/payslip-review.test.ts)
- F4: Check whether `apps/api/src/modules/ingest/services/mailboxes.ts` exports `mailboxSecret` — if it does not, remove that import from routes/payslips.ts (the route should not depend on ingest module)
- F5: Run `npm run db:generate` from `apps/api` dir with `DATABASE_URL="postgresql://localhost/dummy"` to produce migration 0014 (should include payslips + payslip_components tables and ALTER TYPE to add payslip_parse to ai_event_kind)
- F6: Update `apps/api/src/db/schema.decomposition.test.ts` — increment table count from 58 to 60 (payslips + payslip_components), add both to the appropriate test sets
- F7: Regenerate BOTH route snapshots — run `node apps/api/src/app.route-snapshot.test.ts` or the snapshot update command, then check route-surface.snapshot.txt and route-table.snapshot.txt
- F8: Run `npm run test -w apps/api` and classify failures (DB-dependent vs genuine)
- F9: Run `npm run test -w packages/shared` for shared schema tests

## Files and Symbols
### New (already written by first agent — may need fixes)
- apps/api/src/modules/tax/services/payslip-parse.ts
- apps/api/src/modules/tax/services/payslip-parse.test.ts
- apps/api/src/modules/tax/services/payslip-review.ts
- apps/api/src/modules/tax/services/payslip-review.test.ts
- apps/api/src/modules/tax/routes/payslips.ts

### Modified (already done)
- apps/api/src/modules/tax/schema.ts
- apps/api/src/modules/tax/plugin.ts
- packages/shared/src/schemas/ai-events.ts
- packages/shared/src/schemas/tax.ts
- apps/api/src/modules/automation/schema.ts
- apps/api/src/modules/system/services/backup.ts
- apps/api/src/db/schema.decomposition.test.ts

### Still TODO
- apps/api/drizzle/ — migration 0014 (run db:generate)
- route snapshots (regenerate after routes registered)

## Must Not Change
- modules/tax/services/regime-preference*.ts, routes/regime-preference*, lib/tax-rules.ts, lib/financial-year.ts (13.1 COMPLETE)
- modules/investments/** deposit files (13.3 COMPLETE)
- Any file not listed in the 088 scope

## Key Invariants
- mailboxSecret import in routes/payslips.ts: ONLY include if apps/api/src/modules/ingest/services/mailboxes.ts actually exports it; otherwise remove the import entirely
- ChatTurn type from @compass/ai: check the actual exported shape — do not assume it has a `role` field; look at the real type
- ZodError: use `.issues` not `.errors`; but check if Zod v3 uses `.errors` — adapt to whatever is actually exported
- redactPii import from @compass/shared: verify it's actually exported from packages/shared/src/index.ts
- effectiveModel import from @compass/ai: verify it's actually exported
- AiObserver type from @compass/ai: verify shape

## Commands (run in order)
1. npm run typecheck 2>&1 | head -100  (collect all errors first)
2. npm run lint 2>&1 | head -50
3. (fix all errors)
4. DATABASE_URL="postgresql://localhost/dummy" npm run db:generate -w apps/api
5. node --test apps/api/src/app.route-snapshot.test.ts 2>&1 | head -30  (if exists, run to regenerate snapshots)
6. node --experimental-test-module-mocks --test apps/api/src/modules/tax/services/payslip-parse.test.ts apps/api/src/modules/tax/services/payslip-review.test.ts
7. DATABASE_URL="postgresql://localhost/dummy" node --test apps/api/src/modules/system/services/backup.test.ts
8. node --test apps/api/src/db/schema.decomposition.test.ts
9. npm run typecheck (final confirmation)
10. npm run lint (final confirmation)

## Required Evidence
- All files changed with complete diff
- All command outputs (literal) and exit codes
- Plan deviations or blockers
- Write full report to tasks/088-payslip-parse/implementation-1.md
