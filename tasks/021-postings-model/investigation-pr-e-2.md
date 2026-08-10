# PR-E Investigation: Remaining Legacy-Column Readers

Date: 2026-08-09

---

## 1. `modules/protection/services/insurance.ts`

**READ functions and legacy columns touched:**

| Function | Lines | Legacy columns read from `transactions` |
|---|---|---|
| `listPolicyPremiums` | 284–308 | `amount_paise` (line 300 `r.amountPaise`), `account_id` (line 302 `r.accountId`), `merchant`, `date`, `id` |
| `ownedPolicy` | 71–77 | None — queries `insurancePolicies` only |
| `getPolicyWithCards` | 62–69 | None — queries `insurancePolicies` + `insuranceHealthCards` only |
| `listPolicies` | 79–100 | None — queries `insurancePolicies` + `insuranceHealthCards` only |
| `readPolicyDocument` | 184–198 | None — reads from `insurancePolicies` via `ownedPolicy` |
| `readHealthCard` | 246–258 | None — queries `insuranceHealthCards` only |

**`listPolicyPremiums` detail (lines 290–307):**
Calls `db.query.transactions.findMany(...)` filtering by `policyId`, `userId`, `deletedAt`.
Then maps `r.amountPaise`, `r.merchant`, `r.accountId`, `r.notes`, `r.date` — reading
`amount_paise` and `account_id` from the legacy `transactions` row. No `category_id`,
`necessity`, `is_opening`, or `transfer_links` reads in this file.

---

## 2. `modules/ingest/services/` — All Files

Files present: `import-reconciliation.ts`, `import-reconciliation.test.ts`,
`imports.ts`, `imports.test.ts`, `inbox-shared.ts`, `inbox.test.ts`,
`mailboxes.ts`, `review-actions.ts`, `review-queue.ts`, `transfer-classification.ts`.

**Reader files NOT already covered by `imports.ts`:**

| File | Nature | Legacy `transactions` columns read |
|---|---|---|
| `import-reconciliation.ts` | Pure logic only — no DB queries | None |
| `inbox-shared.ts` | Readers: `reload`, `INBOX_COLUMNS` | None — queries `extractedTransactions`/`emailIngestions` only |
| `review-queue.ts` | Readers: `listInbox`, `listOrphanedAccepts`, `countPending`, `applyHistoryCategory` | `applyHistoryCategory` (line 177–195) reads `transactions.merchant`, `transactions.categoryId` from legacy columns via Drizzle select |
| `mailboxes.ts` | Readers: list/get mailbox accounts | None — queries `mailboxAccounts` only |
| `transfer-classification.ts` | Mixed: `claimPending` (write), `acceptRepayment` (read + write), `acceptTransfer` (write) | `acceptRepayment` (lines 233–247) reads `transactions.id`, `transactions.accountId`, `transactions.amountPaise`, `transactions.isOpening` from legacy columns; also references `transferLinks` in a subquery |
| `review-actions.ts` | Writers only | N/A |

---

## 3. `modules/system/services/prefs.ts` — `evaluateLargeTransactions`

**Status: ALREADY CONVERTED to postings join.**

Query at lines 92–108:
```sql
select t.id, t.merchant, p.amount_paise, t.date
from postings p
join accounts a on a.id = p.account_id
join transactions t on t.id = p.transaction_id
where t.user_id = $userId and t.deleted_at is null
  and t.date >= current_date - interval '7 days'
  and abs(p.amount_paise) >= $thresholdPaise
  and a.system_kind is null
  [and a.id = $accountId]           -- optional per-account filter
  and not exists (
    select 1 from postings p2
    join accounts a2 on a2.id = p2.account_id
    where p2.transaction_id = t.id
      and a2.system_kind in ('clearing', 'opening')
  )
```
Amount is sourced from `postings.amount_paise` (`p.amount_paise`), not
`transactions.amount_paise`. Transfer exclusion is via postings `system_kind` check,
not `transfer_links`. Fully converted — no action needed.

---

## 4. `modules/ledger/services/search.ts` — Complete Raw SQL (34 lines total)

```sql
-- transactions query (lines 12–17):
select id, merchant, amount_paise, date from transactions
where user_id = $userId and deleted_at is null
  and (lower(merchant) like $like or lower(notes) like $like)
order by date desc limit 8

-- categories query (line 18):
select id, name from categories where user_id = $userId and lower(name) like $like order by name limit 6

-- accounts query (line 19):
select id, name from accounts where user_id = $userId and lower(name) like $like and system_kind is null order by name limit 6

-- goals query (line 20):
select id, name from goals where user_id = $userId and archived_at is null and lower(name) like $like order by name limit 6
```

**Status: NOT CONVERTED.** The transactions branch reads `amount_paise` directly from
`transactions` (legacy column). Needs conversion to a postings join to read
`p.amount_paise` for the display amount. The `id`, `merchant`, `date`, `notes`
columns in `transactions` are not being removed, so only `amount_paise` needs a join.

---

## Summary of Remaining Work for PR-E

| File | Function | Action needed |
|---|---|---|
| `modules/protection/services/insurance.ts` | `listPolicyPremiums` | Convert `amount_paise` / `account_id` reads to postings join |
| `modules/ingest/services/review-queue.ts` | `applyHistoryCategory` | Reads only `merchant`/`categoryId` — both stay on `transactions`; no conversion needed |
| `modules/ingest/services/transfer-classification.ts` | `acceptRepayment` candidate query | Reads `amountPaise`, `accountId`, `isOpening` from legacy `transactions`; needs postings join for amount, `is_opening` still on `transactions` header |
| `modules/ledger/services/search.ts` | `search` | Convert `amount_paise` to postings join |
| `modules/system/services/prefs.ts` | `evaluateLargeTransactions` | Already done — no action |
