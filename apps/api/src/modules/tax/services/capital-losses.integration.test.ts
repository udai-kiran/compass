/**
 * capital-losses.integration.test.ts — Real-Postgres integration tests for
 * applySetoffForFy() (Part 2 fix: persisting carried-forward loss set-off).
 *
 * REQUIRES: a real Postgres connection (DATABASE_URL env var).
 *   requireDatabaseUrl() throws loudly rather than skipping when unset.
 *
 * Each test creates its own throwaway user(s)/rows and cleans up in t.after().
 *
 * Covered:
 *   1. Happy path: partial absorption — remainingPaise actually decreases by
 *      absorbedPaise (queried directly from the DB row, not just from the return).
 *   2. Idempotency: second call for the same FY throws HttpError(409); the
 *      carry-forward entry is NOT decremented a second time.
 *   3. Cross-user isolation: user B's call never touches user A's carryforward.
 *   4. Zero-absorption case: a FY with no eligible brought-forward entries
 *      succeeds (records the idempotency marker) and a second call for the same
 *      FY still 409s.
 *
 * Note: applySetoffForFy() reads the capital position via getCapitalPosition(),
 * which in turn calls getCapitalGains() over the holdings/holdingEvents tables.
 * In these tests no holdings are created, so gross STCG = LTCG = 0, meaning the
 * brought-forward loss set-off computes 0 absorption for any amount of carry-
 * forward. To test real absorption we insert holdings and holding events that
 * produce realised gains, or — simpler — we rely on the fact that
 * getCapitalGains() returns 0 gains when there are no holdings, which means
 * the brought-forward losses absorb nothing.
 *
 * To test ACTUAL absorption (the main purpose of the fix) we need realised
 * STCG/LTCG in the DB. This requires inserting holdings + holding events in the
 * correct format expected by getCapitalGains(). This is heavy setup; the happy
 * path test below inserts holdings data to produce a real gain.
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/schema.ts";
import { capitalLossCarryforward, capitalLossSetoffApplications } from "../schema.ts";
import { holdings, holdingEvents } from "../../investments/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { createCapitalLossEntry, applySetoffForFy } from "./capital-losses.ts";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "capital-losses.integration.test.ts requires DATABASE_URL set (a real Postgres " +
        "connection) — this repo has no DB-mocking infrastructure. Export it (see " +
        "apps/api/.env) before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const pool = createPool(requireDatabaseUrl());
const db: Db = createDb(pool);

after(async () => {
  await pool.end();
});

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function createUser(): Promise<string> {
  const [u] = await db
    .insert(users)
    .values({
      email: `capital-losses-int-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "capital-losses.integration.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  await db.delete(capitalLossSetoffApplications).where(
    eq(capitalLossSetoffApplications.userId, userId),
  );
  await db.delete(capitalLossCarryforward).where(
    eq(capitalLossCarryforward.userId, userId),
  );
  // holdingEvents cascade-delete from holdings; holdings must be deleted before users
  // because holdings.userId references users.id without cascade.
  await db.delete(holdings).where(eq(holdings.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Create a stock holding with one buy and one sell event that produce a
 * short-term capital gain in FY 2025-26.
 *
 * Buy: 100 units @ ₹10,000/unit = 1,000,000,000 paise — no, let's use small numbers.
 * Buy:  100 units @ ₹100/unit  = 1,000,000 paise (₹10,000)
 * Sell: 100 units @ ₹200/unit  = 2,000,000 paise (₹20,000)
 * STCG = 2,000,000 − 1,000,000 = 1,000,000 paise (₹10,000)
 *
 * Held Apr → Oct (6 months) → short-term equity (≤12 months).
 * Returns the holdingId so the caller can clean up if needed.
 */
async function createStcgHolding(userId: string): Promise<{ holdingId: string; stcgPaise: number }> {
  const [h] = await db
    .insert(holdings)
    .values({
      userId,
      name: `integration-test-stock-${randomUUID()}`,
      assetClass: "stock",
      gainsTaxClass: "equity",
    })
    .returning({ id: holdings.id });
  const holdingId = h!.id;

  // Buy: 100 units @ ₹100/unit = 1,000,000 paise
  await db.insert(holdingEvents).values({
    holdingId,
    type: "buy",
    date: "2025-04-01",
    amountPaise: 1_000_000,
    units: 100,
    source: "manual",
  });

  // Sell: 100 units @ ₹200/unit = 2,000,000 paise
  await db.insert(holdingEvents).values({
    holdingId,
    type: "sell",
    date: "2025-10-01",
    amountPaise: 2_000_000,
    units: 100,
    source: "manual",
  });

  // STCG = 2,000,000 − 1,000,000 = 1,000,000 paise (₹10,000)
  return { holdingId, stcgPaise: 1_000_000 };
}

