/**
 * deposit-details.ts service tests.
 *
 * Pure tests (no DB) are gated only on module import.
 * DB-backed tests require DATABASE_URL and a live Postgres connection.
 */
import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { getDepositDetails, upsertDepositDetails, getDepositSchedule, validateDepositKindConstraints } from "./deposit-details.ts";
import { HttpError } from "../../../lib/errors.ts";

// ── Pure: module exports the expected functions ───────────────────────────────

test("deposit-details module exports getDepositDetails, upsertDepositDetails, getDepositSchedule", () => {
  assert.equal(typeof getDepositDetails, "function");
  assert.equal(typeof upsertDepositDetails, "function");
  assert.equal(typeof getDepositSchedule, "function");
});

// ── Pure: validateDepositKindConstraints — RD quarterly enforcement (F3) ─────

test("validateDepositKindConstraints: RD with non-quarterly compoundingFrequency is rejected (400)", () => {
  for (const freq of ["monthly", "half_yearly", "annually"] as const) {
    assert.throws(
      () => validateDepositKindConstraints({
        depositKind: "rd",
        installmentPaise: 1_000_000,
        totalInstallments: 12,
        annualRateBps: 700,
        compoundingFrequency: freq,
        interestDisposition: "reinvest",
        startDate: "2024-01-01",
        maturityDate: "2025-01-01",
      }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError, `expected HttpError for frequency ${freq}`);
        assert.equal((err as HttpError).statusCode, 400);
        return true;
      },
      `should reject RD with compoundingFrequency="${freq}"`,
    );
  }
});

test("validateDepositKindConstraints: RD with quarterly compoundingFrequency is accepted", () => {
  assert.doesNotThrow(() =>
    validateDepositKindConstraints({
      depositKind: "rd",
      installmentPaise: 1_000_000,
      totalInstallments: 12,
      annualRateBps: 700,
      compoundingFrequency: "quarterly",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2025-01-01",
    }),
  );
});

// ── Pure: validateDepositKindConstraints — NSC 5-year enforcement (F2) ────────

