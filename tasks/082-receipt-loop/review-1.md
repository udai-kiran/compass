## Review verdict

The plan is not implementation-ready. It conflicts with the canonical task, depends on cart functionality that has not shipped, and lacks the persistence/state model needed to make confirmation secure and idempotent.

## High severity

### H1 — Ledger creation and `ledger.mutated` are incorrectly excluded

The plan declares ledger creation a non-goal and omits it from its acceptance criteria ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:44), [TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:55)). The canonical 11.4 task explicitly requires:

- an accepted purchase to become a ledger transaction with a manually chosen category;
- routing through an inbox/review flow;
- emission of `ledger.mutated`.

See [11.04-receipt-loop.md](/work/personal/compass/tasks/11.04-receipt-loop.md:10).

This is not a minor deferral: it removes two canonical acceptance criteria and leaves “category stays manual” as an assertion with no workflow that actually asks for or applies a category.

The existing inbox cannot be reused directly without design work. `extracted_transactions.ingestion_id` is mandatory and references an email ingestion ([schema.ts](/work/personal/compass/apps/api/src/modules/ingest/schema.ts:155)). The current acceptance service also assumes that entity and creates the ledger transaction inside a guarded transaction ([review-actions.ts](/work/personal/compass/apps/api/src/modules/ingest/services/review-actions.ts:63)).

The plan must either:

- generalize the review-inbox data model to support receipt-originated drafts; or
- introduce a receipt-specific pending ledger review entity with an explicit accept route.

Acceptance must require user-supplied account, transaction date, merchant, actual total, and category. Do not silently copy `catalog_items.category_id`; that would violate the manual-category rule. Emit `ledger.mutated` only after successful ledger commit, following [inbox.ts](/work/personal/compass/apps/api/src/modules/ingest/routes/inbox.ts:45).

### H2 — Task 079 is not implemented, so there are no draft lines to reconcile

The dependency is described as “cart drafts exist” ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:24)), but task 079 is only `APPROVED`, not complete ([079 TASK.md](/work/personal/compass/tasks/079-predictive-cart/TASK.md:1)). Its own root cause says the existing table is header-only and has no lines or generation logic.

That matches the repository: only `cart_drafts` exists ([schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:257)); there is no `cart_draft_items` table, draft service, route, or ownership guard. Therefore `reconcile(draftItems, …)` and all three proposed receipt routes have no actual source of draft items.

Task 082 must be blocked on task 079 reaching `COMPLETE`, its migration being present, and the final cart-item contract being known. The plan should reference task 079’s eventual `CartDraftItem` fields rather than assume `canonicalName` is available.

### H3 — Confirmation is replayable and trusts client-authored reconciliation data

The proposed flow sends parsed lines back from the client, then accepts `confirmedLines` on confirmation ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:37)). No receipt or reconciliation is persisted, signed, versioned, or recomputed. A client can therefore:

- alter quantities, prices, catalog IDs, or matches between reconcile and confirm;
- submit another user’s catalog IDs unless every ID is independently ownership-checked;
- replay confirmation and replenish the pantry repeatedly;
- confirm a stale report after the cart was edited;
- race two confirmation requests.

`replenishPantry()` unconditionally adds the supplied quantity to stock ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:99)). It has no receipt-level idempotency key.

The plan needs a persisted, user-owned receipt/reconciliation record or an equivalent authoritative server-side mechanism. Confirmation should use a conditional state transition under a DB transaction, lock or atomically claim the draft/receipt, reload authoritative draft lines, validate all selected catalog IDs and units, and return 409 for already-confirmed, abandoned, stale, or racing requests. Pantry updates, purchase-history writes, receipt state, and cart status must commit or roll back together.

### H4 — Calling `replenishPantry()` does not add a consumption-rate observation

The plan assumes replenishment “updates consumption rates” ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:36)). Although `replenishPantry()` calls `learnConsumptionRate()` ([pantry-management.ts](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:148)), that learner reads only `shopping_list_items` with `status = 'bought'` ([consumption-rate.ts](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts:149)).

A receipt confirmation creates no bought list item, so recomputation sees exactly the old observations. Rates do not become sharper.

