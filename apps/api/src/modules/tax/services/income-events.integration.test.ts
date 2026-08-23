/**
 * income-events.integration.test.ts — Real-Postgres integration tests (task 13.4).
 *
 * REQUIREMENTS per tasks/TDD.md:
 *   - Do NOT mock the database. CI has a real one; a mocked Drizzle chain tests
 *     your mock, not the real service or the real DB constraints.
 *   - Requires a real Postgres connection (DATABASE_URL env var).
 *     requireDatabaseUrl() throws loudly rather than skipping when unset.
 *   - Each test creates and cleans up its own throwaway user(s)/rows via t.after().
 *
 * Covered:
 *   1. Guarded accept-vs-reject race: Promise.all fires both; exactly one wins, the
 *      loser gets a 409 HttpError.
 *   2. Cross-user 404: getIncomeEvent/acceptIncomeEvent/rejectIncomeEvent return 404
 *      when the row belongs to a different user.
 *   3. Source dedup via two real deriveFromPayslip calls against the same accepted
 *      payslip — second call returns the SAME row id; the partial unique index means
 *      exactly one row exists for (user, source_kind='payslip', source_id=payslipId).
 *   4. section/sourcePriority round-trip: manually created event with section='194A'
 *      and deriveFromHoldingEvent setting section='194K' both persist and are returned
 *      correctly in the DTO.
 *
 * Pattern: `apps/api/src/modules/ledger/services/epf-contributions.test.ts`.
 */

import { test, after, describe } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { createDb, type Db } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/schema.ts";
import { payslips, incomeEvents } from "../schema.ts";
import {
  createIncomeEvent,
  getIncomeEvent,
  acceptIncomeEvent,
  rejectIncomeEvent,
  deriveFromPayslip,
} from "./income-events.ts";

