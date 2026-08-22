# Task: 082 — Receipt OCR → Cart Reconcile → Ledger (task 11.4)

## Status
COMPLETE

## Final verdict (2026-08-22)
F1–F9 and F6c implemented. Independent verification-4/5 passed. Codex review-11: F6c fixed; F4b/F5b/F9 and Review-6 F1–F3/F7/F8 still present; no High/Medium findings. Deferred: full confirm/route/DB suite (no DATABASE_URL), receipt-parse OCR issues, reconciled-edit-without-reset, storage best-effort delete, prettier sweep on four F6c files (lint already green), concurrent catalog/pantry mutation, pre-existing habit-blend unit ignore.

## Codex Review-11 Findings — Digested
- **F6c: fixed.** Chooser + user-scoped lookups + `(position, id)` + all unit-keyed observations + `resolveLearningUnit`.
- Low: Prettier drift on four F6c files — lint passes; same deferral as 083. Do not expand into a formatting sweep.
- Low: chooser/resolver tests do not prove confirm wiring — already accepted residual.

## Verification-5 — Digested
Verdict PASS. Coordinator already read chooser, confirm wiring, and resolveLearningUnit before the worker report. V1–V6 present. Commands: typecheck 0, lint 0, focused 33/33. Residual unchanged: no confirm wiring test; concurrency out of scope. Verifier line-number slip (`computeConsumptionRate` is immediately after the resolver, not “line 209”) does not change the verdict.

## Codex Review-9 Findings — Digested (F6c plan)

### Must address before implementation
- **Learner target unit (High).** Inserting all mixed-unit observations is required (F6). `replenishPantry` then calls `learnConsumptionRate`, which uses `catalog.unit` or else most-frequent observation unit — **not** pantry unit. Catalog null + pantry `g` + more `ml` rows can write an `ml` habit, then later decay gram stock with an `ml` rate. F6c must resolve learning unit with the same precedence: catalog, else pantry, else most-frequent. Implement in `consumption-rate.ts` (do not change `pantry-management.ts`).
- **userId on catalog/pantry lookups.** Current catalog query is `inArray(id)` only. Missing owned catalog must not be treated as `catalog.unit=null` and sent to `replenishPantry` (that 404s confirm). Scope both batch queries by `userId`; skip pantry if no owned catalog row.
- **Stable order.** `position` is not unique. Order confirmed lines by `position, id`.
- **Concurrency.** Chooser cannot claim replenish is universally non-throwing vs concurrent catalog/pantry edits. Declare that out of F6c scope.

### Accepted
- Catalog/pantry already-conflict → skip pantry, do not fail confirm. Product choice stands.
- Do not change `pantry-management.ts`.
- Do not add a full confirm integration suite. State residual: chooser tests do not prove wiring (all inserts / one pantry call).
- Pre-existing habit-blend ignores `existing.unit !== result.unit`. Out of 082.

## Codex Review-8 Findings — Digested

### Must Fix
- **F6c: Existing pantry unit still aborts confirm.** F6b only consults `catalog.unit`. `replenishPantry` also 400s when `existing.pantry.unit !== chosenUnit` (`pantry-management.ts:90`). Catalog `unit=null` + pantry `g` + receipt aggregates `ml` then `g` can pick `ml`, throw, and roll back ledger + observations. Iteration 7 said “never call replenishPantry with a unit that will 400.” First-seen is also unstable: confirmed lines are loaded with no `orderBy`.

### Accepted
- **F4b, F9, F5b: fixed** in current code.
- F1, F2, F3, F7, F8 still present.
- F5b missing shared-schema cases — Low; not blocking this pass.
- F9 claim helper duplication — Low; do not refactor unless touching those handlers for another reason.
- Missing DB/route/integration tests remain deferred (Review-7 accepted / M1). Do not add a full confirm integration suite.

### Review-8 Medium (include with F6c)
Extract the pantry-unit chooser as a **pure exported function** and unit-test it. `receipt-confirm.test.ts` still never imports `confirmReceipt`; the 24/24 focused suite does not cover F6b/F6c. A DB-free selection test is required so this rollback cannot slip through again.

