/**
 * regime-comparison.integration.test.ts — DB-backed integration test for
 * compareRegimes() proving the §24(a) rent-deduction fix (round-2 fix).
 *
 * WHAT THIS PROVES:
 *   compareRegimes() applies the flat 30% Section 24(a) deduction to rent income
 *   before it enters the taxable-income base. The pure test file
 *   (regime-comparison.test.ts) verifies the arithmetic in isolation but never
 *   calls compareRegimes() — so a revert of the fix in the service would pass the
 *   pure tests while failing THIS test.
 *
 * REQUIRES: a real Postgres connection (DATABASE_URL env var).
 *   requireDatabaseUrl() throws loudly rather than skipping when unset.
 *   Each test creates and cleans up its own throwaway user/rows via t.after().
 *
 * Follows the repo-standard convention from deductions.integration.test.ts and
 * income-events.integration.test.ts.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/schema.ts";
import { incomeEvents } from "../schema.ts";
import { compareRegimes } from "./regime-comparison.ts";

// ─── DB setup ─────────────────────────────────────────────────────────────────

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "regime-comparison.integration.test.ts requires DATABASE_URL set (a real Postgres " +
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

// ─── Helpers ─────────────────────────────────────────────────────────────────

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `regime-comparison-int-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "regime-comparison.integration.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  // incomeEvents rows cascade-delete from users, but explicit cleanup is safer.
  await db.delete(incomeEvents).where(eq(incomeEvents.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

// ─── §24(a) rent deduction — the fix under test ───────────────────────────────

test("compareRegimes: §24(a) 30% deduction reduces rent income in grossIncomePaise and taxableIncomePaise for both regimes", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // ₹10,00,000 gross rent = 100_000_000 paise.
  // §24(a): taxable rent = 70% × 100_000_000 = 70_000_000 paise.
  // No salary → no standard deduction (§16(ia): capped at salary income).
  // No 80C/80D/CCD2 entries → zero regime-specific deductions.
  // Expected result: grossIncomePaise = 70_000_000,
  //   old.taxableIncomePaise = 70_000_000,
  //   new.taxableIncomePaise = 70_000_000.
  await db.insert(incomeEvents).values({
    userId,
    accrualDate: "2025-10-01",
    fy: "2025-26",
    incomeKind: "rent",
    sourceKind: "manual",
    grossPaise: 100_000_000,
    tdsPaise: 0,
    status: "accepted",
  });

  const result = await compareRegimes(db, userId, "2025-26");

  // grossIncomePaise must be the TRUE gross (₹10L = 100_000_000 paise) — the
  // §24(a) deduction is now explicit in result.old.deductions.section24aDeductionPaise
  // rather than being silently baked into grossIncomePaise.
  assert.equal(
    result.grossIncomePaise,
    100_000_000,
    `grossIncomePaise should be 100_000_000 (true gross, §24(a) is explicit), got ${result.grossIncomePaise}`,
  );

  // §24(a) deduction (30% of gross rent) must appear in the deductions breakdown.
  assert.equal(
    result.old.deductions.section24aDeductionPaise,
    30_000_000,
    `old.deductions.section24aDeductionPaise should be 30_000_000 (30% of ₹10L), got ${result.old.deductions.section24aDeductionPaise}`,
  );
  assert.equal(
    result.new.deductions.section24aDeductionPaise,
    30_000_000,
    `new.deductions.section24aDeductionPaise should be 30_000_000 (30% of ₹10L), got ${result.new.deductions.section24aDeductionPaise}`,
  );

  // No deductions under either regime for a pure rent-only taxpayer with no
  // salary → taxableIncomePaise = grossIncomePaise − section24aDeductionPaise = 70_000_000.
  assert.equal(
    result.old.taxableIncomePaise,
    70_000_000,
    `old.taxableIncomePaise should be 70_000_000 (gross 100M − §24(a) 30M), got ${result.old.taxableIncomePaise}`,
  );
  assert.equal(
    result.new.taxableIncomePaise,
    70_000_000,
    `new.taxableIncomePaise should be 70_000_000 (gross 100M − §24(a) 30M), got ${result.new.taxableIncomePaise}`,
  );

  // The §24(a) disclosure string must appear in assumptions (added by the fix).
  const sec24aDisclosure =
    "Rent income gets the flat 30% Section 24(a) deduction before entering taxable income (both regimes); municipal taxes paid and any other house-property adjustments are not modelled.";
  assert.ok(
    result.assumptions.includes(sec24aDisclosure),
    `assumptions must include §24(a) disclosure string. Got: ${JSON.stringify(result.assumptions)}`,
  );
});

test("compareRegimes: rent-only user — grossIncomePaise is NOT the full ₹10L (proves §24(a) bites when reverted)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await db.insert(incomeEvents).values({
    userId,
    accrualDate: "2025-12-15",
    fy: "2025-26",
    incomeKind: "rent",
    sourceKind: "manual",
    grossPaise: 100_000_000,
    tdsPaise: 0,
    status: "accepted",
  });

  const result = await compareRegimes(db, userId, "2025-26");

  // grossIncomePaise is now the TRUE gross — it equals the raw 100_000_000.
  assert.equal(
    result.grossIncomePaise,
    100_000_000,
    "grossIncomePaise must equal the raw gross (₹10L = 100_000_000) — §24(a) is now explicit",
  );

  // The §24(a) deduction must be surfaced explicitly in the deductions breakdown.
  // This assertion fails if the fix is reverted (section24aDeductionPaise would be 0
  // or missing, and taxableIncomePaise would be 100_000_000 instead of 70_000_000).
  assert.equal(
    result.old.deductions.section24aDeductionPaise,
    30_000_000,
    "old.deductions.section24aDeductionPaise must be 30_000_000 (30% of ₹10L gross rent)",
  );

  // taxableIncomePaise must reflect the §24(a) subtraction: 100M − 30M = 70M.
  assert.equal(
    result.old.taxableIncomePaise,
    70_000_000,
    "old.taxableIncomePaise must be 70_000_000 (gross − §24(a))",
  );
  assert.equal(
    result.new.taxableIncomePaise,
    70_000_000,
    "new.taxableIncomePaise must be 70_000_000 (gross − §24(a))",
  );
});
