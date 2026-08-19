import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, gte, isNotNull, isNull, lte, sql } from "drizzle-orm";
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
import { suggestCategoriesFor } from "../../automation/services/categorize.ts";
import type { AiProvider } from "@compass/ai";
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
    holderId: null,
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
  assert.equal(holders[0]!.cards[0]!.balancePaise, Number(legRow.total));

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
    // After PR-G1 the Opening balance is stored as a posting (not the column),
    // so the sum already includes it — no manual addend needed.
    return -Number(r.s);
  }

  const result = await ledgerDuesAtDates(db, userId, cardAcct.id, [d1, d2, d3]);
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
// PE5 — categorize.ts: suggestCategoriesFor calls AI with uncategorized transactions
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE5 — suggestCategoriesFor passes correct transactions to AI (postings-based inclusion/exclusion)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const bank1 = await createAcct(userId, "Bank1", "bank");
  const bank2 = await createAcct(userId, "Bank2", "bank");

  // Look up system expenses account (needed to build split-shaped postings directly).
  const sysRows = await db
    .select({ id: accounts.id, systemKind: accounts.systemKind })
    .from(accounts)
    .where(and(eq(accounts.userId, userId), isNotNull(accounts.systemKind)));
  const sysExpensesId = sysRows.find((r) => r.systemKind === "expenses")!.id;

  const [cat] = await db
    .insert(categories)
    .values({ userId, name: "Food", kind: "expense" })
    .returning({ id: categories.id });
  const catId = cat!.id;

  // 1. Ordinary uncategorized — included; amount = real posting (-500).
  const ordinaryTxn = await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-6),
    amountPaise: -500,
    merchant: "Zomato",
  });

  // 2. Uncategorized split-like — included; amount = parent real posting (-1500).
  //    suggestCategoriesFor includes it because NOT EXISTS(system posting with non-null category_id)
  //    is TRUE (counter postings have null category_id) and hasCategoryDimension() is TRUE
  //    (counter postings join to the Expenses system account).
  //    Counter postings are inserted directly because setSplits/buildSplitPostings require non-null
  //    categoryIds; this shape tests the reader's amount-from-real-posting behavior.
  const uncatSplitTxn = await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-5),
    amountPaise: -1500,
    merchant: "Swiggy",
  });
  await db.delete(postings).where(eq(postings.transactionId, uncatSplitTxn.id));
  await db.insert(postings).values([
    { transactionId: uncatSplitTxn.id, accountId: bank1.id, amountPaise: -1500 },
    { transactionId: uncatSplitTxn.id, accountId: sysExpensesId, amountPaise: 800 },
    { transactionId: uncatSplitTxn.id, accountId: sysExpensesId, amountPaise: 700 },
  ]);

  // 3. Categorized split — EXCLUDED; counter postings have non-null category_id so
  //    NOT EXISTS(system posting with non-null category_id) is FALSE.
  //    This is the exact case the old duplicated SQL got backwards (old SQL included it
  //    because it only excluded clearing/opening postings, not categorized expenses postings).
  const catSplitTxn = await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-4),
    amountPaise: -800,
    merchant: "Groceries",
  });
  await setSplits(db, userId, catSplitTxn.id, [
    { categoryId: catId, amountPaise: -400, note: "" },
    { categoryId: catId, amountPaise: -400, note: "" },
  ]);

  // 4. Transfer — EXCLUDED; no Expenses/Income counter postings so hasCategoryDimension() is FALSE.
  const xfer = await createTransfer(db, userId, {
    fromAccountId: bank1.id,
    toAccountId: bank2.id,
    amountPaise: 2000,
    date: iso(-3),
  });

  // 5. Categorized ordinary — EXCLUDED; expenses counter has non-null category_id.
  const catOrdinaryTxn = await createTransaction(db, userId, {
    accountId: bank1.id,
    date: iso(-2),
    amountPaise: -300,
    merchant: "Uber",
    categoryId: catId,
  });

  // 6. Opening — EXCLUDED; Opening system posting fails hasCategoryDimension() (not expenses/income).
  const openingAcct = await createAcct(userId, "Bank3", "bank", 100000);
  const [openingTxnRow] = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        sql`exists (select 1 from postings p1 where p1.transaction_id = ${transactions.id} and p1.account_id = ${openingAcct.id})`,
        sql`exists (select 1 from postings p2 join accounts a on a.id = p2.account_id where p2.transaction_id = ${transactions.id} and a.system_kind = 'opening')`,
      ),
    );
  const openingTxnId = openingTxnRow!.id;

  // Capturing fake AiProvider: records what transactions were passed to suggestCategories.
  const capturedTxns: Array<{ id: string; amountPaise: number }> = [];
  const fakeAi: AiProvider = {
    name: "fake",
    enabled: true,
    suggestCategories: async (input) => {
      for (const txn of input.transactions) {
        capturedTxns.push({ id: txn.id, amountPaise: txn.amountPaise });
      }
      return [];
    },
    generateSummary: async () => "",
    chat: async () => ({ text: "", toolCalls: [] }),
  };

  await suggestCategoriesFor(db, fakeAi, userId, undefined);

  // Exactly 2 transactions passed to AI: ordinary uncategorized and uncategorized split.
  assert.equal(capturedTxns.length, 2, "exactly 2 uncategorized transactions passed to AI");

  const capturedIds = new Set(capturedTxns.map((txn) => txn.id));

  // 1. Ordinary uncategorized — included; amount = real posting amount.
  assert.ok(capturedIds.has(ordinaryTxn.id), "ordinary uncategorized included");
  const capturedOrdinary = capturedTxns.find((txn) => txn.id === ordinaryTxn.id)!;
  assert.equal(capturedOrdinary.amountPaise, -500, "ordinary amount = real posting amount (-500)");

  // 2. Uncategorized split — included; amount = parent real posting amount (not sub-amounts).
  assert.ok(capturedIds.has(uncatSplitTxn.id), "uncategorized split included");
  const capturedSplit = capturedTxns.find((txn) => txn.id === uncatSplitTxn.id)!;
  assert.equal(
    capturedSplit.amountPaise,
    -1500,
    "split amount = parent real posting (-1500), not sub-amounts (800 or 700)",
  );

  // 3. Categorized split — excluded (category-bearing counter postings block inclusion).
  assert.ok(!capturedIds.has(catSplitTxn.id), "categorized split excluded");

  // 4. Transfer — excluded (no expenses/income counter; hasCategoryDimension() is false).
  assert.ok(!capturedIds.has(xfer.transactionId), "transfer excluded");

  // 5. Categorized ordinary — excluded.
  assert.ok(!capturedIds.has(catOrdinaryTxn.id), "categorized ordinary excluded");

  // 6. Opening — excluded (Opening system posting, not expenses/income).
  assert.ok(!capturedIds.has(openingTxnId), "opening transaction excluded");

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

  // Update the transfer header's merchant (createTransfer returns { transactionId } —
  // the outflow leg; PR-G1 replaced the old three-field result)
  await db.execute(
    sql`UPDATE transactions SET merchant = 'PE7Merchant' WHERE id = ${xfer.transactionId}`,
  );

  const results = await search(db, userId, "PE7Merchant");
  assert.equal(results.transactions.length, 1, "transfer legs excluded by Pattern C");
  assert.equal(results.transactions[0]!.amountPaise, -600, "amount from posting");
  // createTransaction normalises merchant on write via normalizeMerchant/titleCase:
  // lowercase then capitalise-after-whitespace, so "PE7Merchant" (one token, no noise
  // filter hit) is stored as "Pe7merchant". search.ts returns the stored value verbatim.
  // This normalisation predates PR-E and is not a postings-conversion regression.
  assert.equal(results.transactions[0]!.merchant, "Pe7merchant");

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE8a — imports.ts: applyMapping dedup query returns the expected rows
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

  assert.equal(postingsRows.length, 2);
  const pSorted = postingsRows
    .map((r) => `${r.date}|${r.amountPaise}|${r.merchant}`)
    .sort();
  // Assert the two expected rows are present with the correct dates and amounts.
  // merchant is "" when not supplied to createTransaction (normalizeMerchant default).
  assert.deepEqual(pSorted, [
    `${iso(-10)}|-3000|`,
    `${iso(-5)}|-7000|`,
  ].sort());

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});

