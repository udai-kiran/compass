## 1. AI event storage

The table is `ai_events`.

- The central schema barrel re-exports it from the automation module: [apps/api/src/db/schema.ts:94](/home/udai/common/compass/apps/api/src/db/schema.ts:94).
- Its actual definition is in [apps/api/src/modules/automation/schema.ts:60](/home/udai/common/compass/apps/api/src/modules/automation/schema.ts:60) and [apps/api/src/modules/automation/schema.ts:77](/home/udai/common/compass/apps/api/src/modules/automation/schema.ts:77).

Columns:

| Column | Type/behavior |
|---|---|
| `id` | UUID primary key, generated |
| `user_id` | Required UUID FK to `users` |
| `kind` | `ai_event_kind` enum |
| `status` | `ai_event_status`: `ok` or `error` |
| `provider` | Text |
| `model` | Text |
| `title` | Short display label |
| `ingestion_id` | Nullable UUID FK to `email_ingestions`, set null on deletion |
| `account_id` | Nullable UUID FK to `accounts`, set null on deletion |
| `request_context` | Exact model request/context |
| `response_raw` | Raw model response |
| `latency_ms` | Nullable integer |
| `error` | Nullable text |
| `created_at` | Timestamp with timezone |

These appear at [apps/api/src/modules/automation/schema.ts:80](/home/udai/common/compass/apps/api/src/modules/automation/schema.ts:80) through [apps/api/src/modules/automation/schema.ts:98](/home/udai/common/compass/apps/api/src/modules/automation/schema.ts:98). The table has a `(user_id, created_at DESC)` index at line 100.

Event kinds are:

- `email_extract`
- `statement_parse`
- `statement_summary`
- `categorize`
- `summary`
- `assistant`

See [apps/api/src/modules/automation/schema.ts:60](/home/udai/common/compass/apps/api/src/modules/automation/schema.ts:60).

The extractor writes these rows through [apps/extractor/src/db.ts:170](/home/udai/common/compass/apps/extractor/src/db.ts:170) and [apps/extractor/src/db.ts:190](/home/udai/common/compass/apps/extractor/src/db.ts:190). Request and response fields are capped at 64,000 characters, the title at 300 characters, and logging failures are deliberately swallowed.

Each provider model round-trip is observed and logged at [apps/extractor/src/index.ts:219](/home/udai/common/compass/apps/extractor/src/index.ts:219). Consequently, a successfully processed statement normally generates up to three AI events:

1. `email_extract` for initial classification.
2. `statement_parse` for PDF transaction lines.
3. `statement_summary` for totals and rewards.

The event receives the ingestion ID and, for statement passes, the identified card account ID where available: [apps/extractor/src/index.ts:221](/home/udai/common/compass/apps/extractor/src/index.ts:221).

## 2. Where `card_statement` is processed

The explicit branch is [apps/extractor/src/index.ts:254](/home/udai/common/compass/apps/extractor/src/index.ts:254), with the condition at line 259.

Before that branch, every email—including a statement email—is passed through the ordinary email classifier:

- `runExtraction(...)`: [apps/extractor/src/index.ts:249](/home/udai/common/compass/apps/extractor/src/index.ts:249)
- AI event kind `email_extract`: line 251
- Generic classification/extraction implementation: [apps/extractor/src/extract.ts:383](/home/udai/common/compass/apps/extractor/src/extract.ts:383)
- Generic email prompt: [apps/extractor/src/extract.ts:131](/home/udai/common/compass/apps/extractor/src/extract.ts:131)

`runExtraction` classifies `card_statement` as deferred and discards any transactions returned from the email-body classification call:

- Status decision: [apps/extractor/src/extract.ts:226](/home/udai/common/compass/apps/extractor/src/extract.ts:226)
- `card_statement` → `{ status: "deferred", extract: false }`: lines 235–237
- Early empty-row return: [apps/extractor/src/extract.ts:440](/home/udai/common/compass/apps/extractor/src/extract.ts:440)

The dedicated branch then calls `processStatement(...)` at [apps/extractor/src/index.ts:259](/home/udai/common/compass/apps/extractor/src/index.ts:259).

