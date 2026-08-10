# PR-F Investigation 3

Scope: six questions about the postings migration, the two PR-F targets, and test infrastructure.

---

## Q1 — SPLIT transactions and category

### Q1a — What `setSplits` does to the parent `transactions.category_id`

File: `apps/api/src/modules/ledger/services/transactions.ts:533-566`

```ts
export async function setSplits(
  db: Db,
  userId: string,
  id: string,
  splits: Array<{ categoryId: string; amountPaise: number; note: string }>,
): Promise<Transaction> {
  for (const s of splits) await assertOwnedCategory(db, userId, s.categoryId);
  await db.transaction(async (t) => {
    const parentRows = await t
      .select()
      .from(transactions)
      .where(
        and(eq(transactions.id, id), eq(transactions.userId, userId), isNull(transactions.deletedAt)),
      )
      .for("update");
    const parent = parentRows[0];
    if (!parent) throw new HttpError(404, "Transaction not found");
    const total = sumPaise(splits.map((s) => s.amountPaise));
    if (splits.length > 0 && total !== parent.amountPaise) {
      throw new HttpError(400, `Splits must sum to the transaction amount (${parent.amountPaise})`);
    }
    await t.delete(transactionSplits).where(eq(transactionSplits.transactionId, id));
    if (splits.length > 0) {
      await t.insert(transactionSplits).values(splits.map((s) => ({ ...s, transactionId: id })));
    }
    await rebuildPostingsForTransaction(t, userId, id);
  });
  return getTransaction(db, userId, id);
}
```

**Finding:** `setSplits` does NOT write to `transactions.category_id` at all. The parent row's `category_id` is left exactly as it was before the call — it is UNCONSTRAINED relative to the splits.

There is no DB check constraint on `transactions.category_id` that could enforce parity with splits:

`apps/api/src/db/shared/ledger.ts:43-52`:
```ts
categoryId: uuid("category_id").references(() => categories.id),
/**
 * No check constraint like `categories` has: a transaction carries no `kind`
 * to contradict, and sign alone does not disqualify a row — a refund against
 * an essential purchase is still essential spend being reversed.
 */
```

There is also no service invariant — `setSplits` never sets `category_id = null` or copies `splits[0].categoryId` onto the parent row.

`transactionSplits.categoryId` is `NOT NULL`:
`apps/api/src/modules/ledger/schema.ts:47-49`:
```ts
categoryId: uuid("category_id")
  .notNull()
  .references(() => categories.id),
```

### Q1b — What `buildSplitPostings` emits for categories

File: `apps/api/src/modules/ledger/services/postings.ts:126-161`

```ts
export function buildSplitPostings(input: {
  accountId: string;
  splits: ReadonlyArray<{
    categoryId: string;
    amountPaise: number;
    necessity: ExpenseNecessity | null;
    note: string;
  }>;
  systemExpensesAccountId: string;
  systemIncomeAccountId: string;
}): PostingDraft[] {
  const assetAmount = sumPaise(input.splits.map((s) => s.amountPaise));
  const postings: PostingDraft[] = [
    {
      accountId: input.accountId,
      amountPaise: assetAmount,
      categoryId: null,           // real leg: category always null
      necessity: null,
      note: "",
    },
  ];
  for (const split of input.splits) {
    postings.push({
      accountId:
        split.amountPaise < 0
          ? input.systemExpensesAccountId
          : input.systemIncomeAccountId,
      amountPaise: -split.amountPaise,
      categoryId: split.categoryId,   // each counter leg gets its own split's categoryId
      necessity: split.necessity,
      note: split.note,
    });
  }
  assertZeroSum(postings);
  return postings;
}
```

Exactly one Expenses/Income counter posting per split, each carrying `split.categoryId` (from `transactionSplits.categoryId`).

### Q1c — Does the first counter posting's category equal `t.category_id`?

**DEFINITIVE: NO.**

For a split transaction:
- The first Expenses/Income counter posting's `categoryId` = `transactionSplits[0].categoryId` (the first split's own category)
- `t.category_id` = whatever the parent transaction row held before `setSplits` was called; `setSplits` never modifies it

