import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import type { AccountType } from "@compass/shared";
import { CreateEpfContributionSchema } from "@compass/shared";
import { createDb, type Db } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, categories, postings, transactions } from "../schema.ts";
import { users } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { bankCashBalances } from "./balances.ts";
import { listAccounts } from "./accounts.ts";
import { recordEpfContribution } from "./epf-contributions.ts";
import { getTransaction } from "./transactions.ts";
import { resolveSystemAccounts, postTransaction } from "./post-entry.ts";
import { buildOpeningPostings } from "./postings.ts";

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
    .select({
      id: transactions.id,
      date: transactions.date,
      source: transactions.source,
      tags: transactions.tags,
      merchant: transactions.merchant,
      amountPaise: postings.amountPaise,
      categoryId: postings.categoryId,
    })
    .from(transactions)
    .innerJoin(postings, and(eq(postings.transactionId, transactions.id), eq(postings.accountId, accountId)))
    .where(
      and(
        eq(transactions.userId, userId),
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
    employeeSharePaise: 6_000_00,
    employerSharePaise: 2_345_00,
    pensionSharePaise: 4_000_00,
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

  // Not a transfer: prove via the real API-facing read path.
  // (transfer_links table was dropped in PR-G2; transfer shape is now a single
  // header with two postings — isTransfer is derived from postings alone.)
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
    employeeSharePaise: 5_000_00,
    employerSharePaise: 1_376_00,
    pensionSharePaise: 3_500_00,
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
          employeeSharePaise: 1000_00,
          employerSharePaise: 0,
          pensionSharePaise: 0,
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
        employeeSharePaise: 1000_00,
        employerSharePaise: 0,
        pensionSharePaise: 0,
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
        employeeSharePaise: 1000_00,
        employerSharePaise: 0,
        pensionSharePaise: 0,
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
    employeeSharePaise: 1000_00,
    employerSharePaise: 0,
    pensionSharePaise: 0,
    notes: "",
  });
  const second = await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date: todayIso(),
    employer: "Acme",
    employeeSharePaise: 2000_00,
    employerSharePaise: 0,
    pensionSharePaise: 0,
    notes: "",
  });

  // categoryId now lives on the counter posting, not on the transaction header
  const firstPosting = await db.query.postings.findFirst({
    where: and(eq(postings.transactionId, first.transactionId), isNotNull(postings.categoryId)),
  });
  const secondPosting = await db.query.postings.findFirst({
    where: and(eq(postings.transactionId, second.transactionId), isNotNull(postings.categoryId)),
  });
  assert.ok(firstPosting?.categoryId);
  assert.ok(secondPosting?.categoryId);
  assert.equal(firstPosting!.categoryId, secondPosting!.categoryId);

  const cats = await db
    .select()
    .from(categories)
    .where(and(eq(categories.userId, userId), eq(categories.name, "EPF Contribution")));
  assert.equal(cats.length, 1);
});

// ---------- 7: schema-level field validation ----------

const validBase = {
  toAccountId: "00000000-0000-4000-8000-000000000001",
  date: "2026-07-01",
  employer: "Acme",
  notes: "",
};

const validThreeFields = {
  employeeSharePaise: 6_000_00,
  employerSharePaise: 2_345_00,
  pensionSharePaise: 4_000_00,
};

// Per-field rejection tests — employeeSharePaise
test("CreateEpfContributionSchema: rejects negative employeeSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employeeSharePaise: -1,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects fractional employeeSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employeeSharePaise: 1000.5,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects Infinity for employeeSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employeeSharePaise: Infinity,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects NaN for employeeSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employeeSharePaise: NaN,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects unsafe-integer employeeSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employeeSharePaise: Number.MAX_SAFE_INTEGER + 2,
  });
  assert.equal(r.success, false);
});

// Per-field rejection tests — employerSharePaise
test("CreateEpfContributionSchema: rejects negative employerSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employerSharePaise: -1,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects fractional employerSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employerSharePaise: 1000.5,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects Infinity for employerSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employerSharePaise: Infinity,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects NaN for employerSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employerSharePaise: NaN,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects unsafe-integer employerSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    employerSharePaise: Number.MAX_SAFE_INTEGER + 2,
  });
  assert.equal(r.success, false);
});

// Per-field rejection tests — pensionSharePaise
test("CreateEpfContributionSchema: rejects negative pensionSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    pensionSharePaise: -1,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects fractional pensionSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    pensionSharePaise: 1000.5,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects Infinity for pensionSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    pensionSharePaise: Infinity,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects NaN for pensionSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    pensionSharePaise: NaN,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects unsafe-integer pensionSharePaise", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    ...validThreeFields,
    pensionSharePaise: Number.MAX_SAFE_INTEGER + 2,
  });
  assert.equal(r.success, false);
});

