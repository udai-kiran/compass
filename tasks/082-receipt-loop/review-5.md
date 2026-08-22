## High

1. **Receipt totals are never populated or validated before ledger posting.**  
   The OCR tool only returns line-level `lineTotal` and `discount`; P3 never sets `receipts.totalPaise`, and manual line APIs cannot update receipt header totals. Yet confirmation posts `-receipt.totalPaise`, even though the column is nullable. The plan also does not define whether discounts are already reflected in `lineTotal`, how tax/fee lines are represented, or how totals are recomputed after line edits. Confirmation must derive and validate a non-zero, safe-integer grand total server-side before calling [`createTransaction()`](/work/personal/compass/apps/api/src/modules/ledger/services/transactions.ts:412).

2. **Confirmed receipts can apparently be reopened and confirmed again.**  
   The atomic `UPDATE ... WHERE status='reconciled'` prevents concurrent double-confirm, but P4 unconditionally changes a receipt back to `reconciled`. No transition guard prevents reconciling a `confirmed` receipt, and the manual line routes have no status restrictions. A sequence of confirm → reconcile → confirm can therefore create a second ledger transaction. Reconciliation must reject confirmed receipts, and line mutations should either be forbidden after confirmation or explicitly invalidate reconciliation without reopening confirmed records.

3. **The proposed `storage_key` backup entry will fail the existing drift test.**  
   [`backup.test.ts`](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:106) detects file-bearing columns only when their SQL name is `stored_path` or `document_path`. Adding `receipts.storage_key` to [`FILE_COLUMNS`](/work/personal/compass/apps/api/src/modules/system/services/backup.ts:219) makes it appear “stale,” so T5 cannot pass. Update the detector to recognize `storage_key` or generalize the schema convention. Also, `FILE_COLUMNS` has no MIME-column field; the plan’s “with mimeType column reference” does not match its current `{ table, column }` shape.

## Medium

1. **Receipt purchase dates do not reach pantry or consumption learning.**  
   [`replenishPantry()`](/work/personal/compass/apps/api/src/modules/shopping/services/pantry-management.ts:68) accepts no purchase timestamp and records `lastPurchasedAt` as the current time. [`learnConsumptionRate()`](/work/personal/compass/apps/api/src/modules/shopping/services/consumption-rate.ts:137) likewise treats `shopping_list_items.updated_at` as `boughtAt`; synthetic rows default that to confirmation time. Confirming an older receipt therefore makes it look like a purchase today despite `purchaseDate` and confirmation `date` being available.

2. **The synthetic rows feed the learner structurally, but not always correctly.**  
   The insert-before-`replenishPantry()` ordering means the learner can see the new `status='bought'` row in the same transaction. However:

   - Multiple receipt lines for the same catalog item become multiple simultaneous “purchases,” producing zero/short intervals and inflated observation counts. They should be aggregated per catalog item per receipt.
   - `learnConsumptionRate()` recomputes from all historical bought rows, then blends that complete result into the existing profile and adds its observation count again. After 2 observations the count is 2; after a third it becomes 5, then 9, rather than 3 and 4. Task 082 should either correct that learner behavior or avoid claiming accurate rate learning without doing so.

3. **OCR quantity/unit normalization is unspecified.**  
   The tool returns generic numeric quantities and strings, while persistence accepts integer base quantities and only `g`, `ml`, or `piece`. The plan does not define conversion of `kg`, `L`, packs, decimals, or malformed units before inserting `quantityBase` and `unit`. Without reusing the existing shopping normalization seam, common receipt quantities may be rejected or stored at the wrong scale.

4. **The reconciliation draft may differ from the receipt’s persisted draft link.**  
   Parse accepts an optional `cartDraftId`, while reconcile independently accepts another `cartDraftId`. P4 does not say to persist the reconciled draft ID or require it to equal the existing link. Consequently confirmation could order the wrong draft—or no draft—after reconciling against a different one.

5. **The row-deletion half of storage lifecycle is still not represented.**  
   The revision compensates when DB insertion fails after `storage.put`, but no receipt deletion service/route or user-cascade cleanup path removes the corresponding object. A PostgreSQL cascade cannot call `storage.delete()`. The plan should identify the application-owned deletion path and test its best-effort object cleanup.

## Low

1. **The test plan does not cover the newly added manual API surface.**  
   P7 lists reconciliation and confirmation tests but no route/service tests for POST/PUT/DELETE line operations, cross-user receipt/line IDs, invalid quantity-unit pairs, or mutation-after-confirm behavior. Under the repository’s TDD rules, AC5 needs explicit tests.

## Resolved from the revision

- **D1 resolved:** `createTransaction(dbOrTx, userId, input)` exists. Its input supports `accountId`, `date`, `amountPaise`, `merchant`, `categoryId`, `notes`, and the service extension supports `source: "import"`.
- **D2 structurally resolved:** bought synthetic `shopping_list_items` are exactly what the learner queries, subject to the timestamp/aggregation defects above.
- **D3 upload ordering resolved:** receipt/image persistence precedes OCR, with insertion-failure compensation planned.
- **D4 concurrency claim resolved:** the guarded status update inside one transaction prevents racing confirmations.
- **D5 resolved:** one aggregate ledger transaction per receipt is specified.
- **H6 API surface resolved:** POST/PUT/DELETE manual-line routes are included.
- **Post-commit event resolved:** `ledger.mutated` is explicitly emitted after successful commit.
- **Category enforcement resolved:** the confirmation contract requires a non-null UUID, and `createTransaction()` performs ownership validation.
- **Match statuses resolved:** both `unmatched` and `ambiguous` are present.
- **PII minimization resolved in intent:** the plan explicitly excludes filenames and raw OCR content from AI events; implementation should sanitize both `requestContext` and `responseRaw`.
- **Backup table ordering resolved:** the proposed parent-first ordering is compatible with the declared receipt foreign keys.