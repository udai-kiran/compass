/**
 * epf-contributions.integration.test.ts — DB-backed integration tests for the
 * EPF passbook reconciliation service (task 13.5, fix round 2).
 *
 * Follows the repo-standard requireDatabaseUrl() pattern — requires a real
 * Postgres connection (DATABASE_URL env var). This repo has no DB-mocking
 * infrastructure; Drizzle cannot be mocked per tasks/TDD.md.
 *
 * Each test creates its own throwaway user(s) / rows and cleans up in t.after().
 *
 * IMPORTANT: If DATABASE_URL is not set, requireDatabaseUrl() throws loudly
 * at module load time — tests will not silently skip.
 *
 * Coverage:
 *   1. importFromPayslip — ownership check (404 for another user's payslip)
 *   2. importFromPayslip — accepted-state check (409 for non-accepted payslip)
 *   3. importFromPayslip — multi-component summing (two employee_epf lines)
 *   4. importFromPayslip — re-import refreshes expected_* (P1 fix)
 *   5. importFromPayslip — re-import preserves actual_* (confirms actuals survive)
 *   6. confirmActual — cross-user isolation (cannot confirm another user's row)
 *   7. listContributions — cross-user isolation (user sees only own rows)
 *   8. getGaps — gap appears after 45-day grace; absent before
 *   9. getProjection — requires EPF account type (404 for bank account)
 *  10. getProjection — returns correct corpus from posted balance
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/schema.ts";
import { accounts } from "../../../db/shared/hubs.ts";
import { postings, transactions } from "../../../db/shared/ledger.ts";
import { payslips, payslipComponents, epfContributions } from "../schema.ts";
import { userProfiles } from "../../system/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import {
  importFromPayslip,
  confirmActual,
  listContributions,
  getGaps,
  getProjection,
  isGapEligible,
} from "./epf-contributions.ts";

// ─── DB setup ────────────────────────────────────────────────────────────────

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "epf-contributions.integration.test.ts requires DATABASE_URL set (a real Postgres " +
        "connection) — this repo has no DB-mocking infrastructure. Export it (see " +
        "apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db = createDb(pool);
after(async () => {
  await pool.end();
});

// ─── Setup helpers ────────────────────────────────────────────────────────────

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `epf-int-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "epf-contributions.integration.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(epfContributions).where(eq(epfContributions.userId, userId));
  await db.delete(payslips).where(eq(payslips.userId, userId));
  // postings and transactions cascade through user_id on transactions
  const txns = await db
    .select({ id: transactions.id })
    .from(transactions)
    .where(eq(transactions.userId, userId));
  for (const t of txns) {
    await db.delete(postings).where(eq(postings.transactionId, t.id));
  }
  await db.delete(transactions).where(eq(transactions.userId, userId));
  await db.delete(accounts).where(eq(accounts.userId, userId));
  await db.delete(userProfiles).where(eq(userProfiles.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

/** Create a payslip in the given status for the user. */
async function createPayslip(
  userId: string,
  opts: {
    payMonth?: string;
    fy?: string;
    status?: "pending" | "accepted" | "rejected";
    employerName?: string;
  } = {},
): Promise<string> {
  const [p] = await db
    .insert(payslips)
    .values({
      userId,
      payMonth: opts.payMonth ?? "2025-06",
      fy: opts.fy ?? "2025-26",
      status: opts.status ?? "accepted",
      employerName: opts.employerName ?? "Test Employer",
    })
    .returning({ id: payslips.id });
  return p!.id;
}

/** Insert payslip components for a payslip. */
async function addComponents(
  payslipId: string,
  components: Array<{
    canonicalKind: string;
    currentPaise: number;
    rawLabel?: string;
    category?: string;
  }>,
): Promise<void> {
  for (let i = 0; i < components.length; i++) {
    const c = components[i]!;
    await db.insert(payslipComponents).values({
      payslipId,
      rawLabel: c.rawLabel ?? c.canonicalKind,
      canonicalKind: c.canonicalKind,
      category: c.category ?? "deduction",
      currentPaise: c.currentPaise,
      displayOrder: i,
    });
  }
}

/** Create an EPF account for a user. */
async function createEpfAccount(userId: string): Promise<string> {
  const [a] = await db
    .insert(accounts)
    .values({ userId, name: "EPF Account", type: "epf", openingBalancePaise: 0 })
    .returning({ id: accounts.id });
  return a!.id;
}

/** Post a transaction with a single posting to an account (simulates a balance). */
async function postBalance(userId: string, accountId: string, amountPaise: number): Promise<void> {
  const today = new Date().toISOString().slice(0, 10);
  const [t] = await db
    .insert(transactions)
    .values({ userId, date: today, merchant: "Test deposit" })
    .returning({ id: transactions.id });
  await db.insert(postings).values({
    transactionId: t!.id,
    accountId,
    amountPaise,
  });
}

const EPFO_ID = "MH/BAN/0012345/000/9999";

// ─── Test 1: ownership check ──────────────────────────────────────────────────

