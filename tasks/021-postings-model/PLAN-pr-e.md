# PLAN-pr-e — Postings readers: credit / investments / automation / ingest / search / user-tasks / insurance

## Status
APPROVED (review-30, review-31, review-32 — all blocking findings resolved)

## Objective
Convert all remaining aggregate and per-row reader functions that still read `transactions.amount_paise`, `transactions.account_id`, or `transactions.is_opening` directly. Each converted reader uses the `postings` table as its money source. After PR-E every remaining legacy column read in these files is gone; PR-G can later drop those columns without breaking them.

## Scope (9 source files + 1 new parity test)

| File | Functions to convert |
|---|---|
| `modules/credit/services/cards.ts` | `listCardHolders` (aggregate SQL), `getCardActivity` (aggregate SQL + per-row Drizzle fetch) |
| `modules/credit/services/emis.ts` | `upsertEmiDetails` (existence check filter), `listEmiInstallments` (row fetch + filter) |
| `modules/credit/services/reconciliation-reads.ts` | `ledgerDuesAtDates` (aggregate SQL) |
| `modules/investments/services/sip-installments.ts` | `linkSipInstallment` (validation fetch), `unlinkedInstallmentRows` (filter query), `linkedInstallmentRows` (display fetch) |
| `modules/automation/services/categorize.ts` | `suggestCategoriesFor` (display amount in AI prompt) |
| `modules/ledger/services/user-tasks.ts` | `taskQuery` (per-row linked-transaction display) |
| `modules/ledger/services/search.ts` | `search` (display amount in results) |
| `modules/ingest/services/imports.ts` | `applyMapping` dedup hash read, `commitImport` CC reconciliation window read |
| `modules/protection/services/insurance.ts` | `listPolicyPremiums` (per-row display) |
| NEW: `modules/ledger/services/postings-pr-e-parity.test.ts` | Full parity proof for all 9 files |

**No changes to:** `networth.ts` (delegates to already-converted `accountBalancesAtDate`), `tools.ts` (delegates to already-converted services), `prefs.ts` (converted in PR-D), `transfer-classification.ts` (write-path, not a reader).

## Already-established conversion patterns (from PR-B/C/D)

Every reader that moves to postings follows one of three patterns, all proven in the existing parity tests:

**Pattern A — Account-scoped balance aggregate:**
```sql
SELECT coalesce(sum(p.amount_paise), 0)::bigint AS total
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
WHERE p.account_id = $accountId
  AND t.user_id = $userId AND t.deleted_at IS NULL AND t.date <= $asOf
```
Note: `opening_balance_paise` remains an explicit addend (Q3 — no opening posting exists for card/loan/investment accounts during dual-write).

**Pattern B — Real-posting per-row (D20 semantics):**
```sql
SELECT t.id, t.date, t.merchant, rp.amount_paise, rp.account_id
FROM postings rp
JOIN accounts a ON a.id = rp.account_id
JOIN transactions t ON t.id = rp.transaction_id
WHERE a.system_kind IS NULL          -- exclude system accounts
  AND ...                            -- optional: NOT EXISTS (clearing/opening)
```

**Pattern C — Transfer/opening exclusion:**
```sql
AND NOT EXISTS (
  SELECT 1 FROM postings p2
  JOIN accounts a2 ON a2.id = p2.account_id
  WHERE p2.transaction_id = t.id
    AND a2.system_kind IN ('clearing', 'opening')
)
```

## Per-file conversion plan

### PE1 — `cards.ts`

**`listCardHolders` (lines ~229–236) and `getCardActivity` (lines ~322–328) — aggregate queries:**

Replace `SUM(amount_paise) FROM transactions WHERE account_id = $acc.id ...`:

```sql
SELECT
  coalesce(sum(p.amount_paise), 0)::bigint AS total,
  coalesce(sum(p.amount_paise) FILTER (WHERE t.date < $billedBefore), 0)::bigint AS at_close,
  coalesce(sum(p.amount_paise) FILTER (WHERE p.amount_paise < 0 AND t.date >= $billedBefore), 0)::bigint AS current_spend
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
WHERE p.account_id = $acc.id
  AND t.user_id = $userId AND t.deleted_at IS NULL AND t.date <= $ref
```

