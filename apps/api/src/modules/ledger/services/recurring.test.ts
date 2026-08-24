import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import type { AccountType, RecurringKind } from "@compass/shared";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { accounts, postings, recurringTemplates, transactions } from "../schema.ts";
import { emiDetails, users } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { createEmi, listEmiInstallments, upsertEmiDetails } from "../../credit/services/emis.ts";
import { incomeExpense, spentByCategory } from "../../../lib/periods.ts";
import { advanceDate, createTemplate, materializeDue, updateTemplate } from "./recurring.ts";
import { createAccount as createAccountSvc } from "./accounts.ts";
import { seedSystemAccounts } from "./post-entry.ts";

// ---------- DB-backed regression coverage for materializeDue's lock-then-read
// refactor, the new EMI+destination-account branch, and the updateTemplate/
// createTemplate schedule/kind guards. ----------
//
// This needs a real Postgres connection (DATABASE_URL) — this repo has no
// DB-mocking infrastructure. Each test creates its own throwaway user(s) and
// cleans them up via t.after().
//
// IMPORTANT: materializeDue is a global cron-style batch job in production,
// but every call in this file passes an explicit { userId } scope so it only
// ever materializes templates belonging to the throwaway user created by that
// test. This scoping is what makes the file safe to run concurrently with
// other test files against a shared database. Do NOT change any call here
// back to the unscoped two-argument form (materializeDue(db, callback)).

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "recurring.test.ts's DB-backed tests need DATABASE_URL set (a real Postgres connection) — " +
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

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}


