## Review verdict

The replanned task is still not implementation-ready. It correctly recognizes that durable receipt persistence, cart reconciliation, inbox review, pantry replenishment, and rate learning all belong in scope. It also correctly reflects the existing vision call shape and confirms task 079 is now complete.

However, four of the six original HIGH gaps remain unresolved, one is only partially addressed, and only the cart dependency gap is fully closed. The largest blocker is that `extracted_transactions` is still email-owned throughout its schema, queries, DTOs, and UI contract.

## High severity

### H1 — Receipt drafts cannot currently be inserted into or read from `extracted_transactions`

The plan proposes receipt-sourced rows with “a new `receiptId` FK or `sourceQuote` text,” but its schema and modified-file lists do not generalize the ingest model ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:20), [TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:63)).

Today:

- `ingestion_id` is `NOT NULL` and FKs `email_ingestions` ([schema.ts](/work/personal/compass/apps/api/src/modules/ingest/schema.ts:155)).
- Inbox listing uses an `INNER JOIN` to `email_ingestions`, so even merely making `ingestion_id` nullable would hide receipt rows ([review-queue.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-queue.ts:19)).
- Reload and acceptance response construction also query the email ingestion ([inbox-shared.ts](/work/personal/compass/apps/api/src/modules/ingest/services/inbox-shared.ts:64), [review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:31)).
- The shared DTO requires a non-null `ingestionId` and email-only `subject`, `fromAddr`, and `receivedAt` fields ([email.ts](/work/personal/compass/packages/shared/src/schemas/email.ts:93)).
- Accepted ledger notes are hard-coded as “Imported from email” ([review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:95)).

`sourceQuote` cannot substitute for the required FK. The plan must explicitly redesign the inbox provenance model, including:

- nullable `ingestionId` plus a receipt source reference, or a generic source entity;
- an exactly-one-source constraint;
- receipt-aware list/reload/DTO behavior;
- migration and ingest schema smoke tests;
- shared email/inbox contract changes;
- receipt-aware ledger notes;
- deletion behavior for a receipt after its draft has been accepted;
- restore ordering or deferred restore handling for the new cross-table FK.

A direct FK from the ingest module to a shopping-resident table would also conflict with the current schema boundary rule documented in the shopping schema: cross-domain targets belong in shared schema layers, not cross-module schema imports ([shopping/schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:6)).

### H2 — The plan still does not add receipt observations to consumption learning

The claim that confirmed receipt quantities can be “fed” to `learnConsumptionRate()` is incorrect ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:42)).

The actual signature is only:

```ts
learnConsumptionRate(db, userId, catalogItemId)
```

It accepts no quantity, unit, or purchase date ([consumption-rate.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts:137)). It reloads observations exclusively from `shopping_list_items` where status is `bought`, using `updatedAt` as the date ([consumption-rate.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts:149)).

Consequently, confirming a receipt and then calling this function does not add any observation. Calling `replenishPantry()` does not solve this either: it already calls the same learner after replenishment ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:127)). Calling it again explicitly would merely recompute and blend the same old observations twice.

The task needs a durable confirmed-purchase observation source and a redesigned learner that includes receipt observations, with quantity, normalized unit, and purchase timestamp. Alternatively it must deliberately create/link bought shopping-list items, but that is weaker for receipt extras and should not overload `updatedAt`.

### H3 — Confirmation remains race-prone, replayable, and vulnerable to stale reconciliation

Persisting receipts is an improvement, but the confirm plan still describes a load/check followed by multiple writes and then a final status update ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:98)). It does not require:

- one database transaction for receipt claim, pantry writes, purchase observations, extracted drafts, and cart transition;
- an atomic `UPDATE ... WHERE status = 'reconciled' RETURNING` claim;
- a uniqueness/idempotency constraint between a receipt and its pending inbox draft;
- rollback when any pantry, rate, or inbox write fails;
- stale reconciliation detection after cart edits;
- concurrent confirmation behavior.

Two racing requests can both observe `reconciled`, both replenish pantry, and both create inbox drafts before either sets `confirmed`.

The persisted reconciliation is also insufficient to detect staleness. Receipt lines retain `matchedDraftItemId`, but there is no cart version, immutable expected-price snapshot, reconciliation hash, or prohibition on later draft edits. Existing draft routes permit editing any status and allow an ordered draft to be abandoned because they only check ownership, not `status = 'draft'` ([cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:64), [cart-drafts.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/cart-drafts.ts:118)).

The plan must modify those state transitions or freeze/snapshot the authoritative reconciliation inputs.

### H4 — Canonical ledger completion, manual category enforcement, and `ledger.mutated` are still missing from the task’s acceptance gate