### PDF handling

`processStatement` is defined at [apps/extractor/src/index.ts:99](/home/udai/common/compass/apps/extractor/src/index.ts:99) and starts at line 115.

It:

- Finds the first PDF attachment: lines 121–124.
- Defers if none exists.
- Rejects PDFs over 15 MiB: [apps/extractor/src/index.ts:42](/home/udai/common/compass/apps/extractor/src/index.ts:42) and lines 125–132.
- Redacts owner PII from extracted PDF text: lines 135–140.
- Caps model input to 60,000 characters: [apps/extractor/src/extract.ts:456](/home/udai/common/compass/apps/extractor/src/extract.ts:456).
- Runs separate transaction and summary model calls: [apps/extractor/src/index.ts:146](/home/udai/common/compass/apps/extractor/src/index.ts:146).

It loads credit-card accounts and their per-card encrypted statement passwords at [apps/extractor/src/db.ts:93](/home/udai/common/compass/apps/extractor/src/db.ts:93). The query selects active `accounts` where `type = 'credit_card'` and left-joins `card_details.statement_password_enc`: lines 99–111.

Each stored password is tried in turn at [apps/extractor/src/index.ts:161](/home/udai/common/compass/apps/extractor/src/index.ts:161). The password that opens the PDF identifies the card account; all extracted lines are assigned that `accountId`: lines 175–180.

If no stored password matches, the extractor attempts to open the PDF without a password: lines 183–188. In that case extraction can succeed, but `accountId` remains null. If the PDF cannot be opened, the ingestion stays deferred: lines 189–190.

### What it extracts

The statement transaction pass extracts every dated transaction with:

- amount in rupees, converted to integer paise
- debit/credit direction
- date
- optional printed time
- counterparty/merchant description
- category suggestion
- optional bank reference
- verbatim source line
- confidence
- credit intent: `repayment`, `refund`, `cashback`, or null

The model schema is at [apps/extractor/src/extract.ts:20](/home/udai/common/compass/apps/extractor/src/extract.ts:20). Normalization into an inbox row is at [apps/extractor/src/extract.ts:349](/home/udai/common/compass/apps/extractor/src/extract.ts:349). It converts rupees to paise, validates dates, derives an IST timestamp, resolves an existing category, and computes a dedupe hash.

The separate summary pass extracts:

- total amount due
- minimum amount due
- statement/closing date
- reward opening balance
- rewards earned
- rewards redeemed
- reward closing balance

See [apps/extractor/src/extract.ts:551](/home/udai/common/compass/apps/extractor/src/extract.ts:551) and the normalized return type at [apps/extractor/src/extract.ts:572](/home/udai/common/compass/apps/extractor/src/extract.ts:572).

### What it writes

The statement’s transaction lines are written to `extracted_transactions`, not directly to the ledger:

- Branch calls `saveResults`: [apps/extractor/src/index.ts:270](/home/udai/common/compass/apps/extractor/src/index.ts:270)
- SQL insert: [apps/extractor/src/db.ts:297](/home/udai/common/compass/apps/extractor/src/db.ts:297), specifically lines 316–340.

Each inserted draft carries:

- user and ingestion IDs
- amount/direction/date/timestamp
- counterparty
- suggested card account and category
- bank reference/source quote/confidence
- dedupe hash
- status
- matched transaction ID
- intent

The complete table schema is at [apps/api/src/modules/ingest/schema.ts:149](/home/udai/common/compass/apps/api/src/modules/ingest/schema.ts:149).

The same transaction also updates `email_ingestions.classification`, `status`, `error`, and `updated_at`: [apps/extractor/src/db.ts:289](/home/udai/common/compass/apps/extractor/src/db.ts:289).

Previously recorded ledger transactions are matched against statement lines. Matches are saved as `status = 'duplicate'` with `matched_transaction_id`; unmatched lines remain pending drafts. See [apps/extractor/src/statement-duplicates.ts:11](/home/udai/common/compass/apps/extractor/src/statement-duplicates.ts:11), especially lines 20–44.

Rewards are written to `reward_entries` when the card is identified and the summary contains reward data:

- Invocation: [apps/extractor/src/index.ts:286](/home/udai/common/compass/apps/extractor/src/index.ts:286)
- Replace-on-replay implementation: [apps/extractor/src/db.ts:353](/home/udai/common/compass/apps/extractor/src/db.ts:353)
- Table schema: [apps/api/src/modules/credit/schema.ts:206](/home/udai/common/compass/apps/api/src/modules/credit/schema.ts:206)

A per-cycle row is upserted into `statement_reconciliations` when an account is identified, at least one transaction line exists, and a period can be derived:

- Invocation: [apps/extractor/src/index.ts:308](/home/udai/common/compass/apps/extractor/src/index.ts:308)
- SQL upsert: [apps/extractor/src/db.ts:408](/home/udai/common/compass/apps/extractor/src/db.ts:408)
- Table schema and populated fields: [apps/api/src/db/shared/spines.ts:168](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:168)

The reconciliation records statement totals, rewards and match statistics. Matched ledger transactions receive `transactions.reconciled_statement_id`: [apps/extractor/src/db.ts:477](/home/udai/common/compass/apps/extractor/src/db.ts:477) and [apps/api/src/db/shared/ledger.ts:88](/home/udai/common/compass/apps/api/src/db/shared/ledger.ts:88).

## 3. Data populated on credit-card accounts or `card_details`

Statement processing does **not** update either `accounts` or `card_details`.

The only account/card data it expects to exist beforehand is:

- An active `accounts` row with `type = 'credit_card'`.
- Its ID, which becomes `suggested_account_id` and the reconciliation/reward account.
- Preferably a matching `card_details` row with `statement_password_enc`.

The read query proving this is [apps/extractor/src/db.ts:99](/home/udai/common/compass/apps/extractor/src/db.ts:99). There is no account or `card_details` update in the statement branch.

The general account fields are defined at [apps/api/src/db/shared/hubs.ts:65](/home/udai/common/compass/apps/api/src/db/shared/hubs.ts:65), including institution, last four digits, holder, currency, opening balance and linked payment account.

`card_details` contains:

- `account_id`
- `user_id`
- network
- product name
- cycle day
- due day
- earn rate per ₹100
- encrypted statement password
- created/updated timestamps

See [apps/api/src/modules/credit/schema.ts:43](/home/udai/common/compass/apps/api/src/modules/credit/schema.ts:43) through line 75.

None of the following are inferred or populated by statement processing:

- card network or product
- cycle day or due day
- credit limit
- account balance/opening balance
- institution or last four digits
- statement password

The extracted total and minimum due go to `statement_reconciliations`, not `card_details`: [apps/api/src/db/shared/spines.ts:196](/home/udai/common/compass/apps/api/src/db/shared/spines.ts:196). Rewards go to `reward_entries`. Transaction lines go to `extracted_transactions`.

Also, the emailed PDF itself is not inserted into `card_statements`; that table is described as uploaded statement-file metadata at [apps/api/src/modules/credit/schema.ts:112](/home/udai/common/compass/apps/api/src/modules/credit/schema.ts:112), and the extractor contains no write to it.

For an unencrypted statement opened without matching a card:

- extracted drafts still go into `extracted_transactions`
- `suggested_account_id` is null
- AI statement events have null `account_id`
- rewards and reconciliation are skipped because both require `stmt.accountId`

## 4. AI event log API route

There is no `GET /api/events` backend route in the examined API. The browser page is `/events`, but its API is `GET /api/ai-events`.

The routes are defined at [apps/api/src/modules/automation/routes/ai-events.ts:13](/home/udai/common/compass/apps/api/src/modules/automation/routes/ai-events.ts:13):

- `GET /api/ai-events`: lines 17–21
- `GET /api/ai-events/:id`: lines 23–27

They are registered by the automation plugin at [apps/api/src/modules/automation/plugin.ts:20](/home/udai/common/compass/apps/api/src/modules/automation/plugin.ts:20).