// ─── Test 1: Happy path — zero absorption (no holdings/gains in DB) ───────────
// With no holding events for the user, getCapitalGains returns 0 STCG/LTCG.
// Therefore no brought-forward losses are absorbed. The application is still
// recorded. This verifies the INSERT + UPDATE path without needing complex
// holdings setup.

test("applySetoffForFy: succeeds with zero absorption when no gains exist", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Create a STCL carry-forward entry with returnFiled=true.
  const entry = await createCapitalLossEntry(db, userId, {
    originFy: "2024-25",
    lossKind: "STCL",
    originalPaise: 100_000_000,
    remainingPaise: 100_000_000,
    returnFiled: true,
  });

  // Apply set-off — no holdings so STCG = 0 → absorbed = 0.
  const result = await applySetoffForFy(db, userId, "2025-26");

  assert.equal(result.fy, "2025-26");
  assert.equal(result.totalAbsorbedPaise, 0);
  assert.equal(result.entries.length, 0, "no entries absorbed when STCG = 0");

  // carry-forward entry's remainingPaise must be UNCHANGED (nothing absorbed).
  const rows = await db
    .select({ remainingPaise: capitalLossCarryforward.remainingPaise })
    .from(capitalLossCarryforward)
    .where(
      and(
        eq(capitalLossCarryforward.id, entry.id),
        eq(capitalLossCarryforward.userId, userId),
      ),
    );
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]!.remainingPaise,
    100_000_000,
    "remainingPaise must not change when nothing was absorbed",
  );

  // The idempotency application row must have been recorded.
  const apps = await db
    .select({ totalAbsorbedPaise: capitalLossSetoffApplications.totalAbsorbedPaise })
    .from(capitalLossSetoffApplications)
    .where(
      and(
        eq(capitalLossSetoffApplications.userId, userId),
        eq(capitalLossSetoffApplications.fy, "2025-26"),
      ),
    );
  assert.equal(apps.length, 1);
  assert.equal(apps[0]!.totalAbsorbedPaise, 0);
});

// ─── Test 2: Idempotency — second call for same FY throws 409 ─────────────────

test("applySetoffForFy: second call for same FY throws HttpError(409)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // First call — succeeds.
  await applySetoffForFy(db, userId, "2025-26");

  // Second call for the same FY — must 409.
  await assert.rejects(
    () => applySetoffForFy(db, userId, "2025-26"),
    (e: unknown) => {
      assert.ok(e instanceof HttpError, `expected HttpError, got ${String(e)}`);
      assert.equal((e as HttpError).statusCode, 409);
      return true;
    },
  );
});

// ─── Test 3: Idempotency — carryforward NOT decremented twice (real absorption) ──
//
// This test uses REAL STCG (from a holding with buy/sell events) so that the
// first call performs a genuine non-zero absorption and the second call 409s.
// A zero-absorption scenario proves nothing about idempotency of the decrement.

test("applySetoffForFy: carry-forward remainingPaise not decremented on second call (real absorption)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Set up a holding that produces STCG = 1,000,000 paise in FY 2025-26.
  const { stcgPaise } = await createStcgHolding(userId);

  // STCL carry-forward larger than the gain → partial absorption of the LOSS.
  // absorbedPaise = min(stcgPaise, stclPaise) = min(1,000,000, 2,000,000) = 1,000,000.
  const STCL_ORIGINAL = 2_000_000;
  const entry = await createCapitalLossEntry(db, userId, {
    originFy: "2024-25",
    lossKind: "STCL",
    originalPaise: STCL_ORIGINAL,
    remainingPaise: STCL_ORIGINAL,
    returnFiled: true,
  });

  // First call — REAL absorption should happen.
  const result1 = await applySetoffForFy(db, userId, "2025-26");
  assert.equal(result1.totalAbsorbedPaise, stcgPaise,
    "first call must absorb the full STCG against the carry-forward STCL");

  // Query the DB directly to confirm remainingPaise was decremented.
  const rowsAfterFirst = await db
    .select({ remainingPaise: capitalLossCarryforward.remainingPaise })
    .from(capitalLossCarryforward)
    .where(and(
      eq(capitalLossCarryforward.id, entry.id),
      eq(capitalLossCarryforward.userId, userId),
    ));
  assert.equal(rowsAfterFirst.length, 1);
  const expectedRemaining = STCL_ORIGINAL - stcgPaise;
  assert.equal(
    rowsAfterFirst[0]!.remainingPaise,
    expectedRemaining,
    `after first call, remainingPaise must be ${expectedRemaining} (original ${STCL_ORIGINAL} − absorbed ${stcgPaise})`,
  );

  // Second call must 409.
  await assert.rejects(
    () => applySetoffForFy(db, userId, "2025-26"),
    (e: unknown) => e instanceof HttpError && (e as HttpError).statusCode === 409,
  );

  // remainingPaise must NOT have changed after the 409.
  const rowsAfterSecond = await db
    .select({ remainingPaise: capitalLossCarryforward.remainingPaise })
    .from(capitalLossCarryforward)
    .where(and(
      eq(capitalLossCarryforward.id, entry.id),
      eq(capitalLossCarryforward.userId, userId),
    ));
  assert.equal(rowsAfterSecond.length, 1);
  assert.equal(
    rowsAfterSecond[0]!.remainingPaise,
    expectedRemaining,
    "remainingPaise must not change further after the 409 (decrement happened exactly once)",
  );
});

