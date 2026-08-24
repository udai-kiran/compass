/**
 * deductions.integration.test.ts — DB-backed integration tests for the deduction
 * basket service (task 13.7).
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
 * Future coverage (deferred — see DELEGATION.md 2f):
 *   - EPF/VPF aggregation in 80C (requires seeding epf_contributions + payslips + payslip_components)
 *   - PPF/SSY compliance contributions in 80C (requires seeding savings_accounts + holding events)
 *   - ELSS buy events in 80C (requires seeding holdings (isElss=true) + holdingEvents)
 *   - Life insurance actual premiums in 80C (requires seeding transactions + postings chain with policyId)
 *   - Tax-saver FD / NSC amounts in 80C (requires seeding deposit_details + holdings)
 *   - EMI interest estimate with real data (requires full EMI table setup)
 */

import { test, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { createDb } from "../../../db/index.ts";
import { createPool } from "../../../infra/db.ts";
import { users } from "../../../db/schema.ts";
import { insurancePolicies } from "../../../db/shared/spines.ts";
import { deductionEntries, taxRegimePreferences } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import {
  listDeductionEntries,
  createDeductionEntry,
  updateDeductionEntry,
  deleteDeductionEntry,
  getDeductionBasket,
} from "./deductions.ts";

// ─── DB setup ────────────────────────────────────────────────────────────────

function requireDatabaseUrl(): string {
  const url = process.env.DATABASE_URL;
  if (!url) {
    throw new Error(
      "deductions.integration.test.ts requires DATABASE_URL set (a real Postgres " +
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
      email: `ded-int-test-${randomUUID()}@example.invalid`,
      passwordHash: "x",
      displayName: "deductions.integration.test.ts user",
    })
    .returning({ id: users.id });
  return u!.id;
}

async function cleanupUser(userId: string): Promise<void> {
  // Delete in dependency order (children before parents)
  await db.delete(deductionEntries).where(eq(deductionEntries.userId, userId));
  await db.delete(taxRegimePreferences).where(eq(taxRegimePreferences.userId, userId));
  await db.delete(insurancePolicies).where(eq(insurancePolicies.userId, userId));
  await db.delete(users).where(eq(users.id, userId));
}

// ─── Group 1: CRUD for deduction_entries ────────────────────────────────────

test("create and list deduction entries for a FY", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const entry = await createDeductionEntry(db, userId, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 1_000_000,
    description: "",
  });

  assert.ok(entry.id, "entry should have an id");
  assert.equal(entry.fy, "2024-25");
  assert.equal(entry.section, "80C");
  assert.equal(entry.deductionKind, "other_80c");
  assert.equal(entry.amountPaise, 1_000_000);

  const list = await listDeductionEntries(db, userId, "2024-25");
  assert.equal(list.length, 1);
  assert.equal(list[0]!.id, entry.id);
  assert.equal(list[0]!.amountPaise, 1_000_000);
  assert.equal(list[0]!.section, "80C");
});

test("update deduction entry", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const entry = await createDeductionEntry(db, userId, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 1_000_000,
    description: "",
  });

  const updated = await updateDeductionEntry(db, userId, entry.id, { amountPaise: 2_000_000 });
  assert.equal(updated.id, entry.id);
  assert.equal(updated.amountPaise, 2_000_000);
});

test("delete deduction entry", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const entry = await createDeductionEntry(db, userId, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 1_500_000,
    description: "",
  });

  await deleteDeductionEntry(db, userId, entry.id);

  const list = await listDeductionEntries(db, userId, "2024-25");
  assert.equal(list.length, 0);
});

test("ownership: update by wrong user throws 404", async (t) => {
  const user1Id = await createUser();
  t.after(() => cleanupUser(user1Id));
  const user2Id = await createUser();
  t.after(() => cleanupUser(user2Id));

  const entry = await createDeductionEntry(db, user1Id, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 1_000_000,
    description: "",
  });

  await assert.rejects(
    updateDeductionEntry(db, user2Id, entry.id, { amountPaise: 500_000 }),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("ownership: delete by wrong user throws 404", async (t) => {
  const user1Id = await createUser();
  t.after(() => cleanupUser(user1Id));
  const user2Id = await createUser();
  t.after(() => cleanupUser(user2Id));

  const entry = await createDeductionEntry(db, user1Id, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 1_000_000,
    description: "",
  });

  await assert.rejects(
    deleteDeductionEntry(db, user2Id, entry.id),
    (e: unknown) => e instanceof HttpError && e.statusCode === 404,
  );
});

test("DB check constraint: 80CCD2 entry with invalid employerType is rejected", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // The check constraint catches non-null invalid values:
  // `section <> '80CCD2' OR (employer_type IN ('private','government') AND salary_base_paise > 0)`
  // Note: SQL NULL semantics mean omitting employer_type (NULL) passes the constraint —
  // the Zod superRefine on CreateDeductionEntrySchema is the enforcement layer for null inputs.
  // Here we test the DB constraint path directly with an invalid non-null value.
  await assert.rejects(
    db.insert(deductionEntries).values({
      userId,
      fy: "2024-25",
      section: "80CCD2",
      deductionKind: "employer_nps_ccd2",
      amountPaise: 1_000_000,
      employerType: "invalid_employer",  // not 'private' or 'government' → constraint fires
      salaryBasePaise: 50_000_000,
    }),
  );
});

