import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import type { AccountType, CategoryKind, ExpenseNecessity } from "@compass/shared";
import { accounts, categories, transactions, users } from "../db/schema.ts";
import { createDb } from "../db/index.ts";
import { createPool } from "../infra/db.ts";
import { findInconsistentPostings } from "../modules/ledger/services/reconcile-postings.ts";
import { seedSystemAccounts } from "../modules/ledger/services/post-entry.ts";
import { createAccount } from "../modules/ledger/services/accounts.ts";
import {
  createTransaction,
  softDeleteTransaction,
  setSplits,
} from "../modules/ledger/services/transactions.ts";
import { createTransfer, linkTransfer, unlinkTransfer } from "../modules/ledger/services/transfers.ts";
import type { NecessitySpendRow } from "./periods.ts";
import { spentByCategory, spendByNecessity, incomeExpense, LIABILITY_TYPES_SQL } from "./periods.ts";

/**
 * PR-C parity proof: spentByCategory / spendByNecessity / incomeExpense now
 * compute from `postings`; this DB-backed suite seeds fixtures via the REAL
 * writers (so postings are dual-written) and asserts the converted readers
 * equal a formula computed DIRECTLY from legacy `transactions` /
 * `transaction_splits` tables — never by calling another periods helper.
 * `findInconsistentPostings` is also asserted empty so a coincidentally-equal
 * aggregate can't hide drift.
 */

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "postings-periods-parity.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
        "connection) — export it before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `postings-periods-parity-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "postings-periods-parity.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  // Deleting transactions cascades to: postings, transaction_splits, transfer_links.
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function createAcct(
  userId: string,
  name: string,
  type: AccountType,
  openingBalancePaise = 0,
): Promise<{ id: string; type: AccountType }> {
  const account = await createAccount(db, userId, {
    name,
    type,
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  });
  return { id: account.id, type };
}

// ---------------------------------------------------------------------------
// Legacy formula helpers — query transactions/transaction_splits ONLY.
// Never call spentByCategory / spendByNecessity / incomeExpense here.
// ---------------------------------------------------------------------------

async function legacySpentByCategory(
  userId: string,
  from: string,
  to: string,
): Promise<Map<string | null, number>> {
  const nonSplit = await db.execute(sql`
    select t.category_id as cid, coalesce(sum(-t.amount_paise), 0)::bigint as spent
    from transactions t
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and t.amount_paise < 0 and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
      and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
    group by t.category_id
  `);
  const splitParts = await db.execute(sql`
    select s.category_id as cid, coalesce(sum(-s.amount_paise), 0)::bigint as spent
    from transaction_splits s
    join transactions t on t.id = s.transaction_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and s.amount_paise < 0 and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    group by s.category_id
  `);
  const out = new Map<string | null, number>();
  for (const row of [
    ...nonSplit.rows,
    ...splitParts.rows,
  ] as Array<{ cid: string | null; spent: string }>) {
    out.set(row.cid, (out.get(row.cid) ?? 0) + Number(row.spent));
  }
  return out;
}

async function legacyIncomeExpense(
  userId: string,
  from: string,
  to: string,
): Promise<{ incomePaise: number; expensePaise: number }> {
  const res = await db.execute(sql`
    select
      coalesce(sum(case when t.amount_paise > 0 and a.type not in (${LIABILITY_TYPES_SQL})
        then t.amount_paise else 0 end), 0)::bigint as income,
      coalesce(sum(case when t.amount_paise < 0 then -t.amount_paise else 0 end), 0)::bigint as expense
    from transactions t
    join accounts a on a.id = t.account_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
  `);
  const row = res.rows[0] as { income: string; expense: string };
  return { incomePaise: Number(row.income), expensePaise: Number(row.expense) };
}