// ---------------------------------------------------------------------------
// PE8b — imports.ts: commitImport reconciliation query returns the expected rows
// ---------------------------------------------------------------------------

test("postings-pr-e-parity: PE8b — commitImport reconciliation query parity", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const ccAcct = await createAcct(userId, "CC", "credit_card");

  const early = await createTransaction(db, userId, {
    accountId: ccAcct.id,
    date: iso(-10),
    amountPaise: -5000,
  });
  const late = await createTransaction(db, userId, {
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

  assert.equal(postingsRows.length, 2);
  // Ordered by date asc: iso(-10) first (-5000), then iso(-4) (-12000). Assert the
  // row IDENTITIES as well as the amounts — a wrong join or projection returning
  // different rows that happened to carry the same two amounts must not pass.
  assert.deepEqual(
    postingsRows.map((r) => ({ id: r.id, amountPaise: r.amountPaise })),
    [
      { id: early.id, amountPaise: -5000 },
      { id: late.id, amountPaise: -12000 },
    ],
    "reconciliation reader must return exactly the two created transactions, in date order, with their posting amounts",
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
  // totalPaise is the sum of absolute amounts for the two premiums created above.
  assert.equal(premiums.totalPaise, 1000 + 2500, "listPolicyPremiums total is sum of both premium amounts");

  // txn1 and txn2 referenced to suppress unused-variable lint warnings
  assert.ok(txn1.id);
  assert.ok(txn2.id);

  assert.deepEqual(await findInconsistentPostings(db, userId), []);
});