`acc.openingBalancePaise` addend retained (card accounts have no opening posting during dual-write — Q3). Range-checked with `Number.isSafeInteger` before use.

**`getCardActivity` per-row fetch (lines ~334–351) — switch Drizzle findMany to raw SQL:**

Replace `db.query.transactions.findMany({ columns: { amountPaise, categoryId, ... } })` with:

```sql
SELECT t.id, t.date, t.merchant, t.reconciled_statement_id, t.category_id, p.amount_paise
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
WHERE p.account_id = $accountId
  AND t.user_id = $userId AND t.deleted_at IS NULL
  AND t.date >= $fromInclusive AND t.date <= $ref
ORDER BY t.date DESC, t.id DESC
```

`category_id` still on the transactions header (correct for dual-write; removed at PR-G). The real posting is the one on the card account (`p.account_id = $accountId`). No explicit transfer/opening exclusion needed here — the filter is per-account, matching only this card's postings.

### PE2 — `emis.ts`

**`upsertEmiDetails` existence check (lines ~374–386):**

Replace `lt(transactions.amountPaise, 0)` + `eq(transactions.accountId, template.accountId)` with a JOIN to `postings` filtered on the same account and sign:

```typescript
const history = await trx
  .select({ id: transactions.id })
  .from(transactions)
  .innerJoin(
    postings,
    and(
      eq(postings.transactionId, transactions.id),
      eq(postings.accountId, template.accountId),
      lt(postings.amountPaise, 0),
    ),
  )
  .where(
    and(
      eq(transactions.recurringTemplateId, templateId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
  )
  .limit(1);
```

Remove `eq(transactions.accountId, template.accountId)` from the WHERE (moved to JOIN). Import `postings` from `"../../../db/schema.ts"`.

**`listEmiInstallments` (lines ~471–488):**

Same join: remove `eq(transactions.accountId, template.accountId)` + `lt(transactions.amountPaise, 0)` from WHERE; move both to INNER JOIN on postings; select `amountPaise: postings.amountPaise` from the posting (not the transaction). The `gte(transactions.date, d.startDate)` stays in WHERE.

```typescript
const rows = await db
  .select({
    id: transactions.id,
    date: transactions.date,
    amountPaise: postings.amountPaise,
  })
  .from(transactions)
  .innerJoin(
    postings,
    and(
      eq(postings.transactionId, transactions.id),
      eq(postings.accountId, template.accountId),
      lt(postings.amountPaise, 0),
    ),
  )
  .where(
    and(
      eq(transactions.recurringTemplateId, templateId),
      eq(transactions.userId, userId),
      gte(transactions.date, d.startDate),
      isNull(transactions.deletedAt),
    ),
  )
  .orderBy(asc(transactions.date), asc(transactions.createdAt), asc(transactions.id))
  .limit(2000);
```

### PE3 — `reconciliation-reads.ts`

**`ledgerDuesAtDates` (lines ~124–134):**

Replace the raw SQL that reads `SUM(t.amount_paise) FROM transactions WHERE account_id = $accountId`:

```sql
SELECT ds.stmt_date::text AS stmt_date,
  coalesce(sum(sub.amount_paise), 0)::bigint AS sum_paise
FROM unnest(array[$dateList]) AS ds(stmt_date)
LEFT JOIN (
  SELECT p.amount_paise, t.date
  FROM postings p
  JOIN transactions t ON t.id = p.transaction_id
  WHERE p.account_id = $accountId
    AND t.user_id = $userId
    AND t.deleted_at IS NULL
) sub ON sub.date < ds.stmt_date
GROUP BY ds.stmt_date
```

The subquery pre-filters to this card's postings; the outer LEFT JOIN applies the per-statement-date `< stmt_date` cutoff. The `openingBalancePaise` addend in `ledgerDuePaise = -(openingBalancePaise + sum)` is unchanged.

### PE4 — `sip-installments.ts`

**`linkSipInstallment` validation fetch (lines ~288–300):**

The current query reads `transactions.accountId`, `transactions.amountPaise`, `transactions.isOpening` to feed `linkInstallmentIssue`. Replace with a raw SQL query that joins to postings:

```sql
SELECT t.id, t.date, t.sip_id, t.deleted_at,
  p.account_id,
  p.amount_paise,
  EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind = 'opening'
  )::boolean AS is_opening
FROM transactions t
LEFT JOIN postings p ON p.transaction_id = t.id
  AND p.account_id = $sipTargetAccountId
WHERE t.id = $transactionId AND t.user_id = $userId
FOR UPDATE OF t
```

Then build a `ledgerTx` shape that matches the `linkInstallmentIssue` parameter:
```typescript
{
  accountId: row.account_id ?? "",      // null if posting not on target account → fails the accountId check
  amountPaise: Number(row.amount_paise ?? 0),
  date: row.date,
  isOpening: row.is_opening,
  sipId: row.sip_id,
}
```

`linkInstallmentIssue` already guards `tx.accountId !== sip.targetAccountId` so a null `account_id` (no posting on that account) correctly rejects the link.

**`unlinkedInstallmentRows` (lines ~443–471):**

Replace `eq(transactions.accountId, accountId)`, `eq(transactions.isOpening, false)`, `gt(transactions.amountPaise, 0)` with postings-based equivalents:

```typescript
return db
  .select({
    id: transactions.id,
    date: transactions.date,
    amountPaise: postings.amountPaise,
    merchant: transactions.merchant,
    notes: transactions.notes,
  })
  .from(transactions)
  .innerJoin(
    postings,
    and(
      eq(postings.transactionId, transactions.id),
      eq(postings.accountId, accountId),   // replaces transactions.accountId filter
      gt(postings.amountPaise, 0),         // replaces transactions.amountPaise > 0
    ),
  )
  .where(
    and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      isNull(transactions.sipId),
      // isOpening filter: exclude transactions that have an Opening posting
      sql`NOT EXISTS (
        SELECT 1 FROM postings p2
        JOIN accounts a2 ON a2.id = p2.account_id
        WHERE p2.transaction_id = ${transactions.id} AND a2.system_kind = 'opening'
      )`,
      gte(transactions.date, bounds.from),
      lte(transactions.date, bounds.to),
    ),
  )
  .orderBy(desc(transactions.date), desc(transactions.createdAt))
  .limit(INSTALLMENT_CANDIDATE_LIMIT);
```

**`linkedInstallmentRows` (lines ~417–433):**

`linkedInstallmentRows` must return ALL currently-linked transactions regardless of whether they still satisfy eligibility rules — linked rows are shown purely so the user can detach them (code comment at line ~400: "linked rows are exempt from the asOf window and the eligibility filters"). An INNER JOIN on `postings.accountId = targetAccountId` would silently drop a linked transaction if it was later edited to a different account, losing the user's ability to detach it.

Fix: join to ANY real posting using a LATERAL subquery with deterministic `ORDER BY p.id`. No `targetAccountId` parameter. Implemented as `db.execute(sql`...`)` since Drizzle has no LATERAL join API:

```sql
SELECT t.id, t.date, t.merchant, t.notes, rp.amount_paise
FROM transactions t
JOIN LATERAL (
  SELECT p.amount_paise
  FROM postings p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.transaction_id = t.id AND a.system_kind IS NULL
  ORDER BY p.id
  LIMIT 1
) rp ON true
WHERE t.user_id = $userId AND t.sip_id = $sipId AND t.deleted_at IS NULL
ORDER BY t.date DESC, t.created_at DESC
LIMIT $INSTALLMENT_CANDIDATE_LIMIT
```

The `rp.amount_paise` bigint column comes back from node-postgres as a string; cast to `Number()` with a `Number.isSafeInteger` guard before returning. Signature unchanged (no new parameter).

### PE5 — `categorize.ts`

**`suggestCategoriesFor` (lines ~50–57):**

Replace raw SQL that reads `amount_paise` from transactions with a postings join. Use Pattern B with transfer/opening exclusion (Pattern C), since uncategorized transfers must not appear in the AI prompt:

```sql
SELECT t.id, t.merchant, t.notes, p.amount_paise
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId AND t.deleted_at IS NULL AND t.category_id IS NULL
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind IN ('clearing', 'opening')
  )
  [$restrict filter]
ORDER BY t.date DESC
LIMIT 200
```

Note: `t.category_id IS NULL` on the header is correct — headers with no category need AI suggestions. `a.system_kind IS NULL` ensures exactly one real posting per ordinary/split transaction.

### PE6 — `user-tasks.ts`