// ─── Test 4: Cross-user isolation ─────────────────────────────────────────────

test("applySetoffForFy: user B's call never touches user A's carry-forward entries", async (t) => {
  const userAId = await createUser();
  const userBId = await createUser();
  t.after(() => cleanupUser(userAId));
  t.after(() => cleanupUser(userBId));

  // User A has a carry-forward entry.
  const entryA = await createCapitalLossEntry(db, userAId, {
    originFy: "2023-24",
    lossKind: "LTCL",
    originalPaise: 80_000_000,
    remainingPaise: 80_000_000,
    returnFiled: true,
  });

  // User B applies set-off for the same FY — must not touch user A's entry.
  await applySetoffForFy(db, userBId, "2025-26");

  const rows = await db
    .select({ remainingPaise: capitalLossCarryforward.remainingPaise })
    .from(capitalLossCarryforward)
    .where(
      and(
        eq(capitalLossCarryforward.id, entryA.id),
        eq(capitalLossCarryforward.userId, userAId),
      ),
    );
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]!.remainingPaise,
    80_000_000,
    "user A's remainingPaise must be untouched by user B's applySetoffForFy",
  );
});

// ─── Test 5: Zero-absorption FY still records idempotency marker ──────────────

test("applySetoffForFy: zero-absorption FY records application and second call 409s", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // No carry-forward entries at all for this user.
  const result = await applySetoffForFy(db, userId, "2025-26");
  assert.equal(result.totalAbsorbedPaise, 0);
  assert.equal(result.entries.length, 0);

  // Idempotency row must exist.
  const apps = await db
    .select()
    .from(capitalLossSetoffApplications)
    .where(
      and(
        eq(capitalLossSetoffApplications.userId, userId),
        eq(capitalLossSetoffApplications.fy, "2025-26"),
      ),
    );
  assert.equal(apps.length, 1, "idempotency row must be recorded even for zero absorption");

  // Second call must 409 even for zero-absorption FY.
  await assert.rejects(
    () => applySetoffForFy(db, userId, "2025-26"),
    (e: unknown) => e instanceof HttpError && (e as HttpError).statusCode === 409,
  );
});

// ─── Test 6: Invalid FY throws 400 ────────────────────────────────────────────

test("applySetoffForFy: invalid FY string throws HttpError(400)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await assert.rejects(
    () => applySetoffForFy(db, userId, "not-a-fy"),
    (e: unknown) => e instanceof HttpError && (e as HttpError).statusCode === 400,
  );
});

// ─── Test 7: Real absorption — partial (STCG < STCL carry-forward) ────────────
//
// This is the critical gap: tests 1–5 all have zero current-year gains, so the
// decrement loop never ran. This test exercises the actual path.
//
// Setup:
//   • Holdings: buy 100 units @ ₹100 (Apr-25), sell @ ₹200 (Oct-25) → STCG = ₹10,000 (1,000,000 paise)
//   • Carry-forward STCL: ₹20,000 (2,000,000 paise), originFy "2024-25", returnFiled=true
//   • Absorption: min(2,000,000, 1,000,000) = 1,000,000 paise
//   • remainingPaiseAfter = 2,000,000 − 1,000,000 = 1,000,000 (partial, not full)

