import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNull, lte, sql } from "drizzle-orm";
import type { AccountType } from "@compass/shared";
import {
  accounts,
  categories,
  emiDetails,
  goals,
  insurancePolicies,
  postings,
  recurringTemplates,
  sips,
  transactions,
  users,
  userTasks,
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

/**
 * PR-E parity proof: reader files converted from legacy transactions.amount_paise /
 * transactions.account_id / transactions.is_opening to postings-based queries.
 * Mirrors the structure of postings-planning-parity.test.ts.
 */

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
after(async () => {
  await pool.end();
});

function iso(offsetDays = 0): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `postings-pr-e-parity-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "postings-pr-e-parity.test.ts user",
    })
    .returning({ id: users.id });
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
  userId: string,
  name: string,
  type: AccountType,
  openingBalancePaise = 0,
) {
  return createAccount(db, userId, {
    name,
    type,
    institution: null,
    accountLast4: null,
    holderName: null,
    currency: "INR",
    openingBalancePaise,
  });
}

// ---------------------------------------------------------------------------
// PE1 — cards.ts: listCardHolders and getCardActivity
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE1 — listCardHolders and getCardActivity aggregate from postings", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const cardAcct = await createAcct(userId, "TestCard", "credit_card", 5000);

  await createTransaction(db, userId, { accountId: cardAcct.id, date: iso(), amountPaise: -10000 });
  await createTransaction(db, userId, { accountId: cardAcct.id, date: iso(), amountPaise: -25000 });
  await createTransaction(db, userId, { accountId: cardAcct.id, date: iso(), amountPaise: 20000 });

  const ref = iso();

  const holders = await listCardHolders(db, userId, ref);
  assert.equal(holders.length, 1);
  assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + (-10000 - 25000 + 20000)); // -10000
  assert.equal(holders[0]!.totalOwedPaise, 10000);

  // Legacy SQL cross-check
  const legRow = (
    await db.execute(sql`
      select coalesce(sum(p.amount_paise), 0)::bigint as total
      from postings p join transactions t on t.id = p.transaction_id
      where p.account_id = ${cardAcct.id} and t.user_id = ${userId} and t.deleted_at is null
    `)
  ).rows[0] as { total: string };
  assert.equal(holders[0]!.cards[0]!.balancePaise, 5000 + Number(legRow.total));

  const act = await getCardActivity(db, userId, cardAcct.id, ref);
  assert.equal(act.balancePaise, -10000);
  assert.equal(act.billed.length + act.unbilled.length, 3);
  // all amounts are Numbers (not NaN/strings)
  for (const row of [...act.billed, ...act.unbilled]) {
    assert.ok(Number.isFinite(row.amountPaise));
  }

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE2 — emis.ts: listEmiInstallments reads posting amounts
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE2 — listEmiInstallments reads posting amounts", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bankAcct = await createAcct(userId, "Bank", "bank");

  const [tmpl] = await db
    .insert(recurringTemplates)
    .values({
      userId,
      accountId: bankAcct.id,
      merchant: "EMI Bank",
      amountPaise: -5000,
      frequency: "monthly",
      nextDueDate: iso(),
      kind: "emi",
    })
    .returning({ id: recurringTemplates.id });
  const templateId = tmpl!.id;

  await db.insert(emiDetails).values({
    templateId,
    userId,
    principalPaise: 100000,
    annualRateBps: 1000,
    totalInstallments: 24,
    startDate: iso(-60),
  });

  await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-50),
    amountPaise: -5000,
    recurringTemplateId: templateId,
  });
  await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-20),
    amountPaise: -5000,
    recurringTemplateId: templateId,
  });
  await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-5),
    amountPaise: -5000,
    recurringTemplateId: templateId,
  });

  const installments = await listEmiInstallments(db, userId, templateId);
  assert.equal(installments.length, 3);
  // Each installment's amountPaise is the full posting amount (-5000)
  assert.ok(installments.every((i) => i.amountPaise === -5000));

  // Cross-check via direct posting query
  const legRows = (
    await db.execute(sql`
      select p.amount_paise from postings p
      join transactions t on t.id = p.transaction_id
      where p.account_id = ${bankAcct.id} and t.recurring_template_id = ${templateId}
        and p.amount_paise < 0 and t.deleted_at is null
      order by t.date
    `)
  ).rows as Array<{ amount_paise: string }>;
  assert.equal(legRows.length, 3);
  assert.deepEqual(
    installments.map((i) => i.amountPaise).sort((a, b) => a - b),
    legRows.map((r) => Number(r.amount_paise)).sort((a, b) => a - b),
  );

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE3 — reconciliation-reads.ts: ledgerDuesAtDates matches opening+postings sum
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE3 — ledgerDuesAtDates matches opening+postings sum", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const cardAcct = await createAcct(userId, "CC", "credit_card", 8000);

  await createTransaction(db, userId, { accountId: cardAcct.id, date: iso(-30), amountPaise: -15000 });
  await createTransaction(db, userId, { accountId: cardAcct.id, date: iso(-15), amountPaise: -8000 });
  await createTransaction(db, userId, { accountId: cardAcct.id, date: iso(-5), amountPaise: 10000 });

  const d1 = iso(-20);
  const d2 = iso(-2);
  const d3 = iso(1);

  async function expectedDue(cutDate: string): Promise<number> {
    const r = (
      await db.execute(sql`
        select coalesce(sum(p.amount_paise), 0)::bigint as s
        from postings p join transactions t on t.id = p.transaction_id
        where p.account_id = ${cardAcct.id} and t.user_id = ${userId}
          and t.deleted_at is null and t.date < ${cutDate}
      `)
    ).rows[0] as { s: string };
    return -(8000 + Number(r.s));
  }

  const result = await ledgerDuesAtDates(db, userId, cardAcct.id, 8000, [d1, d2, d3]);
  assert.equal(result.get(d1), await expectedDue(d1));
  assert.equal(result.get(d2), await expectedDue(d2));
  assert.equal(result.get(d3), await expectedDue(d3));

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE4 — sip-installments.ts: SIP installment readers use postings
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE4 — SIP installment readers use postings", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const srcAcct = await createAcct(userId, "SrcBank", "bank");
  const tgtAcct = await createAcct(userId, "PPF", "bank", 10000);
  // tgtAcct auto-creates an is_opening = true transaction (bank type + non-zero opening balance)

  const [g] = await db
    .insert(goals)
    .values({ userId, name: "PE4", type: "savings" })
    .returning({ id: goals.id });
  const goalId = g!.id;

  const [s] = await db
    .insert(sips)
    .values({
      userId,
      goalId,
      sourceAccountId: srcAcct.id,
      targetKind: "account",
      targetAccountId: tgtAcct.id,
      amountPaise: 5000,
      dayOfMonth: 1,
      frequency: "monthly",
      fundingSource: "bank_debit",
      startDate: iso(-90),
    })
    .returning({ id: sips.id });
  const sipId = s!.id;

  const txn1 = await createTransaction(db, userId, {
    accountId: tgtAcct.id,
    date: iso(-60),
    amountPaise: 5000,
  });
  const txn2 = await createTransaction(db, userId, {
    accountId: tgtAcct.id,
    date: iso(-30),
    amountPaise: 5000,
  });

  const cands1 = await listSipInstallmentCandidates(db, userId, sipId, iso());
  assert.equal(cands1.filter((c) => !c.linked).length, 2, "unlinked=2 (opening excluded)");
  assert.equal(cands1.filter((c) => c.linked).length, 0);

  await linkSipInstallment(db, userId, sipId, { transactionId: txn1.id });

  const cands2 = await listSipInstallmentCandidates(db, userId, sipId, iso());
  assert.equal(cands2.filter((c) => c.linked).length, 1);
  assert.equal(
    cands2.filter((c) => c.linked)[0]!.amountPaise,
    5000,
    "linked amount from posting",
  );
  assert.equal(cands2.filter((c) => !c.linked).length, 1);

  // txn2 referenced to suppress unused-variable lint warning
  assert.ok(txn2.id);

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE5 — categorize.ts: suggestCategoriesFor SQL returns real posting amounts
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE5 — suggestCategoriesFor SQL returns real posting amounts", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank1 = await createAcct(userId, "Bank1", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");

  const [cat] = await db
    .insert(categories)
    .values({ userId, name: "Food", kind: "expense" })
    .returning({ id: categories.id });
  const catId = cat!.id;

  // Ordinary uncategorized
  await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-5),
    amountPaise: -500,
    merchant: "Zomato",
  });

  // Split uncategorized (parent null categoryId)
  const splitTxn = await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-4),
    amountPaise: -1500,
    merchant: "Swiggy",
  });
  await setSplits(db, userId, splitTxn.id, [
    { categoryId: catId, amountPaise: -800, note: "" },
    { categoryId: catId, amountPaise: -700, note: "" },
  ]);

  // Transfer (excluded via clearing postings)
  await createTransfer(db, userId, {
    fromAccountId: bank1.id,
    toAccountId: bank2.id,
    amountPaise: 2000,
    date: iso(-3),
  });

  // Categorized ordinary (excluded)
  await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-2),
    amountPaise: -300,
    merchant: "Uber",
    categoryId: catId,
  });

  // Run the same SQL as suggestCategoriesFor
  const rows = (
    await db.execute(sql`
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
    `)
  ).rows as Array<{ id: string; amount_paise: string }>;

  assert.equal(rows.length, 2, "ordinary + split only");
  const splitRow = rows.find((r) => r.id === splitTxn.id);
  assert.ok(splitRow, "split txn appears in query");
  assert.equal(
    Number(splitRow!.amount_paise),
    -1500,
    "split amount = real posting (-1500), not split sub-amount",
  );

  // Legacy comparison (same transaction IDs)
  const legRows = (
    await db.execute(sql`
      select t.id from transactions t
      where t.user_id = ${userId} and t.deleted_at is null and t.category_id is null
        and not t.is_opening
        and not exists (select 1 from transfer_links tl
          where tl.out_transaction_id = t.id or tl.in_transaction_id = t.id)
      order by t.date desc limit 200
    `)
  ).rows as Array<{ id: string }>;
  assert.deepEqual(
    rows.map((r) => r.id).sort(),
    legRows.map((r) => r.id).sort(),
    "postings query and legacy query return same transaction IDs",
  );

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE6 — user-tasks.ts: listUserTasks returns posting accountId and amountPaise
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE6 — listUserTasks returns posting accountId and amountPaise", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bankAcct = await createAcct(userId, "Bank", "bank");

  const txn = await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(),
    amountPaise: -800,
    merchant: "Task Txn",
  });

  const [linkedTask] = await db
    .insert(userTasks)
    .values({
      userId,
      title: "Linked",
      notes: "",
      transactionId: txn.id,
    })
    .returning({ id: userTasks.id });
  const [freeTask] = await db
    .insert(userTasks)
    .values({
      userId,
      title: "Free",
      notes: "",
    })
    .returning({ id: userTasks.id });

  const tasks = await listUserTasks(db, userId);
  assert.equal(tasks.length, 2);

  const linked = tasks.find((t) => t.id === linkedTask!.id);
  assert.ok(linked?.transaction, "linked task has transaction");
  assert.equal(linked!.transaction!.amountPaise, -800, "amountPaise from posting");
  assert.equal(linked!.transaction!.accountId, bankAcct.id, "accountId from posting");

  const free = tasks.find((t) => t.id === freeTask!.id);
  assert.equal(free!.transaction, null, "unlinked task has null transaction");

  const single = await getUserTask(db, userId, linkedTask!.id);
  assert.equal(single.transaction!.amountPaise, -800);
  assert.equal(single.transaction!.accountId, bankAcct.id);

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE7 — search.ts: search returns one result per transaction, real posting amount
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE7 — search returns one result per transaction, real posting amount", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank1 = await createAcct(userId, "Bank1", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");

  // Ordinary transaction
  await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-5),
    amountPaise: -600,
    merchant: "PE7Merchant",
  });

  // Transfer (clearing postings → excluded)
  const xfer = await createTransfer(db, userId, {
    fromAccountId: bank1.id,
    toAccountId: bank2.id,
    amountPaise: 1500,
    date: iso(-3),
  });

  // Update out-leg merchant to force a match with the search term
  // createTransfer returns TransferResult = { transferLinkId, outTransactionId, inTransactionId }
  await db.execute(
    sql`UPDATE transactions SET merchant = 'PE7Merchant' WHERE id = ${xfer.outTransactionId}`,
  );

  const results = await search(db, userId, "PE7Merchant");
  assert.equal(results.transactions.length, 1, "transfer legs excluded by Pattern C");
  assert.equal(results.transactions[0]!.amountPaise, -600, "amount from posting");
  assert.equal(results.transactions[0]!.merchant, "PE7Merchant");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE8a — imports.ts: applyMapping dedup query parity
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE8a — applyMapping dedup query parity", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bankAcct = await createAcct(userId, "ImportBank", "bank");

  await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-10),
    amountPaise: -3000,
  });
  await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-5),
    amountPaise: -7000,
  });

  const minDate = iso(-15);
  const maxDate = iso(0);

  // Postings-based query (same as applyMapping)
  const postingsRows = await db
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
        eq(postings.accountId, bankAcct.id),
      ),
    )
    .where(
      and(
        eq(transactions.userId, userId),
        gte(transactions.date, minDate),
        lte(transactions.date, maxDate),
      ),
    );

  // Legacy query
  const legacyRows = (
    await db.execute(sql`
      select date, amount_paise, merchant from transactions
      where user_id = ${userId} and account_id = ${bankAcct.id}
        and date >= ${minDate} and date <= ${maxDate}
    `)
  ).rows as Array<{ date: string; amount_paise: string; merchant: string }>;

  assert.equal(postingsRows.length, 2);
  assert.equal(legacyRows.length, 2);
  const pSorted = postingsRows
    .map((r) => `${r.date}|${r.amountPaise}|${r.merchant}`)
    .sort();
  const lSorted = legacyRows
    .map((r) => `${r.date}|${Number(r.amount_paise)}|${r.merchant}`)
    .sort();
  assert.deepEqual(pSorted, lSorted, "applyMapping dedup query parity");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE8b — imports.ts: commitImport reconciliation query parity
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE8b — commitImport reconciliation query parity", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const ccAcct = await createAcct(userId, "CC", "credit_card");

  await createTransaction(db, userId, {
    accountId: ccAcct.id,
    date: iso(-10),
    amountPaise: -5000,
  });
  await createTransaction(db, userId, {
    accountId: ccAcct.id,
    date: iso(-4),
    amountPaise: -12000,
  });

  const start = iso(-15);
  const end = iso(0);

  // Postings-based query (same as commitImport CC reconciliation)
  const postingsRows = await db
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
        eq(postings.accountId, ccAcct.id),
      ),
    )
    .where(
      and(
        eq(transactions.userId, userId),
        isNull(transactions.deletedAt),
        gte(transactions.date, start),
        lte(transactions.date, end),
      ),
    )
    .orderBy(transactions.date, transactions.id);

  // Legacy query
  const legacyRows = (
    await db.execute(sql`
      select id, date, amount_paise, merchant, notes, source from transactions
      where user_id = ${userId} and account_id = ${ccAcct.id} and deleted_at is null
        and date >= ${start} and date <= ${end}
      order by date, id
    `)
  ).rows as Array<{
    id: string;
    date: string;
    amount_paise: string;
    merchant: string;
    notes: string;
    source: string;
  }>;

  assert.equal(postingsRows.length, 2);
  assert.equal(legacyRows.length, 2);
  assert.deepEqual(
    postingsRows.map((r) => ({ id: r.id, amountPaise: r.amountPaise })),
    legacyRows.map((r) => ({ id: r.id, amountPaise: Number(r.amount_paise) })),
    "commitImport reconciliation query parity",
  );

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE9 — insurance.ts: listPolicyPremiums total and amounts from real postings
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE9 — listPolicyPremiums total and amounts from real postings", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bankAcct = await createAcct(userId, "Bank", "bank");

  const [pRow] = await db
    .insert(insurancePolicies)
    .values({
      userId,
      name: "Test Life Policy",
    })
    .returning({ id: insurancePolicies.id });
  const policyId = pRow!.id;

  const txn1 = await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-20),
    amountPaise: -1000,
    merchant: "LIC",
    policyId,
  });
  const txn2 = await createTransaction(db, userId, {
    accountId: bankAcct.id,
    date: iso(-10),
    amountPaise: -2500,
    merchant: "LIC",
    policyId,
  });

  const premiums = await listPolicyPremiums(db, userId, policyId);
  assert.equal(premiums.count, 2);
  assert.equal(premiums.totalPaise, 3500, "total = |−1000| + |−2500|");
  // ordered by date desc, id desc: txn2 (date=-10) first
  assert.equal(premiums.items[0]!.amountPaise, -2500);
  assert.equal(premiums.items[1]!.amountPaise, -1000);
  assert.equal(premiums.items[0]!.accountId, bankAcct.id, "accountId from posting");

  // Legacy comparison
  const legRows = (
    await db.execute(sql`
      select abs(amount_paise) as abs_amt from transactions
      where policy_id = ${policyId} and user_id = ${userId} and deleted_at is null
    `)
  ).rows as Array<{ abs_amt: string }>;
  const legTotal = legRows.reduce((s, r) => s + Number(r.abs_amt), 0);
  assert.equal(premiums.totalPaise, legTotal, "listPolicyPremiums total matches legacy sum");

  // txn1 and txn2 referenced to suppress unused-variable lint warnings
  assert.ok(txn1.id);
  assert.ok(txn2.id);

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});