The plan needs a durable purchase-observation model used by consumption learning, or it must mark/link the relevant source items as bought with an explicit purchase timestamp. Reusing `shopping_list_items.updatedAt` would remain a weak proxy and does not represent receipt extras. The rate learner should be redesigned to consume confirmed receipt observations directly.

### H5 — Required durable receipt/image ownership was omitted

Task 068 explicitly deferred durable image persistence to task 11.4, stating that this task should add an owning table and backup `FILE_COLUMNS` entry ([068 TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:126), [068 TASK.md](/work/personal/compass/tasks/068-photo-capture/TASK.md:194)). Task 082 proposes no DB table, migration, storage ownership, deletion lifecycle, or backup changes.

Without this, the receipt cannot serve as durable evidence, cannot be attached to the later ledger transaction, and cannot safely survive parse/reconcile/accept requests.

Scope should include receipt persistence, Drizzle migration/metadata generation, schema smoke tests, DB barrel exports, backup table registration, storage-key registration in `FILE_COLUMNS`, and cleanup behavior if DB insertion or confirmation fails.

### H6 — No UI task currently owns the promised manual review/accept workflow

Task 082 defers its UI to task 12.2 ([TASK.md](/work/personal/compass/tasks/082-receipt-loop/TASK.md:57)), but the actual task 083/12.2 scope only covers cart drafting, guards, recommendations, and abandonment. It lists no receipt upload, manual-line entry, reconciliation review, category selection, or ledger acceptance ([083 TASK.md](/work/personal/compass/tasks/083-cart-review-ui/TASK.md:10)).

Unless another UI task is explicitly added or amended, the required manual fallback and explicit ledger acceptance have no owner.

## Medium severity

### M1 — The proposed AI interface does not match the existing vision seam

`parseReceipt(aiProvider, imageBuffer)` is underspecified and bypasses established behavior:

- `AiProvider` has no OCR or vision method; image processing goes through `chat()` with `ContentBlock[]`, `supportsVision`, tools, and forced `toolChoice` ([types.ts](/work/personal/compass/packages/ai/src/types.ts:287)).
- A buffer alone is insufficient because an `ImageBlock` requires `mediaType` ([types.ts](/work/personal/compass/packages/ai/src/types.ts:134)).
- Providers are resolved per user via `getUserAiProvider`, not passed directly by routes.
- The existing service gates disabled/non-vision providers before storage or chat, uses raw base64, and records an observer ([parse-image.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-image.ts:63)).
- Anthropic and OpenAI-compatible providers support the image path; Ollama and default DeepSeek do not necessarily do so.

Receipt parsing should mirror `parseListImage(deps, userId, {buffer, contentType}, observer)`, with a receipt-specific forced tool and Zod-validated output. No new `AiProvider` method is necessary.

The fallback contract also needs clarification. Existing image parsing gracefully handles disabled/non-vision and malformed model output, but network/provider errors propagate ([parse-image.ts](/work/personal/compass/apps/api/src/modules/shopping/services/parse-image.ts:9)). If “never error page” includes provider outages, this task must intentionally change that behavior and test `AiUnavailableError`; if it means only unreadable content, say so.

### M2 — Receipt schemas are far too vague for reconciliation or ledger posting

`ReceiptLineSchema` is named but its fields and invariants are not defined. At minimum, the plan must distinguish:

- stable line ID and original position;
- raw OCR text versus normalized display name;
- nullable catalog match and match state/confidence;
- total acquired inventory quantity in base units plus paired normalized unit;
- pack count/pack size where needed to derive that inventory quantity;
- integer `unitPricePaise` versus integer `lineTotalPaise`;
- discounts or negative adjustments;
- whether the line is merchandise or a receipt-level charge.

A receipt header is also needed for merchant, purchase date/time, currency, subtotal, discounts, tax/fees, grand total, parse/review status, draft association, stored image key, confirmation timestamp, and eventual transaction ID.

All money must be safe integers in paise. Quantity/unit fields need the same paired Zod and DB constraints already used by shopping schemas. Define whether tax, delivery, rounding, deposits, coupons, returns, and weighted goods contribute to the ledger total but not pantry stock.

### M3 — Price-difference semantics are undefined

The plan says only “price diffs.” It does not define:

- expected value source (`suggestedPricePaise`, unit price, or cart-line total);
- whether draft quantity multiplies the expected price;
- comparison of different pack sizes;
- handling of null expected prices;
- tax, delivery charges, discounts, coupons, and receipt-level rounding;
- whether zero difference is emitted;
- signed delta convention;
- safe-integer and total reconciliation invariants.

Task 079 currently proposes `suggestedPricePaise` but does not clearly establish it as per-unit or line-total price ([079 TASK.md](/work/personal/compass/tasks/079-predictive-cart/TASK.md:26)). Task 082 must wait for and then explicitly consume that definition.

The report should expose both expected and actual paise, signed delta, match provenance, and totals. Add invariants that matched + extra receipt lines partition every receipt line exactly once, matched + missing partition every active draft line exactly once, and receipt components reconcile to the grand total.

### M4 — Fuzzy matching is feasible but unsafe as currently specified

The repository’s existing catalog matcher deliberately performs owner-scoped, case-insensitive exact matching and returns ambiguity rather than guessing ([canonicalize.ts](/work/personal/compass/apps/api/src/modules/shopping/services/canonicalize.ts:65)). There is no fuzzy-matching dependency in the workspaces.

A small pure matcher is feasible without adding a package, but the plan must define:

- Unicode/case/punctuation/whitespace normalization;
- brand and pack-size handling;
- similarity algorithm and threshold;
- minimum margin over the second-best candidate;
- deterministic tie behavior;
- unit compatibility;
- one-to-one/global assignment rather than independently matching several receipt lines to one draft line;
- duplicate-name and partial-quantity behavior;
- an explicit `ambiguous` result.

`catalogItemId` is reliable when supplied by an already-reviewed server record, but the OCR model cannot invent trustworthy internal IDs. Fuzzy matches should be suggestions requiring review, never automatically confirmed pantry links.

### M5 — Cart status after confirmation is not defined

The only current statuses are `draft`, `ordered`, and `abandoned` ([shopping.ts](/work/personal/compass/packages/shared/src/schemas/shopping.ts:47)). The plan merely says “update draft status.”

Task 079 says drafts remain `draft` or become `abandoned`, and never become `ordered` without later explicit action ([079 TASK.md](/work/personal/compass/tasks/079-predictive-cart/TASK.md:88)). Receipt confirmation is presumably that action, but the state transition still needs to be explicit:

- `draft → ordered` on first successful confirmation; or
- add a clearer `purchased`/`confirmed` status through a migration.

`ordered` may be misleading for an uploaded receipt documenting an already completed purchase. Whichever state is chosen, define permitted source states, timestamps, retries, behavior for abandoned/already-confirmed drafts, and whether the expected draft total remains unchanged while actual total lives on the receipt.

### M6 — Route granularity needs resource identity and separate confirmation from ledger acceptance

Parse/reconcile/confirm are reasonable phases, but the current stateless payload design is not. Prefer resource-oriented routes such as:

- `POST /receipts` — multipart upload, create owned receipt and parsed editable lines;
- `POST /receipts/:receiptId/reconcile` — reconcile the persisted receipt against an owned draft;
- `POST /receipts/:receiptId/confirm` — confirm reviewed matches, record purchases, replenish pantry, and close the cart;
- `POST /receipts/:receiptId/accept` — explicit ledger acceptance with account/date/merchant/manual category.

If the inbox is generalized, the last step may instead create a pending review item and use the existing inbox accept route. In either design, receipt and draft ownership must be verified server-side, and route paths must remain relative to `/api/shopping`.

### M7 — Upload validation and storage behavior are missing

The multipart pattern is more than `req.file()`. The existing route enforces one file, a 5 MiB ceiling, MIME allowlisting, magic-byte verification, raw-buffer draining before truncation checks, session auth, demo rejection, and AI-event observation ([capture-image.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/capture-image.ts:56)).

The plan should explicitly reuse those controls. Decide whether receipts support only JPEG/PNG/WebP or also PDF; the vision interface supports GIF, while the existing route intentionally does not. Durable storage also needs compensation if `storage.put()` succeeds and the receipt DB insert fails.

### M8 — Receipt privacy and AI logging need an explicit policy

Receipts commonly contain addresses, loyalty IDs, phone numbers, payment-card suffixes, and transaction references. The image request itself is redacted from AI observations, but the route pattern stores `obs.response` as `responseRaw`, which may contain OCR-extracted PII ([capture-image.ts](/work/personal/compass/apps/api/src/modules/shopping/routes/capture-image.ts:102)). It also places the client-supplied filename in the event title.