## F6c Plan (Review-9 amendments folded)

Do **not** change `pantry-management.ts`. Allowed extra file: `consumption-rate.ts` (target-unit only).

P1. Export `choosePantryReplenishment(items, catalogUnit, pantryUnit): item | null` from `receipt-confirm.ts`.
    Compatible iff `(catalogUnit == null || catalogUnit === unit)` AND `(pantryUnit == null || pantryUnit === unit)`.
    From aggregates in given order:
    - no owned catalog row for that id → treat as skip (caller does not invoke chooser / does not replenish)
    - no compatible item → `null` (skip pantry, do not throw)
    - else prefer catalogUnit match if set; else pantryUnit match if set; else first compatible
    Catalog vs pantry already conflict → every unit incompatible → `null`.
    Types: normalized `"g"|"ml"|"piece"` plus `null`. Do not treat missing catalog as null unit.

P2. Batch-load catalog `{id, canonicalName, unit}` **and** pantry `{catalogItemId, unit}` for aggregated ids, both `AND userId =`.
    If an aggregate’s catalog id is absent from the owned catalog map → skip pantry for that id (do not call replenish).
    Concurrent catalog/pantry mutation between these reads and `replenishPantry` is **out of scope**. Do not add locks/retries. Do not claim the call cannot 400 under concurrency.

P3. Load confirmed lines with `orderBy (position, id)`.

P4. Insert ALL `${catalogItemId}:${unit}` shopping_list_items. Call `replenishPantry` only when chooser returns an item. Drop the extra `pantryChoiceMap` if a single loop is clearer.

P5. Learner target unit in `consumption-rate.ts` (no pantry-management change):
    Export `resolveLearningUnit(catalogUnit, pantryUnit): string | null` — catalog if set, else pantry if set, else `null`.
    `learnConsumptionRate`: after the existing user-scoped catalog read, if catalog unit is null, read the user’s pantry row unit and pass `resolveLearningUnit(catalog.unit, pantry.unit)` into `computeConsumptionRate` (null still means most-frequent, existing behavior).
    Do not change blending, outlier, or rate math. Do not rewrite habit rows that already mismatch; only stop *new* mixed-unit confirms from choosing the wrong learning unit.

P6. Tests — import the **real** functions:
    `choosePantryReplenishment` in `receipt-confirm.test.ts`:
    - catalog `g`, items `g`+`ml` → pick `g` (including when `g` is not first)
    - catalog `g`, items only `ml` → null
    - catalog null, pantry `g`, items `ml` then `g` → pick `g` (Review-8 abort)
    - catalog null, pantry `g`, items only `ml` → null
    - catalog null, pantry null, items `ml` then `g` → first (`ml`)
    - catalog `g`, pantry `ml`, items `g`+`ml` → null
    - empty items → null
    - catalog and pantry both `g`, mixed aggregates → `g`; no matching aggregate → null
    - returned item is the original aggregate (quantity preserved)
    Delete the local catalog-only aggregation test (false F6).
    `resolveLearningUnit` in `consumption-rate.test.ts`:
    - catalog `g`, pantry `ml` → `g`
    - catalog null, pantry `g` → `g`
    - both null → `null` (most-frequent path)
    Residual (stated, not a suite): chooser/resolver tests do not prove confirm wiring.

## Implementation-4 (Review-7) — Coordinator notes
F4b/F5b/F6b/F9 implemented by sonnet-worker; report at `implementation-4.md`. Source-checked:
- F4b/F9/F5b verified by Review-8 as fixed.
- F6b incomplete: pantry-row unit ignored. See F6c.

## Verification-4 — Digested
Verdict PASS. Coordinator independently confirmed V1–V4 in source before the worker report. Command evidence: typecheck 0, lint 0, shared 351/351, focused receipt 24/24, apps/api 1023 pass / 33 fail (pre-existing DATABASE_URL-gated, no new receipt failures).
Verifier errors (do not treat as facts): (1) `{qty:1,unit:null}` is rejected as null/non-null mismatch, not “one present/one absent”; (2) no dedicated F5b schema test was cited; (3) receipt-confirm.test.ts still does not import `confirmReceipt` — 8 “confirm” tests remain local copies, same as Review-7. Missing route/DB tests stay deferred (Review-7 accepted / M1).