The canonical task requires an accepted purchase to become a ledger transaction with a manually chosen category and to emit `ledger.mutated` ([11.04-receipt-loop.md](/work/personal/compass/tasks/11.04-receipt-loop.md:16)). The replanned AC3 stops at creating a pending extracted transaction, and the replanned acceptance criteria omit `ledger.mutated` entirely ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:132)).

The existing inbox route does emit the event after successful acceptance ([inbox.ts](/work/personal/compass/apps/api/src/modules/ingest/routes/inbox.ts:45)), but receipt rows cannot currently reach that route correctly because of H1. The task must test the complete receipt → pending inbox draft → explicit accept → ledger transaction → event flow.

Manual category is also not enforced by the current contract. `AcceptExtractedTxnSchema` permits `categoryId: null` ([email.ts](/work/personal/compass/packages/shared/src/schemas/email.ts:129)), and the Inbox UI permits “No category” ([InboxPage.tsx](/work/personal/compass/apps/web/src/routes/inbox/InboxPage.tsx:335)). Moreover, `listInbox()` can automatically prefill a history-derived category even when `suggestedCategoryId` was inserted as null ([review-queue.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-queue.ts:31)). Therefore setting `suggestedCategoryId = null` does not prove that a category was manually chosen.

The plan must define whether an explicit non-null category is mandatory for receipt drafts and enforce it server-side.

### H5 — The financial posting model is undecided and can post the wrong purchase total

P5 says “one `extracted_transaction` per confirmed line (or one aggregate)” ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:104)). Those are materially different ledger semantics and cannot be left as an implementation-time choice.

Per-line drafts would:

- create multiple ledger transactions for one real receipt;
- omit receipt-level tax, fees, rounding, deposits, coupons, and discounts;
- make the sum differ from `receipts.totalPaise`;
- require separate category acceptance for each line;
- make a single card/bank transaction difficult to reconcile.

An aggregate draft better matches the actual payment, but then category handling must define whether one category is chosen for the full receipt or whether split postings are required.

The schema currently has only ambiguous `pricePaise`; it does not distinguish unit price, line total, discounts/returns, or receipt-level charges. It also lacks merchant, purchase timestamp, currency, subtotal, tax/fee, discount, and grand-total components, even though P5 expects a “receipt store name” that is not stored anywhere ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:105)).

The plan needs a single defined posting model and a monetary invariant proving the inbox amount equals the actual receipt grand total.

### H6 — “Manual entry” still has no API or UI owner

AC5 equates an empty lines array with degrading to manual entry ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:137)), but the plan provides no route or schema to create, edit, delete, or reorder receipt lines manually.

The task explicitly excludes UI and points to task 083 or the future ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:151)). Task 083 contains only cart-draft review; it has no receipt upload, OCR review, manual line entry, reconciliation, or receipt confirmation scope ([083 TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:44)).

Returning `[]` without an editable workflow does not satisfy “degrades to manual entry.” Either task 082 must own the manual-line API and a UI task must explicitly own the interaction, or the canonical criterion remains unassigned.

## Medium severity

### M1 — The receipt state and line schemas cannot represent the proposed workflow cleanly

`receipt_lines.matchStatus` appears mandatory, but a freshly parsed line has not yet been reconciled. The enum has no `unmatched`, `unreviewed`, or `ambiguous` state. Treating every parsed line as `extra` would conflate “not reconciled yet” with “receipt-only.”

Similarly:

- `missing` describes a draft-only item, not a receipt line, so it should not normally be a receipt-line status.
- `matchedDraftItemId` is described as a match but is not explicitly declared as an FK in scope.
- There is no one-to-one constraint preventing multiple receipt lines from matching the same draft item.
- There is no position field for stable OCR order.
- There is no normalized/display name separate from `rawText`.
- There are no paired quantity/unit DB constraints or explicit safe-integer money constraints.
- `ReceiptSchema` omits `createdAt`, image metadata, merchant, and purchase date despite the persistence schema or later posting requiring them.

The existing shopping convention uses safe integer helpers, paired quantity/unit refinements, entity schemas without `userId`, and an adjacent inferred type export ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:20)). The proposed names generally follow the `PascalCaseSchema` convention, but their fields and invariants do not yet.

### M2 — The AI pattern is only partially described correctly

The plan correctly identifies the existing mechanics: per-user provider resolution, `supportsVision`, a content-block message, `chat()`, forced tool choice, and structured parsing ([parse-image.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-image.ts:63)).

But “graceful degrade” is overstated:

- disabled/non-vision providers return an empty response before storage;
- malformed tool output becomes an empty result;
- provider, timeout, and network errors propagate ([parse-image.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-image.ts:9)).