async function legacySpendByNecessity(
  userId: string,
  from: string,
  to: string,
): Promise<NecessitySpendRow[]> {
  const nonSplit = await db.execute(sql`
    select t.necessity as tx_necessity, c.necessity as cat_necessity, c.kind as cat_kind,
           coalesce(sum(-t.amount_paise), 0)::bigint as spent
    from transactions t
    left join categories c on c.id = t.category_id and c.user_id = t.user_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and t.amount_paise < 0 and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
      and not exists (select 1 from transaction_splits s where s.transaction_id = t.id)
    group by t.necessity, c.necessity, c.kind
  `);
  const splitParts = await db.execute(sql`
    select t.necessity as tx_necessity, c.necessity as cat_necessity, c.kind as cat_kind,
           coalesce(sum(-s.amount_paise), 0)::bigint as spent
    from transaction_splits s
    join transactions t on t.id = s.transaction_id
    left join categories c on c.id = s.category_id and c.user_id = t.user_id
    where t.user_id = ${userId} and t.deleted_at is null
      and t.date >= ${from} and t.date <= ${to}
      and s.amount_paise < 0 and not t.is_opening
      and not exists (select 1 from transfer_links tl
        where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
    group by t.necessity, c.necessity, c.kind
  `);
  type Row = {
    tx_necessity: string | null;
    cat_necessity: string | null;
    cat_kind: string | null;
    spent: string;
  };
  // Merge the two result sets, combining rows with the same (tx_necessity, cat_necessity, cat_kind) key
  const merged = new Map<string, NecessitySpendRow>();
  for (const row of [...nonSplit.rows, ...splitParts.rows] as Row[]) {
    const key = `${row.tx_necessity}|${row.cat_necessity}|${row.cat_kind}`;
    const prev = merged.get(key);
    merged.set(key, {
      txNecessity: row.tx_necessity as ExpenseNecessity | null,
      catNecessity: row.cat_necessity as ExpenseNecessity | null,
      catKind: row.cat_kind as CategoryKind | null,
      spentPaise: (prev?.spentPaise ?? 0) + Number(row.spent),
    });
  }
  return [...merged.values()];
}

/** Total spend from spendByNecessity rows — used to compare against legacy spentByCategory total. */
function totalNecessitySpend(rows: NecessitySpendRow[]): number {
  return rows.reduce((sum, r) => sum + r.spentPaise, 0);
}

/** Canonically sort NecessitySpendRow arrays so deepEqual comparisons are order-independent. */
function sortNecessityRows(rows: NecessitySpendRow[]): NecessitySpendRow[] {
  return [...rows].sort((a, b) => {
    const ka = `${a.txNecessity}|${a.catNecessity}|${a.catKind}|${a.spentPaise}`;
    const kb = `${b.txNecessity}|${b.catNecessity}|${b.catKind}|${b.spentPaise}`;
    return ka < kb ? -1 : ka > kb ? 1 : 0;
  });
}

// ---------------------------------------------------------------------------
// Test cases
// ---------------------------------------------------------------------------

const FROM = "2020-01-01";
const TO = "2020-12-31";