## Codex Review-7 Findings — Digested

### Must Fix
- **F4b: Delete race.** DELETE still reads status then deletes by id/userId only. Concurrent confirm can commit first; delete then removes the confirmed receipt/image while ledger + synthetic list remain. Fix: `DELETE ... WHERE status != 'confirmed' RETURNING`; 0 rows → 404 or 409.
- **F9: Line CRUD race (leftover from Review-6 H2).** POST/PUT/DELETE lines still check-then-write. After confirm commits, a stale request can insert/update/delete lines and `recomputeTotal` overwrites `totalPaise` unconditionally. Fix: one transaction; lock/claim the non-confirmed receipt row; every line write + total update must exclude `status='confirmed'`; 409 + rollback on lost race.
- **F5b: Nullable pairing.** Refine only checks property presence, so `{quantityBase:1, unit:null}` and `{quantityBase:null, unit:'g'}` pass Zod and hit the DB CHECK. Reject null/non-null mismatches too.
- **F6b: Mixed-unit pantry abort.** Composite aggregation exists, but `replenishPantry` is 1 row per catalog item and rejects a second unit. Mixed `g`+`ml` for the same catalogItemId throws and rolls back confirm, so the separate shopping_list_items never land. Keep separate observations; replenish pantry only for a compatible unit (catalog unit if set, else first aggregate).

### Accepted (deferred)
- Missing DB/route/integration tests (P7, no DATABASE_URL in CI) — same as Review-6 M1.
- OCR `purchaseDate` / non-integer `lineTotal` — parse was out of Review-6 scope; do not reopen `receipt-parse.ts`.
- Editing a reconciled receipt without resetting match state — new, not in F1–F8. Defer.
- Storage delete best-effort, route-layer persistence, stale schema comments — low.

### Review-6 F1–F8 after Review-7
- F1, F2 (reconcile persist), F3, F7, F8: implemented.
- F4, F5, F6: incomplete as noted above.

## Codex Review-6 Findings — Digested

### Must Fix
- **F1 (H1): cartDraftId multipart field reading.** `req.body` doesn't have multipart fields — need `file.fields`. Also needs UUID validation + ownership check.
- **F2 (H2): Reconciliation race condition.** `reconcileReceipt()` does read-then-unconditional-write. Must use `UPDATE WHERE status != 'confirmed'` or `UPDATE WHERE status = 'parsed' OR status = 'reconciled'`.
- **F3 (H3): catalogItemId ownership on manual line CRUD.** Security: must validate catalog item belongs to user before setting FK.
- **F4 (M6): Confirmed receipts can be deleted.** Add status guard to reject DELETE on confirmed receipts.
- **F5 (M4): UpdateReceiptLineSchema qty/unit pairing.** Partial update can violate CHECK constraint. Add Zod refinement.
- **F6 (M5): Unit-safe aggregation in confirm.** Group by (catalogItemId, unit) not just catalogItemId, to prevent mixing g and ml.
- **F7 (L1): Schema header "11 → 12 tables, 8 enums".** Update comment.
- **F8 (L2): rawText → canonicalName.** Synthetic shopping_list_items should use catalog canonicalName, not OCR text.

### Accepted (deferred)
- M1 (fragment tests): Acceptable — no DB in CI. Integration tests deferred to E2E.
- M2 (lineTotal optional): Intentional robustness for partial OCR.
- M3 (storedPath naming): Intentional per D3.
- M7 (AC11): Pre-existing DB test failures.
- L3 (negative price diff test): Nice to have but low impact.

## Objective
Close the shopping loop: photograph a receipt, OCR it into line items, reconcile against the drafted cart, and on user confirm: (a) create a ledger transaction directly (manual path, not inbox), (b) replenish pantry, (c) add purchase observations for consumption-rate learning. Nothing reaches the ledger without explicit manual confirm + category choice.