`GET /api/ai-events` is user-scoped, optionally filters by `kind`, supports cursor pagination, defaults to 50 results and allows at most 100. Query validation is at [packages/shared/src/schemas/ai-events.ts:46](/home/udai/common/compass/packages/shared/src/schemas/ai-events.ts:46).

It returns:

```json
{
  "items": [
    {
      "id": "uuid",
      "kind": "email_extract | statement_parse | statement_summary | ...",
      "status": "ok | error",
      "provider": "...",
      "model": "...",
      "title": "...",
      "ingestionId": "uuid | null",
      "accountId": "uuid | null",
      "latencyMs": 123,
      "createdAt": "ISO timestamp"
    }
  ],
  "nextCursor": "string | null"
}
```

The response schema is at [packages/shared/src/schemas/ai-events.ts:17](/home/udai/common/compass/packages/shared/src/schemas/ai-events.ts:17) and [packages/shared/src/schemas/ai-events.ts:40](/home/udai/common/compass/packages/shared/src/schemas/ai-events.ts:40).

The service implementation is [apps/api/src/modules/automation/services/events.ts:90](/home/udai/common/compass/apps/api/src/modules/automation/services/events.ts:90). It filters by the session user, orders newest first, fetches one extra row to determine `nextCursor`, and deliberately omits request/response bodies from the list.

`GET /api/ai-events/:id` returns the same summary plus:

- `requestContext`
- `responseRaw`
- `error`

See [apps/api/src/modules/automation/services/events.ts:122](/home/udai/common/compass/apps/api/src/modules/automation/services/events.ts:122) and [packages/shared/src/schemas/ai-events.ts:32](/home/udai/common/compass/packages/shared/src/schemas/ai-events.ts:32). It is also user-scoped and returns 404 if the event does not belong to that user.

## 5. Card-statement-specific classification behavior

Yes, card statements use different prompts after initial classification.

The sequence is:

1. The generic `EXTRACT_SYSTEM` prompt classifies the email as `card_statement`: [apps/extractor/src/extract.ts:131](/home/udai/common/compass/apps/extractor/src/extract.ts:131).
2. Generic extraction deliberately returns no rows for that classification: [apps/extractor/src/extract.ts:440](/home/udai/common/compass/apps/extractor/src/extract.ts:440).
3. The `card_statement` branch opens and parses the PDF: [apps/extractor/src/index.ts:254](/home/udai/common/compass/apps/extractor/src/index.ts:254).
4. PDF transactions use the dedicated `STATEMENT_SYSTEM` prompt: [apps/extractor/src/extract.ts:463](/home/udai/common/compass/apps/extractor/src/extract.ts:463).
5. Statement totals and rewards use a second dedicated `STATEMENT_SUMMARY_SYSTEM` prompt: [apps/extractor/src/extract.ts:581](/home/udai/common/compass/apps/extractor/src/extract.ts:581).

The transaction prompt specifically instructs the model to:

- extract every dated statement transaction
- interpret statement debit/credit markers
- classify card repayments, refunds and cashback
- use Indian day-first dates
- ignore opening/closing balances, amount-due lines, subtotals and other summaries

See [apps/extractor/src/extract.ts:463](/home/udai/common/compass/apps/extractor/src/extract.ts:463) through line 479.

For non-Ollama providers it forces a `record_statement_transactions` tool call containing only `transactions`; it does not depend on another classification result. See [apps/extractor/src/extract.ts:481](/home/udai/common/compass/apps/extractor/src/extract.ts:481). Ollama uses prompt/JSON output instead. The call allows 4,096 output tokens, a 180-second timeout and one retry: [apps/extractor/src/extract.ts:506](/home/udai/common/compass/apps/extractor/src/extract.ts:506).

The summary prompt is another independent model call with a 512-token limit and 120-second timeout: [apps/extractor/src/extract.ts:647](/home/udai/common/compass/apps/extractor/src/extract.ts:647).

The decisive storage answer is: statement transaction rows go to `extracted_transactions`, initially as reviewable drafts or matched duplicates. They do not directly create ordinary `transactions`, update account balances, update `card_details`, or populate `card_statements`. Only already-existing ledger transactions matched to statement lines are stamped with the resulting reconciliation ID.