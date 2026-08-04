import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import type { AccountType } from "@compass/shared";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, recurringTemplates, transactions, users } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { amortize, createEmi, splitInstallments, stepAmortization, upsertEmiDetails } from "./emis.ts";

// ---------- (a) on-schedule payments match amortize()'s per-row arithmetic exactly ----------

test("splitInstallments: on-schedule monthly payments match a hand-computed amortize()-style loop, per row", () => {
  const principalPaise = 100000;
  const annualRateBps = 1200; // 12% p.a. -> 1% monthly
  const startDate = "2026-01-05";
  const payments = [
    { transactionId: "t1", date: "2026-02-05", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-03-05", amountPaise: -34000 },
    { transactionId: "t3", date: "2026-04-05", amountPaise: -34000 },
  ];

  const rows = splitInstallments(principalPaise, annualRateBps, startDate, payments);

  // Hand-implemented amortize()-equivalent loop: one period per payment,
  // reducing-balance, same rounding rule — computed independently of
  // splitInstallments, not by calling amortize() (which only returns
  // aggregates) or splitInstallments itself.
  const r = annualRateBps / 10000 / 12;
  let balance = principalPaise;
  const expected: { principalPaise: number; interestPaise: number; balancePaise: number }[] = [];
  for (const p of payments) {
    const paid = Math.abs(p.amountPaise);
    const interest = Math.round(balance * r);
    const principalPart = Math.min(balance, paid - interest);
    balance -= principalPart;
    expected.push({ principalPaise: principalPart, interestPaise: interest, balancePaise: balance });
  }

  assert.equal(rows.length, 3);
  rows.forEach((row, i) => {
    assert.equal(row.principalPaise, expected[i]!.principalPaise);
    assert.equal(row.interestPaise, expected[i]!.interestPaise);
    assert.equal(row.balancePaise, expected[i]!.balancePaise);
  });

  // Exact hand-traced values (see task's review-2 hand-trace):
  assert.deepEqual(
    rows.map((row) => [row.principalPaise, row.interestPaise, row.balancePaise]),
    [
      [33000, 1000, 67000],
      [33330, 670, 33670],
      [33663, 337, 7],
    ],
  );
  rows.forEach((row) => {
    assert.equal(row.principalPaise + row.interestPaise, Math.abs(row.amountPaise));
  });

  // Tie the ledger-driven algorithm's aggregate back to the real,
  // production amortize() function — not just the test's own
  // hand-rolled parallel loop above.
  const totalInterest = rows.reduce((sum, row) => sum + row.interestPaise, 0);
  const installmentPaise = Math.abs(payments[0]!.amountPaise); // 34000, same for every payment in this fixture
  const { totalInterestPaise } = amortize(
    principalPaise,
    annualRateBps,
    installmentPaise,
    payments.length, // totalInstallments
    payments.length, // paidInstallments — all of them paid, for this fixture
  );
  assert.equal(totalInterest, totalInterestPaise);
});

// ---------- (b) prepayment ----------

test("splitInstallments: a payment larger than the period's interest (prepayment) reduces balance by more than the standard principal share", () => {
  const [row] = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -60000 },
  ]);
  assert.equal(row!.interestPaise, 1000);
  assert.equal(row!.principalPaise, 59000);
  assert.equal(row!.balancePaise, 41000);
  // A standard on-schedule installment of 34000 in the same period would
  // only have taken 33000 off principal (see case (a) row 1) — this
  // prepayment takes off more.
  assert.ok(row!.principalPaise > 33000);
});

// ---------- (c) underpayment / shortfall capitalizes ----------

test("splitInstallments: a payment smaller than the period's interest capitalizes the shortfall, interest capped at paid, principal 0", () => {
  const [row] = splitInstallments(100000, 1200, "2026-01-05", [
    { transactionId: "t1", date: "2026-02-05", amountPaise: -500 },
  ]);
  assert.equal(row!.principalPaise, 0);
  assert.equal(row!.interestPaise, 500);
  assert.equal(row!.principalPaise + row!.interestPaise, 500);
  // periodInterest was 1000 (1% of 100000); only 500 was paid, so the 500
  // shortfall capitalizes: 100000 + 500 = 100500.
  assert.equal(row!.balancePaise, 100500);
});