The plan should:

- minimize the requested output to merchandise and totals;
- instruct the model to ignore instructions printed in the image;
- avoid logging raw receipt OCR/provider responses or redact receipt PII;
- avoid PII-bearing filenames in event titles;
- define image retention/deletion;
- ensure receipt data is user-scoped in reads, writes, backups, and storage retrieval;
- never let AI-derived category or catalog identifiers trigger writes without review.

### M9 — The test plan misses most stateful and adversarial cases

The four proposed cases are insufficient. Required coverage should include:

- disabled AI, non-vision model, provider unavailable, timeout, malformed output, zero/multiple matching tool calls;
- unsupported MIME, MIME/magic mismatch, empty and oversized uploads;
- auth, demo rejection, and AI-event redaction;
- exact, fuzzy, ambiguous, tie, below-threshold, duplicate-name, duplicate-line, unit-conflict, quantity mismatch, and empty-cart cases;
- extras without catalog IDs and missing/removed draft lines;
- null expected price, zero price, discounts, tax/fees, returns, weighted items, and safe-integer bounds;
- one-to-one partition and monetary-total invariants, preferably property-based;
- cross-user receipt, draft, catalog, account, and category IDs;
- stale/tampered reconciliation payloads;
- confirmation rollback when one pantry line fails;
- confirmation retry and concurrent double-submit;
- invalid cart state transitions;
- proof that a confirmed receipt adds a new rate-learning observation;
- explicit category selection, successful ledger post, failed ledger rollback, and `ledger.mutated` emitted exactly once only after success;
- persistent-image backup/restore and deletion behavior;
- shared Zod contract tests, real-DB service integration tests, and both route snapshots.

The repository’s TDD rule requires every unchecked acceptance criterion to have a test observed failing before implementation; the plan should map each AC to concrete tests rather than place all coverage in one pure unit-test file.

## Low severity

### L1 — Existing `prompts.ts` has no receipt prompt, but it is not necessarily the right home

`packages/ai/src/prompts.ts` currently contains only categorization, summary, and assistant prompts ([prompts.ts](/work/personal/compass/packages/ai/src/prompts.ts:1)). Shopping-list prompts and tool definitions live beside the shopping service, in `parse-list.ts` and `parse-image.ts`.

Therefore the incorrect assumption would be that receipt OCR can reuse an existing prompt: none exists. A receipt-specific system prompt, tool specification, model-output Zod schema, and turn parser must be added. Keeping these in the shopping service is consistent with current shopping code; moving them to `packages/ai/src/prompts.ts` is not required unless they are intended to be provider-level/shared API.

### L2 — No new fuzzy/OCR package is currently justified

The necessary runtime dependencies already exist:

- `@fastify/multipart` for uploads;
- `@compass/ai` for vision chat;
- Zod for validation;
- `fast-check` as an API dev dependency for invariants.

There is no fuzzy string library. Adding one merely for this feature would need justification; a small tested pure normalizer/scorer is likely sufficient. OCR itself should remain provider-backed rather than introducing an unrelated OCR dependency.

### L3 — Scope must name all generated and convention-required files

If persistence is added, the modified-file list must include at least:

- shopping DB schema and schema smoke tests;
- generated migration and Drizzle metadata;
- DB schema barrel if a new table is introduced;
- shared schema tests and shared index exports where required;
- backup `ALL_TABLES`/`USER_TABLES`/`LINKED_TABLES`;
- `FILE_COLUMNS` for a stored receipt image;
- both `route-surface.snapshot.txt` and `route-table.snapshot.txt`.

“Route snapshots” is too vague for this repository’s established two-snapshot convention.

### L4 — The acceptance wording should distinguish parse, confirm, and accept

The task currently mixes “confirmed purchase” and “accepted purchase” without defining their separate effects. The revised plan should make the state machine explicit:

- parsed/reviewable: no domain writes;
- reconciled: advisory report only;
- confirmed: purchase observations, pantry update, cart closure;
- accepted: manual account/category selection, ledger transaction, event emission.

That separation preserves the repository rule that recommendations and AI output are advisory and that nothing reaches the ledger without explicit human acceptance.