These two values are independently managed. They could coincidentally equal each other (e.g. if there is only one split and its category was chosen as the same category the parent had), but no invariant enforces this and there is no code path that keeps them in sync.

---

## Q2 — `transactionsCsv` call site

File: `apps/api/src/modules/system/routes/backup.ts:37-43`

```ts
r.get("/api/export/transactions.csv", async (req, reply) => {
  const csv = await transactionsCsv(app.db, req.session!.userId);
  return reply
    .header("content-type", "text/csv; charset=utf-8")
    .header("content-disposition", `attachment; filename="compass-transactions.csv"`)
    .send(csv);
});
```

- **Endpoint:** `GET /api/export/transactions.csv`
- **Content-type:** `text/csv; charset=utf-8`
- **Filename:** `compass-transactions.csv` (via `content-disposition: attachment`)
- **User-facing download only:** yes — reads `req.session!.userId`, returns the authenticated user's own transactions. Not an admin/internal path.

---

## Q3 — Premise check: remaining production readers of legacy columns

### Search methodology

Searched `apps/api/src`, `apps/extractor/src`, `apps/web/src`, `apps/ingestor/src`, `packages/` for:
- SQL forms: `amount_paise`, `account_id` where the table is `transactions`
- Drizzle forms: `transactions.amountPaise`, `transactions.accountId`, `.amountPaise`, `.accountId` where table context is transactions

Classified every hit.

### WRITERS / dual-write (expected to remain until PR-G)

- `apps/api/src/modules/ledger/services/transactions.ts:409-422` — `createTransaction` inserts into both `transactions` (sets `accountId`, `amountPaise`) and `postings` in one transaction.
- `apps/api/src/modules/ledger/services/transactions.ts:492,524,577,622,633,643,650` — `updateTransaction`, `softDeleteTransaction`, `bulkAction` update `transactions` legacy columns.
- Various other `transactions.ts` write functions that use Drizzle `transactions.accountId`, `transactions.amountPaise`, `transactions.categoryId` as field names in `.set({...})` or `.where(...)` contexts — these are writers or filter conditions, not "reading the amount to compute something".

### READERS still on legacy (the critical list)