// ---------- (d) multi-month gap capitalizes skipped months' interest ----------

test("splitInstallments: a 3-calendar-month gap capitalizes the 2 skipped months' interest before charging the paid period", () => {
  const rows = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-05-01", amountPaise: -34000 },
  ]);
  assert.equal(rows.length, 2);
  assert.deepEqual(
    [rows[0]!.principalPaise, rows[0]!.interestPaise, rows[0]!.balancePaise],
    [33000, 1000, 67000],
  );
  // 2 skipped months capitalize: 67000 -> 67670 -> 68347; then the paid
  // period's own interest is round(68347 * 0.01) = 683.
  assert.deepEqual(
    [rows[1]!.principalPaise, rows[1]!.interestPaise, rows[1]!.balancePaise],
    [33317, 683, 35030],
  );
  assert.equal(rows[1]!.principalPaise + rows[1]!.interestPaise, 34000);
});

// ---------- (e) same-month duplicate payment accrues interest once ----------

test("splitInstallments: two payments in the same calendar month accrue interest once, not twice", () => {
  const rows = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-01-10", amountPaise: -20000 },
    { transactionId: "t2", date: "2026-01-25", amountPaise: -10000 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[0]!.interestPaise, 1000);
  // Second same-month payment: no new period, no new interest.
  assert.equal(rows[1]!.interestPaise, 0);
  assert.equal(rows[1]!.principalPaise, 10000);
  assert.equal(rows[1]!.balancePaise, 71000);
});

// ---------- (f) balance never goes negative (payoff/overpayment) ----------

test("splitInstallments: an overshoot payment floors balance at 0 without attributing the excess", () => {
  const [row] = splitInstallments(1000, 0, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -5000 },
  ]);
  assert.equal(row!.principalPaise, 1000);
  assert.equal(row!.interestPaise, 0);
  assert.equal(row!.balancePaise, 0);
  // principal + interest (1000) is strictly less than paid (5000) on a
  // payoff/overpayment row — the excess is unattributed by design.
  assert.ok(row!.principalPaise + row!.interestPaise < Math.abs(row!.amountPaise));
});

// ---------- (g) a payment after payoff produces a 0/0/0 row, no crash ----------

test("splitInstallments: a transaction landing after the loan is already paid off produces a 0/0/0 row", () => {
  const rows = splitInstallments(1000, 0, "2026-01-01", [
    { transactionId: "t1", date: "2026-02-01", amountPaise: -5000 },
    { transactionId: "t2", date: "2026-03-01", amountPaise: -2000 },
  ]);
  assert.equal(rows.length, 2);
  assert.equal(rows[1]!.principalPaise, 0);
  assert.equal(rows[1]!.interestPaise, 0);
  assert.equal(rows[1]!.balancePaise, 0);
});

// ---------- (h) empty payments list ----------

test("splitInstallments: an empty payments list returns []", () => {
  assert.deepEqual(splitInstallments(100000, 1200, "2026-01-01", []), []);
});

// ---------- (i) first payment lands in the same calendar month as startDate ----------

test("splitInstallments: the first payment landing in the same calendar month as startDate still accrues one period of interest", () => {
  const [row] = splitInstallments(100000, 1200, "2026-01-01", [
    { transactionId: "t1", date: "2026-01-15", amountPaise: -5000 },
  ]);
  // Unlike a later same-month payment (case (e), row 2), the very first
  // payment always charges at least one period — that month IS the first
  // period, even though calendarMonthsBetween(startDate, paymentDate) is 0.
  assert.equal(row!.interestPaise, 1000);
  assert.equal(row!.principalPaise, 4000);
  assert.equal(row!.balancePaise, 96000);
});

// ---------- (j) a December -> January gap computes the same elapsed-month count as an equal-length same-year gap ----------

