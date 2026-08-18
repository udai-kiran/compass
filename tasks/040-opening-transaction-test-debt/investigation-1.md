# Investigation: Opening-Transaction Test Debt

Date: 2026-08-15
Investigator: worker (claude-sonnet-4-6)

---

## 1. `openingTxnPaise` aggregate — exact code and line numbers

File: `apps/api/src/modules/ledger/services/accounts.ts`, line 198.

```sql
coalesce(
  sum(postings.amountPaise)
  filter (where
    exists (
      select 1
      from postings p2
      join accounts a2 on a2.id = p2.account_id
      where p2.transaction_id = transactions.id
        and a2.system_kind = 'opening'
    )
    and transactions.deletedAt is null
    and transactions.userId = ${userId}
  ),
  0
)::bigint
```

Detection mechanism: a transaction is considered "opening" if **any** of its
postings lands on an account whose `system_kind = 'opening'`. The aggregate
sums up the `amountPaise` of *all* postings on the queried real account that
belong to such transactions (not just the opening-system-account leg). The
filter also excludes soft-deleted transactions and enforces `userId` scoping.

The Drizzle call is a `leftJoin(postings …) leftJoin(transactions …)` so
zero-activity accounts are not collapsed; the result is named
`openingTransactionPaise` and returned on every `AccountWithBalance` object
(line 224).

---

## 2. `planOpeningBalanceChange` and `updateAccount` — how opening balance is written

### `carriesOpeningAsTransaction` (line 22–24)

```ts
function carriesOpeningAsTransaction(_type: AccountType): boolean {
  return true;
}
```

Post-PR-G2 **all** account types carry the opening balance as a ledger
transaction (column is always 0). The type parameter is kept for interface
stability but is unused.

### `planOpeningBalanceChange` (lines 80–115)

Pure, DB-free. Accepts `{ type, requestedPaise, existing, earliestTxnDate, today }`.
Returns `OpeningBalancePlan { columnPaise: number; txn: OpeningBalanceTxnAction }`.

Decision tree:
- If type no longer carries opening as transaction → `columnPaise = requestedPaise`, delete any `existing` row (unreachable today because `carriesOpeningAsTransaction` always returns `true`).
- If `requestedPaise === 0` → `columnPaise = 0`, delete any `existing` row.
- If `existing` row present → `columnPaise = 0`, update its `amountPaise` if changed, otherwise `none`.
- No existing row → `columnPaise = 0`, insert dated `dayBefore(earliestTxnDate)` or `today`.

### `updateAccount` — SQL to locate the existing opening row (lines 458–471)

```sql
select t.id, p.amount_paise
from transactions t
join postings p on p.transaction_id = t.id and p.account_id = ${id}
where t.user_id = ${userId}
  and t.deleted_at is null
  and exists (
    select 1 from postings p_sys
    join accounts a_sys on a_sys.id = p_sys.account_id
              and a_sys.system_kind = 'opening'
    where p_sys.transaction_id = t.id
  )
order by t.date asc, t.id asc
limit 1
```

If more than one opening row exists, `LIMIT 1 ORDER BY date ASC` picks the
earliest. The others are silently ignored (see "invariant enforcement" below).

After calling `planOpeningBalanceChange`, `updateAccount` executes insert /
`postTransaction` (with `buildOpeningPostings`) / soft-delete as the plan
dictates (lines 501–545).

---

## 3. Test scaffolding in `epf-contributions.test.ts`

File: `apps/api/src/modules/ledger/services/epf-contributions.test.ts` (611 lines)

### Infrastructure

| Symbol | What it does |
|---|---|
| `createPool(requireDatabaseUrl())` | pg pool from env var `DATABASE_URL`; fails fast if unset |
| `createDb(pool)` | Drizzle handle; module-level `db` constant |
| `after(async () => pool.end())` | closes pool after all tests |

### Helper functions

