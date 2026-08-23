/**
 * regime-preference.test.ts — service tests for tax/services/regime-preference.ts
 *
 * Pure tests (no DB) verify module exports and HttpError(400) for invalid FY.
 * DB-backed tests require DATABASE_URL and a live Postgres connection; they are
 * skipped automatically when DATABASE_URL is not set (same guard pattern as
 * apps/api/src/modules/investments/services/deposit-details.test.ts).
 */

import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import {
  getRegimePreference,
  upsertRegimePreference,
  updateInferredRegime,
} from "./regime-preference.ts";
import { HttpError } from "../../../lib/errors.ts";

// ── Pure: module exports the expected functions ───────────────────────────────

test("regime-preference module exports getRegimePreference, upsertRegimePreference, updateInferredRegime", () => {
  assert.equal(typeof getRegimePreference, "function");
  assert.equal(typeof upsertRegimePreference, "function");
  assert.equal(typeof updateInferredRegime, "function");
});

// ── Pure: uncovered-FY HttpError(400) ────────────────────────────────────────
// These do not hit the DB — the FY guard fires before any query.

test("getRegimePreference: HttpError(400) for FY outside coveredFys", async () => {
  // Stub db — never called because the FY guard fires first.
  const stubDb = {} as Parameters<typeof getRegimePreference>[0];
  await assert.rejects(
    () => getRegimePreference(stubDb, randomUUID(), "2030-31"),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});

test("upsertRegimePreference: HttpError(400) for FY outside coveredFys", async () => {
  const stubDb = {} as Parameters<typeof upsertRegimePreference>[0];
  await assert.rejects(
    () => upsertRegimePreference(stubDb, randomUUID(), "2030-31", "new"),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});

test("getRegimePreference: HttpError(400) for malformed FY (e.g. '2025-27')", async () => {
  const stubDb = {} as Parameters<typeof getRegimePreference>[0];
  await assert.rejects(
    () => getRegimePreference(stubDb, randomUUID(), "2025-27"),
    (err: unknown) => {
      assert.ok(err instanceof HttpError);
      assert.equal((err as HttpError).statusCode, 400);
      return true;
    },
  );
});

// ── DB-backed tests ───────────────────────────────────────────────────────────
// Require a live Postgres connection. Skipped when DATABASE_URL is absent.
//
// These tests verify:
//   - composite-PK upsert idempotency
//   - resolution order: chosen > inferred > default
//   - PUT preserves inferred_regime
//   - inference preserves chosen
//   - user isolation (one user's data never leaks to another)

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "regime-preference.test.ts DB-backed tests need DATABASE_URL set " +
      "(a real Postgres connection) — export it before running `npm run test -w apps/api`.",
    );
  }
  return url;
}

const dbUrl = process.env.DATABASE_URL;