// Acceptance tests — individual zero while others are positive
test("CreateEpfContributionSchema: accepts zero employeeSharePaise when others are positive", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    employeeSharePaise: 0,
    employerSharePaise: 2_345_00,
    pensionSharePaise: 4_000_00,
  });
  assert.equal(r.success, true);
});

test("CreateEpfContributionSchema: accepts zero employerSharePaise when others are positive", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    employeeSharePaise: 6_000_00,
    employerSharePaise: 0,
    pensionSharePaise: 4_000_00,
  });
  assert.equal(r.success, true);
});

test("CreateEpfContributionSchema: accepts zero pensionSharePaise when others are positive", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    employeeSharePaise: 6_000_00,
    employerSharePaise: 2_345_00,
    pensionSharePaise: 0,
  });
  assert.equal(r.success, true);
});

// Refine tests
test("CreateEpfContributionSchema: rejects all-zero fields", () => {
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    employeeSharePaise: 0,
    employerSharePaise: 0,
    pensionSharePaise: 0,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: rejects unsafe aggregate total", () => {
  // Each field is individually safe but their sum exceeds MAX_SAFE_INTEGER
  const r = CreateEpfContributionSchema.safeParse({
    ...validBase,
    employeeSharePaise: Number.MAX_SAFE_INTEGER - 1,
    employerSharePaise: Number.MAX_SAFE_INTEGER - 1,
    pensionSharePaise: Number.MAX_SAFE_INTEGER - 1,
  });
  assert.equal(r.success, false);
});

test("CreateEpfContributionSchema: accepts valid three-field combination", () => {
  const r = CreateEpfContributionSchema.safeParse({ ...validBase, ...validThreeFields });
  assert.equal(r.success, true);
});

// ---------- 8: notes-behavior tests ----------

test("recordEpfContribution: blank notes → transaction notes contain EE/ER/EPS breakdown", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const epfAccountId = await createAccount(userId, "epf");

  const result = await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date: todayIso(),
    employer: "Acme",
    employeeSharePaise: 6_000_00,
    employerSharePaise: 2_345_00,
    pensionSharePaise: 4_000_00,
    notes: "",
  });

  const row = await db.query.transactions.findFirst({
    where: eq(transactions.id, result.transactionId),
  });
  assert.ok(row);
  assert.ok(row!.notes?.includes("EE:"), "notes should include EE: breakdown");
  assert.ok(row!.notes?.includes("ER:"), "notes should include ER: breakdown");
  assert.ok(row!.notes?.includes("EPS:"), "notes should include EPS: breakdown");
});

test("recordEpfContribution: custom notes → notes starts with breakdown then custom text", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const epfAccountId = await createAccount(userId, "epf");

  const result = await recordEpfContribution(db, userId, {
    toAccountId: epfAccountId,
    date: todayIso(),
    employer: "Acme",
    employeeSharePaise: 6_000_00,
    employerSharePaise: 2_345_00,
    pensionSharePaise: 4_000_00,
    notes: "my custom note",
  });

  const row = await db.query.transactions.findFirst({
    where: eq(transactions.id, result.transactionId),
  });
  assert.ok(row);
  assert.ok(row!.notes?.startsWith("EE:"), "notes should start with EE: breakdown");
  assert.ok(
    row!.notes?.includes("\nmy custom note"),
    "notes should contain custom text after newline",
  );
});

// ---------- openingTransactionPaise coverage (P2–P5) ----------
//
// These tests exercise the postings-based EXISTS subquery in listAccounts that
// detects opening transactions via `system_kind = 'opening'` accounts. The old
// `is_opening` column on transactions was dropped in PR-G2; detection is now
// purely through the posting graph.

/**
 * Creates an opening transaction for the given account via the canonical
 * path used by createAccount / updateAccount: insert the transaction header,
 * then call postTransaction with buildOpeningPostings. The helper is
 * intentionally NOT idempotent — it inserts a new transaction each time,
 * which is what P5 (duplicate sum) relies on.
 */
async function createOpeningTransaction(
  db: Db,
  userId: string,
  accountId: string,
  amountPaise: number,
  date = new Date().toISOString().slice(0, 10),
): Promise<string> {
  const sys = await resolveSystemAccounts(db, userId);
  const [txn] = await db
    .insert(transactions)
    .values({ userId, date, merchant: "Opening balance" })
    .returning({ id: transactions.id });
  await postTransaction(
    db,
    txn!.id,
    userId,
    buildOpeningPostings({
      accountId,
      amountPaise,
      systemOpeningAccountId: sys.opening,
    }),
  );
  return txn!.id;
}