test("postings-periods-parity: 1 — ordinary expense appears in all three readers", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const [cat] = await db
    .insert(categories)
    .values({ userId, name: "Food", kind: "expense" })
    .returning({ id: categories.id });
  await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-06-01",
    amountPaise: -10000,
    categoryId: cat!.id,
  });

  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc), "spentByCategory must match legacy");
  assert.equal(totalNecessitySpend(sbn), 10000, "spendByNecessity total must equal 10000");
  const legSbn = await legacySpendByNecessity(userId, FROM, TO);
  assert.deepEqual(sortNecessityRows(sbn), sortNecessityRows(legSbn), "spendByNecessity rows must match legacy");
  assert.equal(ie.incomePaise, legIe.incomePaise, "incomeExpense income must match legacy");
  assert.equal(ie.expensePaise, legIe.expensePaise, "incomeExpense expense must match legacy");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 2 — ordinary income appears in incomeExpense", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-07-01",
    amountPaise: 20000,
  });

  const legIe = await legacyIncomeExpense(userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);
  const sbc = await spentByCategory(db, userId, FROM, TO);

  assert.equal(ie.incomePaise, legIe.incomePaise, "income must match legacy");
  assert.equal(ie.expensePaise, legIe.expensePaise, "expense must be 0");
  assert.equal(ie.incomePaise, 20000, "income must be 20000");
  assert.equal(sbc.size, 0, "income transaction must not appear in spentByCategory");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 3 — same-sign split expense per category, expense = parent amount", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const [cat1] = await db
    .insert(categories)
    .values({ userId, name: "Groceries", kind: "expense" })
    .returning({ id: categories.id });
  const [cat2] = await db
    .insert(categories)
    .values({ userId, name: "Transport", kind: "expense" })
    .returning({ id: categories.id });
  const [cat3] = await db
    .insert(categories)
    .values({ userId, name: "Entertainment", kind: "expense" })
    .returning({ id: categories.id });

  const parentTxn = await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-08-01",
    amountPaise: -30000,
  });
  await setSplits(db, userId, parentTxn.id, [
    { categoryId: cat1!.id, amountPaise: -10000, note: "" },
    { categoryId: cat2!.id, amountPaise: -15000, note: "" },
    { categoryId: cat3!.id, amountPaise: -5000, note: "" },
  ]);

  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc), "spentByCategory must match legacy");
  assert.equal(sbc.get(cat1!.id), 10000, "cat1 spend must be 10000");
  assert.equal(sbc.get(cat2!.id), 15000, "cat2 spend must be 15000");
  assert.equal(sbc.get(cat3!.id), 5000, "cat3 spend must be 5000");
  assert.equal(totalNecessitySpend(sbn), 30000, "spendByNecessity total must be 30000");
  const legSbn = await legacySpendByNecessity(userId, FROM, TO);
  assert.deepEqual(sortNecessityRows(sbn), sortNecessityRows(legSbn), "spendByNecessity rows must match legacy");
  assert.equal(ie.expensePaise, legIe.expensePaise, "incomeExpense expense must match legacy");
  assert.equal(ie.expensePaise, 30000, "incomeExpense expense = parent amount");
  assert.equal(ie.incomePaise, 0, "no income");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 4 — mixed-sign split, negative parent: expense = parent, spend = only negative splits", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const [catNeg] = await db
    .insert(categories)
    .values({ userId, name: "Cat Neg", kind: "expense" })
    .returning({ id: categories.id });
  const [catPos] = await db
    .insert(categories)
    .values({ userId, name: "Cat Pos", kind: "income" })
    .returning({ id: categories.id });

  // parent -70, splits [-100, +30]
  const parentTxn = await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-04-01",
    amountPaise: -7000,
  });
  await setSplits(db, userId, parentTxn.id, [
    { categoryId: catNeg!.id, amountPaise: -10000, note: "" },
    { categoryId: catPos!.id, amountPaise: 3000, note: "" },
  ]);

  // Legacy expected: splits with negative amount; only catNeg qualifies
  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  // Legacy incomeExpense: parent t.amount_paise = -7000
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  // incomeExpense anchors on real posting (-7000): expense=7000, income=0
  assert.equal(ie.expensePaise, legIe.expensePaise, "incomeExpense expense must match legacy (parent amount)");
  assert.equal(ie.expensePaise, 7000, "expense must be 7000 (parent amount, not split sum)");
  assert.equal(ie.incomePaise, 0, "income must be 0");

  // spentByCategory: only catNeg gets 10000; catPos is NOT in spend
  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc), "spentByCategory must match legacy");
  assert.equal(sbc.get(catNeg!.id), 10000, "catNeg spend must be 10000");
  assert.equal(sbc.has(catPos!.id), false, "catPos must NOT appear in spentByCategory");

  // spendByNecessity mirrors spentByCategory total
  assert.equal(totalNecessitySpend(sbn), 10000, "spendByNecessity total must be 10000 (only negative splits)");
  const legSbn = await legacySpendByNecessity(userId, FROM, TO);
  assert.deepEqual(sortNecessityRows(sbn), sortNecessityRows(legSbn), "spendByNecessity rows must match legacy");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 5 — mixed-sign split, positive parent: income = parent, spend = only negative splits", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const [catPos] = await db
    .insert(categories)
    .values({ userId, name: "Cat Pos", kind: "income" })
    .returning({ id: categories.id });
  const [catNeg] = await db
    .insert(categories)
    .values({ userId, name: "Cat Neg", kind: "expense" })
    .returning({ id: categories.id });

  // parent +70, splits [+100, -30]
  const parentTxn = await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-05-01",
    amountPaise: 7000,
  });
  await setSplits(db, userId, parentTxn.id, [
    { categoryId: catPos!.id, amountPaise: 10000, note: "" },
    { categoryId: catNeg!.id, amountPaise: -3000, note: "" },
  ]);

  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  // incomeExpense anchors on real posting (+7000): income=7000, expense=0
  assert.equal(ie.incomePaise, legIe.incomePaise, "incomeExpense income must match legacy (parent amount)");
  assert.equal(ie.incomePaise, 7000, "income must be 7000 (parent amount, not split sum)");
  assert.equal(ie.expensePaise, 0, "expense must be 0");

  // spentByCategory: only catNeg gets 3000
  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc), "spentByCategory must match legacy");
  assert.equal(sbc.get(catNeg!.id), 3000, "catNeg spend must be 3000");
  assert.equal(sbc.has(catPos!.id), false, "catPos must NOT appear in spentByCategory");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 6 — transfer pair excluded from all three readers", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank1 = await createAcct(userId, "Bank1", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");
  await createTransfer(db, userId, {
    fromAccountId: bank1.id,
    toAccountId: bank2.id,
    amountPaise: 50000,
    date: "2020-03-15",
  });

  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc));
  assert.equal(sbc.size, 0, "transfer must not appear in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 0, "transfer must not appear in spendByNecessity");
  assert.equal(ie.incomePaise, legIe.incomePaise);
  assert.equal(ie.expensePaise, legIe.expensePaise);
  assert.equal(ie.incomePaise, 0, "transfer must not appear as income");
  assert.equal(ie.expensePaise, 0, "transfer must not appear as expense");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 7 — transfer lifecycle: link / unlink / re-link / hard-delete", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank1 = await createAcct(userId, "Bank1", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");

  // 7a: auto-linked transfer pair excluded from all three
  const transfer = await createTransfer(db, userId, {
    fromAccountId: bank1.id,
    toAccountId: bank2.id,
    amountPaise: 30000,
    date: "2020-04-10",
  });

  {
    const sbc = await spentByCategory(db, userId, FROM, TO);
    const ie = await incomeExpense(db, userId, FROM, TO);
    assert.equal(sbc.size, 0, "7a: transfer pair excluded from spentByCategory");
    assert.equal(ie.incomePaise, 0, "7a: transfer pair excluded from incomeExpense income");
    assert.equal(ie.expensePaise, 0, "7a: transfer pair excluded from incomeExpense expense");
    const sbn7a = await spendByNecessity(db, userId, FROM, TO); assert.equal(totalNecessitySpend(sbn7a), 0, "7a: transfer excluded from spendByNecessity");
  }

  // 7b: unlink → both legs appear as ordinary spend/income
  const unlinked = await unlinkTransfer(db, userId, transfer.transactionId);
  const [outId, inId] = unlinked.transactionIds;
  {
    const legIe = await legacyIncomeExpense(userId, FROM, TO);
    const ie = await incomeExpense(db, userId, FROM, TO);
    const legSbc = await legacySpentByCategory(userId, FROM, TO);
    const sbc = await spentByCategory(db, userId, FROM, TO);

    assert.equal(ie.expensePaise, legIe.expensePaise, "7b: out-leg expense after unlink matches legacy");
    assert.equal(ie.incomePaise, legIe.incomePaise, "7b: in-leg income after unlink matches legacy");
    assert.equal(ie.expensePaise, 30000, "7b: out-leg expense = 30000");
    assert.equal(ie.incomePaise, 30000, "7b: in-leg income = 30000");
    // Both uncategorized; null key
    assert.equal(sbc.get(null) ?? 0, 30000, "7b: out-leg appears in spentByCategory");
    assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc), "7b: spentByCategory matches legacy");
    const sbn7b = await spendByNecessity(db, userId, FROM, TO); assert.equal(totalNecessitySpend(sbn7b), 30000, "7b: out-leg appears in spendByNecessity after unlink");
  }

  // 7c: re-link → both excluded again
  const newLink = await linkTransfer(db, userId, outId, inId);
  {
    const ie = await incomeExpense(db, userId, FROM, TO);
    const sbc = await spentByCategory(db, userId, FROM, TO);
    assert.equal(ie.incomePaise, 0, "7c: re-linked transfer excluded from incomeExpense income");
    assert.equal(ie.expensePaise, 0, "7c: re-linked transfer excluded from incomeExpense expense");
    assert.equal(sbc.size, 0, "7c: re-linked transfer excluded from spentByCategory");
    const sbn7c = await spendByNecessity(db, userId, FROM, TO); assert.equal(totalNecessitySpend(sbn7c), 0, "7c: re-linked excluded from spendByNecessity");
  }

  // findInconsistentPostings: re-linked transfer must be consistent
  assert.deepEqual(await findInconsistentPostings(db, userId), []);
  assert.ok(true, "7: transfer lifecycle complete with " + newLink.id);
});

