import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, or } from "drizzle-orm";
import type { AccountType } from "@compass/shared";
import { CreateEpfContributionSchema } from "@compass/shared";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, categories, transactions, transferLinks } from "../schema.ts";
import { users } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { bankCashBalances } from "./balances.ts";
import { listAccounts } from "./accounts.ts";
import { recordEpfContribution } from "./epf-contributions.ts";
import { getTransaction } from "./transactions.ts";

// ---------- DB-backed integration coverage for recordEpfContribution — this is a
// money-path endpoint (creates real ledger entries in a retirement account), so
// mocking is not an option: this repo has no DB-mocking infrastructure. Each test
// creates its own throwaway user(s)/account(s) and cleans them up via t.after().

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "epf-contributions.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres " +
        "connection) — this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) " +
        "before running `npm run test -w apps/api`.",
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
      email: `epf-contributions-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "epf-contributions.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function createAccount(
  userId: string,
  type: AccountType,
  openingBalancePaise = 0,
): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: `Test ${type}`, type, openingBalancePaise })
    .returning({ id: accounts.id });
  return a!.id;
}

async function archiveAccount(accountId: string): Promise<void> {
  await db.update(accounts).set({ archivedAt: new Date() }).where(eq(accounts.id, accountId));
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(categories).where(eq(categories.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function transactionsFor(userId: string, accountId: string) {
  return db
    .select()
    .from(transactions)
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.accountId, accountId),
        isNull(transactions.deletedAt),
      ),
    );
}

async function allTransactionsFor(userId: string) {
  return db
    .select()
    .from(transactions)
    .where(and(eq(transactions.userId, userId), isNull(transactions.deletedAt)));
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------- 1: success shape (AC2) ----------

test("recordEpfContribution: creates exactly one income transaction on the retirement account, tagged, categorized, not a transfer", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const epfAccountId = await createAccount(userId, "epf");
  // Deliberately no digits/UUID in the employer string: createTransaction runs
  // the merchant through normalizeMerchant/heuristicNormalize, which strips
  // long digit runs (reference-number heuristic) — a raw randomUUID() employer
  // would come back mangled by that pre-existing, unrelated normalization, not
  // by anything under test here.
  const employer = "Acme Corp Employer";
  const date = todayIso();

  const result = await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date,
    employer,
    amountPaise: 12_345_00,
    notes: "",
  });

  assert.equal(result.amountPaise, 12_345_00);

  const rows = await transactionsFor(userId, epfAccountId);
  assert.equal(rows.length, 1);
  const row = rows[0]!;
  assert.equal(row.id, result.transactionId);
  assert.equal(row.amountPaise, 12_345_00);
  assert.ok(row.amountPaise > 0);
  assert.equal(row.source, "manual");
  assert.deepEqual(row.tags, ["payslip"]);
  assert.equal(row.merchant, employer);
  assert.ok(row.categoryId !== null);

  const category = await db.query.categories.findFirst({ where: eq(categories.id, row.categoryId!) });
  assert.ok(category);
  assert.equal(category!.kind, "income");
  assert.equal(category!.userId, userId);
  assert.equal(category!.name, "EPF Contribution");

  // Not a transfer: no transferLinkId, and no transfer_links row references it.
  const links = await db
    .select()
    .from(transferLinks)
    .where(or(eq(transferLinks.outTransactionId, row.id), eq(transferLinks.inTransactionId, row.id)));
  assert.equal(links.length, 0);

  // Also prove it via the real API-facing read path: the hydrated transaction
  // (not just the raw table row) reports transferLinkId === null.
  const hydrated = await getTransaction(db, userId, result.transactionId);
  assert.equal(hydrated.isTransfer, false);

  // Exactly one transaction total for this user (no second/bank leg created).
  const all = await allTransactionsFor(userId);
  assert.equal(all.length, 1);
});

// ---------- 2: bank/cash balance provably unaffected (AC4) ----------

test("recordEpfContribution: bank account balance is byte-for-byte unchanged; retirement account balance increases by exactly amountPaise", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const bankAccountId = await createAccount(userId, "bank", 500_000_00);
  const cashAccountId = await createAccount(userId, "cash", 12_345_00);
  const epfAccountId = await createAccount(userId, "epf", 0);

  const beforeBank = await bankCashBalances(db, userId);
  const beforeBankRow = beforeBank.find((b) => b.id === bankAccountId)!;
  const beforeCashRow = beforeBank.find((b) => b.id === cashAccountId)!;
  const beforeList = await listAccounts(db, userId);
  const beforeEpfRow = beforeList.find((a) => a.id === epfAccountId)!;
  const beforeBankListRow = beforeList.find((a) => a.id === bankAccountId)!;
  const beforeCashListRow = beforeList.find((a) => a.id === cashAccountId)!;

  const amountPaise = 9_876_00;
  await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date: todayIso(),
    employer: "Acme",
    amountPaise,
    notes: "",
  });

  const afterBank = await bankCashBalances(db, userId);
  const afterBankRow = afterBank.find((b) => b.id === bankAccountId)!;
  const afterCashRow = afterBank.find((b) => b.id === cashAccountId)!;
  assert.equal(afterBankRow.balancePaise, beforeBankRow.balancePaise);
  assert.equal(afterCashRow.balancePaise, beforeCashRow.balancePaise);

  const afterList = await listAccounts(db, userId);
  const afterBankListRow = afterList.find((a) => a.id === bankAccountId)!;
  const afterCashListRow = afterList.find((a) => a.id === cashAccountId)!;
  assert.equal(afterBankListRow.balancePaise, beforeBankListRow.balancePaise);
  assert.equal(afterCashListRow.balancePaise, beforeCashListRow.balancePaise);

  const afterEpfRow = afterList.find((a) => a.id === epfAccountId)!;
  assert.equal(afterEpfRow.balancePaise, beforeEpfRow.balancePaise + amountPaise);

  // Zero transactions were written to any bank/cash account belonging to this user.
  const bankTxns = await transactionsFor(userId, bankAccountId);
  assert.equal(bankTxns.length, 0);
  const cashTxns = await transactionsFor(userId, cashAccountId);
  assert.equal(cashTxns.length, 0);
});

// ---------- 3: non-retirement destination rejected (AC3a) ----------

for (const type of ["bank", "cash", "credit_card", "loan", "investment"] as const satisfies readonly AccountType[]) {
  test(`recordEpfContribution: a "${type}" destination is rejected 400, zero writes`, async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const destAccountId = await createAccount(userId, type);

    await assert.rejects(
      () =>
        recordEpfContribution(db, userId, {
          toAccountId: destAccountId,
          date: todayIso(),
          employer: "Acme",
          amountPaise: 1000_00,
          notes: "",
        }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal(err.statusCode, 400);
        return true;
      },
    );

    const all = await allTransactionsFor(userId);
    assert.equal(all.length, 0);
  });
}

// ---------- 4: cross-user destination rejected (AC3b) ----------

test("recordEpfContribution: another user's retirement account is rejected 404, zero writes — ownership isolation", async (t) => {
  const ownerUserId = await createUser();
  t.after(() => cleanupUser(ownerUserId));
  const callerUserId = await createUser();
  t.after(() => cleanupUser(callerUserId));
  const otherUsersEpfAccount = await createAccount(ownerUserId, "epf");

  await assert.rejects(
    () =>
      recordEpfContribution(db, callerUserId, {
        toAccountId: otherUsersEpfAccount,
        date: todayIso(),
        employer: "Acme",
        amountPaise: 1000_00,
        notes: "",
      }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  const callerTxns = await allTransactionsFor(callerUserId);
  assert.equal(callerTxns.length, 0);
  const ownerTxns = await allTransactionsFor(ownerUserId);
  assert.equal(ownerTxns.length, 0);
});

// ---------- 5: archived retirement destination rejected (AC3c) ----------

test("recordEpfContribution: an archived retirement account is rejected 400, zero writes", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const epfAccountId = await createAccount(userId, "epf");
  await archiveAccount(epfAccountId);

  await assert.rejects(
    () =>
      recordEpfContribution(db, userId, {
        toAccountId: epfAccountId,
        date: todayIso(),
        employer: "Acme",
        amountPaise: 1000_00,
        notes: "",
      }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 400);
      return true;
    },
  );

  const all = await allTransactionsFor(userId);
  assert.equal(all.length, 0);
});

// ---------- 6: category reuse, not duplication (AC2 detail) ----------

test("recordEpfContribution: the 'EPF Contribution' category is created once and reused on a second call", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const epfAccountId = await createAccount(userId, "epf");

  const first = await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date: todayIso(),
    employer: "Acme",
    amountPaise: 1000_00,
    notes: "",
  });
  const second = await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date: todayIso(),
    employer: "Acme",
    amountPaise: 2000_00,
    notes: "",
  });

  const firstRow = await db.query.transactions.findFirst({ where: eq(transactions.id, first.transactionId) });
  const secondRow = await db.query.transactions.findFirst({ where: eq(transactions.id, second.transactionId) });
  assert.ok(firstRow?.categoryId);
  assert.ok(secondRow?.categoryId);
  assert.equal(firstRow!.categoryId, secondRow!.categoryId);

  const cats = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, "EPF Contribution")));
  assert.equal(cats.length, 1);
});

// ---------- 7: schema-level amount validation (review-2 finding) ----------

const validBase = {
  toAccountId: "00000000-0000-4000-8000-000000000001",
  date: "2026-07-01",
  employer: "Acme",
  notes: "",
};

test("CreateEpfContributionSchema: rejects a zero amount", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, amountPaise: 0 });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects a negative amount", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, amountPaise: -1000_00 });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects a fractional-paise amount", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, amountPaise: 1000.5 });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects an integer above Number.MAX_SAFE_INTEGER", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    amountPaise: Number.MAX_SAFE_INTEGER + 2,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects Infinity", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, amountPaise: Infinity });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects NaN", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, amountPaise: NaN });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: accepts a valid positive integer amount", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, amountPaise: 1000_00 });
  assert.equal(r.success, true);
});