The receipt plan must define whether provider failure also becomes manual entry. If so, it intentionally differs from `parseListImage` and needs tests.

There is also an ordering conflict: mirroring the current disabled/non-vision behavior means no image or receipt is stored, while AC6 expects durable receipt evidence. The receipt workflow should probably persist the owned receipt first and then attempt OCR, with compensation if persistence fails.

### M3 — Upload, storage, deletion, and restore lifecycle are incomplete

P3 says only `storage.put` followed by storing the key. It does not cover:

- deleting the blob if the DB insert fails;
- deleting or retaining the blob when a receipt row is deleted;
- a secure user-scoped download route;
- retention policy;
- missing storage objects;
- MIME and original filename persistence.

Existing durable file tables store `storedPath`, `mimeType`, and filename metadata. The proposed `storageKey` naming diverges from that convention.

Backup restore determines MIME from `mime_type` or `document_mime`; without a receipt MIME column, restored receipt images become `application/octet-stream` ([restore-user.ts](/work/personal/compass/apps/api/src/modules/system/services/restore-user.ts:22)).

Also, the `FILE_COLUMNS` drift test currently recognizes only columns named `stored_path` or `document_path`. A new `storage_key` column would not be automatically detected, weakening the stated backup guard ([backup.test.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:106)).

### M4 — Backup ordering is more complex than P8 acknowledges

Adding `receipts` to `USER_TABLES` and `receipt_lines` to `LINKED_TABLES` is the correct scoping pattern ([backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:51)). However, `ALL_TABLES` must place:

- `receipts` after `cart_drafts`;
- `receipt_lines` after `receipts`, `catalog_items`, and `cart_draft_items`.

If `extracted_transactions.receipt_id` is added, current ordering is invalid because `extracted_transactions` is restored before all shopping tables ([backup.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:32)). It must be reordered or its receipt FK deferred in `DEFERRED_RESTORE_COLUMNS`.

The plan’s backup test should exercise both full dump restore and per-user file restore, not only table coverage.

### M5 — Fuzzy matching remains underspecified and unsafe for automatic pantry writes

The proposed Levenshtein threshold does not define normalization, unit compatibility, pack-size handling, duplicate products, partial quantities, or global one-to-one assignment. “Ambiguous → extra” destroys useful ambiguity information and may let the user confirm an apparent extra without understanding that a close draft match existed.

Required behavior should include:

- Unicode/case/punctuation/whitespace normalization;
- one-to-one matching across the whole receipt and draft;
- unit and pack compatibility;
- deterministic tie handling;
- a minimum margin over the second-best result;
- an explicit `ambiguous` suggestion;
- no automatic catalog/pantry write from an AI/fuzzy suggestion without user confirmation.

The OCR model cannot provide trustworthy internal `catalogItemId` values, so the plan must explain how server-owned catalog candidates are loaded and matched.

### M6 — Price-difference semantics and reconciliation invariants remain undefined

The current cart field is `suggestedPricePaise`, but the cart implementation treats it as a displayed pack/line price and simply sums it across active items ([cart-draft-generator.ts](/work/personal/compass/apps/api/src/modules/shopping/services/cart-draft-generator.ts:70)). The receipt plan does not define:

- whether `pricePaise` is unit price or line total;
- whether draft quantity multiplies expected price;
- different pack-size comparison;
- null expected price;
- signed delta convention;
- quantity differences;
- discounts and weighted goods.

Tests should prove that receipt lines are partitioned exactly once into matched/extra/ambiguous, draft lines exactly once into matched/missing, and monetary components reconcile to the grand total.

### M7 — Ownership validation is not fully planned

Receipt ownership is mentioned, but the plan also accepts or derives IDs for:

- cart draft;
- confirmed receipt lines;
- catalog items;
- matched draft items;
- suggested account.

Every one must be user-scoped or proven through an owned parent. In particular, `suggestedAccountId` is only a plain FK in `extracted_transactions`; the FK does not prove ownership.

`confirmedLineIds` must be constrained to the receipt in the route, deduplicated, and loaded authoritatively. The confirm route must not trust client quantities, prices, units, or catalog IDs.

### M8 — Account and receipt identity are duplicated or collected at the wrong phase

`ConfirmReceiptBodySchema` includes `receiptId` even though the route also uses `:id` ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:80)). That creates two identities that can disagree.

The confirm step also asks for `accountId`, but the existing inbox acceptance step asks for the account again. Unless preselection is a deliberate convenience with ownership validation, it is unnecessary duplication. Date and merchant provenance need the same clear division between receipt confirmation and ledger acceptance.

### M9 — Receipt PII handling cannot safely be deferred

