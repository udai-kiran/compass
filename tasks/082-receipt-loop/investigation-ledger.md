# Investigation: Ledger Inbox/Transactions Flow (Task 082)

## Module Structure

**Ledger module** (`apps/api/src/modules/ledger/`):
- Routes: accounts, attachments, categories, integrity, recurring, resources, rules, search, transaction-links, **transactions**, transfers, user-tasks
- Services: accounts, attachments, balances, categories, postings, post-entry, reconcile-postings, recurring, resources, search, transaction-links, **transactions**, transfers, user-tasks
- No inbox/import service — ledger is write-only for transactions; ingest owns the review workflow.

**Ingest module** (`apps/api/src/modules/ingest/`):
- Routes: **inbox**, imports, mailboxes
- Services: **review-actions** (accept/reject/restore), **review-queue** (list pending), transfer-classification, import-reconciliation, imports, inbox-shared

## Key Tables

### `extracted_transactions` (ingest/schema.ts, lines 155–214)
Status enum: `pending | accepted | rejected | duplicate`

**Columns:** id, userId, ingestionId, amountPaise, direction (`debit|credit`), occurredAt (date), occurredAtTs (timestamp), counterparty, suggestedAccountId, suggestedCategoryId, intent (`repayment|refund|cashback|null`), bankRef, sourceQuote, confidence, dedupeHash, status, transactionId (FK to ledger.transactions once accepted), matchedTransactionId (for duplicates), createdAt, updatedAt

### `transactions` (db/shared/ledger.ts, lines 22–100)
**Columns:** id, userId, date, occurredAt (timestamp), merchant, notes, tags[], source (`manual|import|recurring`), policyId, resourceId, sipId, recurringTemplateId, reconciledStatementId, deletedAt, createdAt, updatedAt

**No embedded account or category** — postings table holds the account/category/amount legs.

## Interface: Acceptance Flow

### Accept Extracted Transaction (review-actions.ts, lines 63–119)
1. **Claim phase:** Atomic UPDATE WHERE status='pending' returning the row — only one request can claim each draft.
2. **Create ledger transaction:** Call `createTransaction(tx, userId, {...})` with:
   - accountId (from request)
   - date (from request)
   - occurredAt (carried from extracted_txn.occurredAtTs for statement↔ledger matching)
   - amountPaise (signed: direction='debit' → negative, 'credit' → positive)
   - merchant, categoryId (from reviewer input), notes (enriched with bankRef), source='import'
3. **Link back:** UPDATE extracted_transactions SET transactionId=txn.id
4. **Transfer matching:** Call `autoLinkTransfers()` post-commit to collapse debit↔credit pairs into one transfer

### Create Transaction (ledger/services/transactions.ts, lines 412–475)
Wraps header + postings in one transaction:
1. INSERT transactions row (returns auto-generated id)
2. Resolve system accounts (expenses, income)
3. Build postings (ordinary: one real leg + one system leg)
4. POST each posting via `postTransaction()`

**Source field** distinguishes origin: 'manual' (UI), 'import' (email/CSV), 'recurring' (autopay).

## Data Flow: Email → Ledger

```
Email
  ↓
emailIngestions (raw RFC822 retained)
  ↓
[async] Extractor LLM
  ↓
extractedTransactions (pending, amount unsigned, direction enum)
  ↓
[UI Review] InboxPage.tsx — re-fills account/category suggestions
  ↓
POST /api/inbox/:id/accept
  ↓
acceptExtracted() 
  ↓
createTransaction() ← amount signed by direction, occuredAt carried over
  ↓
transactions + postings (double-entry)
  ↓
app.eventBus.emit("ledger.mutated", {userId})
  ↓
Cache invalidation + budget-eval job enqueued
```

## Key Patterns

- **Atomic accept:** Guarded UPDATE (WHERE status='pending') ensures no double-post races.
- **Orphan handling:** If ledger txn is hard-deleted, extracted_txn stays with transactionId=null, status='accepted' — surfaced in `/api/inbox/orphaned` for re-review.
- **Transfer detection:** After accept, `autoLinkTransfers()` matches debit↔credit pairs and rewrites both as a single transfer.
- **Event emission:** Every accept/reject/restore emits `ledger.mutated` to invalidate caches and trigger async work.
- **No category in extraction:** AI guesses (suggestedCategoryId), reviewer confirms on accept; null if cleared.
- **Source='import':** Distinguishes email-extracted from manual/recurring entries for reporting/lifecycle.

## Web Side (apps/web/src/routes/inbox/InboxPage.tsx, lines 1–40)

- Loads pending + duplicate drafts + orphaned accepts
- Filters to open accounts/categories only
- Renders form: date picker, account dropdown, category picker, merchant/notes fields
- Calls mutation hooks: useInboxMutations → POST /api/inbox/:id/accept|reject|restore

No AI on the review path — extraction is async, acceptance is manual (with category confirmed from AI guess).