## Root Cause
No receipt capture, reconciliation, or confirmed-purchase feedback loop exists.

## Dependencies
- task 8.1 (AI vision) — done
- task 079 (11.2, cart drafts) — done
- task 077 (11.1, pantry + habit profiles) — done
- task 068 (9.5, photo capture) — done (reuse multipart/magic-byte/vision patterns)

## Codex Review-4 Findings — Digested

### Confirmed (must address)
- **H1: Cannot use `extracted_transactions` for receipts.** `ingestionId` is NOT NULL FK to `emailIngestions`; all inbox queries INNER JOIN on it for subject/fromAddr/receivedAt; shared DTO requires these email-specific fields. Receipt rows would fail INSERT and be invisible to inbox. **Decision: receipts create ledger transactions directly via `createTransaction()` at confirm time, same as manual entry. Source='import'. No inbox involvement.**
- **H2: `learnConsumptionRate()` only reads from `shopping_list_items` status='bought'.** Receipt confirmations must create synthetic `shopping_list_items` entries (status='bought') to serve as purchase observations for the rate learner. This is the simplest extension that feeds the existing observation pipeline.
- **H3: Confirm must be atomic.** Use `UPDATE ... WHERE status = 'reconciled' RETURNING` atomic claim in a single DB transaction wrapping pantry replenish, list item creation, ledger transaction, and status update.
- **H4: `ledger.mutated` must fire.** The confirm route must emit `app.eventBus.emit("ledger.mutated", { userId })` after the transaction commits, matching the inbox accept pattern.
- **H5: Single posting model.** One aggregate ledger transaction per receipt with the receipt's grand total. Category chosen at confirm time. No per-line split.
- **H6: Manual entry API.** Add `POST /receipts/:id/lines` and `PUT /receipts/:id/lines/:lineId` routes so unreadable receipts can have lines entered/edited manually. UI ownership deferred to a future task but API surface is complete.

### Confirmed (medium, must address)
- **M1: `matchStatus` needs 'unmatched' value** for freshly parsed lines pre-reconciliation.
- **M2: Provider errors must propagate** (matching `parseListImage`); disabled/non-vision → graceful empty. Receipt persisted BEFORE OCR attempt so image is always saved.
- **M3: Storage lifecycle.** Persist receipt + image first (storage.put + DB insert), then attempt OCR. If DB fails after storage.put, compensate with storage.delete. On receipt row delete, cascade-delete image from storage. Store `mimeType` alongside `storageKey`.
- **M4: Backup ordering.** `receipts` after `cart_drafts`; `receipt_lines` after `receipts` + `catalog_items`. No FK from `extracted_transactions` → no ordering issue.
- **M5: Fuzzy matching spec.** Normalize: lowercase, trim, collapse whitespace. Levenshtein ≤ 30% of shorter string. One-to-one matching (Hungarian assignment not needed — greedy best-match with minimum margin). Ambiguous → `ambiguous` status (not extra). No automatic pantry write from ambiguous matches.
- **M6: Price semantics.** `receipt_lines.pricePaise` = line total (qty × unit price). `receipt.totalPaise` = sum of all line pricePaise + any tax/fee lines. Price diff = `receiptLine.pricePaise - draftItem.suggestedPricePaise` (signed). Null expected price → no diff computed.
- **M7: Ownership validation.** All IDs (receipt, draft, catalog, account, lines) validated server-side. `confirmedLineIds` constrained to receipt. AccountId ownership checked. Client data not trusted for amounts.
- **M8: Route identity.** `receiptId` from URL param `:id` only, not duplicated in body.
- **M9: PII minimization.** AI tool output schema extracts only item/qty/price fields. No raw OCR text stored in AI events. Client filename not included in event title.
- **M10: Schema header update.** Update shopping schema doc comment to reflect new table count.

### Accepted (low, deferred)
- **L1:** Route paths relative to `/api/shopping` prefix as per convention.
- **L2:** Response contracts for list/reconcile/confirm specified in P2.
- **L3:** Receipt image retrieval route (GET /receipts/:id/image) — deferred to UI task.