The plan explicitly makes receipt PII redaction a non-goal ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:151)). Receipts can contain addresses, loyalty identifiers, phone numbers, card suffixes, transaction references, and tax identifiers.

The reused route observer logs the provider response and includes the client filename in the event title ([capture-image.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/capture-image.ts:98)). Receipt OCR output therefore risks persisting PII in AI-event logs even if the image block itself is omitted from observation.

At minimum the task must:

- avoid storing raw OCR/provider output in AI events;
- avoid client filenames in event titles;
- minimize tool output to required purchase fields;
- include prompt-injection resistance for instructions printed on receipts;
- define who can retrieve receipt images and for how long.

### M10 — The test plan is far below the repository’s TDD and risk requirements

P7 names reconciliation examples and vague “integration test patterns,” but no concrete parse-service test file, confirm-service integration test file, route test, schema smoke test, shared schema test, or inbox compatibility test is scoped ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:122)).

Missing tests include:

- disabled AI, non-vision model, provider failure/timeout, malformed output, zero/multiple matching tool calls;
- empty, oversized, unsupported, and MIME/magic-mismatched uploads;
- authentication, demo rejection, and AI-event redaction;
- exact/fuzzy/ambiguous/tie/unit-conflict/duplicate matching;
- receipt and draft partition invariants;
- tax, discount, return, weighted-item, null-price, zero-price, and safe-integer cases;
- cross-user receipt, draft, line, catalog, and account IDs;
- stale cart after reconciliation;
- duplicate `confirmedLineIds`;
- retry and concurrent double-confirm;
- rollback after partial pantry/rate/inbox failure;
- proof that receipt confirmation adds a new rate observation;
- aggregate amount equals receipt total;
- manual category enforcement;
- end-to-end ledger creation and `ledger.mutated` exactly once after commit;
- backup/restore of receipt rows and image MIME;
- deletion/orphan-storage behavior;
- both route snapshots and the shopping plugin’s local route registration test.

Each canonical acceptance criterion should map to a test observed failing before implementation, per the repository’s TDD rules.

## Low severity

### L1 — The route registration wording is ambiguous

Shopping route files already declare paths relative to `/api/shopping` ([plugin.ts](/work/personal/compass/apps/api/src/modules/shopping/plugin.ts:18)). “`routes/receipts.ts` under `/receipts` prefix” followed by handlers named `/receipts/...` could produce duplicated prefixes if implemented literally.

The plan should state one convention explicitly: register the route plugin normally in `shoppingRoutes` and declare `/receipts`, `/receipts/:id/reconcile`, etc. inside it.

### L2 — Response contracts are incomplete

The plan names entity, line, parse, reconciliation, and confirmation-body schemas, but not:

- receipt list response;
- reconcile request body;
- confirm response;
- manual line create/update bodies;
- unavailable/manual-entry response state.

Existing shopping APIs use explicit response wrappers and corresponding inferred types. These should be named before implementation.

### L3 — Schema documentation and required file scope need updating

The shopping schema header currently claims “9 resident tables + 6 resident enums,” which is already stale after cart items and serviceability and would become further outdated with receipts ([shopping/schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:1)).

The modified-file list should explicitly name:

- `apps/api/src/modules/ingest/schema.ts`;
- ingest inbox services and shared email schemas;
- shopping and ingest schema smoke tests;
- `packages/shared/src/schemas/shopping.test.ts`;
- `packages/shared/src/schemas/email.ts` and relevant tests;
- `apps/api/src/db/restore.ts` if a receipt FK must be deferred;
- `apps/api/src/modules/system/services/restore-user.ts`;
- both snapshot filenames;
- cart-draft routes/tests if ordered drafts must become immutable.

## Original six HIGH-gap status

- **H1 — Ledger/inbox integration:** Partially addressed in intent, but not technically viable and not covered through ledger/event acceptance.
- **H2 — Task 079 unavailable:** Fully addressed. Task 079 is now `COMPLETE`, and `cart_draft_items`, services, routes, and shared contracts exist.
- **H3 — Replay/tampering/state persistence:** Partially addressed by new receipt tables, but atomic claim, transactionality, stale-cart handling, and concurrency remain missing.
- **H4 — Consumption observation:** Not addressed. The plan assumes a `learnConsumptionRate` interface and data source that do not exist.
- **H5 — Durable receipt/image ownership:** Partially addressed, but MIME, compensation, deletion, retrieval, restore ordering, and lifecycle remain unspecified.
- **H6 — UI/manual review owner:** Not addressed. Task 083 still does not own receipt review or manual entry.

Overall: only one of the six original HIGH gaps is fully resolved.