1. **`apps/api/src/modules/system/services/backup.ts:128-134`** — `transactionsCsv` (PR-F target #1):
   ```sql
   select t.date, t.merchant, t.amount_paise, c.name as category, a.name as account, t.notes
   from transactions t
   left join categories c on c.id = t.category_id
   left join accounts a on a.id = t.account_id
   where t.user_id = ${userId} and t.deleted_at is null
   ```
   Reads `t.amount_paise` and joins via `t.account_id` from `transactions`.

2. **`apps/extractor/src/db.ts:240-255`** — `loadCardLedgerTxns` (PR-F target #2):
   ```ts
   const res = await pool.query<{
     id: string;
     amount_paise: string;
     ...
   }>(
     `select id, amount_paise, to_char(date, 'YYYY-MM-DD') as date,
             to_char(occurred_at, 'YYYY-MM-DD"T"HH24:MI:SSOF') as occurred_at_ts, merchant
        from transactions
       where user_id = $1 and account_id = $2 and deleted_at is null
         and date between $3 and $4`,
   ```
   Reads `amount_paise` and filters by `account_id` from `transactions`.

3. **`apps/api/src/modules/ledger/services/transfers.ts:37-65`** — `suggestTransfers` (NOT a PR-F target):
   ```sql
   select o.id as out_id, i.id as in_id, i.amount_paise as amount, abs(o.date - i.date) as days
   from transactions o
   join transactions i
     on i.user_id = o.user_id
    and i.account_id <> o.account_id
    and i.amount_paise = -o.amount_paise
    and i.amount_paise > 0
    ...
   where o.user_id = ${userId}
     and o.deleted_at is null
     and o.amount_paise < 0
   ```
   Reads `i.amount_paise`, `o.amount_paise`, and `i.account_id` / `o.account_id` from `transactions`. Returns `amountPaise: Number(r.amount)`.

### Tests / fixtures

All hits in `*.test.ts` files that reference `transactions.amountPaise`, `transactions.accountId`, etc. are for inserting test data or assertions against the dual-written value. Not production readers. Examples:
- `postings-balance-parity.test.ts`: uses `createTransaction(...)` for fixtures
- `user-tasks.test.ts`: uses direct `db.insert(transactions).values({...amountPaise...})` (no postings created)

### Unrelated (different table's `account_id`)

- `apps/extractor/src/db.ts:73` — `bank_details bd on bd.account_id = a.id` (bank_details)
- `apps/extractor/src/db.ts:103` — `card_details cd on cd.account_id = a.id` (card_details)
- `apps/extractor/src/db.ts:354,359,366` — `reward_entries.account_id` (reward_entries)
- `apps/api/src/modules/planning/services/bills.ts:94` — `p.amount_paise` from `postings p` (not transactions)
- `apps/api/src/modules/credit/services/cards.ts:343` — `p.amount_paise` from `postings p`
- `apps/api/src/modules/system/services/prefs.ts:93` — `p.amount_paise` from `postings p`
- `apps/api/src/modules/ledger/services/search.ts:13` — `p.amount_paise` from `postings p`
- `apps/api/src/modules/ledger/services/average-balance.ts:221-243` — `po.account_id`, `po.amount_paise` from `postings po`
- `apps/api/src/modules/ledger/services/balances.ts:41-45` — `po.account_id`, `po.amount_paise` from `postings po`
- `apps/api/src/modules/ledger/services/accounts.ts:170-174` — from `postings po`

### Column-agnostic dumpers: `db/restore.ts` and `restore-user.ts`

- `apps/api/src/db/restore.ts:58-94` — `restoreDump`: uses `select * from <table>` (line 93: `await db.execute(sql\`select * from ${sql.identifier(table)}\`)`) to dump all tables generically, then inserts rows via a generic `insertRow` that iterates `Object.entries(row)`. It NEVER names `amount_paise` or `account_id` specifically; it handles all columns uniformly. **Classification: column-agnostic dumper, not a legacy-column reader.**
- `apps/api/src/modules/system/services/restore-user.ts:86-211` — `restoreUserBackup`: similarly iterates `header.tables[table]` and calls `insertRow` generically. Does not name legacy columns. **Classification: column-agnostic dumper.**

### PREMISE VERDICT

**PREMISE FALSE.** After PR-F converts its two targets (`transactionsCsv` and `loadCardLedgerTxns`), one additional production reader remains:

- `apps/api/src/modules/ledger/services/transfers.ts:39-53` (`suggestTransfers`) reads `transactions.amount_paise` and `transactions.account_id` — not covered by PR-F.

---

## Q4 — Characterization-test precedent for poisoned/decoy values

Searched all `*.test.ts` files in `apps/api/src` and `apps/extractor/src` for tests that:
- Set `transactions.amount_paise` to a value deliberately different from the corresponding `postings.amount_paise`
- Use terms like "poisoned", "decoy", "tamper", "different amount", or direct SQL UPDATE to misalign the legacy column from the posting

**No such precedent exists.**

All PR-B..PR-E characterization tests use one of two patterns:
1. `createTransaction(db, userId, {...amountPaise...})` — the real dual-write function, which keeps legacy and postings columns identical by construction. The tests then assert the converted reader returns the expected value.
2. Direct `db.insert(transactions).values({...amountPaise...})` (e.g. in `user-tasks.test.ts`) — which inserts a transaction WITHOUT creating any postings at all (zero-posting case), not a mismatched-value case.

No test deliberately writes, say, `amountPaise: -99999` to the `transactions` row and `amountPaise: -10000` to the posting to prove the reader is using the posting column.

---

## Q5 — Zero-posting handling: LEFT JOIN vs INNER JOIN

### Readers using INNER JOIN (row disappears without a matching posting)

All readers that start `from postings p join accounts a on a.id = p.account_id join transactions t on t.id = p.transaction_id` are effectively inner-joins — a transaction with no postings yields no row:

- `apps/api/src/modules/ledger/services/search.ts:12-24` — `from postings p ... join transactions t`
- `apps/api/src/modules/planning/services/bills.ts:93-109` — `from postings p ... join transactions t`
- `apps/api/src/modules/planning/services/dashboard.ts:68-95` — `from postings p ... join transactions t`
- `apps/api/src/modules/planning/services/cashflow.ts:74-84` — `from postings p ... join transactions t`
- `apps/api/src/modules/planning/services/reports.ts:103-117` — `from postings p ... join transactions t`
- `apps/api/src/modules/planning/services/insights.ts:136-205` — `from postings p ... join transactions t`
- `apps/api/src/modules/automation/services/categorize.ts:51-65` — `from postings p ... join transactions t`
- `apps/api/src/modules/system/services/prefs.ts:93-108` — `from postings p ... join transactions t`
- `apps/api/src/modules/credit/services/cards.ts:330-349` — `from postings p ... join transactions t`
- `apps/api/src/modules/credit/services/reconciliation-reads.ts:130` — `from postings p ... join transactions t`
- `apps/api/src/modules/planning/services/goals.ts:201` — `from postings p`
- `apps/api/src/modules/investments/services/sip-installments.ts:444-454` — `join lateral (select p.amount_paise from postings p ... ) rp on true` (inner lateral; transaction disappears without a matching posting)

### Readers using LEFT JOIN / left join lateral (row survives without a posting)

1. **`apps/api/src/modules/ledger/services/user-tasks.ts:93-104`** — `left join transactions t ... left join lateral (select p.account_id, p.amount_paise from postings p ... where p.transaction_id = t.id and a.system_kind is null ...) rp on t.id is not null`

   A task with a linked transaction that has no non-system postings still appears. `rp.account_id` and `rp.amount_paise` are null in that case.

2. **`apps/api/src/modules/investments/services/sip-installments.ts:297-300`** — in `linkSipInstallment`:
   `left join postings p on p.transaction_id = t.id and p.account_id = ${sip.targetAccountId}`

   If the transaction has no posting for the target account, the row still appears with `p.account_id = null` and `p.amount_paise = null`.

### Explicit test for zero-posting case

`apps/api/src/modules/ledger/services/user-tasks.test.ts:63-79` — `createTxn` inserts directly into `transactions` WITHOUT postings:

```ts
async function createTxn(
  userId: string,
  accountId: string,
  overrides: Partial<{ date: string; amountPaise: number; merchant: string }> = {},
): Promise<string> {
  const [t] = await db
    .insert(transactions)
    .values({
      userId,
      accountId,
      date: overrides.date ?? "2026-01-05",
      amountPaise: overrides.amountPaise ?? -1000,
      merchant: overrides.merchant ?? "Test merchant",
    })
    .returning({ id: transactions.id });
  return t!.id;
}
```

Every test in this file that uses `createTxn` implicitly exercises the zero-posting case (no postings exist for those transactions). The tests pass, proving the `left join lateral` in `user-tasks.ts` returns rows even with no postings.

No PR-B..PR-E test explicitly asserts "this transaction has no postings; verify the reader still returns a row with null amount". The zero-posting behavior is validated implicitly.

---

## Q6 — Test infrastructure for the two target files

### Q6a — `backup.test.ts` DATABASE_URL guard

File: `apps/api/src/modules/system/services/backup.test.ts:333-345`

```ts
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "backup.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
        "this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before " +
        "running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
```

`requireDatabaseUrl()` is called **at module level** (line 345: `const pool = createPool(requireDatabaseUrl())`). If `DATABASE_URL` is unset, it throws during module import, failing ALL tests in the file — including the pure unit tests (schema coverage, ALL_TABLES ordering, etc.) that appear before line 333 and need no DB. There is no `test.skip` or `process.exit` branch; the entire module is unusable without the env var.

### Q6b — `statement-duplicate.test.ts` guard + `createLedgerTxn` fixture

**Guard** (`apps/extractor/src/statement-duplicate.test.ts:27-39`):
```ts
function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "statement-duplicate.test.ts needs DATABASE_URL set (a real Postgres connection) — " +
        "this repo has no DB-mocking infrastructure. Export it (see apps/extractor/.env) before " +
        "running `npm run test -w apps/extractor`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
```

Same pattern: module-level throw if `DATABASE_URL` missing.

**`createLedgerTxn` fixture** (full, `apps/extractor/src/statement-duplicate.test.ts:92-105`):
```ts
async function createLedgerTxn(
  userId: string,
  accountId: string,
  opts: { amountPaise: number; date: string; occurredAtTs: string | null; merchant: string },
): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into transactions
       (user_id, account_id, date, occurred_at, amount_paise, merchant, category_id, notes, tags, source)
     values ($1, $2, $3, $4, $5, $6, null, '', '{}', 'import')
     returning id`,
    [userId, accountId, opts.date, opts.occurredAtTs, opts.amountPaise, opts.merchant],
  );
  return res.rows[0]!.id;
}
```

This inserts directly into `transactions` via raw SQL, explicitly naming `amount_paise` and `account_id`. **It creates NO postings** — the extractor has no Drizzle access and no `seedSystemAccounts` helper. The throwaway user and account are created via raw SQL INSERTs (see `createUser` at line 44-50 and `createAccount` at lines 52-58), also with no system accounts seeded. The `loadCardLedgerTxns` reader queries `transactions` directly by `account_id`, so no system accounts are needed for this test to function.

**Throwaway user creation** (`apps/extractor/src/statement-duplicate.test.ts:44-50`):
```ts
async function createUser(): Promise<string> {
  const res = await pool.query<{ id: string }>(
    `insert into users (email, password_hash, display_name) values ($1, 'x', 'AC9 test user') returning id`,
    [`ac9-test-${randomUUID()}@example.invalid`],
  );
  return res.rows[0]!.id;
}
```

No system accounts are seeded; the extractor has no equivalent of the API's `seedSystemAccounts`.

### Q6c — Commands to run each test file individually

```bash
# backup.test.ts
node --test apps/api/src/modules/system/services/backup.test.ts

