## Findings

### High — payer type changes can leave invalid links

[accounts.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:395) defines `typeChangingAwayFromCreditCard`, then uses it to clear cards referencing the edited account at line 575.

A valid payer must already be non-credit-card. Therefore changing a payer from `bank` to `credit_card` makes `typeChangingAwayFromCreditCard` false and leaves dependent cards linked to another credit card—an association rejected when initially created and later rejected by `acceptRepayment`.

The reverse cleanup condition should cover `archiving || (typeChanged && nextType === "credit_card")`, or more generally any transition making the account ineligible as a payer.

### Medium — archiving a card does not clear its own link

At [accounts.ts](/home/udai/common/compass/apps/api/src/modules/ledger/services/accounts.ts:566), the edited account’s own `linkedAccountId` is cleared only when changing away from `credit_card`. Archiving a credit card leaves its link stored, despite the stated lifecycle requirement to clear it on archive.

The update should clear the edited row’s link when `archiving || typeChangingAwayFromCreditCard`.

## Requested pipeline checks

1. Ingestor/extractor account access:

   - `apps/ingestor` does not access `accounts`; it writes `email_ingestions` and updates `mailbox_accounts`.
   - The extractor only reads accounts using named SQL columns in `loadAccounts`, `loadCreditCards`, and `loadIdentity`. Adding a nullable column cannot shift or break these projections.
   - No task-041 changes were made under either application.

2. Repayment route:

   - `POST /api/inbox/:id/repayment` remains registered at [inbox.ts](/home/udai/common/compass/apps/api/src/modules/ingest/routes/inbox.ts:61).
   - It still validates `AcceptRepaymentSchema`, invokes `acceptRepayment`, returns `ExtractedTransactionSchema`, and emits `ledger.mutated`.
   - The web mutation still posts to the same endpoint.
   - Task 041 did not modify the route or repayment service.

3. Email classification paths:

   - `transaction_alert` follows ordinary body extraction and settles as `extracted`.
   - `card_statement` initially returns `deferred`, then [extractor index.ts](/home/udai/common/compass/apps/extractor/src/index.ts:259) invokes the distinct PDF statement pipeline, performs duplicate annotation, and saves its resulting status and rows.
   - Task 041 does not intersect either classification path.

4. Migration/schema:

   - [0068_mean_sentinel.sql](/home/udai/common/compass/apps/api/drizzle/0068_mean_sentinel.sql:1) contains exactly two operations: add nullable `accounts.linked_account_id`, then add its self-FK with `ON DELETE SET NULL`.
   - `emailIngestions`, `emailIngestStatus`, and `emailClass` are unchanged.
   - Comparing snapshots 0067 and 0068 shows only snapshot IDs plus the new column/FK.
   - Restore correctly defers `linked_account_id` alongside `goal_id`.

5. Other card-statement surfaces:

   - Existing statement upload/list/read/delete routes remain under `/api/cards/:accountId/statements` and `/api/card-statements/:id`.
   - Statement-password, reconciliation, activity, rewards, extractor PDF processing, duplicate matching, and import reconciliation remain intact.
   - No additional statement-specific service needed modification for task 041.

The DraftCard effect uses stable scalar dependencies and correctly resets the payer to `""` when switching to an unlinked card. No regression was found there.