## Key Design Decisions

### D1: Direct ledger transaction, not inbox
Receipts create transactions via `createTransaction()` at confirm time, with `source: 'import'`. The user provides accountId + categoryId + date at confirm time. `ledger.mutated` emitted post-commit. This avoids restructuring the email-coupled inbox pipeline.

### D2: Shopping list items as purchase observations
Confirmed receipt lines with catalogItemId create `shopping_list_items` (status='bought', catalogItemId, quantityBase, unit) in a synthetic shopping list (one per receipt). This feeds `learnConsumptionRate()` through its existing data path. The synthetic list is linked to the receipt for traceability.

### D3: Receipt persistence with durable images
New `receipts` + `receipt_lines` tables. Image stored via Storage abstraction with `stored_path` (not `storage_key` — must match the backup drift test's `stored_path`/`document_path` convention) + `mimeType` in `receipts` row. Image persisted BEFORE OCR, so even failed OCR preserves evidence.

### D4: Atomic confirm with claim guard
`UPDATE receipts SET status = 'confirmed' WHERE id = $1 AND status = 'reconciled' AND user_id = $2 RETURNING *` — exactly one request can claim. All subsequent writes (pantry, list items, ledger) in the same transaction.

### D5: Cart draft status transition
On confirm (if receipt linked to a draft): draft status → 'ordered'. Existing draft routes already allow status transitions.

### D6: AI pattern mirrors parseListImage
Uses supportsVision gate, ContentBlock[] vision messages, forced toolChoice, PARSE_RECEIPT_TOOL. Disabled/non-vision → graceful { available: false, lines: [] }. Provider errors propagate. Receipt image stored before OCR attempt.

## Codex Review-5 Findings — Digested (amendments folded into plan below)
- **H1 (total validation):** `receipts.totalPaise` must be computed server-side from sum of line pricePaise before ledger posting. P5 step 1 now derives and validates total before createTransaction.
- **H2 (status guard on reconcile/line-edit):** Reconcile and line mutation routes must reject `status='confirmed'` receipts. Added to P6 route guards.
- **H3 (stored_path naming):** Column named `stored_path` (not `storage_key`) to pass backup drift test. Already updated in D3.
- **M1 (purchase dates):** `replenishPantry()` uses now(), not receipt purchaseDate. Accepted as pre-existing limitation — the learner uses updatedAt anyway.
- **M2 (learner aggregation):** Multiple lines for same catalogItem aggregated per receipt before creating synthetic shopping_list_item. Added to P5.
- **M3 (OCR unit normalization):** Reuse existing `convertToBaseQuantity` from shared/money.ts or shopping unit normalization. Added to P3.
- **M4 (cartDraftId consistency):** Reconcile uses receipt's persisted cartDraftId, not a separate body param. Updated P4/P6.
- **M5 (storage deletion cascade):** Receipt delete route must call storage.delete(storedPath). Added to P6.
- **L1 (manual API tests):** Tests for line CRUD added to P7.

## Scope

### New tables (migration required)
- `receipt_status` enum: `parsed`, `reconciled`, `confirmed`
- `receipt_line_match_status` enum: `unmatched`, `matched`, `extra`, `missing`, `price_diff`, `ambiguous`
- `receipts`: id, userId, cartDraftId (nullable FK→cart_drafts, set null), shoppingListId (nullable FK→shopping_lists, set null — synthetic list for observations), storedPath (text, not null — matches backup drift test convention), mimeType (text, not null), status (receipt_status), merchantName (text, nullable), purchaseDate (date, nullable), totalPaise (bigint nullable — computed from lines before ledger posting), parsedAt, reconciledAt, confirmedAt, createdAt
- `receipt_lines`: id, receiptId FK (cascade), position (integer), rawText (text), normalizedName (text, nullable), catalogItemId (nullable FK→catalog_items, set null), quantityBase (bigint nullable), unit (nullable, paired), pricePaise (bigint nullable — line total), matchedDraftItemId (uuid nullable), matchStatus (receipt_line_match_status, default 'unmatched'), createdAt

### New files
- `apps/api/src/modules/shopping/services/receipt-parse.ts` — AI vision receipt OCR
- `apps/api/src/modules/shopping/services/receipt-reconcile.ts` — pure reconciliation engine
- `apps/api/src/modules/shopping/services/receipt-confirm.ts` — confirm → ledger + pantry + rates
- `apps/api/src/modules/shopping/services/receipt-reconcile.test.ts` — unit tests for pure reconciliation
- `apps/api/src/modules/shopping/services/receipt-confirm.test.ts` — confirm logic tests
- `apps/api/src/modules/shopping/routes/receipts.ts` — receipt routes

### Modified files
- `apps/api/src/modules/shopping/schema.ts` — add receipts, receiptLines, 2 enums
- `apps/api/src/db/schema.ts` — re-export new tables/enums
- `packages/shared/src/schemas/shopping.ts` — receipt schemas (see P2)
- `apps/api/src/modules/shopping/plugin.ts` — register receipt routes
- `apps/api/src/modules/system/services/backup.ts` — add receipts + receipt_lines + FILE_COLUMNS for storageKey
- Route snapshot files

### Cross-module imports (runtime, allowed)
- `apps/api/src/modules/ledger/services/transactions.ts` — `createTransaction()` for direct ledger write
- `apps/api/src/modules/shopping/services/consumption-rate.ts` — `learnConsumptionRate()`
- `apps/api/src/modules/shopping/services/pantry-management.ts` — `replenishPantry()`

## Plan

### P1: Schema + migration
Add `receiptStatus` and `receiptLineMatchStatus` enums, `receipts` and `receiptLines` tables to `modules/shopping/schema.ts`. Include CHECK constraints (quantity_unit_paired, quantity_nonneg, price_nonneg, position_nonneg). Re-export from `db/schema.ts`. Run `db:generate`. Update schema header comment.

### P2: Shared Zod schemas
In `packages/shared/src/schemas/shopping.ts`:
- `ReceiptStatusSchema` — z.enum parsed/reconciled/confirmed
- `ReceiptLineMatchStatusSchema` — z.enum unmatched/matched/extra/missing/price_diff/ambiguous
- `ReceiptLineSchema` — id, position, rawText, normalizedName, catalogItemId, quantityBase, unit, pricePaise, matchedDraftItemId, matchStatus, createdAt
- `ReceiptSchema` — id, cartDraftId, shoppingListId, status, merchantName, purchaseDate, totalPaise, storageKey, mimeType, parsedAt, reconciledAt, confirmedAt, createdAt
- `ReceiptWithLinesSchema` — ReceiptSchema.extend({ lines: ReceiptLineSchema[] })
- `ParseReceiptResponseSchema` — { available, receipt: ReceiptWithLinesSchema | null, message: string | null }
- `ReconciliationReportSchema` — { matched[], extra[], missing[], priceDiffs[], ambiguous[] }
- `ConfirmReceiptBodySchema` — { confirmedLineIds: uuid[], accountId: uuid, categoryId: uuid, date: string }
- `CreateReceiptLineSchema` — { rawText, normalizedName?, catalogItemId?, quantityBase?, unit?, pricePaise? }
- `UpdateReceiptLineSchema` — { rawText?, normalizedName?, catalogItemId?, quantityBase?, unit?, pricePaise? }
- `ReceiptListResponseSchema` — { receipts: ReceiptWithLinesSchema[] }

### P3: Receipt parse service
`receipt-parse.ts`: 
- `createReceiptFromImage(deps, userId, image, cartDraftId?)`:
  1. storage.put(buffer, contentType) → storedPath
  2. Try: INSERT receipts row (status='parsed', storedPath, mimeType)
  3. Catch: storage.delete(storedPath), rethrow
  4. Resolve AI provider (getUserAiProvider)
  5. If !enabled or !supportsVision → return { available: false, receipt with empty lines }
  6. Call ai.chat with PARSE_RECEIPT_TOOL (name, qty, unit, lineTotal, discount)
  7. Parse tool output → normalize units (kg→g×1000, L→ml×1000, piece→piece, decimal→Math.floor) using existing shopping unit normalization; reject unrecognizable units (store line with null qty/unit)
  8. INSERT receipt_lines (status='unmatched', position from array index, normalized qty/unit)
  9. Compute totalPaise = sum of all line pricePaise; UPDATE receipts.totalPaise + parsedAt
  10. Return { available: true, receipt with lines }
- PARSE_RECEIPT_TOOL schema: name (string), quantity (number, optional), unit (string, optional), lineTotal (number — paise), discount (number — paise, optional)
- System prompt: "Extract every line item from this receipt. For each: item name, quantity, unit (kg/g/litre/ml/piece), line total in smallest currency unit (paise), and any discount. Line total should reflect quantity × unit price."
- AI observer: record event kind='shopping_parse', omit raw OCR, omit filename

### P4: Reconciliation engine (pure)
`receipt-reconcile.ts`:
- `reconcileReceiptWithDraft(receiptLines, draftItems, catalogLookup)` → ReconciliationReport
- Phase 1: exact catalogItemId match (receipt line → draft item, one-to-one, greedy)
- Phase 2: fuzzy normalizedName match (normalize: lowercase, trim, collapse whitespace; Levenshtein ≤ 30% of shorter; minimum margin over 2nd-best ≥ 2 chars; one-to-one)
- Classify: matched (catalogId or fuzzy), extra (receipt-only), missing (draft-only), price_diff (matched but |priceDiff| > 0), ambiguous (fuzzy with no clear winner)
- Update receipt_lines with matchedDraftItemId and matchStatus
- Update receipt status → reconciled, set reconciledAt
- **Status guard:** reject if receipt status is `confirmed` (cannot re-reconcile after confirmation)
- **cartDraftId:** uses the receipt's persisted cartDraftId (set at parse time), NOT a separate body param. Route takes no cartDraftId — it loads the receipt and uses its existing link.
- Pure logic in `reconcile()`, DB wrapper in `reconcileReceipt(db, userId, receiptId)`

### P5: Confirm service
`receipt-confirm.ts`: `confirmReceipt(db, tx, userId, receiptId, body, app)`:
1. Atomic claim: `UPDATE receipts SET status='confirmed', confirmedAt=now() WHERE id=$1 AND status='reconciled' AND user_id=$2 RETURNING *` — fail if 0 rows
2. Load confirmed receipt lines (filter by confirmedLineIds, validate all belong to receipt, deduplicate)
3. Validate accountId ownership (check accounts table)
4. Require categoryId non-null (manual category enforcement)
5. **Compute and validate totalPaise:** sum confirmed lines' pricePaise. Require > 0 and safe integer. Store in receipt row. This is the amount used for the ledger transaction.
6. Create synthetic shopping list: INSERT shopping_lists (name="Receipt {receiptId}", status='archived')
7. **Aggregate per catalogItem:** group confirmed lines by catalogItemId. For each unique catalogItemId with quantity + unit:
   a. INSERT one shopping_list_items (listId, catalogItemId, rawText=canonicalName, quantityBase=sum of line quantities, unit, status='bought')
   b. Call replenishPantry(tx, userId, catalogItemId, aggregatedQuantity, unit) — this internally calls learnConsumptionRate
8. Create one aggregate ledger transaction:
   - `createTransaction(tx, userId, { accountId, date, amountPaise: -totalPaise, merchant: receipt.merchantName ?? 'Receipt purchase', categoryId, notes: 'From receipt', source: 'import' })`
9. Update receipt: shoppingListId = synthetic list id
10. If receipt.cartDraftId → update cart_drafts status → 'ordered'
11. Post-commit: `app.eventBus.emit("ledger.mutated", { userId })`

### P6: Routes
`routes/receipts.ts` registered in plugin.ts:
- `POST /receipts/parse` — multipart image upload → createReceiptFromImage → return ParseReceiptResponse
- `POST /receipts/:id/reconcile` — reconcileReceipt (uses receipt's persisted cartDraftId) → return ReconciliationReport. **Status guard:** reject if status='confirmed'.
- `POST /receipts/:id/confirm` — ConfirmReceiptBody → confirmReceipt → 200 + receipt
- `GET /receipts` — list user's receipts with lines
- `GET /receipts/:id` — single receipt with lines
- `DELETE /receipts/:id` — delete receipt + storage.delete(storedPath) for image cleanup
- `POST /receipts/:id/lines` — manual line add (CreateReceiptLineSchema). **Status guard:** reject if status='confirmed'.
- `PUT /receipts/:id/lines/:lineId` — manual line edit (UpdateReceiptLineSchema). **Status guard:** reject if status='confirmed'.
- `DELETE /receipts/:id/lines/:lineId` — manual line delete. **Status guard:** reject if status='confirmed'.
All routes: session-auth, userId scope, ownership validation. Multipart route: MIME check, magic bytes, MAX_IMAGE_BYTES. Line mutations recompute receipts.totalPaise from lines.

### P7: Tests
`receipt-reconcile.test.ts`:
- Exact catalogItemId matching (1:1)
- Fuzzy name matching with clear winner
- Ambiguous fuzzy match → ambiguous status
- Extra receipt lines (no draft match)
- Missing draft items (no receipt match)
- Price differences (signed delta)
- Empty receipt / empty draft / both empty
- Null price handling
- One-to-one constraint (no double-matching)

`receipt-confirm.test.ts`:
- Double-confirm prevented (atomic claim)
- CategoryId required (non-null)
- AccountId ownership checked
- Shopping list items created for rate learning (aggregated per catalogItem)
- Ledger transaction created with correct amount (= sum of confirmed line pricePaise)
- Cart draft status updated
- totalPaise validated > 0 and safe integer

`receipt-lines.test.ts` (manual line CRUD):
- Add/edit/delete lines updates receipt totalPaise
- Lines rejected when receipt status='confirmed'
- Quantity/unit pairing validated
- Cross-user receipt/line IDs rejected

### P8: Registration + backup + snapshots
- Register `receiptRoutes` in plugin.ts
- Add `receipts` to ALL_TABLES (after `cart_drafts`), USER_TABLES
- Add `receipt_lines` to ALL_TABLES (after `receipts`), LINKED_TABLES under receipts ({ fk: 'receipt_id', parent: 'receipts' })
- Add `receipts.stored_path` to FILE_COLUMNS (matches drift test convention)
- Update route snapshots
- Update schema header comment in shopping/schema.ts

## Acceptance Criteria
- [ ] AC1: Receipt photo → line items via vision path (reuses 8.1 infrastructure)
- [ ] AC2: Reconciliation reports matched, extra, missing, price-diff, and ambiguous items
- [ ] AC3: Accepted purchase creates a ledger transaction directly (source='import') with manually chosen category
- [ ] AC4: Confirmed purchase replenishes pantry and creates shopping_list_items for consumption-rate learning
- [ ] AC5: Unreadable receipt returns { available: false/true, lines: [] } — manual line entry API available
- [ ] AC6: Receipt image persisted durably (storageKey + mimeType in DB, backup FILE_COLUMNS)
- [ ] AC7: `ledger.mutated` emitted after confirm
- [ ] AC8: Category required non-null at confirm time (manual category enforcement)
- [ ] AC9: Cart draft status → 'ordered' on confirm (if linked)
- [ ] AC10: Atomic confirm — double-confirm prevented by UPDATE WHERE status='reconciled'
- [ ] AC11: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` — exit 0
- T2: `npm run lint` — exit 0
- T3: `npm run test -w apps/api` — all pass, receipt tests included
- T4: `npm run test -w packages/shared` — schema tests pass
- T5: Backup test passes (receipts + receipt_lines + FILE_COLUMNS)

## Non-Goals
- UI for receipt capture/review (future task)
- Auto-categorization
- Per-line category splits (one category per receipt)
- Receipt PII redaction beyond minimizing AI event data
- Multiple receipt images per receipt
- Receipt image retrieval route (deferred to UI task)
