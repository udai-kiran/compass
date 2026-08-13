# Investigation: Email Ingestor Extracted Transaction Review & Credit Card Payment Flow

## 1. Extracted Transaction Storage (Schema)

**Table:** `extracted_transactions`
**Defined in:** `apps/api/src/modules/ingest/schema.ts` (lines 155–214)

Key columns:
| Column | Type | Notes |
|---|---|---|
| `id` | uuid PK | |
| `userId` | uuid FK → users | row-scoped |
| `ingestionId` | uuid FK → email_ingestions | cascade delete |
| `amountPaise` | bigint | positive magnitude |
| `direction` | enum debit/credit | sign applied on accept |
| `occurredAt` | date | transaction date from email |
| `occurredAtTs` | timestamp | precise instant (alert only); used as statement↔ledger match key |
| `counterparty` | text | merchant/counterparty name |
| `suggestedAccountId` | uuid FK → accounts | set null on account delete |
| `suggestedCategoryId` | uuid FK → categories | AI guess, reviewer confirms/overrides |
| `intent` | enum repayment/refund/cashback or null | model's classification of a credit's purpose; display-only, does not gate behavior |
| `bankRef` | text | UTR / bank ref id; dedupe key against later statements |
| `sourceQuote` | text | verbatim snippet from email for review provenance |
| `confidence` | double | model confidence 0–1 |
| `dedupeHash` | text | bank_ref OR hash of amount+date+counterparty; unique per user |
| `status` | enum pending/accepted/rejected/duplicate | |
| `transactionId` | uuid FK → transactions set null | set after accept |
| `matchedTransactionId` | uuid FK → transactions set null | set for status=duplicate |

**Parent table:** `email_ingestions` (`apps/api/src/db/shared/hubs.ts`, lines 151–176)
- Stores raw RFC822 message, `fromAddr`, `subject`, `receivedAt`, `classification`, `status` (pending/processing/extracted/deferred/ignored/failed)
- Denormalized fields `subject`, `fromAddr`, `receivedAt` are joined into the review DTO at read time

**Shared Zod shapes:** `packages/shared/src/schemas/email.ts`
- `ExtractedTransactionSchema` — the API/UI DTO; includes computed `transferPartnerId` (null unless two pending drafts match as a transfer pair) and denormalized email context (`subject`, `fromAddr`, `receivedAt`)
- `AcceptExtractedTxnSchema` — plain accept: `{ accountId, occurredAt, amountPaise, direction, merchant, categoryId? }`
- `AcceptRepaymentSchema` — card repayment accept: `{ cardAccountId, fromAccountId, occurredAt }` (no amount: taken from draft server-side)
- `AcceptTransferSchema` — paired transfer: `{ outId, inId, fromAccountId, toAccountId, occurredAt }`

---

## 2. Review UI Component

**File:** `apps/web/src/routes/inbox/InboxPage.tsx`

### DraftCard (ordinary single draft)
Shown for every pending draft that has no `transferPartnerId` pairing.

**Editable fields:**
- Account (select from open accounts; pre-filled with `draft.suggestedAccountId`)
- Category (CategoryPicker; pre-filled with `draft.suggestedCategoryId`; filtered by debit/credit direction)
- Date (DateField; pre-filled with `draft.occurredAt` or today)
- Merchant (text input; pre-filled with `draft.counterparty`)
- **Paying account** (conditional select; only shown when `repaymentEligible === true`)

**Display-only fields:** amount (large, color-coded by direction), Debit/Credit badge, "Card payment" intent badge when `draft.intent === "repayment"`, source quote (italic), bank ref, email subject+from

**Actions:**
- **Accept** → POST `/api/inbox/:id/accept` with `AcceptExtractedTxn`
- **Record as card payment** → POST `/api/inbox/:id/repayment` with `AcceptRepayment` (conditional, see section 3)
- **Reject** → POST `/api/inbox/:id/reject`

### TransferGroup (paired debit+credit)
Shown when two pending drafts share `transferPartnerId`. Offers "Record transfer" action (POST `/api/inbox/transfer`). "Not a transfer" drops back to two `DraftCard` instances.

### OrphanedSection
Shows accepted drafts whose `transactionId` was nulled by a hard-delete of the ledger entry. Actions: Restore (→ pending) or Dismiss (→ rejected).

### DuplicatesGroup
Shows `status=duplicate` drafts (statement lines matched to existing ledger rows from alerts). Action: "Not a duplicate" → POST `/api/inbox/:id/unmatch`.

---

## 3. "Record as Card Payment" Flow

**Eligibility check** (`apps/web/src/routes/inbox/repayment-eligibility.ts`):
```ts
draft.direction === "credit" && selectedAccount?.type === "credit_card"
```
The `intent === "repayment"` flag is display-only — it never gates the button. The button condition depends only on draft direction + selected account type.

**UI state:** `payingAccountId` local state (separate from `accountId`). The "Paying account" dropdown only appears when eligible; it excludes the card account itself.