| Function | Signature / behaviour |
|---|---|
| `createUser()` | Inserts a `users` row with unique email (`epf-contributions-test-${randomUUID()}@example.invalid`), password `"x"`. Returns `userId`. |
| `createAccount(userId, type, openingBalancePaise=0)` | **Direct DB insert** into `accounts`; does NOT call the service layer, does NOT seed system accounts, does NOT create an opening transaction. Returns `accountId`. |
| `archiveAccount(accountId)` | Sets `archivedAt = new Date()`. |
| `cleanupUser(userId)` | Cascading delete: `transactions` → `accounts` → `categories` → `users` for that user. Used in `t.after()`. |
| `transactionsFor(userId, accountId)` | SELECT from `transactions` INNER JOIN `postings` filtered to one account; returns `{id, date, source, tags, merchant, amountPaise, categoryId}[]`. |
| `allTransactionsFor(userId)` | All non-soft-deleted transactions for the user. |
| `todayIso()` | `new Date().toISOString().slice(0, 10)`. |

### What is and is not present

- **Present**: DB handle, user factory, bare account factory, cleanup, query helpers.
- **Absent**: no `resolveSystemAccounts` call anywhere in the scaffolding; no
  `buildOpeningPostings`/`postTransaction` import; no opening-transaction
  factory helper. A test that needs an opening transaction must import and call
  these itself.

### Where new tests would fit

Tests are grouped by numbered comment blocks (`// ---------- 1: … ----------`
through `// ---------- 8: … ----------`). New opening-transaction behaviour
tests would naturally form a new numbered section after `// ---------- 8`.
The pattern is: `createUser()` + `t.after(() => cleanupUser(userId))` +
`createAccount(…)` + service call under test + assertions.

---

## 4. How to create an opening posting in a test

`buildOpeningPostings` (in `postings.ts`, lines 201–223) requires:

```ts
export function buildOpeningPostings(input: {
  accountId: string;       // real account being opened
  amountPaise: number;     // opening balance (positive = debit side)
  systemOpeningAccountId: string; // account with system_kind = 'opening'
}): PostingDraft[]
```

It returns exactly two `PostingDraft` entries that sum to zero:
`+amountPaise` on `accountId`, `-amountPaise` on `systemOpeningAccountId`.

A test that needs an opening posting must:

1. Call `resolveSystemAccounts(db, userId)` — this auto-seeds the four system
   accounts (expenses/income/opening/clearing) if absent. Returns
   `{ opening: string, … }`.
2. Insert a transaction header via `db.insert(transactions).values({…}).returning()`.
3. Call `postTransaction(db, txnId, userId, buildOpeningPostings({accountId, amountPaise, systemOpeningAccountId: sys.opening}))`.

Alternatively, call `createAccount` from the **service layer**
(`accounts.ts`, not the test helper) with a non-zero `openingBalancePaise`,
which runs the full flow including system-account seeding and posting creation.

Note: the `createAccount` helper in `epf-contributions.test.ts` (line 52) is a
bare DB insert — it intentionally bypasses the service to stay minimal. New
opening-transaction tests must either use the service-layer `createAccount` or
manually perform the three steps above.

---

## 5. "At most one active opening transaction" invariant — enforcement status

**Not enforced** at the database level (no unique index).

At the application level, `updateAccount` (lines 458–471) uses `LIMIT 1 ORDER
BY date ASC` when locating the existing opening row. The comment at line 456 is:

> "Ordered so that if more than one ever exists, the earliest is deterministic."

This is an acknowledgement that duplicates *can* exist; the code picks one and
leaves others in place. There is no assertion, no error, no cleanup of extras.

The `listAccounts` aggregate (line 198) would sum all matching postings across
**all** opening transactions for the account, so duplicate opening rows would
silently inflate `openingTransactionPaise`. This is a known risk with no guard.

No constraint, trigger, or application code prevents concurrent or sequential
creation of two opening transactions for the same account.

---

## 6. Referenced files

- `apps/api/src/modules/ledger/services/accounts.ts` — lines 22–24, 80–115, 198, 448–549
- `apps/api/src/modules/ledger/services/postings.ts` — lines 16, 201–224
- `apps/api/src/modules/ledger/services/post-entry.ts` — lines 49–82 (`replacePostings`), 92–103 (`postTransaction`), 194–250 (`seedSystemAccounts`, `resolveSystemAccounts`)
- `apps/api/src/modules/ledger/services/epf-contributions.test.ts` — full file (611 lines)
