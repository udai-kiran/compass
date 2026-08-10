# Sonnet Worker Delegation — PR-E reader conversions

## Task
021-postings-model PR-E: convert 9 remaining reader files from legacy `transactions.amount_paise` / `transactions.account_id` / `transactions.is_opening` to postings-based queries.

## Approved Plan
Full plan in `tasks/021-postings-model/PLAN-pr-e.md` (status: APPROVED). Codex reviews: review-30, review-31, review-32 — all blocking findings resolved.

## Context
- Dual-write phase: `postings` table is fully populated by all writers (PR-A). Legacy columns (`transactions.amount_paise`, `transactions.account_id`, etc.) still exist on the header but are NOT to be read by these reader files after PR-E.
- System accounts have `accounts.system_kind IN ('expenses', 'income', 'opening', 'clearing')`. Real accounts have `system_kind IS NULL`.
- Opening balance for card/loan/investment accounts stays in `accounts.opening_balance_paise` (no posting) during dual-write — keep the addend.
- Existing converted pattern reference: `apps/api/src/modules/system/services/prefs.ts` (evaluateLargeTransactions) and `apps/api/src/modules/ledger/services/balances.ts`.
- Import `postings` from `"../../../db/schema.ts"` or the module's own `"../schema.ts"` — check which the file uses. Same for `accounts`.

## Files and Symbols

### PE1 — `apps/api/src/modules/credit/services/cards.ts`
**Functions:** `listCardHolders` (~line 229), `getCardActivity` (~line 305)

Changes:
1. `listCardHolders` aggregate SQL (lines ~229–236): Replace `SUM(amount_paise) FROM transactions WHERE account_id = acc.id ...` with:
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
Keep `acc.openingBalancePaise` addend: `balance = acc.openingBalancePaise + Number(row.total)`.
Range-check all Number() casts with Number.isSafeInteger.

2. Same aggregate pattern in `getCardActivity` (lines ~322–328) for the headline totals.

3. `getCardActivity` per-row fetch (lines ~334–351): Replace Drizzle `findMany({ columns: { amountPaise, categoryId, ... } })` with raw SQL:
```sql
SELECT t.id, t.date, t.merchant, t.reconciled_statement_id, t.category_id, p.amount_paise
FROM postings p
JOIN transactions t ON t.id = p.transaction_id
WHERE p.account_id = $accountId
  AND t.user_id = $userId AND t.deleted_at IS NULL
  AND t.date >= $fromInclusive AND t.date <= $ref
ORDER BY t.date DESC, t.id DESC
```
Map the raw rows to `CardActivityTxn` (cast `amount_paise` string → Number with isSafeInteger check; `category_id` and `reconciled_statement_id` may be null). Add/update imports as needed.

### PE2 — `apps/api/src/modules/credit/services/emis.ts`
**Functions:** `upsertEmiDetails` (~line 374), `listEmiInstallments` (~line 456)