describe("listAccounts openingTransactionPaise", () => {
  // P2 -----------------------------------------------------------------------

  test("returns the opening amount", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const accountId = await createAccount(userId, "epf");

    await createOpeningTransaction(db, userId, accountId, 500_000);

    const list = await listAccounts(db, userId);
    const row = list.find((a) => a.id === accountId)!;
    assert.equal(row.openingTransactionPaise, 500_000);
    // The accounts.opening_balance_paise column stays 0 — the amount lives
    // in the ledger (postings), not on the account row.
    assert.equal(row.openingBalancePaise, 0);
  });

  // P3a ----------------------------------------------------------------------

  test("soft-deleted opening transaction is excluded", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const accountId = await createAccount(userId, "epf");

    const txnId = await createOpeningTransaction(db, userId, accountId, 500_000);
    // Soft-delete: same mechanism used by softDeleteTransaction; every balance
    // surface filters `deleted_at is null`, so the amount stops counting.
    await db
      .update(transactions)
      .set({ deletedAt: new Date() })
      .where(eq(transactions.id, txnId));

    const list = await listAccounts(db, userId);
    const row = list.find((a) => a.id === accountId)!;
    assert.equal(row.openingTransactionPaise, 0);
  });

  // P3b ----------------------------------------------------------------------

  test("non-opening transaction is excluded", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const accountId = await createAccount(userId, "epf");

    await createOpeningTransaction(db, userId, accountId, 500_000);

    // An EPF contribution posts to the Income system account (system_kind =
    // 'income'), not the Opening system account.  The EXISTS subquery in
    // openingTxnPaise requires system_kind = 'opening', so this transaction
    // must not be counted in openingTransactionPaise.
    await recordEpfContribution(db, userId, {
      toAccountId: accountId,
      date: todayIso(),
      employer: "Acme",
      employeeSharePaise: 200_000,
      employerSharePaise: 0,
      pensionSharePaise: 0,
      notes: "",
    });

    const list = await listAccounts(db, userId);
    const row = list.find((a) => a.id === accountId)!;
    // Only the opening transaction is counted; the income transaction is excluded.
    assert.equal(row.openingTransactionPaise, 500_000);
  });

  // P3c ----------------------------------------------------------------------

  test("cross-user isolation", async (t) => {
    const userAId = await createUser();
    t.after(() => cleanupUser(userAId));
    const userBId = await createUser();
    t.after(() => cleanupUser(userBId));

    const accountA = await createAccount(userAId, "epf");
    const accountB = await createAccount(userBId, "epf");

    await createOpeningTransaction(db, userAId, accountA, 300_000);
    await createOpeningTransaction(db, userBId, accountB, 700_000);

    const listA = await listAccounts(db, userAId);
    const rowA = listA.find((a) => a.id === accountA)!;
    assert.equal(rowA.openingTransactionPaise, 300_000);

    const listB = await listAccounts(db, userBId);
    const rowB = listB.find((a) => a.id === accountB)!;
    assert.equal(rowB.openingTransactionPaise, 700_000);
  });

  // P4 -----------------------------------------------------------------------

  test("future-dated opening is included (no date cut on openingTransactionPaise)", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const accountId = await createAccount(userId, "epf");

    await createOpeningTransaction(db, userId, accountId, 500_000, "2099-01-01");

    const list = await listAccounts(db, userId);
    const row = list.find((a) => a.id === accountId)!;
    // openingTransactionPaise has no date filter, so future-dated opening
    // rows are always included regardless of current_date.
    assert.equal(row.openingTransactionPaise, 500_000);
    // postingSum DOES apply date <= current_date, so the future transaction
    // does not yet contribute to the running balance.
    assert.equal(row.balancePaise, 0);
  });

  // P5 -----------------------------------------------------------------------

  test("duplicate opening rows sum", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const accountId = await createAccount(userId, "epf");

    await createOpeningTransaction(db, userId, accountId, 500_000);
    await createOpeningTransaction(db, userId, accountId, 500_000);

    const list = await listAccounts(db, userId);
    const row = list.find((a) => a.id === accountId)!;
    // Documents non-idempotent behavior when duplicates exist;
    // planOpeningBalanceChange prevents this by construction (it finds and
    // updates the existing opening row rather than inserting a second one).
    assert.equal(row.openingTransactionPaise, 1_000_000);
  });
});