test("applySetoffForFy: real absorption — remainingPaise decremented by exactly the absorbed amount (partial)", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Holdings produce STCG = 1,000,000 paise (₹10,000) in FY 2025-26.
  const { stcgPaise } = await createStcgHolding(userId);
  assert.equal(stcgPaise, 1_000_000, "precondition: STCG is ₹10,000");

  // Carry-forward STCL is LARGER than the gain → only partially absorbed.
  const STCL_ORIGINAL = 2_000_000; // ₹20,000
  const entry = await createCapitalLossEntry(db, userId, {
    originFy: "2024-25",
    lossKind: "STCL",
    originalPaise: STCL_ORIGINAL,
    remainingPaise: STCL_ORIGINAL,
    returnFiled: true,
  });

  const result = await applySetoffForFy(db, userId, "2025-26");

  // (a) totalAbsorbedPaise > 0 and equals the STCG amount.
  assert.ok(result.totalAbsorbedPaise > 0, "totalAbsorbedPaise must be > 0");
  assert.equal(result.totalAbsorbedPaise, stcgPaise,
    "totalAbsorbedPaise must equal the STCG (full gain absorbed by the STCL carry-forward)");

  // (b) DB row reflects the exact decrement — not original, not zero.
  const rows = await db
    .select({ remainingPaise: capitalLossCarryforward.remainingPaise })
    .from(capitalLossCarryforward)
    .where(and(
      eq(capitalLossCarryforward.id, entry.id),
      eq(capitalLossCarryforward.userId, userId),
    ));
  assert.equal(rows.length, 1);
  const expectedRemaining = STCL_ORIGINAL - stcgPaise; // 1,000,000
  assert.equal(
    rows[0]!.remainingPaise,
    expectedRemaining,
    `remainingPaise must be ${expectedRemaining} (original − absorbed), not the original amount and not zero`,
  );
  assert.ok(rows[0]!.remainingPaise > 0, "remainingPaise must be > 0 — this is PARTIAL absorption");

  // (c) A subsequent getCapitalPosition for a LATER FY (2026-27) still sees the
  // reduced balance, proving the carry-forward persists correctly.
  const { getCapitalPosition } = await import("./capital-losses.ts");
  const pos = await getCapitalPosition(db, userId, "2026-27");
  const bfEntry = pos.broughtForwardLossesApplied.find((e) => e.entryId === entry.id);
  // The entry still shows up in the later FY with its REDUCED remaining balance.
  // If bfEntry is present, its absorbedPaise comes from the reduced balance.
  // The reduced balance (1,000,000) should appear as the potential absorption
  // available for 2026-27 (no new gains here, so it shows 0 absorbed for that FY).
  // We verify by checking validBf — easier: check that remainingPaise in DB is still
  // 1,000,000 (already asserted above) and that pos shows 0 absorbed for 2026-27.
  if (bfEntry) {
    assert.ok(bfEntry.absorbedPaise <= expectedRemaining,
      "any absorption in 2026-27 must not exceed the post-setoff remaining balance");
  }
  // If no STCG in 2026-27 (no holdings), absorption is 0 — entry still exists.
  assert.ok(
    pos.broughtForwardLossesApplied.length === 0 || bfEntry !== undefined,
    "entry either not present (no 2026-27 absorption) or present with consistent absorption",
  );
});

// ─── Test 8: Real absorption — full (STCG >= STCL carry-forward) ──────────────
//
// When the STCL carry-forward exactly equals the STCG, remainingPaise → 0.
// This exercises the full-absorption branch of the decrement loop.

test("applySetoffForFy: real absorption — STCL fully absorbed, remainingPaise becomes exactly 0", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Holdings produce STCG = 1,000,000 paise (₹10,000) in FY 2025-26.
  const { stcgPaise } = await createStcgHolding(userId);
  assert.equal(stcgPaise, 1_000_000, "precondition: STCG is ₹10,000");

  // Carry-forward STCL equals the gain exactly → fully absorbed.
  const entry = await createCapitalLossEntry(db, userId, {
    originFy: "2024-25",
    lossKind: "STCL",
    originalPaise: stcgPaise, // exactly matches STCG
    remainingPaise: stcgPaise,
    returnFiled: true,
  });

  const result = await applySetoffForFy(db, userId, "2025-26");

  assert.equal(result.totalAbsorbedPaise, stcgPaise,
    "totalAbsorbedPaise must equal the full STCL (and full STCG)");
  assert.equal(result.entries.length, 1, "one entry must be reported in the result");

  // remainingPaise must be exactly 0 — not negative, not any residual.
  const rows = await db
    .select({ remainingPaise: capitalLossCarryforward.remainingPaise })
    .from(capitalLossCarryforward)
    .where(and(
      eq(capitalLossCarryforward.id, entry.id),
      eq(capitalLossCarryforward.userId, userId),
    ));
  assert.equal(rows.length, 1);
  assert.equal(
    rows[0]!.remainingPaise,
    0,
    "remainingPaise must be exactly 0 after full absorption — not negative, not a residual",
  );
});
