# Task: Inbox linked payment account for credit card repayments

## Status
COMPLETE

## Objective
When a user reviews a "PAYMENT RECEIVED" credit card transaction in the Inbox and clicks
"Record as card payment", the **Paying account** dropdown should be pre-populated with the
bank account that is normally used to pay that card's bill, rather than requiring manual
selection every time. The user configures this default once on the account settings page.

## Root Cause / Background
No stored relationship exists between a credit card account and its usual payment bank account.
`card_details` carries per-card fields (cycle day, earn rate, statement password) but no
"paying account" FK. The `payingAccountId` local state in `InboxPage.tsx` is always empty on
mount; the user must pick it manually every review.

## Scope

### DB
- `apps/api/src/db/shared/hubs.ts` — add `linkedAccountId` nullable UUID self-referential FK
  on the `accounts` table → `accounts(id)`, `onDelete: 'set null'`. Use `AnyPgColumn` return
  annotation (same pattern as `goal_id` which already does this for the FK to goals; actually
  accounts→accounts is a self-ref — check the Drizzle pattern for self-refs in hubs.ts).
  Meaningful only for `credit_card` type but stored on the core table (no join needed at read time).
- `apps/api/drizzle/` — new migration SQL (generated via `npm run db:generate`, then reviewed)
- `apps/api/src/db/restore.ts` — add `linked_account_id` to `DEFERRED_RESTORE_COLUMNS.accounts`
  alongside `goal_id`, so backup restore handles the self-referential FK ordering correctly

### Shared schema
- `packages/shared/src/schemas/ledger.ts`
  - `AccountSchema`: add `linkedAccountId: z.uuid().nullable()`
  - `UpdateAccountSchema`: add `linkedAccountId: z.uuid().nullable().optional()`
  - (AccountWithBalanceSchema extends AccountSchema so it gains the field automatically)

### API
- `apps/api/src/modules/ledger/services/accounts.ts`
  - `listAccounts`: `toAccount` mapping function must explicitly include `linkedAccountId`
    (whole `accounts` row is already SELECTed, but `toAccount` constructs the DTO explicitly)
  - `updateAccount`: accept and write `linkedAccountId`; validate:
    1. If setting a non-null `linkedAccountId`, the editing account must be `type === 'credit_card'`
       (return **400** — not 422, consistent with existing convention)
    2. Linked account must be owned by same user, must NOT be `credit_card` type,
       must not be archived, and must have `systemKind IS NULL` (not a system account)
    3. Linked account not found → 404
  - `updateAccount` (lifecycle): when an account is archived (setting `archivedAt`) or its
    `type` changes away from `credit_card`, clear `linkedAccountId` on any credit cards that
    reference that account as their linked payer (a single `UPDATE accounts SET linked_account_id=NULL
    WHERE linked_account_id = <id>` run inside the same transaction)

### Web
- `apps/web/src/routes/settings/AccountDetailPage.tsx`
  — Add `LinkedPaymentAccountSection` component (rendered when `account.type === 'credit_card'`),
    a single select: "Default payment account". Lists **open non-credit-card, non-system** accounts.
    Saves via `PATCH /api/accounts/:id` with `{ linkedAccountId }`.
    Supports clearing (empty option → `null`). Syncs local state after successful mutation.

- `apps/web/src/routes/inbox/InboxPage.tsx` — `DraftCard`
  — Add `useEffect` depending on `[accountId, selectedAccount?.linkedAccountId]` (stable values).
    Sets `payingAccountId` to `selectedAccount.linkedAccountId ?? ""` — this also resets to `""`
    when the user switches to an unlinked card account, preventing stale pre-fills.
    A user's manual override of the paying account dropdown after the effect runs is preserved
    (effect only fires when the account selection changes, not on every re-render).

## Dependencies
- None (standalone feature)

## Plan
- P1: Add `linkedAccountId` FK column to `accounts` table in `hubs.ts` (self-referential,
      `onDelete: 'set null'`, using Drizzle's deferred/AnyPgColumn pattern as needed)
- P2: Generate migration SQL (`npm run db:generate`)
- P3: Add `linked_account_id` to `DEFERRED_RESTORE_COLUMNS.accounts` in `restore.ts`
- P4: Add `linkedAccountId` to `AccountSchema` and `UpdateAccountSchema` in shared
- P5: Update `toAccount` mapping in `listAccounts` to include `linkedAccountId`
- P6: Add `linkedAccountId` validation + write in `updateAccount`; add lifecycle clearing
      (when archiving or type-changing away from credit_card, clear dependent links)
- P7: Add `LinkedPaymentAccountSection` in `AccountDetailPage.tsx` for credit card accounts
- P8: In `InboxPage.tsx` `DraftCard`, add `useEffect([accountId, selectedAccount?.linkedAccountId])`
      to set/reset `payingAccountId`

## Acceptance Criteria
- AC1: `GET /api/accounts` returns `linkedAccountId` (null by default, UUID when set)
- AC2: `PATCH /api/accounts/:id` with `{ linkedAccountId: "<bankAccountId>" }` stores it
- AC3: Validation errors return 400 (not 422): non-credit-card account setting link;
       linked target is credit_card / archived / system / different user / not found
- AC4: When an account is archived or its type changes away from credit_card, any credit cards
       that referenced it as their linked account get `linkedAccountId` cleared
- AC5: Credit card account detail page shows "Default payment account" section with save/clear
- AC6: When a credit card with a linked account is selected in Inbox DraftCard, the
       "Paying account" dropdown pre-selects the linked account; switching to a different
       (unlinked) card resets it to empty
- AC7: If the linked account row is deleted (not just archived), `linkedAccountId` becomes null
       via FK cascade
- AC8: No existing tests broken; typecheck clean; `restore.ts` deferred column list updated

## Verification
- T1: `npm run typecheck` — zero errors
- T2: `npm run test` — all pass (no new test regressions)
- T3: `git diff` shows only files in Scope above plus the generated migration

## Non-Goals
- Not auto-detecting the paying account from transaction history (no heuristics)
- Not enforcing account-type constraints in the DB (DB allows any UUID FK; app layer validates)
- Not changing the repayment eligibility logic (`isRepaymentEligible`)
- Not touching the `card_details` table (field goes on core `accounts` table)
- Not writing new unit tests (existing tests must not regress; typecheck is the primary gate)

## Codex Plan Review Findings (review-1.md)
- [Resolved] Deferred restore: add `linked_account_id` to `DEFERRED_RESTORE_COLUMNS.accounts` in `restore.ts`
- [Resolved] Lifecycle invariants: updateAccount clears dependent links when archiving or type-changing
- [Resolved] Inbox useEffect: reset to "" when unlinked; depend on stable `[accountId, selectedAccount?.linkedAccountId]`
- [Resolved] `toAccount` mapping: must explicitly add `linkedAccountId` (whole row selected but DTO is explicit)
- [Resolved] HTTP status: 400 not 422
- [Resolved] System accounts excluded in linked-account validation
- [Acknowledged] Self-referential FK may need AnyPgColumn — implementer should check the goal_id pattern in hubs.ts
- [Acknowledged] Multiple account-producing mappers must be checked (listAccounts `toAccount` is the main one)