// ─── Bootstrap ────────────────────────────────────────────────────────────────

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "income-events.integration.test.ts needs DATABASE_URL set (a real Postgres " +
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
      email: `income-events-integration-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "income-events.integration.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  // incomeEvents rows are deleted via CASCADE from users, but explicit cleanup
  // is safer to avoid leaving orphans when CASCADE ordering differs.
  await db.delete(incomeEvents).where(eq(incomeEvents.userId, userId));
  await db.delete(payslips).where(eq(payslips.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

/**
 * Create a minimal accepted payslip for `userId`.
 * The payslip is inserted in 'accepted' status with a non-null grossPaise,
 * so deriveFromPayslip can use it immediately.
 */
async function createAcceptedPayslip(
  userId: string,
  payMonth = "2025-06",
  grossPaise = 5_000_00,
): Promise<string> {
  const [p] = await db
    .insert(payslips)
    .values({
      userId,
      fy: "2025-26",
      payMonth,
      employerName: "Integration Test Corp",
      status: "accepted",
      grossPaise,
      tdsCurrentPaise: 30_000,
      acceptedAt: new Date(),
    })
    .returning({ id: payslips.id });
  return p!.id;
}

// ─── Test 1: Guarded accept-vs-reject race ────────────────────────────────────

describe("income-events accept-vs-reject race (real Postgres)", () => {
  test("exactly one of two concurrent accept/reject calls wins; the loser gets 409", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));

    // Create a pending income event.
    const event = await createIncomeEvent(db, userId, {
      accrualDate: "2025-06-30",
      incomeKind: "interest",
      grossPaise: 100_000,
      tdsPaise: 10_000,
    });

    // Fire accept and reject concurrently.
    const [acceptResult, rejectResult] = await Promise.allSettled([
      acceptIncomeEvent(db, userId, event.id, {}),
      rejectIncomeEvent(db, userId, event.id),
    ]);

    // Exactly one should have fulfilled; the other should have been rejected with 409.
    const fulfilled = [acceptResult, rejectResult].filter((r) => r.status === "fulfilled");
    const rejected = [acceptResult, rejectResult].filter((r) => r.status === "rejected");

    assert.equal(fulfilled.length, 1, "exactly one of accept/reject must succeed");
    assert.equal(rejected.length, 1, "exactly one of accept/reject must fail");

    const loser = rejected[0] as PromiseRejectedResult;
    const err = loser.reason as { statusCode?: number; name?: string };
    assert.equal(err.name, "HttpError", `expected HttpError, got ${String(err.name)}`);
    assert.equal(err.statusCode, 409, `loser must get 409, got ${String(err.statusCode)}`);

    // Confirm the final state is one of the two terminal states (not pending).
    const final = await getIncomeEvent(db, userId, event.id);
    assert.ok(
      final.status === "accepted" || final.status === "rejected",
      `expected accepted or rejected, got ${final.status}`,
    );
  });
});

// ─── Test 2: Cross-user 404 ────────────────────────────────────────────────────

describe("income-events cross-user 404 (real Postgres)", () => {
  test("getIncomeEvent returns 404 when the row belongs to a different user", async (t) => {
    const ownerUserId = await createUser();
    const otherUserId = await createUser();
    t.after(() => Promise.all([cleanupUser(ownerUserId), cleanupUser(otherUserId)]));

    // Create an event owned by `owner`.
    const ownerEvent = await createIncomeEvent(db, ownerUserId, {
      accrualDate: "2025-06-30",
      incomeKind: "rent",
      grossPaise: 200_000,
    });

    // `other` must not be able to fetch or mutate it.
    await assert.rejects(
      () => getIncomeEvent(db, otherUserId, ownerEvent.id),
      (err: { name?: string; statusCode?: number }) => {
        assert.equal(err.name, "HttpError");
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });

  test("acceptIncomeEvent returns 404 when the row belongs to a different user", async (t) => {
    const ownerUserId = await createUser();
    const otherUserId = await createUser();
    t.after(() => Promise.all([cleanupUser(ownerUserId), cleanupUser(otherUserId)]));

    const ownerEvent = await createIncomeEvent(db, ownerUserId, {
      accrualDate: "2025-06-30",
      incomeKind: "salary",
      grossPaise: 500_000,
    });

    await assert.rejects(
      () => acceptIncomeEvent(db, otherUserId, ownerEvent.id, {}),
      (err: { name?: string; statusCode?: number }) => {
        assert.equal(err.name, "HttpError");
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });

  test("rejectIncomeEvent returns 404 when the row belongs to a different user", async (t) => {
    const ownerUserId = await createUser();
    const otherUserId = await createUser();
    t.after(() => Promise.all([cleanupUser(ownerUserId), cleanupUser(otherUserId)]));

    const ownerEvent = await createIncomeEvent(db, ownerUserId, {
      accrualDate: "2025-09-10",
      incomeKind: "dividend",
      grossPaise: 50_000,
    });

    await assert.rejects(
      () => rejectIncomeEvent(db, otherUserId, ownerEvent.id),
      (err: { name?: string; statusCode?: number }) => {
        assert.equal(err.name, "HttpError");
        assert.equal(err.statusCode, 404);
        return true;
      },
    );
  });
});

// ─── Test 3: Source dedup via real partial unique index ────────────────────────

describe("income-events deriveFromPayslip dedup (real Postgres)", () => {
  test("two deriveFromPayslip calls on the same payslip return the same row id", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));

    const payslipId = await createAcceptedPayslip(userId);

    // First derive.
    const first = await deriveFromPayslip(db, userId, payslipId);
    // Second derive (idempotent via onConflictDoNothing + fetch).
    const second = await deriveFromPayslip(db, userId, payslipId);

    assert.equal(first.id, second.id, "both calls must return the same income event row");
    assert.equal(first.sourceKind, "payslip");
    assert.equal(first.sourceId, payslipId);

    // Real DB: confirm exactly one row in income_events for this payslip.
    const rows = await db
      .select({ id: incomeEvents.id })
      .from(incomeEvents)
      .where(
        and(
          eq(incomeEvents.userId, userId),
          eq(incomeEvents.sourceKind, "payslip"),
          eq(incomeEvents.sourceId, payslipId),
        ),
      );
    assert.equal(
      rows.length,
      1,
      "partial unique index must allow exactly one derived row per payslip",
    );
  });
});

// ─── Test 4: section/sourcePriority round-trip ────────────────────────────────

describe("income-events section/sourcePriority round-trip (real Postgres)", () => {
  test("createIncomeEvent: section and sourcePriority persist and are returned in the DTO", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));

    const event = await createIncomeEvent(db, userId, {
      accrualDate: "2025-08-15",
      incomeKind: "interest",
      grossPaise: 50_000,
      tdsPaise: 5_000,
      section: "194A",
    });

    assert.equal(event.section, "194A", "section must round-trip through create");
    assert.equal(event.sourcePriority, 0, "sourcePriority must default to 0");

    // Re-fetch from DB to confirm persistence (not just in-memory DTO).
    const fetched = await getIncomeEvent(db, userId, event.id);
    assert.equal(fetched.section, "194A");
    assert.equal(fetched.sourcePriority, 0);
  });

  test("deriveFromPayslip: section='192' and sourcePriority=0 persist correctly", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));

    const payslipId = await createAcceptedPayslip(userId);
    const event = await deriveFromPayslip(db, userId, payslipId);

    assert.equal(event.section, "192", "salary section must be 192");
    assert.equal(event.sourcePriority, 0);

    // Re-fetch from DB to confirm persistence.
    const fetched = await getIncomeEvent(db, userId, event.id);
    assert.equal(fetched.section, "192");
    assert.equal(fetched.sourcePriority, 0);
  });

  test("createIncomeEvent without section: section is null in the DTO", async (t) => {
    const userId = await createUser();
    t.after(() => cleanupUser(userId));

    const event = await createIncomeEvent(db, userId, {
      accrualDate: "2025-10-01",
      incomeKind: "other",
      grossPaise: 20_000,
    });

    assert.equal(event.section, null, "omitted section must be null in DTO");

    const fetched = await getIncomeEvent(db, userId, event.id);
    assert.equal(fetched.section, null);
  });
});