test("DB check constraint: amount must be positive", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await assert.rejects(
    db.insert(deductionEntries).values({
      userId,
      fy: "2024-25",
      section: "80C",
      deductionKind: "other_80c",
      amountPaise: 0,
    }),
  );
});

// ─── Group 2: getDeductionBasket — basic structure ────────────────────────────

test("getDeductionBasket returns valid structure for user with no data", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  const basket = await getDeductionBasket(db, userId, "2024-25");

  assert.equal(basket.fy, "2024-25");
  assert.ok(basket.regime === "old" || basket.regime === "new", "regime must be old or new");
  assert.ok(Array.isArray(basket.eightyC.sources));
  assert.equal(basket.eightyC.contributedPaise, 0);
  assert.equal(basket.eightyCcd1b.contributedPaise, 0);
  assert.equal(basket.eightyCcd2.contributedPaise, 0);
  assert.ok(Array.isArray(basket.eightyD.unallocatedPolicies));
  assert.equal(basket.emiInterestEstimatePaise, 0);
  assert.ok(typeof basket.generatedAt === "string", "generatedAt must be a string");
});

test("getDeductionBasket includes manual 80C entry", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await createDeductionEntry(db, userId, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 5_000_000,
    description: "ELSS fund",
  }); // description already present

  const basket = await getDeductionBasket(db, userId, "2024-25");
  assert.ok(basket.eightyC.contributedPaise >= 5_000_000);
  assert.ok(basket.eightyC.sources.some((s) => s.kind === "manual"));
});

test("getDeductionBasket includes 80CCD2 entry", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await createDeductionEntry(db, userId, {
    fy: "2024-25",
    section: "80CCD2",
    deductionKind: "employer_nps_ccd2",
    amountPaise: 3_000_000,
    description: "",
    employerType: "private",
    salaryBasePaise: 50_000_000,
  });

  const basket = await getDeductionBasket(db, userId, "2024-25");
  assert.equal(basket.eightyCcd2.entries.length, 1);
  assert.equal(basket.eightyCcd2.contributedPaise, 3_000_000);
  assert.ok(basket.eightyCcd2.entries[0]!.ratebps > 0);
});

test("getDeductionBasket 80D: health policy with no covered persons → unallocated", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await db.insert(insurancePolicies).values({
    userId,
    name: "Test Health Policy",
    kind: "health",
    premiumPaise: 2_500_000,
    premiumFrequency: "yearly",
    startDate: "2024-04-01",
  });

  const basket = await getDeductionBasket(db, userId, "2024-25");
  assert.equal(basket.eightyD.unallocatedPolicies.length, 1);
  assert.equal(basket.eightyD.unallocatedPolicies[0]!.reason, "no_covered_persons");
});

test("user isolation: getDeductionBasket for user1 does not include user2's entries", async (t) => {
  const user1Id = await createUser();
  t.after(() => cleanupUser(user1Id));
  const user2Id = await createUser();
  t.after(() => cleanupUser(user2Id));

  await createDeductionEntry(db, user2Id, {
    fy: "2024-25",
    section: "80C",
    deductionKind: "other_80c",
    amountPaise: 10_000_000,
    description: "",
  });

  const basket = await getDeductionBasket(db, user1Id, "2024-25");
  assert.equal(basket.eightyC.contributedPaise, 0);
});

test("getDeductionBasket: unknown FY throws", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  await assert.rejects(getDeductionBasket(db, userId, "1999-00"));
});

test("getDeductionBasket regime suppression: headroomPaise is null for new regime", async (t) => {
  const userId = await createUser();
  t.after(() => cleanupUser(userId));

  // Insert a tax_regime_preferences row forcing the "new" regime.
  await db.insert(taxRegimePreferences).values({
    userId,
    fy: "2024-25",
    chosen: "new",
    effective: "new",
    source: "chosen",
  });

  const basket = await getDeductionBasket(db, userId, "2024-25");
  assert.equal(basket.regime, "new");
  assert.equal(basket.eightyC.headroomPaise, null);
  assert.equal(basket.eightyCcd1b.headroomPaise, null);
  assert.equal(basket.eightyD.selfFamily.headroomPaise, null);
});