test("importFromPayslip: rejects another user's payslip with 404", async (t) => {
  const ownerUserId = await createUser();
  t.after(() => cleanupUser(ownerUserId));
  const callerUserId = await createUser();
  t.after(() => cleanupUser(callerUserId));

  const payslipId = await createPayslip(ownerUserId, { status: "accepted" });
  await addComponents(payslipId, [{ canonicalKind: "employee_epf", currentPaise: 180000 }]);

  await assert.rejects(
    () => importFromPayslip(db, callerUserId, payslipId, EPFO_ID),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  // No row created for either user
  const rows = await db.select().from(epfContributions).where(eq(epfContributions.userId, callerUserId));
  assert.equal(rows.length, 0);
});

// ─── Test 2: accepted-state check ────────────────────────────────────────────

test("importFromPayslip: rejects a pending payslip with 409", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const payslipId = await createPayslip(userId, { status: "pending" });
  await addComponents(payslipId, [{ canonicalKind: "employee_epf", currentPaise: 180000 }]);

  await assert.rejects(
    () => importFromPayslip(db, userId, payslipId, EPFO_ID),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 409);
      return true;
    },
  );
});

// ─── Test 3: multi-component summing ─────────────────────────────────────────

test("importFromPayslip: sums multiple components of the same canonical kind", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const payslipId = await createPayslip(userId, { status: "accepted" });
  await addComponents(payslipId, [
    { canonicalKind: "employee_epf", currentPaise: 100000, rawLabel: "Employee EPF (basic)" },
    { canonicalKind: "employee_epf", currentPaise: 80000, rawLabel: "Employee EPF (arrears)" },
    { canonicalKind: "employer_epf", currentPaise: 55000, rawLabel: "Employer EPF" },
    { canonicalKind: "eps", currentPaise: 125000, rawLabel: "EPS" },
  ]);

  const result = await importFromPayslip(db, userId, payslipId, EPFO_ID);

  // Both employee_epf lines are summed
  assert.equal(result.expectedEmployeePaise, 180000);
  assert.equal(result.expectedEmployerPaise, 55000);
  assert.equal(result.expectedEpsPaise, 125000);
  // grossEmployerContributionPaise = employer + eps
  assert.equal(result.grossEmployerContributionPaise, 55000 + 125000);
});

// ─── Test 4: re-import refreshes expected_* (P1 fix) ─────────────────────────

test("importFromPayslip: re-import refreshes expected_* with corrected payslip values (P1 fix)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const payslipId = await createPayslip(userId, { status: "accepted" });
  await addComponents(payslipId, [
    { canonicalKind: "employee_epf", currentPaise: 180000 },
    { canonicalKind: "employer_epf", currentPaise: 55000 },
    { canonicalKind: "eps", currentPaise: 125000 },
  ]);

  // First import
  const first = await importFromPayslip(db, userId, payslipId, EPFO_ID);
  assert.equal(first.expectedEmployeePaise, 180000);

  // Simulate a corrected payslip: delete old components and insert corrected ones
  await db.delete(payslipComponents).where(eq(payslipComponents.payslipId, payslipId));
  await addComponents(payslipId, [
    { canonicalKind: "employee_epf", currentPaise: 190000 }, // corrected
    { canonicalKind: "employer_epf", currentPaise: 60000 },  // corrected
    { canonicalKind: "eps", currentPaise: 125000 },
  ]);

  // Second import — must refresh expected_*, not return stale data
  const second = await importFromPayslip(db, userId, payslipId, EPFO_ID);
  assert.equal(second.expectedEmployeePaise, 190000, "re-import must refresh corrected expected_*");
  assert.equal(second.expectedEmployerPaise, 60000);
  assert.equal(second.id, first.id, "same row updated, not duplicated");
});

// ─── Test 5: re-import preserves actual_* ────────────────────────────────────

test("importFromPayslip: re-import preserves confirmed actual_* values", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const payslipId = await createPayslip(userId, { status: "accepted" });
  await addComponents(payslipId, [
    { canonicalKind: "employee_epf", currentPaise: 180000 },
  ]);

  // First import then confirm
  const first = await importFromPayslip(db, userId, payslipId, EPFO_ID);
  await confirmActual(db, userId, first.id, { actualEmployeePaise: 180000 });

  // Correct the payslip and re-import
  await db.delete(payslipComponents).where(eq(payslipComponents.payslipId, payslipId));
  await addComponents(payslipId, [
    { canonicalKind: "employee_epf", currentPaise: 185000 },
  ]);

  const second = await importFromPayslip(db, userId, payslipId, EPFO_ID);
  assert.equal(second.expectedEmployeePaise, 185000, "expected_* updated from corrected payslip");
  assert.equal(second.actualEmployeePaise, 180000, "actual_* preserved from prior confirmation");
});

// ─── Test 6: confirmActual cross-user isolation ───────────────────────────────