test("postings-periods-parity: 8 — opening row excluded from all three readers", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  // createAccount with nonzero opening balance seeds an is_opening transaction
  await createAcct(userId, "Bank", "bank", 50000);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.equal(sbc.size, 0, "opening row must not appear in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 0, "opening row must not appear in spendByNecessity");
  assert.equal(ie.incomePaise, 0, "opening row must not appear as income");
  assert.equal(ie.expensePaise, 0, "opening row must not appear as expense");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 9 — soft-deleted transaction excluded from all three readers", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const txn = await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-09-01",
    amountPaise: -10000,
  });
  await softDeleteTransaction(db, userId, txn.id);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.equal(sbc.size, 0, "soft-deleted transaction must not appear in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 0, "soft-deleted transaction must not appear in spendByNecessity");
  assert.equal(ie.expensePaise, 0, "soft-deleted transaction must not appear as expense");
  assert.equal(ie.incomePaise, 0, "soft-deleted transaction must not appear as income");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 10 — future-dated transaction excluded from date-range query", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  // Date is outside FROM/TO range
  await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2030-01-01",
    amountPaise: -10000,
  });

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.equal(sbc.size, 0, "future-dated transaction must not appear in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 0, "future-dated transaction must not appear in spendByNecessity");
  assert.equal(ie.expensePaise, 0, "future-dated transaction must not appear as expense");
  assert.equal(ie.incomePaise, 0, "future-dated transaction must not appear as income");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 11 — liability-account inflow: income=0 (D4), spend=0", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const card = await createAcct(userId, "Card", "credit_card");
  await createTransaction(db, userId, {
    accountId: card.id,
    date: "2020-06-15",
    amountPaise: 10000,
  });

  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  assert.equal(ie.incomePaise, legIe.incomePaise, "incomeExpense income must match legacy (0)");
  assert.equal(ie.incomePaise, 0, "liability account inflow must not count as income (D4)");
  assert.equal(ie.expensePaise, 0, "no expense");
  assert.equal(sbc.size, 0, "liability account inflow must not appear in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 0, "liability account inflow must not appear in spendByNecessity");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 12 — EMI fixture: bank expense counted, liability positive income=0", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  const loan = await createAcct(userId, "Loan", "loan");

  // Bank -50000: ordinary expense
  await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-07-05",
    amountPaise: -50000,
  });
  // Loan +50000: positive on liability — NOT a transfer
  await createTransaction(db, userId, {
    accountId: loan.id,
    date: "2020-07-05",
    amountPaise: 50000,
  });

  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  // Bank expense
  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc), "spentByCategory must match legacy");
  assert.equal(sbc.get(null) ?? 0, 50000, "bank expense must be 50000 in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 50000, "spendByNecessity total must be 50000");

  // incomeExpense: bank expense + loan income=0 (liability D4)
  assert.equal(ie.expensePaise, legIe.expensePaise, "incomeExpense expense must match legacy");
  assert.equal(ie.incomePaise, legIe.incomePaise, "incomeExpense income must match legacy (0)");
  assert.equal(ie.expensePaise, 50000, "bank expense = 50000");
  assert.equal(ie.incomePaise, 0, "loan positive must not count as income (liability D4)");

  // No Clearing postings for either transaction (both are ordinary)
  const clearingRes = await db.execute(sql`
    select count(*)::int as cnt
    from postings p
    join accounts a on a.id = p.account_id
    join transactions t on t.id = p.transaction_id
    where t.user_id = ${userId}
      and a.system_kind = 'clearing'
  `);
  assert.equal((clearingRes.rows[0] as { cnt: number }).cnt, 0, "no Clearing postings for EMI ordinary transactions");

  // Assert no transfer_links rows for either EMI transaction
  const tlRes = await db.execute(sql`
    select count(*)::int as cnt
    from transfer_links tl
    join transactions t on t.id = tl.out_transaction_id or t.id = tl.in_transaction_id
    where t.user_id = ${userId}
  `);
  assert.equal((tlRes.rows[0] as { cnt: number }).cnt, 0, "no transfer_links for EMI ordinary transactions");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 13 — zero-amount transaction contributes 0 to all three", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank");
  await createTransaction(db, userId, {
    accountId: bank.id,
    date: "2020-08-01",
    amountPaise: 0,
  });

  const legSbc = await legacySpentByCategory(userId, FROM, TO);
  const legIe = await legacyIncomeExpense(userId, FROM, TO);

  const sbc = await spentByCategory(db, userId, FROM, TO);
  const sbn = await spendByNecessity(db, userId, FROM, TO);
  const ie = await incomeExpense(db, userId, FROM, TO);

  // zero-amount transaction has no positive Expenses posting
  assert.deepEqual(Object.fromEntries(sbc), Object.fromEntries(legSbc));
  assert.equal(sbc.size, 0, "zero-amount must not appear in spentByCategory");
  assert.equal(totalNecessitySpend(sbn), 0, "zero-amount must not appear in spendByNecessity");
  assert.equal(ie.incomePaise, legIe.incomePaise);
  assert.equal(ie.expensePaise, legIe.expensePaise);
  assert.equal(ie.incomePaise, 0, "zero-amount must not contribute to income");
  assert.equal(ie.expensePaise, 0, "zero-amount must not contribute to expense");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