async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `recurring-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "recurring.test.ts user",
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
  await db.delete(recurringTemplates).where(eq(recurringTemplates.userId, userId)); // cascades emi_details
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

async function transactionsFor(userId: string, accountId: string, templateId: string) {
  return db
    .select({
      id: transactions.id,
      date: transactions.date,
      merchant: transactions.merchant,
      notes: transactions.notes,
      source: transactions.source,
      recurringTemplateId: transactions.recurringTemplateId,
      resourceId: transactions.resourceId,
      amountPaise: postings.amountPaise,
      categoryId: postings.categoryId,
    })
    .from(transactions)
    .innerJoin(postings, and(eq(postings.transactionId, transactions.id), eq(postings.accountId, accountId)))
    .where(
      and(
        eq(transactions.userId, userId),
        eq(transactions.recurringTemplateId, templateId),
        isNull(transactions.deletedAt),
      ),
    )
    .orderBy(transactions.date);
}

async function templateRow(templateId: string) {
  const rows = await db
    .select()
    .from(recurringTemplates)
    .where(eq(recurringTemplates.id, templateId));
  return rows[0]!;
}

async function emiDetailsRow(templateId: string) {
  const rows = await db.select().from(emiDetails).where(eq(emiDetails.templateId, templateId));
  return rows[0]!;
}

/**
 * Overwrites a just-created EMI template's stored installment to exactly
 * -34000 paise — emis.test.ts's hand-traced "(a)" fixture (principal
 * 100000, 12% p.a., 3 monthly installments of 34000, destination legs
 * [33000, 33330, 33663], final balance 7).
 *
 * NOTE / deviation from TASK.md: TASK.md's P7 assumes createEmi's real
 * standardEmiPaise(100000, 1200, 3) equals 34000, matching that fixture
 * directly. It doesn't — verified: standardEmiPaise(100000, 1200, 3) is
 * 34002 (Math.round((100000*0.01*1.030301) / 0.030301) = 34002), so a real
 * createEmi call with those inputs posts -34002/mo, not -34000, and the
 * resulting principal legs are [33002, 33332, 33665] ending at balance 1 —
 * arithmetically correct, just not the literal numbers TASK.md's test spec
 * names. Rather than silently asserting different numbers with no
 * explanation, this test bypasses the service layer (same technique used
 * elsewhere in this file for corrupted/direct-write scenarios) to force the
 * template's stored amount back to the exact fixture TASK.md specifies.
 */
async function forceHandTracedInstallment(templateId: string): Promise<void> {
  await db
    .update(recurringTemplates)
    .set({ amountPaise: -34000 })
    .where(eq(recurringTemplates.id, templateId));
}

// ---------- non-EMI recurringKinds: byte-identical materialization before/after
// the lock-then-read refactor (AC2/AC11) ----------

for (const kind of ["none", "bill", "subscription", "insurance"] as const satisfies readonly RecurringKind[]) {
  test(`materializeDue: a "${kind}"-kind template materializes exactly one due date with the unchanged transaction shape`, async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));
    const accountId = await createAccount(userId, "bank");
    const dueDate = todayIso();
    const tpl = await createTemplate(db, userId, {
      accountId,
      categoryId: null,
      merchant: `Test ${kind}`,
      amountPaise: -5000,
      notes: "a note",
      frequency: "monthly",
      interval: 1,
      nextDueDate: dueDate,
      endDate: null,
      kind,
      remindDays: null,
      resourceId: null,
    });

    await materializeDue(db, undefined, { userId });

    const rows = await transactionsFor(userId, accountId, tpl.id);
    assert.equal(rows.length, 1);
    const row = rows[0]!;
    assert.equal(row.date, dueDate);
    assert.equal(row.amountPaise, -5000);
    assert.equal(row.merchant, `Test ${kind}`);
    assert.equal(row.categoryId, null);
    assert.equal(row.notes, "a note");
    assert.equal(row.source, "recurring");
    assert.equal(row.resourceId, null);
    assert.equal(row.recurringTemplateId, tpl.id);

    const after = await templateRow(tpl.id);
    assert.equal(after.nextDueDate, advanceDate(dueDate, "monthly", 1));
  });
}

// ---------- EMI with no destination account: unaffected by this task (AC2) ----------

test("materializeDue: an EMI with no loanAccountId materializes exactly one source transaction per due date, no destination row of any kind", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "No-destination EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: null,
  });

  await materializeDue(db, undefined, { userId });

  const rows = await transactionsFor(userId, sourceId, emi.templateId);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.amountPaise, -emi.installmentPaise);
    assert.equal(row.recurringTemplateId, emi.templateId);
  }
  // No other transaction of this template's exists anywhere (no destination
  // leg could have landed on any other account, since none was configured).
  const all = await db
    .select()
    .from(transactions)
    .where(eq(transactions.recurringTemplateId, emi.templateId));
  assert.equal(all.length, 3);
});

// ---------- EMI with a destination account: the new branch (AC3/AC4/AC5) ----------

test("materializeDue: an EMI with a loanAccountId posts source+destination legs for a 3-month catch-up, matching the hand-traced fixture", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);

  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Destination EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  assert.equal(emi.loanAccountId, destId);
  await forceHandTracedInstallment(emi.templateId);

  await materializeDue(db, undefined, { userId });

  const sourceRows = await transactionsFor(userId, sourceId, emi.templateId);
  assert.equal(sourceRows.length, 3);
  for (const row of sourceRows) assert.equal(row.amountPaise, -34000);

  const destRows = await transactionsFor(userId, destId, emi.templateId);
  assert.equal(destRows.length, 3);
  assert.deepEqual(
    destRows.map((r) => r.amountPaise),
    [33000, 33330, 33663],
  );
  for (const row of destRows) {
    assert.equal(row.categoryId, null);
    assert.equal(row.source, "recurring");
    assert.equal(row.recurringTemplateId, emi.templateId);
  }

  const details = await emiDetailsRow(emi.templateId);
  assert.equal(details.outstandingPrincipalPaise, 7);
});

test("materializeDue: an EMI's destination-account balance walks from -principal toward 0 as principal legs post", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  // Use the real createAccount service (not the local raw-insert helper) so the
  // opening balance is represented as a real posting against the Opening Balances
  // system account. Balance = sum(postings), so the opening posting must exist.
  await seedSystemAccounts(db, userId);
  const destAcct = await createAccountSvc(db, userId, {
    name: "Test loan",
    type: "loan",
    institution: null,
    accountLast4: null,
    holderName: null,
    holderId: null,
    currency: "INR",
    openingBalancePaise: -100000,
    schemeOpenedDate: null,
  });
  const destId = destAcct.id;
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Balance-walk EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  await forceHandTracedInstallment(emi.templateId);

  await materializeDue(db, undefined, { userId });

  // Balance = sum of all postings on destId (opening -100000 + installments).
  const balanceResult = await db
    .select({ balance: sql<string>`coalesce(sum(${postings.amountPaise}), 0)::bigint` })
    .from(postings)
    .innerJoin(transactions, and(eq(transactions.id, postings.transactionId), isNull(transactions.deletedAt)))
    .where(eq(postings.accountId, destId));
  const balance = Number(balanceResult[0]!.balance);
  // -100000 (opening) + 33000 + 33330 + 33663 = -7
  assert.equal(balance, -7);
  assert.ok(balance > -100000); // moved toward 0 from initial -100000
  void emi;
});

// ---------- detach regression: outstandingPrincipalPaise survives a
// non-null -> null detach untouched (P4 "no reseed needed") ----------

test("upsertEmiDetails: detaching a destination (non-null -> null) leaves outstandingPrincipalPaise untouched", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Detach-regression EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  await forceHandTracedInstallment(emi.templateId);

  // Advance outstandingPrincipalPaise to a known non-null value via the
  // real materializer, same hand-traced fixture as AC3/AC4.
  await materializeDue(db, undefined, { userId });
  const beforeDetach = await emiDetailsRow(emi.templateId);
  assert.equal(beforeDetach.outstandingPrincipalPaise, 7);

  const updated = await upsertEmiDetails(db, userId, emi.templateId, {
    principalPaise: beforeDetach.principalPaise,
    annualRateBps: beforeDetach.annualRateBps,
    totalInstallments: beforeDetach.totalInstallments,
    startDate: beforeDetach.startDate,
    loanAccountId: null,
  });
  assert.equal(updated.loanAccountId, null);

  // The onConflictDoUpdate set object is built from UpsertEmiDetailsSchema's
  // parsed fields, which never include outstandingPrincipalPaise — so
  // Drizzle must leave the column untouched, not reset it to null/principal.
  const afterDetach = await emiDetailsRow(emi.templateId);
  assert.equal(afterDetach.loanAccountId, null);
  assert.equal(afterDetach.outstandingPrincipalPaise, beforeDetach.outstandingPrincipalPaise);
});

// ---------- AC10: an ineligible destination doesn't block/corrupt/throw ----------

test("materializeDue: an archived destination account falls back to source-only posting, no throw, outstandingPrincipalPaise untouched", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Archived-destination EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  await archiveAccount(destId);

  await materializeDue(db, undefined, { userId });

  const sourceRows = await transactionsFor(userId, sourceId, emi.templateId);
  assert.equal(sourceRows.length, 3);
  const destRows = await transactionsFor(userId, destId, emi.templateId);
  assert.equal(destRows.length, 0);
  const details = await emiDetailsRow(emi.templateId);
  assert.equal(details.outstandingPrincipalPaise, null);
});

test("materializeDue: a schedule that somehow isn't monthly/interval-1 at materialization time falls back to source-only, no throw", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Bad-schedule EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  // Simulate a code path that bypasses updateTemplate's guard entirely (e.g.
  // backup restore writing recurring_templates directly).
  await db
    .update(recurringTemplates)
    .set({ frequency: "weekly" })
    .where(eq(recurringTemplates.id, emi.templateId));

  await materializeDue(db, undefined, { userId });

  const sourceRows = await transactionsFor(userId, sourceId, emi.templateId);
  assert.ok(sourceRows.length >= 1);
  const destRows = await transactionsFor(userId, destId, emi.templateId);
  assert.equal(destRows.length, 0);
  const details = await emiDetailsRow(emi.templateId);
  assert.equal(details.outstandingPrincipalPaise, null);
});

test("materializeDue: a destination account belonging to a different user (corrupted/restored data bypassing service guards) is never posted to", async (t) => {
  const userA = await createUser();
  const userB = await createUser();
  t.after(async () => {
    await cleanupUser(userA);
    await cleanupUser(userB);
  });
  const sourceId = await createAccount(userA, "bank");
  const otherUsersAccount = await createAccount(userB, "loan", -100000);
  const emi = await createEmi(db, userA, {
    accountId: sourceId,
    name: "Cross-user EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: null,
  });
  // Bypass upsertEmiDetails's guards entirely: directly point loanAccountId
  // at an account owned by a different user, simulating corrupted/restored
  // data. lockAccountPair's `eq(accounts.userId, t.userId)` scoping must
  // still keep materializeDue from posting to it.
  await db
    .update(emiDetails)
    .set({ loanAccountId: otherUsersAccount })
    .where(eq(emiDetails.templateId, emi.templateId));

  await materializeDue(db, undefined, { userId: userA });

  const sourceRows = await transactionsFor(userA, sourceId, emi.templateId);
  assert.equal(sourceRows.length, 3);
  const crossRows = await transactionsFor(userB, otherUsersAccount, emi.templateId);
  assert.equal(crossRows.length, 0);
  const otherUsersAccountPostings = await db
    .select({ id: postings.transactionId })
    .from(postings)
    .where(eq(postings.accountId, otherUsersAccount));
  assert.equal(otherUsersAccountPostings.length, 0);
});

// ---------- AC14: rollback/atomicity ----------

test("materializeDue: a forced mid-transaction failure between the source and destination inserts leaves no partial state", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Rollback EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  const before = await templateRow(emi.templateId);
  const detailsBefore = await emiDetailsRow(emi.templateId);

  await assert.rejects(
    materializeDue(db, (templateId) => {
      if (templateId === emi.templateId) throw new Error("forced failure for AC14");
    }, { userId }),
    /forced failure for AC14/,
  );

  const sourceRows = await transactionsFor(userId, sourceId, emi.templateId);
  assert.equal(sourceRows.length, 0);
  const destRows = await transactionsFor(userId, destId, emi.templateId);
  assert.equal(destRows.length, 0);
  const after = await templateRow(emi.templateId);
  assert.equal(after.nextDueDate, before.nextDueDate);
  const detailsAfter = await emiDetailsRow(emi.templateId);
  assert.equal(detailsAfter.outstandingPrincipalPaise, detailsBefore.outstandingPrincipalPaise);
});

// ---------- AC6: listEmiInstallments (unchanged code) still returns only
// source-account rows when destination legs exist ----------

test("listEmiInstallments: returns only source-account rows even when destination legs exist", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Installments-view EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  await forceHandTracedInstallment(emi.templateId);

  await materializeDue(db, undefined, { userId });

  const installments = await listEmiInstallments(db, userId, emi.templateId);
  assert.equal(installments.length, 3);
  for (const row of installments) {
    assert.ok(row.amountPaise < 0);
  }
  assert.deepEqual(
    installments.map((r) => r.principalPaise),
    [33000, 33330, 33663],
  );
});

// ---------- AC9: incomeExpense/spentByCategory (unchanged code) treat the
// destination leg as neither income nor expense ----------

test("incomeExpense: the full installment counts as expense; the destination principal leg counts as neither income nor expense", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const destId = await createAccount(userId, "loan", -100000);
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "IncomeExpense EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: destId,
  });
  await forceHandTracedInstallment(emi.templateId);

  await materializeDue(db, undefined, { userId });

  const { incomePaise, expensePaise } = await incomeExpense(db, userId, "2020-01-01", "2020-03-31");
  assert.equal(expensePaise, 34000 * 3);
  assert.equal(incomePaise, 0);

  // spentByCategory excludes the positive destination-account principal legs
  // via its own `amount_paise < 0` SQL predicate — proven directly here, not
  // merely by inspection of periods.ts (unchanged code).
  const byCategory = await spentByCategory(db, userId, "2020-01-01", "2020-03-31");
  assert.equal(byCategory.get(null), 34000 * 3); // categoryId is null in this fixture
  void emi;
});

// ---------- updateTemplate: atomic EMI schedule-immutability + kind-conversion
// guards (AC13) ----------

test("updateTemplate: setting an EMI-kind template's frequency off monthly is rejected with 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Guarded EMI",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: null,
  });
  await assert.rejects(
    updateTemplate(db, userId, emi.templateId, { frequency: "weekly" }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("updateTemplate: setting an EMI-kind template's interval off 1 is rejected with 400", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const sourceId = await createAccount(userId, "bank");
  const emi = await createEmi(db, userId, {
    accountId: sourceId,
    name: "Guarded EMI 2",
    principalPaise: 100000,
    annualRateBps: 1200,
    totalInstallments: 3,
    startDate: "2020-01-05",
    loanAccountId: null,
  });
  await assert.rejects(
    updateTemplate(db, userId, emi.templateId, { interval: 2 }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("updateTemplate: the same schedule patch on a non-EMI-kind template succeeds — the guard is EMI-scoped only", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId, "bank");
  const tpl = await createTemplate(db, userId, {
    accountId,
    categoryId: null,
    merchant: "Ordinary bill",
    amountPaise: -1000,
    notes: "",
    frequency: "monthly",
    interval: 1,
    nextDueDate: todayIso(),
    endDate: null,
    kind: "bill",
    remindDays: null,
    resourceId: null,
  });
  const updated = await updateTemplate(db, userId, tpl.id, { frequency: "weekly" });
  assert.equal(updated.frequency, "weekly");
});

test('updateTemplate: converting a non-EMI template to kind: "emi" is rejected with 400 regardless of its schedule', async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId, "bank");
  const tpl = await createTemplate(db, userId, {
    accountId,
    categoryId: null,
    merchant: "Ordinary bill",
    amountPaise: -1000,
    notes: "",
    frequency: "monthly",
    interval: 1,
    nextDueDate: todayIso(),
    endDate: null,
    kind: "bill",
    remindDays: null,
    resourceId: null,
  });
  await assert.rejects(
    updateTemplate(db, userId, tpl.id, { kind: "emi" }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test('createTemplate: kind: "emi" is rejected with 400 — an EMI can only be created via POST /api/emis', async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId, "bank");
  await assert.rejects(
    createTemplate(db, userId, {
      accountId,
      categoryId: null,
      merchant: "Fake EMI",
      amountPaise: -1000,
      notes: "",
      frequency: "monthly",
      interval: 1,
      nextDueDate: todayIso(),
      endDate: null,
      kind: "emi",
      remindDays: null,
      resourceId: null,
    }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 400,
  );
});

test("updateTemplate: concurrent disjoint patches on the same template cannot combine into an invalid state", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));
  const accountId = await createAccount(userId, "bank");
  const tpl = await createTemplate(db, userId, {
    accountId,
    categoryId: null,
    merchant: "Race template",
    amountPaise: -1000,
    notes: "",
    frequency: "monthly",
    interval: 1,
    nextDueDate: todayIso(),
    endDate: null,
    kind: "bill", // not "emi" — {kind: "emi"} is the thing under race
    remindDays: null,
    resourceId: null,
  });

  const results = await Promise.allSettled([
    updateTemplate(db, userId, tpl.id, { kind: "emi" }),
    updateTemplate(db, userId, tpl.id, { interval: 2 }),
  ]);

  const [kindResult, intervalResult] = results;
  assert.equal(kindResult!.status, "rejected");
  if (kindResult!.status === "rejected") {
    assert.ok(kindResult!.reason instanceof HttpError && kindResult!.reason.statusCode === 400);
  }
  // interval: 2 may succeed or fail depending on lock order, but either way
  // the final row must never end up kind: "emi" AND interval: 2 together.
  void intervalResult;

  const final = await templateRow(tpl.id);
  assert.ok(!(final.kind === "emi" && final.interval === 2));
  assert.equal(final.kind, "bill"); // kind: "emi" never committed
});