**`taskQuery` (lines ~78–96):**

Two independent correlated subqueries with `LIMIT 1` would pick their row independently and could produce a mismatched `(account_id, amount_paise)` pair if a transaction ever has more than one real posting. Fix: use **one single correlated subquery** selecting both `account_id` and `amount_paise` from the same row, then project those columns via `sql` aliases. Use `ORDER BY p.id` for determinism (always picks the lowest posting ID — the first written).

Implementation: switch `taskQuery` to `db.execute(sql`...`)` (raw SQL) to use a LATERAL join naturally. Drizzle ORM has no LATERAL join API, and two independent correlated subqueries don't guarantee the same row.

```sql
SELECT
  ut.id, ut.user_id, ut.title, ut.notes, ut.due_date,
  ut.completed_at, ut.transaction_id, ut.source, ut.source_key,
  ut.created_at, ut.updated_at,
  t.id AS txn_id, t.date AS txn_date, t.merchant AS txn_merchant,
  rp.account_id AS txn_account_id,
  rp.amount_paise AS txn_amount_paise
FROM user_tasks ut
LEFT JOIN transactions t
  ON t.id = ut.transaction_id
  AND t.user_id = ut.user_id
  AND t.deleted_at IS NULL
LEFT JOIN LATERAL (
  SELECT p.account_id, p.amount_paise
  FROM postings p
  JOIN accounts a ON a.id = p.account_id
  WHERE p.transaction_id = t.id AND a.system_kind IS NULL
  ORDER BY p.id
  LIMIT 1
) rp ON t.id IS NOT NULL
WHERE ut.user_id = $userId
ORDER BY (ut.completed_at IS NOT NULL) ASC,
         ut.due_date ASC NULLS LAST,
         ut.created_at DESC, ut.id ASC
```

Replace the Drizzle query builder with a `db.execute(sql`...`)` call returning raw rows, and update `toUserTask` to:
- Take a raw-SQL result row type (snake_case fields)
- Cast `txn_amount_paise` from raw bigint string via `Number()` with a `Number.isSafeInteger` guard (raw SQL bigint → string in node-postgres)
- Handle `txn_id IS NULL` → `transaction: null`

No Drizzle `accounts` import needed (the LATERAL join uses the table name as string, not the Drizzle symbol). `listUserTasks` and `getUserTask` both need their own `db.execute` calls with the appropriate WHERE fragment (`ut.user_id = $userId` vs `ut.id = $id AND ut.user_id = $userId`).

Update `TaskJoinRow` type: change to a raw-row interface with snake_case fields (or rename to match the execute output). `toUserTask` function signature changes accordingly.

### PE7 — `search.ts`

**`search` (lines ~12–17):**

Replace raw SQL `SELECT id, merchant, amount_paise, date FROM transactions` with a postings-joined query:

```sql
SELECT t.id, t.merchant, p.amount_paise, t.date
FROM postings p
JOIN accounts a ON a.id = p.account_id
JOIN transactions t ON t.id = p.transaction_id
WHERE t.user_id = $userId AND t.deleted_at IS NULL
  AND a.system_kind IS NULL
  AND NOT EXISTS (
    SELECT 1 FROM postings p2
    JOIN accounts a2 ON a2.id = p2.account_id
    WHERE p2.transaction_id = t.id AND a2.system_kind IN ('clearing', 'opening')
  )
  AND (lower(t.merchant) LIKE $like OR lower(t.notes) LIKE $like)
ORDER BY t.date DESC LIMIT 8
```

Transfer and opening exclusion added: without it, a transfer would return TWO real-posting rows (one per account), doubling results; opening rows are reconciliation seeds unlikely to match merchant searches.

### PE8 — `imports.ts`

**`applyMapping` dedup read (lines ~358–374):**

Replace `db.select({ amountPaise: transactions.amountPaise, ... }) WHERE account_id = batch.accountId` with a postings join:

```typescript
const existing = await db
  .select({
    date: transactions.date,
    amountPaise: postings.amountPaise,
    merchant: transactions.merchant,
  })
  .from(transactions)
  .innerJoin(
    postings,
    and(
      eq(postings.transactionId, transactions.id),
      eq(postings.accountId, batch.accountId),   // real posting on import account
    ),
  )
  .where(
    and(
      eq(transactions.userId, userId),
      gte(transactions.date, minDate),
      lte(transactions.date, maxDate),
    ),
  );
```