if (dbUrl) {
  const { createDb } = await import("../../../db/index.ts");
  const { createPool } = await import("../../../infra/db.ts");
  const { users: usersTable } = await import("../../../db/schema.ts");

  const pool = createPool(requireDatabaseUrl());
  const db = createDb(pool);

  after(async () => { await pool.end(); });

  const TEST_FY = "2025-26";

  // Helper: create a test user and return userId.
  async function createTestUser(): Promise<string> {
    const id = randomUUID();
    await db.insert(usersTable).values({
      id,
      email: `tax-pref-test-${id}@test.local`,
      passwordHash: "x",
      displayName: "tax preference test user",
    });
    return id;
  }

  // ── upsert idempotency ─────────────────────────────────────────────────────

  test("upsertRegimePreference: first write creates row; second write is idempotent", async () => {
    const userId = await createTestUser();

    const r1 = await upsertRegimePreference(db, userId, TEST_FY, "new");
    assert.equal(r1.chosen, "new");
    assert.equal(r1.effective, "new");
    assert.equal(r1.source, "chosen");

    // Re-run with same value — should not error.
    const r2 = await upsertRegimePreference(db, userId, TEST_FY, "new");
    assert.equal(r2.chosen, "new");
    assert.equal(r2.effective, "new");
  });

  test("upsertRegimePreference: switching chosen from 'new' to 'old' updates effective", async () => {
    const userId = await createTestUser();

    await upsertRegimePreference(db, userId, TEST_FY, "new");
    const r = await upsertRegimePreference(db, userId, TEST_FY, "old");
    assert.equal(r.chosen, "old");
    assert.equal(r.effective, "old");
    assert.equal(r.source, "chosen");
  });

  // ── resolution order: chosen > inferred > default ──────────────────────────

  test("getRegimePreference: returns default (new) when no row exists", async () => {
    const userId = await createTestUser();
    const r = await getRegimePreference(db, userId, TEST_FY);
    assert.equal(r.chosen, null);
    assert.equal(r.inferredRegime, null);
    assert.equal(r.effective, "new");
    assert.equal(r.source, "default");
  });

  test("resolution order: inferred wins over default", async () => {
    const userId = await createTestUser();

    await updateInferredRegime(db, userId, TEST_FY, "old");
    const r = await getRegimePreference(db, userId, TEST_FY);
    assert.equal(r.inferredRegime, "old");
    assert.equal(r.effective, "old");
    assert.equal(r.source, "inferred");
  });

  test("resolution order: chosen wins over inferred", async () => {
    const userId = await createTestUser();

    // First infer 'old', then set chosen = 'new'.
    await updateInferredRegime(db, userId, TEST_FY, "old");
    await upsertRegimePreference(db, userId, TEST_FY, "new");

    const r = await getRegimePreference(db, userId, TEST_FY);
    assert.equal(r.chosen, "new");
    assert.equal(r.inferredRegime, "old");
    assert.equal(r.effective, "new");
    assert.equal(r.source, "chosen");
  });

  // ── PUT preserves inferred_regime ─────────────────────────────────────────

  test("upsertRegimePreference: PUT preserves existing inferred_regime", async () => {
    const userId = await createTestUser();

    // Set inferred first.
    await updateInferredRegime(db, userId, TEST_FY, "old");

    // PUT chosen — inferred must be preserved.
    const r = await upsertRegimePreference(db, userId, TEST_FY, "new");
    assert.equal(r.chosen, "new");
    assert.equal(r.effective, "new");
    assert.equal(r.source, "chosen");
    // Re-read to confirm inferred is still in the DB.
    const read = await getRegimePreference(db, userId, TEST_FY);
    assert.equal(read.inferredRegime, "old", "inferred_regime should survive a PUT");
  });

  // ── inference preserves chosen ─────────────────────────────────────────────

  test("updateInferredRegime: preserves chosen when updating inferred", async () => {
    const userId = await createTestUser();

    // Set chosen first.
    await upsertRegimePreference(db, userId, TEST_FY, "new");

    // Now infer 'old' — chosen should still win.
    const r = await updateInferredRegime(db, userId, TEST_FY, "old");
    assert.equal(r.effective, "new");
    assert.equal(r.source, "chosen");
    assert.equal(r.inferredRegime, "old");
  });

  // ── user isolation ─────────────────────────────────────────────────────────

  test("user isolation: different users have independent preferences", async () => {
    const userId1 = await createTestUser();
    const userId2 = await createTestUser();

    await upsertRegimePreference(db, userId1, TEST_FY, "old");
    await upsertRegimePreference(db, userId2, TEST_FY, "new");

    const r1 = await getRegimePreference(db, userId1, TEST_FY);
    const r2 = await getRegimePreference(db, userId2, TEST_FY);

    assert.equal(r1.chosen, "old");
    assert.equal(r2.chosen, "new");
  });

  // ── concurrency consistency ────────────────────────────────────────────────
  // Fires upsertRegimePreference and updateInferredRegime concurrently on the
  // same (user, fy) row and asserts the resolution invariant holds regardless
  // of interleaving. Both writes are atomic SQL upserts so no invalid row state
  // is possible, but the test proves it empirically over 25 iterations.

  test("concurrency: concurrent chosen and inferred writes satisfy resolution invariant (25 iterations)", async () => {
    const COVERED_FYS = ["2023-24", "2024-25", "2025-26", "2026-27"] as const;
    const REGIMES = ["old", "new"] as const;

    // This test is sound: a lost update can never silently pass the exact
    // postconditions below. However, detecting the old reverted read-modify-write
    // race remains probabilistic, since deterministic mid-statement interleaving
    // would require production test hooks in the database layer.
    for (let i = 0; i < 25; i++) {
      const userId = await createTestUser();
      const fy = COVERED_FYS[i % COVERED_FYS.length]!;
      const chosenRegime = REGIMES[i % 2]!;
      const inferredRegime = REGIMES[(i + 1) % 2]!;  // opposite

      // Fire both writes concurrently — neither waits for the other.
      await Promise.all([
        upsertRegimePreference(db, userId, fy, chosenRegime),
        updateInferredRegime(db, userId, fy, inferredRegime),
      ]);

      // Read back the settled row.
      const row = await getRegimePreference(db, userId, fy);

      // Both fields must have been written exactly — no lost updates.
      // The atomic upserts (INSERT … ON CONFLICT DO UPDATE) preserve the other
      // field under any interleaving.
      assert.equal(row.chosen, chosenRegime, `chosen must equal ${chosenRegime}, got ${row.chosen}`);
      assert.equal(row.inferredRegime, inferredRegime, `inferredRegime must equal ${inferredRegime}, got ${row.inferredRegime}`);

      // Resolution invariant: effective and source must agree.
      assert.equal(row.effective, row.chosen, `effective must equal chosen (${row.chosen}), got ${row.effective}`);
      assert.equal(row.source, "chosen", `source must be 'chosen' when chosen is set, got ${row.source}`);
    }
  });
}