test("confirmActual: rejects cross-user access with 404, zero writes", async (t) => {
  const ownerUserId = await createUser();
  t.after(() => cleanupUser(ownerUserId));
  const callerUserId = await createUser();
  t.after(() => cleanupUser(callerUserId));

  const payslipId = await createPayslip(ownerUserId, { status: "accepted" });
  await addComponents(payslipId, [{ canonicalKind: "employee_epf", currentPaise: 180000 }]);
  const row = await importFromPayslip(db, ownerUserId, payslipId, EPFO_ID);

  // Caller tries to confirm another user's row
  await assert.rejects(
    () => confirmActual(db, callerUserId, row.id, { actualEmployeePaise: 180000 }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );

  // Owner's row is unchanged
  const [unchanged] = await db
    .select()
    .from(epfContributions)
    .where(eq(epfContributions.id, row.id));
  assert.equal(unchanged?.actualEmployeePaise, null);
});

// ─── Test 7: listContributions cross-user isolation ───────────────────────────

test("listContributions: each user sees only their own rows", async (t) => {
  const userAId = await createUser();
  t.after(() => cleanupUser(userAId));
  const userBId = await createUser();
  t.after(() => cleanupUser(userBId));

  const payslipA = await createPayslip(userAId, { payMonth: "2025-06", fy: "2025-26" });
  await addComponents(payslipA, [{ canonicalKind: "employee_epf", currentPaise: 180000 }]);
  await importFromPayslip(db, userAId, payslipA, "MH/A/111");

  const payslipB = await createPayslip(userBId, { payMonth: "2025-06", fy: "2025-26" });
  await addComponents(payslipB, [{ canonicalKind: "employee_epf", currentPaise: 200000 }]);
  await importFromPayslip(db, userBId, payslipB, "MH/B/222");

  const listA = await listContributions(db, userAId, { fy: "2025-26" });
  const listB = await listContributions(db, userBId, { fy: "2025-26" });

  assert.equal(listA.length, 1);
  assert.equal(listB.length, 1);
  assert.equal(listA[0]!.expectedEmployeePaise, 180000);
  assert.equal(listB[0]!.expectedEmployeePaise, 200000);
});

// ─── Test 8: getGaps — 45-day grace period ────────────────────────────────────

test("getGaps: gap not reported before grace period; reported after", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Use a past wage month so the grace period has definitely elapsed.
  const payslipId = await createPayslip(userId, { payMonth: "2024-06", fy: "2024-25" });
  await addComponents(payslipId, [{ canonicalKind: "employee_epf", currentPaise: 180000 }]);
  await importFromPayslip(db, userId, payslipId, EPFO_ID);

  // Grace period for "2024-06": ends 2024-08-14. By now (2026), definitely elapsed.
  const gaps = await getGaps(db, userId, "2024-25");
  assert.ok(gaps.some((g) => g.wageMonth === "2024-06"), "gap reported after grace period");

  // Verify isGapEligible with an injected date BEFORE the grace period
  assert.equal(isGapEligible("2024-06", new Date("2024-07-01")), false);
  assert.equal(isGapEligible("2024-06", new Date("2024-08-14")), true);

  // If we inject an asOf date BEFORE grace expiry, getGaps returns empty
  const gapsBeforeGrace = await getGaps(db, userId, "2024-25", new Date("2024-07-01"));
  assert.equal(gapsBeforeGrace.length, 0, "no gaps before 45-day grace period");

  // After confirming, no longer a gap
  const [row] = await db
    .select()
    .from(epfContributions)
    .where(eq(epfContributions.userId, userId));
  await confirmActual(db, userId, row!.id, { actualEmployeePaise: 180000 });

  const gapsAfterConfirm = await getGaps(db, userId, "2024-25");
  assert.equal(gapsAfterConfirm.length, 0, "no gaps after confirming actual");
});

// ─── Test 9: getProjection — EPF account type required (P6) ──────────────────

test("getProjection: rejects a bank account with 404 (EPF type required)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Create a bank account (not EPF)
  const [bankAccount] = await db
    .insert(accounts)
    .values({ userId, name: "Bank", type: "bank", openingBalancePaise: 0 })
    .returning({ id: accounts.id });

  await assert.rejects(
    () => getProjection(db, userId, bankAccount!.id),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal(err.statusCode, 404);
      return true;
    },
  );
});

// ─── Test 10: getProjection — correct corpus from posted balance ───────────────

test("getProjection: currentCorpusPaise matches posted balance; projection is integer", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const epfAccountId = await createEpfAccount(userId);
  await postBalance(userId, epfAccountId, 500_000_00); // ₹5,00,000

  const result = await getProjection(db, userId, epfAccountId);
  assert.equal(result.currentCorpusPaise, 500_000_00);
  assert.ok(Number.isSafeInteger(result.projectedCorpusPaise), "projection must be a safe integer");
  assert.ok(result.projectedCorpusPaise >= result.currentCorpusPaise, "projection >= current");
  assert.equal(result.isEstimate, true);
  assert.equal(result.rateSource, "last_known_official");
  assert.equal(result.rateApplicableFy, "2024-25");
  assert.ok(typeof result.disclaimer === "string" && result.disclaimer.length > 10);
  assert.ok(typeof result.monthsToRetirement === "number");
  assert.equal(result.monthsToRetirement, Math.floor(result.monthsToRetirement), "integer months");
});