# statement-duplicate.test.ts
node --test apps/extractor/src/statement-duplicate.test.ts
```

Both require `DATABASE_URL` exported in the environment (and `backup.test.ts` also requires the result of `createPool` to succeed at module load).

---

## Files inspected

- `apps/api/src/db/shared/ledger.ts`
- `apps/api/src/db/restore.ts`
- `apps/api/src/modules/ledger/schema.ts`
- `apps/api/src/modules/ledger/services/postings.ts`
- `apps/api/src/modules/ledger/services/transactions.ts`
- `apps/api/src/modules/ledger/services/transfers.ts`
- `apps/api/src/modules/ledger/services/user-tasks.ts`
- `apps/api/src/modules/ledger/services/user-tasks.test.ts`
- `apps/api/src/modules/ledger/services/search.ts`
- `apps/api/src/modules/ledger/services/balances.ts`
- `apps/api/src/modules/ledger/services/average-balance.ts`
- `apps/api/src/modules/ledger/services/postings-balance-parity.test.ts`
- `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`
- `apps/api/src/modules/system/services/backup.ts`
- `apps/api/src/modules/system/services/backup.test.ts`
- `apps/api/src/modules/system/services/restore-user.ts`
- `apps/api/src/modules/system/routes/backup.ts`
- `apps/api/src/modules/planning/services/bills.ts`
- `apps/api/src/modules/planning/services/postings-planning-parity.test.ts`
- `apps/api/src/modules/credit/services/cards.ts`
- `apps/api/src/modules/system/services/prefs.ts`
- `apps/api/src/modules/investments/services/sip-installments.ts`
- `apps/api/src/modules/automation/services/categorize.ts`
- `apps/extractor/src/db.ts`
- `apps/extractor/src/db.test.ts`
- `apps/extractor/src/statement-duplicate.test.ts`

## Files changed

None. This is a read-only investigation.
