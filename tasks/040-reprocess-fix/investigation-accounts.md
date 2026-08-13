# Investigation: Accounts Table Schema and Account Linking

## Files inspected

- `apps/api/src/db/shared/hubs.ts` — DB schema (accounts table)
- `packages/shared/src/schemas/ledger.ts` — Zod schema (AccountSchema, AccountWithBalanceSchema, CreateAccountSchema, UpdateAccountSchema)
- `apps/api/src/modules/ledger/routes/accounts.ts` — GET /api/accounts route
- `apps/api/src/modules/ledger/services/accounts.ts` — listAccounts, createAccount, updateAccount, deleteAccount
- `apps/api/src/modules/credit/schema.ts` — card_details, bank_details (extension tables)
- `apps/web/src/routes/accounts/AccountsPage.tsx` — web UI
- `apps/web/src/routes/inbox/InboxPage.tsx` — only place "payingAccount" appears in web

## 1. accounts table columns (hubs.ts lines 65–127)

| Column | Type | Notes |
|---|---|---|
| id | uuid PK | |
| user_id | uuid FK → users | user-scoped |
| name | text NOT NULL | human-facing label |
| type | account_type enum | bank/cash/credit_card/investment/loan/overdraft/ppf/epf/ssy/nps/home_loan_od/insurance(deprecated)/system |
| institution | text nullable | lookup key, not display |
| account_last4 | text nullable | synced from bank_details.account_number |
| holder_name | text nullable | whose account |
| upi_ids | text[] NOT NULL default {} | |
| currency | text NOT NULL default 'INR' | |
| opening_balance_paise | bigint NOT NULL default 0 | pinned at 0 for bank/cash; real amount lives in is_opening transaction |
| goal_id | uuid nullable FK → goals (set null on delete) | earmarked goal |
| sort_order | integer NOT NULL default 0 | |
| archived_at | timestamp nullable | |
| system_kind | account_system_kind enum nullable | expenses/income/opening/clearing; null for all user accounts |
| created_at | timestamp | |
| updated_at | timestamp | |

**No "linked account" or "paying account" FK exists on this table.**

## 2. AccountSchema (ledger.ts lines 183–197)

Fields: id, name, type, institution, accountLast4, holderName, upiIds, currency, openingBalancePaise, goalId, sortOrder, archivedAt.

AccountWithBalanceSchema extends AccountSchema with: balancePaise, openingTransactionPaise, subtype (bank subtype).

**No linked/paying account field exists in the Zod schemas.**

## 3. No existing "linked account" / "paying account" FK

A thorough grep across `apps/api/src/db/`, `packages/shared/src/`, and `apps/api/src/modules/` found zero occurrences of `payingAccount`, `paying_account`, `linkedAccount`, or `linked_account` as DB columns or schema fields. The only occurrence is a local React state variable `payingAccountId` in `InboxPage.tsx` (line 232) — a transient UI concept for accepting extracted transactions, not persisted in the accounts table.

## 4. GET /api/accounts endpoint (routes/accounts.ts line 24–28)

`GET /api/accounts` → calls `listAccounts(app.db, req.session!.userId)` → returns `AccountWithBalance[]`. The query (services/accounts.ts lines 190–230) LEFT JOINs `postings`, `transactions`, and `bank_details` to compute balancePaise, openingTransactionPaise, and subtype. Filtered by `userId` and `systemKind IS NULL` (system accounts excluded). Ordered by `sort_order`, `created_at`.

## 5. Web UI for accounts (AccountsPage.tsx)

Displays accounts from `useAccounts()`. Shows name, type/subtype label, institution, last-4, balance. No "linked account" concept visible. The route `/accounts/:id` links to `AccountLedgerPage`.

## 6. Extension tables (no linking FKs there either)

Account-type-specific details live in separate 1:1 extension tables:
- `card_details` (credit card: network, productName, cycleDay, dueDay, earnRatePer100, statementPasswordEnc)
- `bank_details` (bank: accountNumber, ifsc, branch, subtype, requiredAmbPaise, debitCardLast4)
- `retirement_details` (ppf/epf/ssy/nps: scheme-specific fields)
- `overdraft_details` (overdraft/home_loan_od: sanctioned limit, drawing power)

None carry a FK to another account for a "paying account" or "linked account" relationship.

## Summary

The accounts table and its Zod schema have no concept of a linked or paying account. The only relationship an account has to another entity is `goal_id` (nullable FK to goals). Any "paying account" feature would require a new nullable FK column (e.g. `paying_account_id uuid references accounts(id)`) on the accounts table and corresponding schema/service/route changes.