**Mutation call** (`apps/web/src/lib/inbox-queries.ts:69`):
```ts
apiPost(`/api/inbox/${id}/repayment`, ExtractedTransactionSchema, {
  cardAccountId: accountId,   // the credit_card account
  fromAccountId: payingAccountId,  // the bank account paying the bill
  occurredAt: date,
})
```

**Backend handler** (`apps/api/src/modules/ingest/routes/inbox.ts:62`):
- Route: POST `/api/inbox/:id/repayment`
- Body schema: `AcceptRepaymentSchema`
- Calls: `acceptRepayment(db, userId, req.params.id, req.body)`

**Service logic** (`apps/api/src/modules/ingest/services/transfer-classification.ts:196`):
1. Claim the draft (atomic guarded UPDATE; must be `status=pending`, `direction=credit`)
2. Validate `cardAcct.type === "credit_card"` and `fromAcct.type !== "credit_card"` and `fromAcct.archivedAt === null`
3. Candidate detection: query for existing unlinked debits on `fromAccountId` exactly matching `-claimed.amountPaise`, within `TRANSFER_WINDOW_DAYS=3` days
   - 0 candidates → CREATE a new paying-account debit (`"Card repayment to <card name>"`)
   - 1 candidate → REUSE it (never mutated)
   - 2+ candidates → 409 ("ambiguous — link manually")
4. Create the card inflow transaction (`amountPaise = +claimed.amountPaise`, `occurredAt = claimed.occurredAtTs`)
5. Call `linkTransfer(tx, userId, outTransactionId, inTxn.id)` — merges the two headers into one, returns the surviving transaction id
6. Stamp `extracted_transactions.transactionId = transferId`
7. Does NOT call `autoLinkTransfers` afterward

**Result in the ledger:** A single transaction (the survivor of the merge) with `isTransfer=true` and two real postings — one on the paying account (negative) and one on the card account (positive). The `transferCounterpartAccountId` field on the DTO identifies the other leg's account.

---

## 4. Account / Paying Account Relationships

**Account type enum** (`apps/api/src/db/shared/hubs.ts:21`):
Values include: `bank`, `cash`, `credit_card`, `investment`, `loan`, `overdraft`, `ppf`, `epf`, `ssy`, `nps`, `home_loan_od`, `system`

**No static paying-account FK** on the accounts table. There is no "paying account" column linking a card account to a specific bank account. The relationship is established dynamically at payment time by the user.

**Constraints enforced at repayment time:**
- `cardAccountId` must have `type === "credit_card"`
- `fromAccountId` must have `type !== "credit_card"` (any non-card account)
- `fromAccountId !== cardAccountId`
- `fromAccount.archivedAt` must be null

**In the TransactionsPage** (`apps/web/src/routes/transactions/TransactionsPage.tsx:373–381`):
A transfer where either leg's account is `credit_card` type is labeled "card payment" (violet badge) instead of "transfer" (blue badge). The counterpart account name is shown inline.

**Card bill VPA** (`apps/web/src/lib/card-billpay.ts`): separate UPI bill-pay VPA helper (Axis/ICICI); not connected to the inbox/repayment flow — it's an informational display on the card detail page.

---

## 5. API Route Summary

| Route | Method | Handler | Purpose |
|---|---|---|---|
| `/api/inbox` | GET | `listInbox` | List pending/accepted/rejected/duplicate drafts |
| `/api/inbox/count` | GET | `countPending` | Pending count for nav badge |
| `/api/inbox/orphaned` | GET | `listOrphanedAccepts` | Accepted with null transactionId |
| `/api/inbox/:id/accept` | POST | `acceptExtracted` | Plain accept into ledger |
| `/api/inbox/:id/repayment` | POST | `acceptRepayment` | Accept credit draft as card-payment transfer |
| `/api/inbox/transfer` | POST | `acceptTransfer` | Accept paired debit+credit as transfer |
| `/api/inbox/:id/reject` | POST | `rejectExtracted` | Dismiss pending/duplicate or orphaned accept |
| `/api/inbox/:id/restore` | POST | `restoreOrphan` | Restore orphaned accept → pending |
| `/api/inbox/:id/unmatch` | POST | `unmatchDuplicate` | Unmark duplicate → pending |

---

## Files Inspected

- `apps/api/src/modules/ingest/schema.ts`
- `apps/api/src/modules/ingest/routes/inbox.ts`
- `apps/api/src/modules/ingest/services/review-actions.ts`
- `apps/api/src/modules/ingest/services/transfer-classification.ts`
- `apps/api/src/db/shared/hubs.ts`
- `apps/web/src/routes/inbox/InboxPage.tsx`
- `apps/web/src/routes/inbox/repayment-eligibility.ts`
- `apps/web/src/lib/inbox-queries.ts`
- `apps/web/src/lib/card-billpay.ts`
- `apps/web/src/routes/transactions/TransactionsPage.tsx` (transfer label logic)
- `packages/shared/src/schemas/email.ts`
- `packages/shared/src/schemas/ledger.ts` (TransactionSchema, CreateTransferSchema)
