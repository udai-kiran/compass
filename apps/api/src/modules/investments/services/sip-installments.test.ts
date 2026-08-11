import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import {
  accountInstallmentSipIssue,
  candidateDateBounds,
  installmentDateError,
  linkInstallmentIssue,
  linkSipInstallment,
  listSipInstallmentCandidates,
} from "./sip-installments.ts";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, goals, sips, transactions, users } from "../../../db/schema.ts";
import { seedSystemAccounts } from "../../ledger/services/post-entry.ts";
import { createTransaction } from "../../ledger/services/transactions.ts";

// ---------- installmentDateError (recordSipInstallment: date must fall within the SIP's life) ----------

test("installmentDateError: a date before startDate is rejected", () => {
  assert.equal(
    installmentDateError({ startDate: "2026-01-01", endDate: null }, "2025-12-31"),
    "Installment date is before the SIP started",
  );
});

test("installmentDateError: a date after endDate is rejected", () => {
  assert.equal(
    installmentDateError({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-07-01"),
    "Installment date is after the SIP ended",
  );
});

test("installmentDateError: a date inside the range is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: "2026-12-31" }, "2026-06-15"), null);
});

test("installmentDateError: a null endDate (open-ended) is valid for any date on/after start", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: null }, "2030-01-01"), null);
});

test("installmentDateError: exactly on startDate is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: null }, "2026-01-01"), null);
});

test("installmentDateError: exactly on endDate is valid", () => {
  assert.equal(installmentDateError({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-06-30"), null);
});

// ---------- linkInstallmentIssue / accountInstallmentSipIssue / candidateDateBounds ----------

const linkSip = {
  id: "sip-1",
  targetKind: "account" as const,
  targetAccountId: "acc-ppf",
  fundingSource: "bank_debit" as const,
  startDate: "2026-01-01",
  endDate: null,
};
const linkTx = { accountId: "acc-ppf", amountPaise: 150000, date: "2026-07-02", isOpening: false, sipId: null };

test("linkInstallmentIssue: a credit into the target account inside the window passes", () => {
  assert.equal(linkInstallmentIssue(linkSip, linkTx), null);
});

test("linkInstallmentIssue: an mf_folio SIP is rejected", () => {
  assert.deepEqual(linkInstallmentIssue({ ...linkSip, targetKind: "mf_folio" }, linkTx), {
    status: 400,
    message: "Only an account-target SIP records by linking a ledger transaction",
  });
});

test("linkInstallmentIssue: an account SIP funded by payroll is rejected", () => {
  assert.deepEqual(linkInstallmentIssue({ ...linkSip, fundingSource: "payroll" }, linkTx), {
    status: 400,
    message: "A payroll-funded SIP is recorded from your payslip, not manually",
  });
});

test("linkInstallmentIssue: a transaction in some other account is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, accountId: "acc-other" }), {
    status: 400,
    message: "That transaction isn't in this SIP's target account",
  });
});

test("linkInstallmentIssue: an opening-balance row is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, isOpening: true }), {
    status: 400,
    message: "An opening-balance entry can't be a SIP installment",
  });
});

test("linkInstallmentIssue: a negative amount (the transfer's outgoing leg) is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, amountPaise: -150000 }), {
    status: 400,
    message: "A SIP installment must be money arriving in the target account",
  });
});

test("linkInstallmentIssue: a zero amount is rejected", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, amountPaise: 0 }), {
    status: 400,
    message: "A SIP installment must be money arriving in the target account",
  });
});

test("linkInstallmentIssue: a row already linked to a different SIP is rejected 409", () => {
  assert.deepEqual(linkInstallmentIssue(linkSip, { ...linkTx, sipId: "sip-2" }), {
    status: 409,
    message: "That transaction is already linked to another SIP's installment",
  });
});

test("linkInstallmentIssue: a row already linked to this SIP passes — the idempotent re-link", () => {
  assert.equal(linkInstallmentIssue(linkSip, { ...linkTx, sipId: "sip-1" }), null);
});

test("linkInstallmentIssue: a date before startDate is rejected with installmentDateError's own message", () => {
  const tx = { ...linkTx, date: "2025-12-31" };
  assert.deepEqual(linkInstallmentIssue(linkSip, tx), {
    status: 400,
    message: installmentDateError(linkSip, tx.date)!,
  });
});

test("linkInstallmentIssue: a date after endDate is rejected with installmentDateError's own message", () => {
  const sip = { ...linkSip, endDate: "2026-06-30" };
  const tx = { ...linkTx, date: "2026-07-01" };
  assert.deepEqual(linkInstallmentIssue(sip, tx), {
    status: 400,
    message: installmentDateError(sip, tx.date)!,
  });
});

test("accountInstallmentSipIssue: null for an account+bank_debit SIP", () => {
  assert.equal(accountInstallmentSipIssue({ targetKind: "account", fundingSource: "bank_debit" }), null);
});