test("postings-periods-parity: 14 — tenant isolation: user B's transaction does not appear in user A's results", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  await seedSystemAccounts(db, userA);
  await seedSystemAccounts(db, userB);

  const bankA = await createAcct(userA, "Bank A", "bank");
  const bankB = await createAcct(userB, "Bank B", "bank");

  // User A: small expense
  await createTransaction(db, userA, {
    accountId: bankA.id,
    date: "2020-03-01",
    amountPaise: -5000,
  });
  // User B: large expense that must not leak into A's results
  await createTransaction(db, userB, {
    accountId: bankB.id,
    date: "2020-03-01",
    amountPaise: -999999999,
  });

  const sbcA = await spentByCategory(db, userA, FROM, TO);
  const sbnA = await spendByNecessity(db, userA, FROM, TO);
  const ieA = await incomeExpense(db, userA, FROM, TO);

  assert.equal(sbcA.get(null) ?? 0, 5000, "user A sees only their own 5000 expense");
  assert.equal(totalNecessitySpend(sbnA), 5000, "user A's spendByNecessity must not include user B's data");
  assert.equal(ieA.expensePaise, 5000, "user A's incomeExpense must not include user B's expense");
  assert.equal(ieA.incomePaise, 0, "user A has no income");

  assert.deepEqual(await findInconsistentPostings(db, userA), []);
});