Changes:
1. `upsertEmiDetails` existence check (lines ~374–385): Remove `eq(transactions.accountId, template.accountId)` and `lt(transactions.amountPaise, 0)` from WHERE. Add INNER JOIN to `postings`:
```typescript
.innerJoin(
  postings,
  and(
    eq(postings.transactionId, transactions.id),
    eq(postings.accountId, template.accountId),
    lt(postings.amountPaise, 0),
  ),
)
```
Remove `eq(transactions.accountId, template.accountId)` from the WHERE clause (it's now implied by the posting join).

2. `listEmiInstallments` (lines ~471–488): Same join pattern, plus change the select to use `amountPaise: postings.amountPaise` instead of `amountPaise: transactions.amountPaise`. Remove the account/amount filters from WHERE.

Import `postings` from `"../../../db/schema.ts"` (check how existing imports in this file are structured — it may use a module schema or the barrel).

### PE3 — `apps/api/src/modules/credit/services/reconciliation-reads.ts`
**Function:** `ledgerDuesAtDates` (~line 112)

Change the raw SQL (lines ~124–134) from:
```sql
LEFT JOIN transactions t ON t.account_id = $accountId AND t.user_id = $userId AND t.deleted_at IS NULL AND t.date < ds.stmt_date
```
to a subquery approach:
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
Keep `openingBalancePaise` addend: `const ledgerDuePaise = -(openingBalancePaise + sum)`. Keep both `Number.isSafeInteger` guards.

Import `postings` as needed. Do NOT change the `accounts` import or any other logic.

### PE4 — `apps/api/src/modules/investments/services/sip-installments.ts`
**Functions:** `linkSipInstallment` (~line 260), `unlinkedInstallmentRows` (~line 443), `linkedInstallmentRows` (~line 417)

1. `linkSipInstallment` validation fetch (lines ~288–300): The current Drizzle query reads `transactions.accountId, amountPaise, isOpening, sipId, deletedAt`. Replace with a raw SQL query that keeps the FOR UPDATE lock on `t` and joins to postings for the SIP's target account. You need `sip.targetAccountId` at the time of the validation query — it's available since the SIP was already locked and read above the transaction fetch. Use:
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
Build the `ledgerTx` shape for `linkInstallmentIssue`:
```typescript
const ledgerTx = {
  accountId: row.account_id ?? "",   // null → fails accountId check
  amountPaise: Number(row.amount_paise ?? 0),
  date: row.date,
  isOpening: row.is_opening as boolean,
  sipId: row.sip_id as string | null,
};
```
Keep the soft-delete check: `if (!row || row.deleted_at !== null) throw new HttpError(404, ...)`.

2. `unlinkedInstallmentRows` (lines ~443–471): Remove `eq(transactions.accountId, accountId)`, `eq(transactions.isOpening, false)`, `gt(transactions.amountPaise, 0)` from WHERE. Add INNER JOIN to `postings`:
```typescript
.innerJoin(
  postings,
  and(
    eq(postings.transactionId, transactions.id),
    eq(postings.accountId, accountId),
    gt(postings.amountPaise, 0),
  ),
)
```
Add the opening exclusion to WHERE:
```typescript
sql`NOT EXISTS (
  SELECT 1 FROM postings p2
  JOIN accounts a2 ON a2.id = p2.account_id
  WHERE p2.transaction_id = ${transactions.id} AND a2.system_kind = 'opening'
)`,
```
Change `amountPaise: transactions.amountPaise` → `amountPaise: postings.amountPaise` in SELECT.

3. `linkedInstallmentRows` (lines ~417–433): Replace the Drizzle query with `db.execute(sql`...`)` using a LATERAL join on ANY real posting (no target account filter — linked rows must remain visible even if the transaction was later edited to a different account):
```sql
SELECT t.id, t.date, t.merchant, t.notes,
  rp.amount_paise
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
Cast `rp.amount_paise` from string to `Number()` with `Number.isSafeInteger` guard. Return type unchanged.

Import `postings` and `accounts` from `"../../../db/schema.ts"` (check existing imports). Remove `isOpening` from any Drizzle column references.

### PE5 — `apps/api/src/modules/automation/services/categorize.ts`
**Function:** `suggestCategoriesFor` (~line 42)

Replace the raw SQL (lines ~50–57):
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
  $restrict_filter
ORDER BY t.date DESC
LIMIT 200
```
The `$restrict_filter` is: `${restrict ? sql`AND t.id IN (${sql.join(transactionIds!.map(id => sql`${id}::uuid`), sql`, `)})` : sql``}`.

Update the result type from `{ id: string; merchant: string; notes: string; amount_paise: string }` to same (the value comes from postings as a bigint string). The `amountPaise: Number(r.amount_paise)` mapping below is correct as-is (already converts to number).

No `accounts` Drizzle import needed (table used by name in SQL string only).

### PE6 — `apps/api/src/modules/ledger/services/user-tasks.ts`
**Functions:** `taskQuery` (private), `listUserTasks`, `getUserTask`

Replace the entire `taskQuery`-based pattern with direct `db.execute(sql`...`)` calls in `listUserTasks` and `getUserTask`. Use a LATERAL join to get both `account_id` and `amount_paise` from the SAME posting row (ORDER BY p.id for determinism):

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
  $extra_where
ORDER BY (ut.completed_at IS NOT NULL) ASC,
         ut.due_date ASC NULLS LAST,
         ut.created_at DESC, ut.id ASC
```

- `listUserTasks`: WHERE `ut.user_id = $userId`
- `getUserTask`: WHERE `ut.id = $id AND ut.user_id = $userId`

Update `toUserTask` to accept a snake_case raw row object. Since `txn_amount_paise` comes back as a bigint string from node-postgres, cast it: `Number(row.txn_amount_paise)` and guard with `Number.isSafeInteger`. `txn_account_id` is a string UUID or null. The `TaskJoinRow` type should be updated to reflect snake_case field names.

Remove the old `taskQuery` function and the `transactions` reference it uses for `transactions.accountId` and `transactions.amountPaise`.

### PE7 — `apps/api/src/modules/ledger/services/search.ts`
**Function:** `search` (line 6)

Replace the transactions-only query in the `txs` Promise.all entry:
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
Update the result type to `{ id: string; merchant: string; amount_paise: string; date: string }` (same as before, bigint comes back as string). The `amountPaise: Number(r.amount_paise)` mapping is already correct.

### PE8 — `apps/api/src/modules/ingest/services/imports.ts`
**Function:** `applyMapping` (lines ~356–376) and `commitImport` CC reconciliation read (lines ~617–636)

**`applyMapping` dedup read:**
Replace the Drizzle select from transactions:
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
      eq(postings.accountId, batch.accountId),
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
Remove `eq(transactions.accountId, batch.accountId)` from WHERE (moved to JOIN). Add `postings` import.

**`commitImport` CC reconciliation read (lines ~617–636):**
Same pattern:
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

**DO NOT change** the UPDATE guard at line ~657 (`eq(transactions.accountId, batch.accountId)` in the write-path update) — that's a write guard, out of PR-E scope. Do not change the `reconciledFrom` snapshot either.

### PE9 — `apps/api/src/modules/protection/services/insurance.ts`
**Function:** `listPolicyPremiums` (~line 284)

Replace `db.query.transactions.findMany` with a Drizzle join to postings + accounts:
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
Import `accounts` and `postings` from `"../../../db/schema.ts"`. Check current import statement in the file.

## Must Not Change
- ANY write path functions in any of the 9 files
- `networth.ts`, `tools.ts`, `prefs.ts`, `transfer-classification.ts` — not in scope
- `commitImport` UPDATE guard (line ~657) — write path, PR-G scope
- Any extractor files
- Any web files
- The `linkInstallmentIssue`, `accountInstallmentSipIssue`, `candidateDateBounds`, `installmentDateError` pure functions (no DB queries, no changes needed)

## Acceptance Criteria
- AC-PE1: `listCardHolders` and `getCardActivity` aggregate via postings; balance = postings_sum + opening_balance_paise
- AC-PE2: `listEmiInstallments` rows/amounts from postings; existence check based on posting sign
- AC-PE3: `ledgerDuesAtDates` sums via postings subquery, opening addend preserved
- AC-PE4: `unlinkedInstallmentRows` excludes opening rows via NOT EXISTS; `linkedInstallmentRows` uses LATERAL on ANY real posting; `linkSipInstallment` validation query uses postings-derived isOpening
- AC-PE5: `suggestCategoriesFor` shows real posting amount; excludes transfers/opening
- AC-PE6: `listUserTasks`/`getUserTask` return real posting (account_id, amount_paise) via LATERAL
- AC-PE7: `search` returns one row per transaction (no transfer duplicates); real posting amount
- AC-PE8: `applyMapping` and `commitImport` reconciliation reads use postings join
- AC-PE9: `listPolicyPremiums` items/total from real postings
- AC-PE11: `npm run typecheck` exit 0; `npm run lint` exit 0; `npm run test -w apps/api` exit 0 (existing tests still pass)

## Commands
1. After implementing all changes: `npm run typecheck -w apps/api`
2. `npm run lint`
3. `npm run test -w apps/api 2>&1 | tail -20` (show pass/fail counts)

## Required Evidence
- List of files changed
- Complete diff (or file-by-file diffs)
- Output of typecheck (exit code)
- Output of lint (exit code)
- Output of test run (pass/fail counts, exit code)
- Any plan deviations or blockers encountered

---

## Iteration 2 — Parity test

**File to create:** `apps/api/src/modules/ledger/services/postings-pr-e-parity.test.ts`

**Reference:** `apps/api/src/modules/planning/services/postings-planning-parity.test.ts` — mirror its structure exactly.

### Module-level skeleton

```typescript
import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { AccountType } from "@compass/shared";
import {
  accounts, categories, emiDetails, goals, insurancePolicies,
  postings, recurringTemplates, sips, transactions, users, userTasks,
} from "../../../db/schema.ts";
// insurancePolicies is available from db/schema.ts via `export * from "./shared/spines.ts"`
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { findInconsistentPostings } from "./reconcile-postings.ts";
import { seedSystemAccounts } from "./post-entry.ts";
import { createAccount } from "./accounts.ts";
import { createTransaction, setSplits } from "./transactions.ts";
import { createTransfer } from "./transfers.ts";
import { listUserTasks, getUserTask } from "./user-tasks.ts";
import { search } from "./search.ts";
import { listCardHolders, getCardActivity } from "../../credit/services/cards.ts";
import { listEmiInstallments } from "../../credit/services/emis.ts";
import { ledgerDuesAtDates } from "../../credit/services/reconciliation-reads.ts";
import {
  linkSipInstallment,
  listSipInstallmentCandidates,
} from "../../investments/services/sip-installments.ts";
import { listPolicyPremiums } from "../../protection/services/insurance.ts";

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "postings-pr-e-parity.test.ts's DB-backed tests need DATABASE_URL set " +
        "(a real Postgres connection) — export it before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => { await pool.end(); });

function iso(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function createUser(): Promise<string> {
  const [u] = await db.insert(users).values({
    email: `postings-pr-e-parity-${randomUUID()}@example.invalid`,
    passwordHash: "x",
    displayName: "postings-pr-e-parity.test.ts user",
  }).returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(userTasks).where(eq(userTasks.userId, userId));
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(sips).where(eq(sips.userId, userId));
  await db.delete(goals).where(eq(goals.userId, userId));
  await db.delete(recurringTemplates).where(eq(recurringTemplates.userId, userId));
  await db.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function createAcct(
  userId: string, name: string, type: AccountType, openingBalancePaise = 0,
) {
  return createAccount(db, userId, {
    name, type, institution: null, accountLast4: null,
    holderName: null, currency: "INR", openingBalancePaise,
  });
}
```

### PE1 — cards.ts

```
test("postings-pr-e-parity: PE1 — listCardHolders and getCardActivity aggregate from postings", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "TestCard", "credit_card", 5000)` → `cardAcct`
3. Three transactions on `cardAcct.id`: amountPaise `-10000`, `-25000`, `+20000`
4. `const ref = iso()`

Assertions:
```typescript
const holders = await listCardHolders(db, userId, ref);
assert.equal(holders.length, 1);
assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + (-10000 - 25000 + 20000)); // -10000
assert.equal(holders[0]!.totalOwedPaise, 10000);
```

Legacy SQL cross-check:
```typescript
const legRow = (await db.execute(sql`
  select coalesce(sum(p.amount_paise), 0)::bigint as total
  from postings p join transactions t on t.id = p.transaction_id
  where p.account_id = ${cardAcct.id} and t.user_id = ${userId} and t.deleted_at is null
`)).rows[0] as { total: string };
assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + Number(legRow.total));
```

`getCardActivity`:
```typescript
const act = await getCardActivity(db, userId, cardAcct.id, ref);
assert.equal(act.balancePaise, -10000);
assert.equal(act.billed.length + act.unbilled.length, 3);
// all amounts are Numbers (not NaN/strings)
for (const row of [...act.billed, ...act.unbilled]) {
  assert.ok(Number.isFinite(row.amountPaise));
}
```

`findInconsistentPostings(db, userId)` → `[]`

### PE2 — emis.ts

```
test("postings-pr-e-parity: PE2 — listEmiInstallments reads posting amounts", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "Bank", "bank")` → `bankAcct`
3. Insert template directly:
```typescript
const [tmpl] = await db.insert(recurringTemplates).values({
  userId, accountId: bankAcct.id, merchant: "EMI Bank",
  amountPaise: -5000, frequency: "monthly", nextDueDate: iso(), kind: "emi",
}).returning({ id: recurringTemplates.id });
const templateId = tmpl!.id;
```
4. Insert emiDetails directly:
```typescript
await db.insert(emiDetails).values({
  templateId, userId,
  principalPaise: 100000, annualRateBps: 1000,
  totalInstallments: 24, startDate: iso(-60),
});
```
5. Three transactions with `recurringTemplateId: templateId`, `accountId: bankAcct.id`, `amountPaise: -5000`, dates `iso(-50)`, `iso(-20)`, `iso(-5)`

Assertions:
```typescript
const installments = await listEmiInstallments(db, userId, templateId);
assert.equal(installments.length, 3);
// Each installment's amountPaise is the full posting amount (-5000)
assert.ok(installments.every(i => i.amountPaise === -5000));
```

Cross-check via direct posting query:
```typescript
const legRows = (await db.execute(sql`
  select p.amount_paise from postings p
  join transactions t on t.id = p.transaction_id
  where p.account_id = ${bankAcct.id} and t.recurring_template_id = ${templateId}
    and p.amount_paise < 0 and t.deleted_at is null
  order by t.date
`)).rows as Array<{ amount_paise: string }>;
assert.equal(legRows.length, 3);
assert.deepEqual(
  installments.map(i => i.amountPaise).sort((a, b) => a - b),
  legRows.map(r => Number(r.amount_paise)).sort((a, b) => a - b),
);
```

`findInconsistentPostings(db, userId)` → `[]`

### PE3 — reconciliation-reads.ts

```
test("postings-pr-e-parity: PE3 — ledgerDuesAtDates matches opening+postings sum", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "CC", "credit_card", 8000)` → `cardAcct` (openingBalancePaise = 8000)
3. Three transactions on cardAcct.id: `-15000` at `iso(-30)`, `-8000` at `iso(-15)`, `+10000` at `iso(-5)`
4. `const d1 = iso(-20)`, `const d2 = iso(-2)`, `const d3 = iso(1)`

Helper:
```typescript
async function expectedDue(cutDate: string): Promise<number> {
  const r = (await db.execute(sql`
    select coalesce(sum(p.amount_paise), 0)::bigint as s
    from postings p join transactions t on t.id = p.transaction_id
    where p.account_id = ${cardAcct.id} and t.user_id = ${userId}
      and t.deleted_at is null and t.date < ${cutDate}
  `)).rows[0] as { s: string };
  return -(8000 + Number(r.s));
}
```

Assertions:
```typescript
const result = await ledgerDuesAtDates(db, userId, cardAcct.id, 8000, [d1, d2, d3]);
assert.equal(result.get(d1), await expectedDue(d1));
assert.equal(result.get(d2), await expectedDue(d2));
assert.equal(result.get(d3), await expectedDue(d3));
```

`findInconsistentPostings(db, userId)` → `[]`

### PE4 — sip-installments.ts

```
test("postings-pr-e-parity: PE4 — SIP installment readers use postings", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "SrcBank", "bank")` → `srcAcct`
3. `createAcct(userId, "PPF", "bank", 10000)` → `tgtAcct`
   - This auto-creates an `is_opening = true` transaction (bank type + non-zero opening balance)
4. Goal:
```typescript
const [g] = await db.insert(goals).values({ userId, name: "PE4", type: "savings" }).returning({ id: goals.id });
const goalId = g!.id;
```
5. SIP row (inserted directly to bypass createSip validation):
```typescript
const [s] = await db.insert(sips).values({
  userId, goalId, sourceAccountId: srcAcct.id,
  targetKind: "account", targetAccountId: tgtAcct.id,
  amountPaise: 5000, dayOfMonth: 1,
  frequency: "monthly", fundingSource: "bank_debit",
  startDate: iso(-90),
}).returning({ id: sips.id });
const sipId = s!.id;
```
6. Two credit transactions on tgtAcct:
```typescript
const txn1 = await createTransaction(db, userId, { accountId: tgtAcct.id, date: iso(-60), amountPaise: 5000 });
const txn2 = await createTransaction(db, userId, { accountId: tgtAcct.id, date: iso(-30), amountPaise: 5000 });
```

Assertions:
```typescript
const cands1 = await listSipInstallmentCandidates(db, userId, sipId, iso());
assert.equal(cands1.filter(c => !c.linked).length, 2, "unlinked=2 (opening excluded)");
assert.equal(cands1.filter(c => c.linked).length, 0);

await linkSipInstallment(db, userId, sipId, txn1.id);

const cands2 = await listSipInstallmentCandidates(db, userId, sipId, iso());
assert.equal(cands2.filter(c => c.linked).length, 1);
assert.equal(cands2.filter(c => c.linked)[0]!.amountPaise, 5000, "linked amount from posting");
assert.equal(cands2.filter(c => !c.linked).length, 1);
```

`findInconsistentPostings(db, userId)` → `[]`

### PE5 — categorize.ts

```
test("postings-pr-e-parity: PE5 — suggestCategoriesFor SQL returns real posting amounts", async (t) => {
```

Test the underlying SQL from `suggestCategoriesFor` directly (the function calls AI; the query is testable standalone).

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. Accounts:
```typescript
const bank1 = await createAcct(userId, "Bank1", "bank");
const bank2 = await createAcct(userId, "Bank2", "bank");
```
3. Category for splits:
```typescript
const [cat] = await db.insert(categories).values({ userId, name: "Food", kind: "expense" }).returning({ id: categories.id });
const catId = cat!.id;
```
4. Seed:
   - Ordinary uncategorized: `createTransaction(db, userId, { accountId: bank1.id, date: iso(-5), amountPaise: -500, merchant: "Zomato" })`
   - Split uncategorized (parent null categoryId):
     ```typescript
     const splitTxn = await createTransaction(db, userId, { accountId: bank1.id, date: iso(-4), amountPaise: -1500, merchant: "Swiggy" });
     await setSplits(db, userId, splitTxn.id, [
       { categoryId: catId, amountPaise: -800, note: "" },
       { categoryId: catId, amountPaise: -700, note: "" },
     ]);
     ```
   - Transfer (excluded via clearing postings):
     `createTransfer(db, userId, { fromAccountId: bank1.id, toAccountId: bank2.id, amountPaise: 2000, date: iso(-3) })`
   - Categorized ordinary (excluded):
     `createTransaction(db, userId, { accountId: bank1.id, date: iso(-2), amountPaise: -300, merchant: "Uber", categoryId: catId })`

Assertions (run the same SQL as `suggestCategoriesFor`):
```typescript
const rows = (await db.execute(sql`
  select t.id, p.amount_paise
  from postings p
  join accounts a on a.id = p.account_id
  join transactions t on t.id = p.transaction_id
  where t.user_id = ${userId} and t.deleted_at is null and t.category_id is null
    and a.system_kind is null
    and not exists (
      select 1 from postings p2
      join accounts a2 on a2.id = p2.account_id
      where p2.transaction_id = t.id and a2.system_kind in ('clearing', 'opening')
    )
  order by t.date desc limit 200
`)).rows as Array<{ id: string; amount_paise: string }>;

assert.equal(rows.length, 2, "ordinary + split only");
const splitRow = rows.find(r => r.id === splitTxn.id);
assert.ok(splitRow, "split txn appears in query");
assert.equal(Number(splitRow!.amount_paise), -1500, "split amount = real posting (-1500), not split sub-amount");
```

Legacy comparison (same transaction IDs):
```typescript
const legRows = (await db.execute(sql`
  select t.id from transactions t
  where t.user_id = ${userId} and t.deleted_at is null and t.category_id is null
    and not t.is_opening
    and not exists (select 1 from transfer_links tl
      where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
  order by t.date desc limit 200
`)).rows as Array<{ id: string }>;
assert.deepEqual(
  rows.map(r => r.id).sort(),
  legRows.map(r => r.id).sort(),
  "postings query and legacy query return same transaction IDs",
);
```

`findInconsistentPostings(db, userId)` → `[]`

### PE6 — user-tasks.ts

```
test("postings-pr-e-parity: PE6 — listUserTasks returns posting accountId and amountPaise", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "Bank", "bank")` → `bankAcct`
3. `const txn = await createTransaction(db, userId, { accountId: bankAcct.id, date: iso(), amountPaise: -800, merchant: "Task Txn" })`
4. Insert tasks:
```typescript
const [linkedTask] = await db.insert(userTasks).values({
  userId, title: "Linked", notes: "", transactionId: txn.id,
}).returning({ id: userTasks.id });
const [freeTask] = await db.insert(userTasks).values({
  userId, title: "Free", notes: "",
}).returning({ id: userTasks.id });
```

Assertions:
```typescript
const tasks = await listUserTasks(db, userId);
assert.equal(tasks.length, 2);

const linked = tasks.find(t => t.id === linkedTask!.id);
assert.ok(linked?.transaction, "linked task has transaction");
assert.equal(linked!.transaction!.amountPaise, -800, "amountPaise from posting");
assert.equal(linked!.transaction!.accountId, bankAcct.id, "accountId from posting");

const free = tasks.find(t => t.id === freeTask!.id);
assert.equal(free!.transaction, null, "unlinked task has null transaction");

const single = await getUserTask(db, userId, linkedTask!.id);
assert.equal(single.transaction!.amountPaise, -800);
assert.equal(single.transaction!.accountId, bankAcct.id);
```

`findInconsistentPostings(db, userId)` → `[]`

### PE7 — search.ts

```
test("postings-pr-e-parity: PE7 — search returns one result per transaction, real posting amount", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. Two accounts: `bank1` (bank), `bank2` (bank)
3. Ordinary transaction: `createTransaction(db, userId, { accountId: bank1.id, date: iso(-5), amountPaise: -600, merchant: "PE7Merchant" })`
4. Transfer (clearing postings → excluded): `const xfer = await createTransfer(db, userId, { fromAccountId: bank1.id, toAccountId: bank2.id, amountPaise: 1500, date: iso(-3) })`
5. Update out-leg merchant to force a match with the search term:
```typescript
await db.execute(sql`UPDATE transactions SET merchant = 'PE7Merchant' WHERE id = ${xfer.outTransactionId}`);
```
(`createTransfer` returns `TransferResult = { transferLinkId, outTransactionId, inTransactionId }` — use `xfer.outTransactionId`)

Assertions:
```typescript
const results = await search(db, userId, "PE7Merchant");
assert.equal(results.transactions.length, 1, "transfer legs excluded by Pattern C");
assert.equal(results.transactions[0]!.amountPaise, -600, "amount from posting");
assert.equal(results.transactions[0]!.merchant, "PE7Merchant");
```

`findInconsistentPostings(db, userId)` → `[]`

### PE8 — imports.ts (SQL-level parity)

Two separate tests, one for each converted reader.

**PE8a:**
```
test("postings-pr-e-parity: PE8a — applyMapping dedup query parity", async (t) => {
```
1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "ImportBank", "bank")` → `bankAcct`
3. Two transactions: `(-3000, iso(-10))` and `(-7000, iso(-5))`
4. `const minDate = iso(-15)`, `const maxDate = iso(0)`

Postings-based query (same as applyMapping):
```typescript
const postingsRows = await db.select({
  date: transactions.date,
  amountPaise: postings.amountPaise,
  merchant: transactions.merchant,
}).from(transactions).innerJoin(postings, and(
  eq(postings.transactionId, transactions.id),
  eq(postings.accountId, bankAcct.id),
)).where(and(
  eq(transactions.userId, userId),
  gte(transactions.date, minDate),
  lte(transactions.date, maxDate),
));
```

Legacy query:
```typescript
const legacyRows = (await db.execute(sql`
  select date, amount_paise, merchant from transactions
  where user_id = ${userId} and account_id = ${bankAcct.id}
    and date >= ${minDate} and date <= ${maxDate}
`)).rows as Array<{ date: string; amount_paise: string; merchant: string }>;
```

Assert parity:
```typescript
assert.equal(postingsRows.length, 2);
assert.equal(legacyRows.length, 2);
const pSorted = postingsRows.map(r => `${r.date}|${r.amountPaise}|${r.merchant}`).sort();
const lSorted = legacyRows.map(r => `${r.date}|${Number(r.amount_paise)}|${r.merchant}`).sort();
assert.deepEqual(pSorted, lSorted, "applyMapping dedup query parity");
```

`findInconsistentPostings(db, userId)` → `[]`

**PE8b:**
```
test("postings-pr-e-parity: PE8b — commitImport reconciliation query parity", async (t) => {
```
1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "CC", "credit_card")` → `ccAcct`
3. Two transactions: `(-5000, iso(-10))` and `(-12000, iso(-4))`
4. `const start = iso(-15)`, `const end = iso(0)`

Postings-based query (same as commitImport CC reconciliation):
```typescript
const postingsRows = await db.select({
  id: transactions.id,
  date: transactions.date,
  amountPaise: postings.amountPaise,
  merchant: transactions.merchant,
  notes: transactions.notes,
  source: transactions.source,
}).from(transactions).innerJoin(postings, and(
  eq(postings.transactionId, transactions.id),
  eq(postings.accountId, ccAcct.id),
)).where(and(
  eq(transactions.userId, userId),
  isNull(transactions.deletedAt),
  gte(transactions.date, start),
  lte(transactions.date, end),
)).orderBy(transactions.date, transactions.id);
```

Legacy query:
```typescript
const legacyRows = (await db.execute(sql`
  select id, date, amount_paise, merchant, notes, source from transactions
  where user_id = ${userId} and account_id = ${ccAcct.id} and deleted_at is null
    and date >= ${start} and date <= ${end}
  order by date, id
`)).rows as Array<{ id: string; date: string; amount_paise: string; merchant: string; notes: string; source: string }>;
```

Assert parity:
```typescript
assert.equal(postingsRows.length, 2);
assert.equal(legacyRows.length, 2);
assert.deepEqual(
  postingsRows.map(r => ({ id: r.id, amountPaise: r.amountPaise })),
  legacyRows.map(r => ({ id: r.id, amountPaise: Number(r.amount_paise) })),
  "commitImport reconciliation query parity",
);
```

`findInconsistentPostings(db, userId)` → `[]`

### PE9 — insurance.ts

```
test("postings-pr-e-parity: PE9 — listPolicyPremiums total and amounts from real postings", async (t) => {
```

1. `createUser()` + `t.after(() => cleanupUser(userId))` + `seedSystemAccounts(db, userId)`
2. `createAcct(userId, "Bank", "bank")` → `bankAcct`
3. Insert policy (minimal — most fields have DB defaults):
```typescript
const [pRow] = await db.insert(insurancePolicies).values({
  userId, name: "Test Life Policy",
}).returning({ id: insurancePolicies.id });
const policyId = pRow!.id;
```
4. Two transactions with `policyId`:
```typescript
const txn1 = await createTransaction(db, userId, {
  accountId: bankAcct.id, date: iso(-20),
  amountPaise: -1000, merchant: "LIC", policyId,
});
const txn2 = await createTransaction(db, userId, {
  accountId: bankAcct.id, date: iso(-10),
  amountPaise: -2500, merchant: "LIC", policyId,
});
```

Assertions:
```typescript
const premiums = await listPolicyPremiums(db, userId, policyId);
assert.equal(premiums.count, 2);
assert.equal(premiums.totalPaise, 3500, "total = |−1000| + |−2500|");
// ordered by date desc, id desc: txn2 (date=-10) first
assert.equal(premiums.items[0]!.amountPaise, -2500);
assert.equal(premiums.items[1]!.amountPaise, -1000);
assert.equal(premiums.items[0]!.accountId, bankAcct.id, "accountId from posting");
```

Legacy comparison:
```typescript
const legRows = (await db.execute(sql`
  select abs(amount_paise) as abs_amt from transactions
  where policy_id = ${policyId} and user_id = ${userId} and deleted_at is null
`)).rows as Array<{ abs_amt: string }>;
const legTotal = legRows.reduce((s, r) => s + Number(r.abs_amt), 0);
assert.equal(premiums.totalPaise, legTotal, "listPolicyPremiums total matches legacy sum");
```

`findInconsistentPostings(db, userId)` → `[]`

### Notes for worker

- `createTransfer` returns `TransferResult = { transferLinkId, outTransactionId, inTransactionId }`. PE7 uses `xfer.outTransactionId`.
- For PE2, `createTransaction` with `recurringTemplateId` requires the template to exist first (done above). The function checks that the template exists for the userId.
- For PE6, `db.insert(userTasks)` bypasses `createUserTask` service — this is fine for parity tests.
- For PE9, `createTransaction` with `policyId` is supported: the function signature is `CreateTransaction & { source?, policyId?, ... }`.
- For PE4, `listSipInstallmentCandidates` calls `ownedSip(db, userId, sipId)` which does `findFirst where id=sipId and userId=userId`. The directly-inserted SIP row satisfies this.
- Import `lt` from `"drizzle-orm"` only if needed; otherwise omit unused imports.
- Drizzle's `orderBy(transactions.date, transactions.id)` for PE8b — both columns ascending, matching the legacy `ORDER BY date, id`.

### Commands for Iteration 2

1. `npm run typecheck -w apps/api` — must exit 0
2. `npm run lint` — must exit 0
3. `npm run test -w apps/api 2>&1 | tail -30` — show pass/fail counts

Expected: test count increases by 10 (PE1–PE9 + PE8 has 2 sub-tests = 10 total). All 10 new tests fail at module load with `requireDatabaseUrl` error (no DATABASE_URL in CI). This adds 10 to the "fail" count (or they're counted as cancelled — verify). The existing 643 pass count must not decrease.

### Required Evidence for Iteration 2

- Path of the new file
- Typecheck exit code
- Lint exit code
- Test run output (pass/fail/cancel counts, exit code)
- Any deviations from the plan
