## Verdict

D8 fully resolves the prior BLOCKING finding. The redesigned tests are coherent with PR-G1’s collapsed-transfer model, deterministic for this fixture, and sufficiently specified for delegation.

No BLOCKING or IMPORTANT findings remain.

## Claim verification

### a) CONFIRMED

`acceptTransferPair` simply calls `acceptTransfer` ([inbox.test.ts:290](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:290)).

`acceptTransfer` creates the debit and credit transactions, then immediately calls:

> `const { id: transferId } = await linkTransfer(tx, userId, outTxn.id, inTxn.id);`

It subsequently updates both drafts with:

> `.set({ transactionId: transferId })`

([transfer-classification.ts:90](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:90), [transfer-classification.ts:116](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:116), [transfer-classification.ts:118](/home/udai/common/compass/apps/api/src/modules/ingest/services/transfer-classification.ts:118)).

`linkTransfer` chooses the outflow ID as survivor:

> `return { survivorId: outTransactionId, absorbedId: inTransactionId };`

([collapse-transfer.ts:32](/home/udai/common/compass/apps/api/src/modules/ledger/services/collapse-transfer.ts:32))

It remaps references, deletes the absorbed header, and installs transfer postings on the survivor ([transfers.ts:170](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:170), [transfers.ts:181](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:181), [transfers.ts:186](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:186)).

One wording nuance: D8’s statement that there is “never a moment with two independent transaction rows” is literally too absolute. Both rows exist transiently inside the enclosing database transaction before `linkTransfer` collapses them. There is no externally committed or test-observable two-row state, so this does not affect the redesign.

### b) CONFIRMED

Both drafts reference the same survivor. The FK is explicitly:

> `onDelete: "set null"`

([schema.ts:195](/home/udai/common/compass/apps/api/src/modules/ingest/schema.ts:195))

Therefore one hard delete nulls both draft references. `listOrphanedAccepts` selects exactly accepted drafts whose `transactionId` is null:

> `eq(extractedTransactions.status, "accepted"),`  
> `isNull(extractedTransactions.transactionId)`

([review-queue.ts:50](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-queue.ts:50), [review-queue.ts:56](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-queue.ts:56)).

Both drafts become orphans from the single delete.

### c) CONFIRMED

`restoreOrphan` performs one guarded update:

> `.set({ status: "pending", updatedAt: new Date() })`

with predicates requiring accepted status and a null transaction ID ([review-actions.ts:143](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-actions.ts:143)).

It contains no transfer matching or pairing call. Its return merely converts the updated row to a DTO:

> `return dtoFromRow(db, claimed);`

([review-actions.ts:163](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-actions.ts:163)).

### d) CONFIRMED

`acceptDraft` delegates to `acceptExtracted` ([inbox.test.ts:272](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:272)). `acceptExtracted` creates one transaction and stamps the draft with its ID ([review-actions.ts:95](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-actions.ts:95), [review-actions.ts:109](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-actions.ts:109)).

After that transaction commits, it runs:

> `await autoLinkTransfers(db, userId);`

([review-actions.ts:115](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-actions.ts:115)).

`autoLinkTransfers` calls the full-user `suggestTransfers` sweep and links only suggestions having one candidate on both sides:

> `if (outCount.get(s.outTransactionId) !== 1 || inCount.get(s.inTransactionId) !== 1) continue;`

([transfers.ts:208](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:208), [transfers.ts:217](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:217)).

### e) CONFIRMED

After accepting only `outDraftId`, no positive ordinary transaction exists. A pending draft is not read by `suggestTransfers`, whose candidates come exclusively from `transactions` joined to `postings` ([transfers.ts:62](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:62)).

Consequently there is no credit-side candidate and no suggestion. T_out remains an ordinary transaction with one real posting and an Expenses/Income counter, exactly the shape described by [transfers.ts:50](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:50).

### f) CONFIRMED

The second acceptance creates T_in with the opposite sign. `suggestTransfers` requires:

> `i.account_id <> o.account_id`  
> `i.amount_paise = -o.amount_paise`  
> `i.amount_paise > 0`  
> `abs(o.date - i.date) <= TRANSFER_WINDOW_DAYS`  
> `where o.amount_paise < 0`

([transfers.ts:80](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:80)).

The fixture uses separate accounts, equal amounts, opposite directions, and `BASE_DATE` for both acceptances ([inbox.test.ts:272](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:272)). It creates a fresh user and only these ledger transactions. Since every suggestion query is restricted by:

> `where t.user_id = ${userId}`

([transfers.ts:67](/home/udai/common/compass/apps/api/src/modules/ledger/services/transfers.ts:67)), other tests and users cannot introduce ambiguity.

There will be exactly one suggestion, with counts of one on each side. `linkTransfer` then keeps T_out, removes T_in, and writes the two-real-posting transfer shape.

The draft IDs also converge correctly: T_out’s draft already references the survivor, while `remapReferences` changes references to the absorbed T_in:

> `.update(extractedTransactions)`  
> `.set({ transactionId: survivorId })`  
> `.where(eq(extractedTransactions.transactionId, absorbedId))`

([collapse-transfer.ts:154](/home/udai/common/compass/apps/api/src/modules/ledger/services/collapse-transfer.ts:154)).

### g) CONFIRMED

The current test calls `hardDeleteTransaction` on both result IDs ([inbox.test.ts:878](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:878)). Because the IDs are equal, the first call deletes the survivor and the second executes the same `DELETE ... WHERE id = ...`, affecting zero rows without error ([inbox.test.ts:298](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:298)).

Everything thereafter remains coherent:

- Both drafts are found as orphans.
- Both are restored.
- `listInbox("pending")` invokes `pickTransferPairs` ([review-queue.ts:31](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-queue.ts:31)).
- `pickTransferPairs` finds the unique equal-amount debit/credit pair ([review-queue.ts:83](/home/udai/common/compass/apps/api/src/modules/ingest/services/review-queue.ts:83)).
- `acceptTransferPair` recreates and collapses the transfer.
- The existing “new ID differs from old ID” assertions remain valid.

Only the retired `transferLinks` assertion at [inbox.test.ts:909](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:909) is structurally wrong.

## Judgment

D8 test 1 is correct and deterministic. The fresh UUID user, user-scoped suggestion query, and absence of other ledger transactions for that user eliminate hidden candidate ambiguity. Step 4 cannot link; step 5 must produce exactly one mutually unique suggestion.

F6’s test 2 correction is also correct. Reaccepting the out draft at 450000 creates an ordinary unmatched transaction, while the in draft remains accepted with `transactionId = null` and therefore remains an orphan. The proposed ordinary-shape and orphan assertions directly test those facts instead of relying on the permanently empty legacy link table.

D8 leaves no material transfer behavior for the implementer to invent: restoration order, acceptance order, amounts, accounts, intermediate shape, survivor identity, final draft references, posting tuples, zero-sum invariant, and retired-link invariant are all specified.

## MINOR finding

Test 3’s name should also be updated. It currently says:

> `acceptTransfer recreates two transactions plus a link`

([inbox.test.ts:852](/home/udai/common/compass/apps/api/src/modules/ingest/services/inbox.test.ts:852))

That title describes the retired representation and contradicts D8’s required final shape. D8 says test 3 needs “ONLY its final transferLinks assertion replaced,” overlooking this stale narrative. Rename it to describe recreation as one collapsed transfer transaction with two real postings. This is documentation/test readability only and does not reopen the prior BLOCKING finding.