test("candidateDateBounds: asOf inside the window returns { from: startDate, to: asOf }", () => {
  assert.deepEqual(candidateDateBounds({ startDate: "2026-01-01", endDate: null }, "2026-07-23"), {
    from: "2026-01-01",
    to: "2026-07-23",
  });
});

test("candidateDateBounds: asOf past endDate clamps to to endDate", () => {
  assert.deepEqual(candidateDateBounds({ startDate: "2026-01-01", endDate: "2026-06-30" }, "2026-07-23"), {
    from: "2026-01-01",
    to: "2026-06-30",
  });
});

test("candidateDateBounds: an open-ended SIP (endDate: null) never clamps", () => {
  assert.deepEqual(candidateDateBounds({ startDate: "2026-01-01", endDate: null }, "2099-12-31"), {
    from: "2026-01-01",
    to: "2099-12-31",
  });
});

test("candidateDateBounds: asOf before startDate yields an inverted (empty) window", () => {
  const { from, to } = candidateDateBounds({ startDate: "2026-01-01", endDate: null }, "2025-12-01");
  assert.ok(to < from);
});

// ---------- DB-backed: listSipInstallmentCandidates — linked row survives posting move ----------
//
// Real Postgres, following reconciliation-writes.test.ts's harness pattern.
// Tests the B3 fix: linkedInstallmentRows must not filter by account_id, so a
// linked installment remains visible even after its posting migrates to a
// different account (e.g. when a transfer merge relocates the posting).

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "sip-installments.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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

async function createTestUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `sip-installments-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "sip-installments.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupTestUser(userId: string): Promise<void> {
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(sips).where(eq(sips.userId, userId));
  await db.delete(goals).where(eq(goals.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

test("listSipInstallmentCandidates: a linked installment still appears in the linked array after its posting is moved to a different account (B3 fix)", async (t) => {
  const userId = await createTestUser();
  t.after(() => cleanupTestUser(userId));
  await seedSystemAccounts(db, userId);

  // source account (bank) — required to satisfy the sips.sourceAccountId FK
  const [srcRow] = await db
    .insert(accounts)
    .values({ userId, name: "Bank Source", type: "bank" })
    .returning({ id: accounts.id });
  const srcAcctId = srcRow!.id;

  // target account (ppf) — the SIP's deposit destination
  const [tgtRow] = await db
    .insert(accounts)
    .values({ userId, name: "PPF Target", type: "ppf" })
    .returning({ id: accounts.id });
  const tgtAcctId = tgtRow!.id;

  // destination account — where we will artificially move the posting to simulate
  // a transfer merge that relocates the real posting off the target account
  const [destRow] = await db
    .insert(accounts)
    .values({ userId, name: "Bank Dest", type: "bank" })
    .returning({ id: accounts.id });
  const destAcctId = destRow!.id;

  // goal + SIP (inserted directly to bypass createSip's validation, consistent
  // with how postings-pr-e-parity.test.ts's PE4 seeds its SIP fixture)
  const [goalRow] = await db
    .insert(goals)
    .values({ userId, name: "PPF SIP", type: "savings" })
    .returning({ id: goals.id });
  const goalId = goalRow!.id;

  const [sipRow] = await db
    .insert(sips)
    .values({
      userId,
      goalId,
      sourceAccountId: srcAcctId,
      targetKind: "account",
      targetAccountId: tgtAcctId,
      amountPaise: 150000,
      dayOfMonth: 1,
      frequency: "monthly",
      fundingSource: "bank_debit",
      startDate: "2026-01-01",
    })
    .returning({ id: sips.id });
  const sipId = sipRow!.id;

  // Create the installment transaction: a positive credit into the target account.
  const txn = await createTransaction(db, userId, {
    accountId: tgtAcctId,
    date: "2026-07-01",
    amountPaise: 150000,
  });

  // Link the transaction to the SIP while its posting is still at the target account.
  await linkSipInstallment(db, userId, sipId, { transactionId: txn.id });

  // Simulate a transfer merge: move the real posting away from the target account.
  // Before the B3 fix, linkedInstallmentRows filtered by account_id = targetAccountId,
  // so after this move the transaction would vanish from the linked candidates list.
  await db.execute(sql`
    UPDATE postings
    SET account_id = ${destAcctId}
    WHERE transaction_id = ${txn.id}
      AND account_id = ${tgtAcctId}
  `);

  // After the fix: the linked installment must still appear, identified by its
  // transaction ID — not just "some linked row exists", which could be a false
  // positive from unrelated fixture data.
  const candidates = await listSipInstallmentCandidates(db, userId, sipId, "2026-08-01");
  const linked = candidates.filter((c) => c.linked);
  assert.equal(linked.length, 1, "exactly one linked installment");
  assert.equal(linked[0]!.id, txn.id, "linked installment is identified by its transaction ID");
  assert.equal(linked[0]!.linked, true);
});