Remove `eq(transactions.accountId, batch.accountId)` from WHERE (now in JOIN). Import `postings` from schema.

**`commitImport` CC reconciliation read (lines ~617–636):**

Same pattern — convert only the SELECT; the subsequent UPDATE (lines ~642–658) uses `eq(transactions.accountId, batch.accountId)` as a write-path safety guard, which is **out of PR-E scope** (it's a write guard, not a reader). That guard will be addressed in PR-G prep when legacy columns are dropped:

```typescript
existing = await t
  .select({
    id: transactions.id,
    date: transactions.date,
    amountPaise: postings.amountPaise,
    merchant: transactions.merchant,
    notes: transactions.notes,
    source: transactions.source,
  })
  .from(transactions)
  .innerJoin(
    postings,
    and(
      eq(postings.transactionId, transactions.id),
      eq(postings.accountId, batch.accountId),
    ),
  )
  .where(
    and(
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
      gte(transactions.date, shift(dates[0]!, -3)),
      lte(transactions.date, shift(dates.at(-1)!, 3)),
    ),
  )
  .orderBy(transactions.date, transactions.id);
```

The `reconciledFrom` snapshot stored in `importRows.reconciledFrom` (line ~664) persists `before.amountPaise` (legacy value) for rollback — that's a write path, also out of PR-E scope.

### PE9 — `insurance.ts`

**`listPolicyPremiums` (lines ~290–307):**

Replace `db.query.transactions.findMany` (which reads `amountPaise`, `accountId` from header) with a Drizzle select joining to postings for real-account amount:

```typescript
const rows = await db
  .select({
    id: transactions.id,
    date: transactions.date,
    amountPaise: postings.amountPaise,
    merchant: transactions.merchant,
    accountId: postings.accountId,
    note: transactions.notes,
  })
  .from(transactions)
  .innerJoin(postings, eq(postings.transactionId, transactions.id))
  .innerJoin(accounts, and(eq(accounts.id, postings.accountId), isNull(accounts.systemKind)))
  .where(
    and(
      eq(transactions.policyId, policyId),
      eq(transactions.userId, userId),
      isNull(transactions.deletedAt),
    ),
  )
  .orderBy(desc(transactions.date), desc(transactions.id));

const items = rows.map((r) => ({
  id: r.id,
  date: r.date,
  amountPaise: r.amountPaise,
  merchant: r.merchant,
  accountId: r.accountId,
  note: r.note,
}));
const totalPaise = items.reduce((s, i) => s + Math.abs(i.amountPaise), 0);
return { items, totalPaise, count: items.length };
```

Import `accounts` and `postings` from `"../../../db/schema.ts"`.

## New file: `postings-pr-e-parity.test.ts`

Location: `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`

Structure mirrors `postings-planning-parity.test.ts`:
- Skip if `DATABASE_URL` not set
- `createUser()` + `cleanupUser()` helpers
- `seedSystemAccounts()` for each test user
- Seed via REAL writers so dual-write postings are automatically created
- Assert `findInconsistentPostings` returns empty

### Parity assertions

**PE1 (cards):** Seed one card account (CREDIT type) with opening balance. Seed:
- Two ordinary expense transactions (different amounts)
- One split transaction (two Expenses counter postings, total matches the header amount)
- One transfer-payment transaction

`listCardHolders`: assert balance = `opening_balance_paise + postings_sum` (verified against legacy `SUM(amount_paise)`). Assert `currentSpendPaise` correct (negative postings only since billedBefore). `getCardActivity`: assert activity rows list includes the split transaction with its REAL posting amount (not a split sub-amount), and excludes no row type.

**PE2 (emis):** Seed a recurring EMI template + 3 installment transactions linked to the source account (all negative postings). `listEmiInstallments` must return exactly 3 rows; the `amountPaise` on each must equal the real posting amount. Assert the existence check in `upsertEmiDetails` fires (> 0 history rows) when installments exist.

**PE3 (reconciliation):** Seed a card account (with opening balance) + transactions across 3 statement dates. `ledgerDuesAtDates(dates=[d1, d2])` must equal `-(opening + SUM(amount_paise WHERE date < di))` for each `di`, verified against the legacy column sum.

**PE4 (sip-installments):** Seed an account-target SIP + target account. Seed:
- 2 positive credit transactions into the target account (linkable)
- 1 opening-balance transaction for the target account (must be excluded from `unlinkedInstallmentRows`)

Assertions:
- `unlinkedInstallmentRows` count = 2 (not 3)
- Link one via `linkSipInstallment`; assert `linkedInstallmentRows` returns 1 row with the correct real posting amount
- Assert `linkSipInstallment` rejects the opening transaction with a 400

**PE5 (categorize):** Seed:
- 1 ordinary uncategorized transaction (amount = -500 paise)
- 1 split uncategorized transaction (3 splits totalling -1500 paise header)
- 1 transfer transaction with no category (must be excluded)
- 1 categorized ordinary transaction (must be excluded)

`suggestCategoriesFor(undefined)`: result rows = 2 (ordinary + split). Assert the split row's `amountPaise` = the real posting amount (-1500), not a split sub-amount. Assert the transfer row is absent.

**PE6 (user-tasks):** Seed a task linked to an ordinary transaction (amount = -800 paise). `listUserTasks` must return `task.transaction.amountPaise = -800` and `task.transaction.accountId` = the real posting's account. Also seed a task with no linked transaction and verify `transaction: null`.

**PE7 (search):** Seed:
- 1 ordinary transaction with merchant "TestMerchant" (amount = -600)
- 1 transfer transaction with merchant "TestMerchant" (must be absent — excluded by Pattern C)

`search(q="testmerchant")`: result count = 1; the result's `amountPaise = -600` (real posting amount).

**PE8 (imports):** Two sub-tests:
- **applyMapping dedup**: Seed 2 existing transactions for the import account in the date range. Call `applyMapping` with staged rows overlapping 1 of those transactions. Assert the dedup hash set built from postings equals the hash set from legacy `account_id`-filtered query.
- **commitImport reconciliation**: Seed a credit-card account with 2 existing transactions. Commit an import batch with matching statement rows (dates ±3 days). Assert the `reconcileStatementTransactions` plan correctly identifies the existing rows by reading their real posting amounts, not `transactions.amountPaise`.

**PE9 (insurance):** Seed a policy + 2 premium transactions (amounts -1000 and -2500 paise). `listPolicyPremiums.totalPaise` = 3500 (sum of abs values). Per-item `amountPaise` values must match real posting amounts.

## Acceptance criteria

- AC-PE1: `listCardHolders` and `getCardActivity` aggregate from postings; balance = postings_sum + opening_balance_paise; no read of `transactions.amount_paise` in aggregate queries.
- AC-PE2: `listEmiInstallments` rows and amounts match legacy filter; `upsertEmiDetails` existence check fires correctly based on real postings.
- AC-PE3: `ledgerDuesAtDates` sums match `-(opening + legacy_sum)` for all statement dates.
- AC-PE4: `unlinkedInstallmentRows` excludes opening transactions via NOT EXISTS check; `linkedInstallmentRows` returns posting amounts; `linkSipInstallment` accepts credits and rejects opening rows.
- AC-PE5: `suggestCategoriesFor` excludes transfers and opening rows; shows real posting amount for ordinary and split transactions.
- AC-PE6: `listUserTasks` returns real posting `accountId` and `amountPaise` for the linked transaction.
- AC-PE7: `search` returns one result row per transaction (no duplicate for transfers); amounts from real postings.
- AC-PE8: `applyMapping` dedup hash set identical to legacy `account_id`-filtered query; `commitImport` window read uses posting amounts.
- AC-PE9: `listPolicyPremiums` total = sum of abs(real posting amounts); per-item amounts from real postings.
- AC-PE10: `findInconsistentPostings` empty on all test data.
- AC-PE11: typecheck (`npm run typecheck`), lint (`npm run lint`), test (`npm run test -w apps/api`) all exit 0.

## Non-goals
- Changing any WRITE path (that's done in PR-A).
- Converting `transactions.ts` `hydrate()` (that's PR-G scope).
- Dropping legacy columns (PR-G).
- Changing the `networth.ts`, `tools.ts`, `prefs.ts`, `transfer-classification.ts` files (already clean or write-path).
- Converting extractor DB reads (PR-F scope).
- Any web changes.