test("validateDepositKindConstraints: NSC with non-5-year term is rejected (400)", () => {
  // 4-year NSC
  assert.throws(
    () => validateDepositKindConstraints({
      depositKind: "nsc",
      principalPaise: 1_000_000,
      annualRateBps: 765,
      compoundingFrequency: "annually",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2028-01-01", // 4 years, not 5
    }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
  // 6-year NSC (one month extra)
  assert.throws(
    () => validateDepositKindConstraints({
      depositKind: "nsc",
      principalPaise: 1_000_000,
      annualRateBps: 765,
      compoundingFrequency: "annually",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2029-02-01", // 5 years + 1 month
    }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});

test("validateDepositKindConstraints: NSC with exact 5-year term is accepted", () => {
  assert.doesNotThrow(() =>
    validateDepositKindConstraints({
      depositKind: "nsc",
      principalPaise: 1_000_000,
      annualRateBps: 765,
      compoundingFrequency: "annually",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2029-01-01", // addMonths("2024-01-01", 60) = "2029-01-01"
    }),
  );
});

// ── Pure: validateDepositKindConstraints — tax_saver_fd exact boundary (F2) ──

test("validateDepositKindConstraints: tax_saver_fd with exact 5-year term is accepted", () => {
  assert.doesNotThrow(() =>
    validateDepositKindConstraints({
      depositKind: "tax_saver_fd",
      principalPaise: 5_000_000,
      annualRateBps: 710,
      compoundingFrequency: "quarterly",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2029-01-01", // addMonths("2024-01-01", 60) = "2029-01-01"
    }),
  );
});

test("validateDepositKindConstraints: tax_saver_fd one day short of 5 years is rejected (400)", () => {
  assert.throws(
    () => validateDepositKindConstraints({
      depositKind: "tax_saver_fd",
      principalPaise: 5_000_000,
      annualRateBps: 710,
      compoundingFrequency: "quarterly",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2028-12-31", // 1 day before exact 5-year
    }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});

test("validateDepositKindConstraints: tax_saver_fd one day beyond 5 years is rejected (400)", () => {
  assert.throws(
    () => validateDepositKindConstraints({
      depositKind: "tax_saver_fd",
      principalPaise: 5_000_000,
      annualRateBps: 710,
      compoundingFrequency: "quarterly",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2029-01-02", // 1 day after exact 5-year
    }),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});

// ── DB-backed tests ───────────────────────────────────────────────────────────

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "deposit-details.test.ts's DB-backed tests need DATABASE_URL set " +
      "(a real Postgres connection) — export it (see apps/api/.env) before running " +
      "`npm run test -w apps/api`.",
    );
  }
  return url;
}

// The DB-backed tests below require a live Postgres connection. They verify
// ownership validation (404 for missing/wrong-user holding, 400 for wrong
// asset class) and the full upsert/read/schedule cycle.

const dbUrl = process.env.DATABASE_URL; // undefined without .env → tests below guard themselves

if (dbUrl) {
  const { createDb } = await import("../../../db/index.ts");
  const { createPool } = await import("../../../infra/db.ts");
  const { holdings, users: usersTable } = await import("../../../db/schema.ts");
  const { eq } = await import("drizzle-orm");

  const pool = createPool(requireDatabaseUrl());
  const db = createDb(pool);

  after(async () => { await pool.end(); });

  // Seed a test user + fd holding, then run service calls.
  test("upsertDepositDetails: 404 when holdingId belongs to a different user", async () => {
    const userId1 = randomUUID();
    const userId2 = randomUUID();

    // Insert test users.
    await db.insert(usersTable).values([
      { id: userId1, email: `dd-test1-${userId1}@test.local`, passwordHash: "x", displayName: "deposit test user" },
      { id: userId2, email: `dd-test2-${userId2}@test.local`, passwordHash: "x", displayName: "deposit test user" },
    ]);

    // Insert an fd holding owned by user1.
    const [h] = await db.insert(holdings).values({
      id: randomUUID(),
      userId: userId1,
      name: "Test FD",
      assetClass: "fd",
      gainsTaxClass: "other",
    }).returning();

    // user2 tries to upsert deposit details — should get 404.
    await assert.rejects(
      () => upsertDepositDetails(db, userId2, h!.id, {
        depositKind: "fd",
        principalPaise: 100_000,
        annualRateBps: 700,
        compoundingFrequency: "quarterly",
        interestDisposition: "reinvest",
        startDate: "2024-01-01",
        maturityDate: "2025-01-01",
      }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal((err as HttpError).statusCode, 404);
        return true;
      },
    );

    // Cleanup.
    await db.delete(holdings).where(eq(holdings.id, h!.id));
    await db.delete(usersTable).where(eq(usersTable.id, userId1));
    await db.delete(usersTable).where(eq(usersTable.id, userId2));
  });

  test("upsertDepositDetails: 400 when holding assetClass is not fd", async () => {
    const userId = randomUUID();
    await db.insert(usersTable).values({ id: userId, email: `dd-test3-${userId}@test.local`, passwordHash: "x", displayName: "deposit test user" });

    const [h] = await db.insert(holdings).values({
      id: randomUUID(),
      userId,
      name: "MF Fund",
      assetClass: "mutual_fund",
      gainsTaxClass: "equity",
    }).returning();

    await assert.rejects(
      () => upsertDepositDetails(db, userId, h!.id, {
        depositKind: "fd",
        principalPaise: 100_000,
        annualRateBps: 700,
        compoundingFrequency: "quarterly",
        interestDisposition: "reinvest",
        startDate: "2024-01-01",
        maturityDate: "2025-01-01",
      }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal((err as HttpError).statusCode, 400);
        return true;
      },
    );

    await db.delete(holdings).where(eq(holdings.id, h!.id));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });

  test("upsertDepositDetails: full cycle — insert, read, schedule", async () => {
    const userId = randomUUID();
    await db.insert(usersTable).values({ id: userId, email: `dd-test4-${userId}@test.local`, passwordHash: "x", displayName: "deposit test user" });

    const [h] = await db.insert(holdings).values({
      id: randomUUID(),
      userId,
      name: "Test FD Cycle",
      assetClass: "fd",
      gainsTaxClass: "other",
    }).returning();

    const detail = await upsertDepositDetails(db, userId, h!.id, {
      depositKind: "fd",
      principalPaise: 10_000_000,
      annualRateBps: 710,
      compoundingFrequency: "quarterly",
      interestDisposition: "reinvest",
      startDate: "2024-01-01",
      maturityDate: "2025-01-01",
    });

    assert.equal(detail.holdingId, h!.id);
    assert.equal(detail.depositKind, "fd");
    assert.equal(detail.principalPaise, 10_000_000);
    assert.equal(detail.annualRateBps, 710);

    // Read back.
    const fetched = await getDepositDetails(db, userId, h!.id);
    assert.ok(fetched !== null);
    assert.equal(fetched!.annualRateBps, 710);

    // Schedule.
    const schedule = await getDepositSchedule(db, userId, h!.id);
    assert.equal(schedule.holdingId, h!.id);
    assert.equal(schedule.periods.length, 4);
    assert.ok(schedule.maturityValuePaise > 10_000_000);

    await db.delete(holdings).where(eq(holdings.id, h!.id));
    await db.delete(usersTable).where(eq(usersTable.id, userId));
  });
}