test("postings-periods-parity: 15 — findInconsistentPostings returns [] for a full fixture user", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank = await createAcct(userId, "Bank", "bank", 10000);
  const card = await createAcct(userId, "Card", "credit_card");
  const loan = await createAcct(userId, "Loan", "loan");
  const bankB = await createAcct(userId, "Bank B", "bank");
  const [catExp] = await db
    .insert(categories)
    .values({ userId, name: "Expense Cat", kind: "expense" })
    .returning({ id: categories.id });
  const [catInc] = await db
    .insert(categories)
    .values({ userId, name: "Income Cat", kind: "income" })
    .returning({ id: categories.id });

  // ordinary expense
  await createTransaction(db, userId, { accountId: bank.id, date: "2020-01-10", amountPaise: -5000, categoryId: catExp!.id });
  // ordinary income
  await createTransaction(db, userId, { accountId: bank.id, date: "2020-02-10", amountPaise: 8000 });
  // split expense
  const splitTxn = await createTransaction(db, userId, { accountId: bank.id, date: "2020-03-01", amountPaise: -12000 });
  await setSplits(db, userId, splitTxn.id, [
    { categoryId: catExp!.id, amountPaise: -7000, note: "" },
    { categoryId: catExp!.id, amountPaise: -5000, note: "" },
  ]);
  // mixed-sign split
  const mixedTxn = await createTransaction(db, userId, { accountId: bank.id, date: "2020-04-01", amountPaise: -4000 });
  await setSplits(db, userId, mixedTxn.id, [
    { categoryId: catExp!.id, amountPaise: -6000, note: "" },
    { categoryId: catInc!.id, amountPaise: 2000, note: "" },
  ]);
  // transfer pair
  await createTransfer(db, userId, {
    fromAccountId: bank.id,
    toAccountId: bankB.id,
    amountPaise: 20000,
    date: "2020-05-01",
  });
  // soft-deleted
  const delTxn = await createTransaction(db, userId, { accountId: bank.id, date: "2020-06-01", amountPaise: -3000 });
  await softDeleteTransaction(db, userId, delTxn.id);
  // future-dated
  await createTransaction(db, userId, { accountId: bank.id, date: "2030-01-01", amountPaise: -1000 });
  // card positive (liability inflow)
  await createTransaction(db, userId, { accountId: card.id, date: "2020-07-01", amountPaise: 5000 });
  // loan positive (liability inflow)
  await createTransaction(db, userId, { accountId: loan.id, date: "2020-08-01", amountPaise: 15000 });
  // zero-amount
  await createTransaction(db, userId, { accountId: bank.id, date: "2020-09-01", amountPaise: 0 });

  const inconsistent = await findInconsistentPostings(db, userId);
  assert.deepEqual(inconsistent, [], `findInconsistentPostings must return [] for fixture user, got: ${JSON.stringify(inconsistent)}`);
});