test("splitInstallments: a gap crossing a December-January year boundary computes the same elapsed-month count as a same-year gap of equal length", () => {
  const crossesYearBoundary = splitInstallments(100000, 1200, "2025-10-01", [
    { transactionId: "t1", date: "2025-11-01", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-02-01", amountPaise: -34000 },
  ]);
  const sameYear = splitInstallments(100000, 1200, "2026-04-01", [
    { transactionId: "t1", date: "2026-05-01", amountPaise: -34000 },
    { transactionId: "t2", date: "2026-08-01", amountPaise: -34000 },
  ]);
  const strip = (rows: ReturnType<typeof splitInstallments>) =>
    rows.map((row) => [row.principalPaise, row.interestPaise, row.balancePaise]);
  assert.deepEqual(strip(crossesYearBoundary), strip(sameYear));
});

// ---------- stepAmortization (P3): shares the exact formula splitInstallments's
// elapsed>=1 branch now delegates to; cross-checked against the same fixtures ----------

test("stepAmortization: matches splitInstallments's case (a) first-row numbers exactly", () => {
  const step = stepAmortization(100000, 1200, -34000);
  assert.deepEqual(step, { principalPaise: 33000, interestPaise: 1000, balancePaise: 67000 });
});

test("stepAmortization: an underpayment step matches case (c) — interest capped at paid, principal 0, shortfall capitalizes", () => {
  const step = stepAmortization(100000, 1200, -500);
  assert.deepEqual(step, { principalPaise: 0, interestPaise: 500, balancePaise: 100500 });
});

test("stepAmortization: an overshoot/payoff step matches case (f) — balance floors at 0, excess unattributed", () => {
  const step = stepAmortization(1000, 0, -5000);
  assert.deepEqual(step, { principalPaise: 1000, interestPaise: 0, balancePaise: 0 });
});

// ---------- DB-backed: createEmi / upsertEmiDetails destination-account handling (P3/P4) ----------
//
// These need a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure. Each test creates its own throwaway user(s) and
// cleans them up via t.after(), so it's safe to run against a shared dev DB.

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "emis.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
        "this repo has no DB-mocking infrastructure. Export it (see apps/api/.env) before " +
        "running `npm run test -w apps/api`.",
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
      email: `emis-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "emis.test.ts user",
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

/** Inserts a real installment payment row satisfying upsertEmiDetails's P4 history predicate. */
async function insertInstallmentHistory(
  userId: string,
  accountId: string,
  templateId: string,
): Promise<void> {
  await db.insert(transactions).values({
    userId,
    accountId,
    date: "2026-01-05",
    amountPaise: -34000,
    source: "recurring",
    recurringTemplateId: templateId,
  });
}

/** Deletes everything a test user (and its accounts/templates) created — order matters for FKs. */
async function cleanupUser(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(recurringTemplates).where(eq(recurringTemplates.userId, userId)); // cascades emi_details
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

// startDate is deliberately far in the *future* (never "due"): these tests
// only exercise createEmi/upsertEmiDetails validation, never materializeDue.
// materializeDue is a *global*, unscoped batch job — if this EMI's
// nextDueDate were in the past, a concurrently-running recurring.test.ts
// test (a separate process, same shared DB) could race materializeDue
// against this file's own cleanup and post a transaction against an account
// this file is mid-deleting.
const emiInput = (accountId: string, loanAccountId: string | null = null) => ({
  accountId,
  name: "Test EMI",
  principalPaise: 100000,
  annualRateBps: 1200,
  totalInstallments: 3,
  startDate: "2099-01-05",
  loanAccountId,
});

for (const destType of ["loan", "home_loan_od", "overdraft"] as const) {
  test(`createEmi: an owned ${destType}-type destination account is accepted`, async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const sourceId = await createAccount(userId, "bank");
    const destId = await createAccount(userId, destType, -100000);
    const emi = await createEmi(db, userId, emiInput(sourceId, destId));
    assert.equal(emi.loanAccountId, destId);
  });
}

test("createEmi: no destination account (null) creates an EMI exactly as before this feature", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const emi = await createEmi(db, userId, emiInput(sourceId, null));
  assert.equal(emi.loanAccountId, null);
});

test("createEmi: another user's account as destination is rejected with 404", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const sourceId = await createAccount(userA, "bank");
  const otherUsersAccount = await createAccount(userB, "loan", -100000);
  await assert.rejects(
    createEmi(db, userA, emiInput(sourceId, otherUsersAccount)),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("createEmi: an archived destination account is rejected with 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  await archiveAccount(destId);
  await assert.rejects(
    createEmi(db, userId, emiInput(sourceId, destId)),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("createEmi: a destination account equal to the source account is rejected with 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  await assert.rejects(
    createEmi(db, userId, emiInput(sourceId, sourceId)),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

for (const badType of ["investment", "bank"] as const) {
  test(`createEmi: a non-eligible destination type (${badType}) is rejected with 400`, async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const sourceId = await createAccount(userId, "bank");
    const destId = await createAccount(userId, badType);
    await assert.rejects(
      createEmi(db, userId, emiInput(sourceId, destId)),
      (e: unknown) => e instanceof HttpError && e.statusCode === 400,
    );
  });
}

test("createEmi: a credit_card destination is rejected with 400 (deliberately excluded from EMI_DESTINATION_TYPES)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "credit_card");
  await assert.rejects(
    createEmi(db, userId, emiInput(sourceId, destId)),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

// ---------- upsertEmiDetails's P4 attach/detach/repoint transition rules ----------

test("upsertEmiDetails: null -> non-null with no installment history is allowed", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, emiInput(sourceId, null));
  const updated = await upsertEmiDetails(db, userId, emi.templateId, {
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2026-01-05",
    loanAccountId: destId,
  });
  assert.equal(updated.loanAccountId, destId);
});

test("upsertEmiDetails: null -> non-null with real installment history present is rejected with 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, emiInput(sourceId, null));
  await insertInstallmentHistory(userId, sourceId, emi.templateId);
  await assert.rejects(
    upsertEmiDetails(db, userId, emi.templateId, {
      principalPaise: 100000,
      annualRateBps: 1200,
      totalInstallments: 3,
      startDate: "2026-01-05",
      loanAccountId: destId,
    }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("upsertEmiDetails: non-null -> null (detach) is always allowed", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, emiInput(sourceId, destId));
  const updated = await upsertEmiDetails(db, userId, emi.templateId, {
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2026-01-05",
    loanAccountId: null,
  });
  assert.equal(updated.loanAccountId, null);
});

test("upsertEmiDetails: non-null -> a different non-null (repoint) is always rejected with 400, regardless of history", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destA = await createAccount(userId, "loan", -100000);
  const destB = await createAccount(userId, "loan", -50000);
  const emi = await createEmi(db, userId, emiInput(sourceId, destA));
  await assert.rejects(
    upsertEmiDetails(db, userId, emi.templateId, {
      principalPaise: 100000,
      annualRateBps: 1200,
      totalInstallments: 3,
      startDate: "2026-01-05",
      loanAccountId: destB,
    }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("upsertEmiDetails: an unchanged loanAccountId is a no-op — no attach/detach/repoint validation triggered", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, emiInput(sourceId, destId));
  // Would be rejected as a repoint if the "unchanged" case were mishandled —
  // passing the same id back must succeed.
  const updated = await upsertEmiDetails(db, userId, emi.templateId, {
    principalPaise: 100000,
    annualRateBps: 1300, // change something else, to prove this is a real full-replace upsert
    totalInstallments: 3,
    startDate: "2026-01-05",
    loanAccountId: destId,
  });
  assert.equal(updated.loanAccountId, destId);
  assert.equal(updated.annualRateBps, 1300);
});

test("upsertEmiDetails: an unchanged loanAccountId is not revalidated, even if it would now fail validation", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, emiInput(sourceId, destId));
  // Archive the destination *after* attaching it — if upsertEmiDetails
  // revalidated an unchanged loanAccountId, resubmitting the same id would
  // now 400 (archived destination). Per TASK.md P4/P7, an unchanged value
  // must be a no-op with no validation triggered, so this must still
  // succeed.
  await archiveAccount(destId);
  const updated = await upsertEmiDetails(db, userId, emi.templateId, {
    principalPaise: 100000,
    annualRateBps: 1300, // change something else, to prove it's a real upsert
    totalInstallments: 3,
    startDate: "2026-01-05",
    loanAccountId: destId,
  });
  assert.equal(updated.loanAccountId, destId);
  assert.equal(updated.annualRateBps, 1300);
});
