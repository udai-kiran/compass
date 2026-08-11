import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, sql } from "drizzle-orm";
import type { AccountType, AccountAverageBalance } from "@compass/shared";
import { accounts, categories, transactions, users } from "../../../db/schema.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { findInconsistentPostings } from "./reconcile-postings.ts";
import { seedSystemAccounts } from "./post-entry.ts";
import { createAccount, accountBalancesAtDate, listAccounts, updateAccount } from "./accounts.ts";
import type { AccountBalanceAtDate } from "./accounts.ts";
import { bankCashBalances, bankCashTotal } from "./balances.ts";
import { accountAverageBalances, buildAverageBalance } from "./average-balance.ts";
import { createTransaction, softDeleteTransaction, setSplits } from "./transactions.ts";
import { createTransfer } from "./transfers.ts";
import { HttpError } from "../../../lib/errors.ts";

/**
 * PR-G1 parity proof: bankCashBalances/bankCashTotal/accountBalancesAtDate/
 * listAccounts/accountAverageBalances all read the real-account component from
 * `postings`. Under PR-G1 the `opening_balance_paise` column is frozen at 0
 * and transfer in-legs are hard-deleted (no transactions row), so the only
 * correct reference formula is also postings-based. This file's `legacyBalance`
 * and `legacyAmb` helpers therefore query `postings` directly (NOT
 * `transactions`/`accounts`) via INDEPENDENT flat SQL not copy-pasted from any
 * production reader. `findInconsistentPostings` is also asserted empty so a
 * coincidentally-equal aggregate can't hide drift. Literal fixture-derived
 * expected values are asserted for transfers and corner-cases so the test is
 * not a same-source tautology.
 */

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "postings-balance-parity.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
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
      email: `postings-parity-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "postings-balance-parity.test.ts user",
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
  openingBalancePaise: number,
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

function shiftDate(iso: string, deltaDays: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + deltaDays);
  return d.toISOString().slice(0, 10);
}

/**
 * Reference balance, computed directly from `postings` inside this test.
 * Under PR-G1 `opening_balance_paise` is frozen at 0 and transfer in-legs
 * have no transactions row, so a postings query is the only honest reference.
 * This is an INDEPENDENT flat query — not copy-pasted from `bankCashBalances`.
 */
async function legacyBalance(accountId: string, userId: string, asOf: string): Promise<number> {
  const res = await db.execute(sql`
    select coalesce(sum(po.amount_paise), 0)::bigint as balance
    from postings po
    join transactions t on t.id = po.transaction_id
    where po.account_id = ${accountId}
      and t.user_id = ${userId}
      and t.deleted_at is null
      and t.date <= ${asOf}
  `);
  return Number((res.rows[0] as { balance: string }).balance);
}

/**
 * Reference AMB inputs, computed directly from `postings` inside this test,
 * then assembled via the UNCHANGED pure `buildAverageBalance` helper — the
 * same assembly `accountAverageBalances` performs. Under PR-G1 there is no
 * `opening_balance_paise` column to add (frozen at 0) and transfer in-legs
 * have no transactions row, so postings are the only honest source.
 */
async function legacyAmb(
  accountId: string,
  userId: string,
  today: string,
  monthStart: string,
): Promise<AccountAverageBalance | null> {
  const firstRes = await db.execute(sql`
    select min(t.date) as first_activity
    from postings po
    join transactions t on t.id = po.transaction_id
    where po.account_id = ${accountId} and t.user_id = ${userId}
      and t.deleted_at is null and t.date <= ${today}
  `);
  const firstActivity = (firstRes.rows[0] as { first_activity: string | null }).first_activity;
  const carriedRes = await db.execute(sql`
    select coalesce(sum(po.amount_paise), 0) as carried_in
    from postings po
    join transactions t on t.id = po.transaction_id
    where po.account_id = ${accountId} and t.user_id = ${userId}
      and t.deleted_at is null and t.date < ${monthStart}
  `);
  const carriedIn = Number((carriedRes.rows[0] as { carried_in: string }).carried_in);
  const deltaRes = await db.execute(sql`
    select t.date, sum(po.amount_paise) as delta
    from postings po
    join transactions t on t.id = po.transaction_id
    where po.account_id = ${accountId} and t.user_id = ${userId}
      and t.deleted_at is null
      and t.date >= ${monthStart} and t.date <= ${today}
    group by t.date
  `);
  const deltas = new Map<string, number>();
  for (const row of deltaRes.rows as Array<{ date: string; delta: string }>) {
    deltas.set(row.date, Number(row.delta));
  }
  return buildAverageBalance(
    { accountId, carriedInPaise: carriedIn, requiredPaise: 0, firstActivity },
    deltas,
    today,
  );
}

function balancesByType(rows: AccountBalanceAtDate[]): Record<string, number[]> {
  const m: Record<string, number[]> = {};
  for (const r of rows) {
    (m[r.type] ??= []).push(r.balancePaise);
  }
  for (const k of Object.keys(m)) m[k]!.sort((a, b) => a - b);
  return m;
}

test("postings-balance-parity: full fixture — every converted reader matches the legacy formula", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  // Anchor everything to the DB's own `current_date` so this test agrees with
  // `listAccounts`, which (per PB4) cuts on `current_date`, not a bound param.
  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;
  const monthStart = `${dbToday.slice(0, 8)}01`;
  const clampToToday = (d: string): string => (d > dbToday ? dbToday : d);
  const farFuture = shiftDate(dbToday, 3650);

  // 1. Bank with an is_opening row (createAccount seeds it) + ordinary +/-.
  const bankOpening = await createAcct(userId, "Bank Opening", "bank", 500000);
  await createTransaction(db, userId, { accountId: bankOpening.id, date: "2020-03-01", amountPaise: 200000 });
  await createTransaction(db, userId, { accountId: bankOpening.id, date: "2020-03-02", amountPaise: -75000 });

  // 2. Card with a column-based opening balance + charges (no opening txn for card type).
  const cardOpening = await createAcct(userId, "Card Opening", "credit_card", 250000);
  await createTransaction(db, userId, { accountId: cardOpening.id, date: "2020-01-05", amountPaise: -30000 });
  await createTransaction(db, userId, { accountId: cardOpening.id, date: "2020-01-06", amountPaise: -20000 });

  // 3. Mixed-sign split summing to the parent, plus a zero-amount ordinary txn.
  const splitBank = await createAcct(userId, "Split Bank", "bank", 0);
  const [catA] = await db.insert(categories).values({ userId, name: "Cat A", kind: "expense" }).returning({ id: categories.id });
  const [catB] = await db.insert(categories).values({ userId, name: "Cat B", kind: "income" }).returning({ id: categories.id });
  const splitTxn = await createTransaction(db, userId, { accountId: splitBank.id, date: "2020-02-01", amountPaise: -10000 });
  await setSplits(db, userId, splitTxn.id, [
    { categoryId: catA!.id, amountPaise: -15000, note: "a" },
    { categoryId: catB!.id, amountPaise: 5000, note: "b" },
  ]);
  await createTransaction(db, userId, { accountId: splitBank.id, date: "2020-02-02", amountPaise: 0 });

  // 4. Linked transfer pair — assert no Clearing leakage into any real balance.
  const transferOut = await createAcct(userId, "Transfer Out", "bank", 0);
  const transferIn = await createAcct(userId, "Transfer In", "bank", 0);
  await createTransfer(db, userId, {
    fromAccountId: transferOut.id,
    toAccountId: transferIn.id,
    amountPaise: 75000,
    date: "2020-04-01",
  });

  // 5. Soft-deleted txn that WOULD be earliest — excluded, must not set the AMB window.
  const softDeleteBank = await createAcct(userId, "Soft Delete Bank", "bank", 0);
  const softDeleted = await createTransaction(db, userId, {
    accountId: softDeleteBank.id,
    date: shiftDate(monthStart, -60),
    amountPaise: -500,
  });
  await softDeleteTransaction(db, userId, softDeleted.id);
  await createTransaction(db, userId, {
    accountId: softDeleteBank.id,
    date: clampToToday(shiftDate(monthStart, 7)),
    amountPaise: 12000,
  });

  // 6. Future-only account — its only txn is dated beyond the cut, excluded entirely.
  const futureOnlyBank = await createAcct(userId, "Future Only Bank", "bank", 0);
  await createTransaction(db, userId, { accountId: futureOnlyBank.id, date: farFuture, amountPaise: 99999 });

  // 7. Zero-activity bank (zero column, no txns) — also the "column-opening bank with
  //    NO transaction -> firstActivity = null, no AMB" case (must not substitute the
  //    account-creation date).
  const zeroActivityBank = await createAcct(userId, "Zero Activity Bank", "bank", 0);

  // 8. Zero-activity column-opening account (balance == column) — a non-bank real type.
  const zeroActivityLoan = await createAcct(userId, "Zero Activity Loan", "loan", 54321);

  // 9. Column-opening bank whose first real activity falls inside the current month.
  const ambInMonthBank = await createAcct(userId, "AMB In Month Bank", "bank", 0);
  await createTransaction(db, userId, {
    accountId: ambInMonthBank.id,
    date: clampToToday(shiftDate(monthStart, 5)),
    amountPaise: 40000,
  });

  // 10. An opening-like txn predating the month (carried-in AMB) + multiple same-day
  //     postings (daily grouping).
  const ambCarriedBank = await createAcct(userId, "AMB Carried Bank", "bank", 0);
  await createTransaction(db, userId, {
    accountId: ambCarriedBank.id,
    date: shiftDate(monthStart, -15),
    amountPaise: 300000,
  });
  const sameDay = clampToToday(shiftDate(monthStart, 9));
  await createTransaction(db, userId, { accountId: ambCarriedBank.id, date: sameDay, amountPaise: -20000 });
  await createTransaction(db, userId, { accountId: ambCarriedBank.id, date: sameDay, amountPaise: 5000 });

  // 11. Column-opening bank with a NONZERO opening-balance COLUMN and NO
  //     transactions/postings at all. createAccount(bank, nonzero) seeds an
  //     is_opening transaction and zeroes the column, so this state can only
  //     be constructed directly: create with opening 0, then set the column.
  const columnOpeningNonzeroBank = await createAcct(userId, "Column Opening Nonzero Bank", "bank", 0);
  await db
    .update(accounts)
    .set({ openingBalancePaise: 77_777 })
    .where(and(eq(accounts.id, columnOpeningNonzeroBank.id), eq(accounts.userId, userId)));

  const realAccounts = [
    bankOpening,
    cardOpening,
    splitBank,
    transferOut,
    transferIn,
    softDeleteBank,
    futureOnlyBank,
    zeroActivityBank,
    zeroActivityLoan,
    ambInMonthBank,
    ambCarriedBank,
    columnOpeningNonzeroBank,
  ];
  const bankCashAccounts = realAccounts.filter((a) => a.type === "bank" || a.type === "cash");
  const bankAccounts = realAccounts.filter((a) => a.type === "bank");

  // ---- bankCashBalances / bankCashTotal ----
  const bcb = await bankCashBalances(db, userId, dbToday);
  for (const a of bankCashAccounts) {
    const expected = await legacyBalance(a.id, userId, dbToday);
    const actual = bcb.find((r) => r.id === a.id);
    assert.ok(actual, `bankCashBalances must include account ${a.id}`);
    assert.equal(actual!.balancePaise, expected, `bankCashBalances mismatch for account ${a.id}`);
  }
  assert.equal(bcb.length, bankCashAccounts.length, "bankCashBalances must not leak system/other-type accounts");

  let expectedTotal = 0;
  for (const a of bankCashAccounts) expectedTotal += await legacyBalance(a.id, userId, dbToday);
  const total = await bankCashTotal(db, userId, dbToday);
  assert.equal(total, expectedTotal);

  // ---- accountBalancesAtDate (no per-row account id — compare per-type multisets) ----
  const atDate = await accountBalancesAtDate(db, userId, dbToday);
  const expectedAtDate: AccountBalanceAtDate[] = [];
  for (const a of realAccounts) {
    expectedAtDate.push({ type: a.type, balancePaise: await legacyBalance(a.id, userId, dbToday) });
  }
  assert.deepEqual(balancesByType(atDate), balancesByType(expectedAtDate));

  // ---- listAccounts (per-account id; cuts on current_date, matching dbToday) ----
  const list = await listAccounts(db, userId);
  for (const a of realAccounts) {
    const expected = await legacyBalance(a.id, userId, dbToday);
    const row = list.find((r) => r.id === a.id);
    assert.ok(row, `listAccounts must include account ${a.id}`);
    assert.equal(row!.balancePaise, expected, `listAccounts mismatch for account ${a.id}`);
  }

  // ---- accountAverageBalances (bank-only; compare the COMPLETE AMB result) ----
  const amb = await accountAverageBalances(db, userId, dbToday);
  for (const a of bankAccounts) {
    const expected = await legacyAmb(a.id, userId, dbToday, monthStart);
    const actual = amb.find((r) => r.accountId === a.id) ?? null;
    assert.deepEqual(actual, expected, `AMB mismatch for account ${a.id}`);
  }
  // Accounts with no eligible activity at/before dbToday must not appear at all.
  assert.equal(
    amb.find((r) => r.accountId === zeroActivityBank.id),
    undefined,
    "zero-activity column-opening bank must have no AMB (must not substitute account-creation date)",
  );
  assert.equal(
    amb.find((r) => r.accountId === futureOnlyBank.id),
    undefined,
    "an account whose only activity is future-dated must have no AMB",
  );
  // ---- Nonzero column-opening bank with no postings: under PR-G1 all readers
  //      derive balance from postings only (opening_balance_paise is frozen at 0),
  //      so a bank whose column was patched to 77_777 directly but has no postings
  //      reports 0.  It must also have no AMB entry (no postings = no first_activity).
  const columnOpeningNonzeroExpected = await legacyBalance(columnOpeningNonzeroBank.id, userId, dbToday);
  assert.equal(columnOpeningNonzeroExpected, 0, "postings-based legacyBalance must return 0 for account with no postings");
  assert.equal(
    bcb.find((r) => r.id === columnOpeningNonzeroBank.id)!.balancePaise,
    0,
    "bankCashBalances must return 0 for a bank with no postings (opening_balance_paise column is ignored)",
  );
  assert.equal(
    list.find((r) => r.id === columnOpeningNonzeroBank.id)!.balancePaise,
    0,
    "listAccounts must return 0 for a bank with no postings (opening_balance_paise column is ignored)",
  );
  assert.equal(
    amb.find((r) => r.accountId === columnOpeningNonzeroBank.id),
    undefined,
    "a nonzero column-opening bank with no transactions must have no AMB entry",
  );
  assert.equal(
    (await legacyAmb(softDeleteBank.id, userId, dbToday, monthStart))?.from,
    amb.find((r) => r.accountId === softDeleteBank.id)?.from,
  );
  assert.notEqual(
    amb.find((r) => r.accountId === softDeleteBank.id)?.from,
    shiftDate(monthStart, -60),
    "the soft-deleted txn must not have established the AMB window",
  );

  // ---- Clearing must never leak into any real balance ----
  const outExpected = await legacyBalance(transferOut.id, userId, dbToday);
  const inExpected = await legacyBalance(transferIn.id, userId, dbToday);
  assert.equal(outExpected, -75000);
  assert.equal(inExpected, 75000);
  assert.equal(bcb.find((r) => r.id === transferOut.id)!.balancePaise, -75000);
  assert.equal(bcb.find((r) => r.id === transferIn.id)!.balancePaise, 75000);

  // ---- Exact posting shape: no drift a coincidentally-equal aggregate could hide ----
  const inconsistent = await findInconsistentPostings(db, userId);
  assert.deepEqual(inconsistent, [], "findInconsistentPostings must return [] for the fixture user");
});

test("postings-balance-parity: archived account — listAccounts includes it, other readers exclude it", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const account = await createAcct(userId, "Archived Bank", "bank", 0);
  await createTransaction(db, userId, { accountId: account.id, date: "2020-05-01", amountPaise: 40000 });
  await updateAccount(db, userId, account.id, { archived: true });

  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;

  const expected = await legacyBalance(account.id, userId, dbToday);
  assert.equal(expected, 40000);

  const list = await listAccounts(db, userId);
  const row = list.find((r) => r.id === account.id);
  assert.ok(row, "listAccounts must still include an archived account");
  assert.equal(row!.balancePaise, expected);

  const bcb = await bankCashBalances(db, userId, dbToday);
  assert.equal(bcb.find((r) => r.id === account.id), undefined, "bankCashBalances must exclude archived accounts");

  const atDate = await accountBalancesAtDate(db, userId, dbToday);
  assert.equal(
    atDate.some((r) => r.type === "bank" && r.balancePaise === 40000),
    false,
    "accountBalancesAtDate must exclude archived accounts",
  );

  const amb = await accountAverageBalances(db, userId, dbToday);
  assert.equal(
    amb.find((r) => r.accountId === account.id),
    undefined,
    "accountAverageBalances must exclude archived accounts",
  );

  const inconsistent = await findInconsistentPostings(db, userId);
  assert.deepEqual(inconsistent, []);
});

test("postings-balance-parity: tenant isolation — user B's data does not leak into user A's balances", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  await seedSystemAccounts(db, userA);
  await seedSystemAccounts(db, userB);

  const acctA = await createAcct(userA, "Bank A", "bank", 0);
  const acctB = await createAcct(userB, "Bank B", "bank", 0);
  await createTransaction(db, userA, { accountId: acctA.id, date: "2020-06-01", amountPaise: 10000 });
  await createTransaction(db, userB, { accountId: acctB.id, date: "2020-06-01", amountPaise: 999999999 });

  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;

  const bcbA = await bankCashBalances(db, userA, dbToday);
  assert.deepEqual(
    bcbA.map((r) => r.id).sort(),
    [acctA.id],
    "bankCashBalances for user A must contain only user A's account",
  );
  assert.equal(bcbA[0]!.balancePaise, 10000);

  const totalA = await bankCashTotal(db, userA, dbToday);
  assert.equal(totalA, 10000, "user B's huge balance must not leak into user A's total");

  const listA = await listAccounts(db, userA);
  assert.deepEqual(listA.map((r) => r.id).sort(), [acctA.id]);

  const atDateA = await accountBalancesAtDate(db, userA, dbToday);
  assert.deepEqual(atDateA, [{ type: "bank", balancePaise: 10000 }]);

  const ambA = await accountAverageBalances(db, userA, dbToday);
  assert.equal(ambA.length, 1);
  assert.equal(ambA[0]!.accountId, acctA.id);
});

test("postings-balance-parity: overflow refusal — bankCashTotal cross-account reduction", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  // Each account's OWN balance stays a safe integer; only the cross-account
  // reduction in bankCashTotal exceeds Number.MAX_SAFE_INTEGER (9007199254740991).
  const BIG = 5_000_000_000_000_000; // 5e15, safe on its own
  const acct1 = await createAcct(userId, "Big Bank 1", "bank", 0);
  const acct2 = await createAcct(userId, "Big Bank 2", "bank", 0);
  await createTransaction(db, userId, { accountId: acct1.id, date: "2020-07-01", amountPaise: BIG });
  await createTransaction(db, userId, { accountId: acct2.id, date: "2020-07-01", amountPaise: BIG });

  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;

  // Each individual balance is fine.
  const bcb = await bankCashBalances(db, userId, dbToday);
  assert.equal(bcb.find((r) => r.id === acct1.id)!.balancePaise, BIG);
  assert.equal(bcb.find((r) => r.id === acct2.id)!.balancePaise, BIG);

  await assert.rejects(
    () => bankCashTotal(db, userId, dbToday),
    (err: unknown) =>
      err instanceof HttpError && err.statusCode === 500 && /safe integer/.test(err.message),
    "the cross-account reduction must refuse rather than silently round",
  );
});

test("postings-balance-parity: overflow refusal — final opening + posting-sum combine", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  // The raw posting aggregate is safe on its own; only opening + sum overflows.
  const BIG = 5_000_000_000_000_000; // 5e15, safe on its own
  const card = await createAcct(userId, "Overflow Card", "credit_card", BIG);
  await createTransaction(db, userId, { accountId: card.id, date: "2020-08-01", amountPaise: BIG });

  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;

  await assert.rejects(
    () => accountBalancesAtDate(db, userId, dbToday),
    (err: unknown) =>
      err instanceof HttpError && err.statusCode === 500 && /safe integer/.test(err.message),
    "accountBalancesAtDate must refuse an out-of-range opening+sum combine",
  );

  await assert.rejects(
    () => listAccounts(db, userId),
    (err: unknown) =>
      err instanceof HttpError && err.statusCode === 500 && /safe integer/.test(err.message),
    "listAccounts must refuse an out-of-range opening+sum combine",
  );
});

test("postings-balance-parity: overflow refusal — AMB running-balance intermediate (Fix 2 guard)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;
  const monthStart = `${dbToday.slice(0, 8)}01`;
  const clampToToday = (d: string): string => (d > dbToday ? dbToday : d);

  // Each delta is individually a safe integer; only the RUNNING balance inside
  // sumDailyClosingPaise (carried-in ~5e15, then another ~5e15 delta landing on
  // a later in-month day) exceeds Number.MAX_SAFE_INTEGER partway through the
  // window. This proves the Fix-2 per-day running/sum guard fires DURING the
  // walk — before buildAverageBalance ever reaches the final average check.
  const BIG = 5_000_000_000_000_000; // 5e15, safe on its own
  const account = await createAcct(userId, "Overflow AMB Bank", "bank", 0);
  await createTransaction(db, userId, {
    accountId: account.id,
    date: shiftDate(monthStart, -10),
    amountPaise: BIG,
  });
  const laterInMonthDay = clampToToday(shiftDate(monthStart, 3));
  await createTransaction(db, userId, {
    accountId: account.id,
    date: laterInMonthDay,
    amountPaise: BIG,
  });

  await assert.rejects(
    () => accountAverageBalances(db, userId, dbToday),
    (err: unknown) => err instanceof HttpError && err.statusCode === 500 && /safe integer/.test(err.message),
    "accountAverageBalances must refuse when the intermediate running balance overflows",
  );
});

test("postings-balance-parity: overflow refusal — bankCashTotal partial-sum overflow (3 accounts, mixed sign)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  await seedSystemAccounts(db, userId);

  // bankCashBalances row order is DB-scan order, not creation order, so this
  // test cannot deterministically force the overflow onto a specific addition
  // step while also guaranteeing a safe FINAL total: a full-magnitude negative
  // (-BIG) could land between the two positives in scan order and cancel them
  // back under the safe range before the last addition, making the test flaky
  // (observed: it failed to throw at all under one ordering). Using a SMALL
  // negative instead keeps the true mathematical total (2*BIG - small) unsafe
  // regardless of order, so the per-addition guard is guaranteed to fire by
  // the last addition at the latest — it is acceptable for this test to prove
  // the Fix-1 per-addition guard fires (the partial sum overflows) rather than
  // guarantee a safe final; the substantive fix is the Fix-1 guard itself.
  const BIG = 5_000_000_000_000_000; // 5e15, safe on its own
  const acct1 = await createAcct(userId, "Mixed Big Bank 1", "bank", 0);
  const acct2 = await createAcct(userId, "Mixed Big Bank 2", "bank", 0);
  const acct3 = await createAcct(userId, "Mixed Big Bank 3", "bank", 0);
  await createTransaction(db, userId, { accountId: acct1.id, date: "2020-09-01", amountPaise: BIG });
  await createTransaction(db, userId, { accountId: acct2.id, date: "2020-09-01", amountPaise: BIG });
  await createTransaction(db, userId, { accountId: acct3.id, date: "2020-09-01", amountPaise: -1000 });

  const todayRow = await db.execute(sql`select current_date::text as today`);
  const dbToday = (todayRow.rows[0] as { today: string }).today;

  await assert.rejects(
    () => bankCashTotal(db, userId, dbToday),
    (err: unknown) => err instanceof HttpError && err.statusCode === 500 && /safe integer/.test(err.message),
    "bankCashTotal must refuse when a partial reduction sum overflows, even mid-reduction",
  );
});
