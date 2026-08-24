/**
 * insurance.test.ts — unit tests for the insurance service (task 13.7 Phase 1a).
 *
 * Covers:
 *   - replaceCoveredPersons: unknown family member ID → HttpError(400)
 *   - createPolicy: coveredPersonIds wired through → returned in response
 *   - sumPolicyPremiumsInRange: result is correctly propagated from the DB query
 *
 * All tests are hermetic — no real DB, no network. The DB is stubbed as a
 * minimal object whose method chains return preset data.
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createPolicy, sumPolicyPremiumsInRange } from "./insurance.ts";
import { HttpError } from "../../../lib/errors.ts";

// ─── DB stub helpers ──────────────────────────────────────────────────────────

/**
 * A fluent select builder whose terminal .where() (or .innerJoin().where())
 * resolves to the given preset rows. Chains any number of .from()/.innerJoin()
 * before the .where() — they all return the same builder.
 */
function selectBuilder(rows: unknown[]) {
  const b: Record<string, unknown> = {
    from: () => b,
    innerJoin: () => b,
    where: () => Promise.resolve(rows),
  };
  return b;
}

/**
 * An insert builder. .values() returns an object that:
 *   - is itself awaitable (thenable) — so `await insert().values()` works
 *   - has .returning() — so `await insert().values().returning()` also works
 * The preset `returningRows` is what both paths yield.
 */
function insertBuilder(returningRows: unknown[]) {
  const valuesResult = {
    then: (resolve: (v: unknown) => void) => resolve(returningRows),
    returning: (_fields: unknown) => Promise.resolve(returningRows),
  };
  return {
    values: (_vals: unknown) => valuesResult,
  };
}

/** A delete builder whose .where() resolves to an empty array (no-op). */
function deleteBuilder() {
  return {
    where: () => Promise.resolve([]),
  };
}

/**
 * Minimal DB stub. Callers provide per-call results via queues:
 *   `selectResults` — each `db.select()` call consumes the next entry.
 *   `insertResults` — each `db.insert()` call consumes the next entry.
 *
 * `query.insurancePolicies.findFirst` / `findMany` / etc. return preset data.
 * `transaction(cb)` calls `cb(db)` — simulates the transaction returning the
 * callback's result (no real Postgres transaction; suitable for unit tests that
 * verify application logic, not isolation guarantees).
 */
function makeDb(options: {
  selectResults?: unknown[][];
  insertResults?: unknown[][];
  findFirstPolicy?: Record<string, unknown> | null;
  findManyCards?: unknown[];
} = {}): unknown {
  let selectIdx = 0;
  let insertIdx = 0;
  const db: Record<string, unknown> = {
    select: (_fields?: unknown) => {
      const rows = (options.selectResults ?? [])[selectIdx++] ?? [];
      return selectBuilder(rows);
    },
    insert: (_table: unknown) => {
      const rows = (options.insertResults ?? [])[insertIdx++] ?? [];
      return insertBuilder(rows);
    },
    delete: (_table: unknown) => deleteBuilder(),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => {
      // Reset indices at transaction start so inner calls use the same queue
      // position — matches how the real Postgres transaction shares state.
      return cb(db);
    },
    query: {
      insurancePolicies: {
        findFirst: async () => options.findFirstPolicy ?? null,
        findMany: async () => [],
      },
      insuranceHealthCards: {
        findMany: async () => options.findManyCards ?? [],
      },
      resources: {
        findFirst: async () => ({ id: "resource-1" }), // assertOwnedResource: found
      },
    },
  };
  return db;
}

/** Minimal policy row matching the insurancePolicies table shape. */
function makePolicyRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "policy-1",
    userId: "user-1",
    name: "Test Policy",
    kind: "health",
    vehicleType: null,
    vehicleRegNo: "",
    resourceId: null,
    healthType: "indemnity",
    insurer: "",
    policyNumber: "",
    policyWordingUrl: "",
    sumAssuredPaise: 0,
    bonusPaise: 0,
    premiumPaise: 50_000,
    premiumFrequency: "yearly",
    startDate: null,
    renewalDate: null,
    maturityDate: null,
    nominee: "",
    nomineePersonId: null,
    coveredMembers: [],
    documentPath: null,
    documentName: null,
    documentMime: null,
    documentSizeBytes: null,
    notes: "",
    archivedAt: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

// ─── replaceCoveredPersons: unknown member → 400 ─────────────────────────────

describe("createPolicy: covered persons validation", () => {
  it("throws HttpError(400) when coveredPersonIds contains an unowned/non-existent person ID", async () => {
    const db = makeDb({
      // Call 1: tx.insert(insurancePolicies).values({...}).returning({id:...}) → [{id:"policy-1"}]
      insertResults: [[{ id: "policy-1" }], []],
      // Call 1 in replaceCoveredPersons: tx.select({id:familyMembers.id}).from(familyMembers).where(...)
      // → [] (member not found for this user)
      selectResults: [[]],
    });

    await assert.rejects(
      () =>
        createPolicy(db as never, "user-1", {
          name: "Health Plan",
          kind: "health",
          vehicleType: null,
          vehicleRegNo: "",
          resourceId: null,
          healthType: "indemnity",
          insurer: "",
          policyNumber: "",
          policyWordingUrl: "",
          sumAssuredPaise: 0,
          bonusPaise: 0,
          premiumPaise: 0,
          premiumFrequency: "yearly",
          startDate: null,
          renewalDate: null,
          maturityDate: null,
          nominee: "",
          nomineePersonId: null,
          coveredPersonIds: ["f1000000-0000-4000-8000-000000000000"],
          coveredMembers: [],
          notes: "",
        }),
      (err: unknown) => {
        assert.ok(err instanceof HttpError);
        assert.equal((err as HttpError).statusCode, 400);
        assert.ok((err as HttpError).message.includes("Unknown family member"));
        return true;
      },
    );
  });

  it("createPolicy with valid coveredPersonIds returns the IDs in the response", async () => {
    const policyRow = makePolicyRow();
    const db = makeDb({
      insertResults: [
        // tx.insert(insurancePolicies).values({...}).returning({id:...}) → [{id:"policy-1"}]
        [{ id: "policy-1" }],
        // tx.insert(policyCoveredPersons).values([...]) — no .returning(), thenable resolves []
        [],
      ],
      selectResults: [
        // replaceCoveredPersons: tx.select({id:familyMembers.id}).from(familyMembers).where(...)
        // → [{id:"a1000000-0000-4000-8000-000000000001"}] (member found)
        [{ id: "a1000000-0000-4000-8000-000000000001" }],
        // getPolicyWithCards: db.select({personId:...}).from(policyCoveredPersons).where(...)
        // → [{personId:"a1000000-0000-4000-8000-000000000001"}]
        [{ personId: "a1000000-0000-4000-8000-000000000001" }],
      ],
      findFirstPolicy: policyRow,
      findManyCards: [],
    });

    const policy = await createPolicy(db as never, "user-1", {
      name: "Health Plan",
      kind: "health",
      vehicleType: null,
      vehicleRegNo: "",
      resourceId: null,
      healthType: "indemnity",
      insurer: "",
      policyNumber: "",
      policyWordingUrl: "",
      sumAssuredPaise: 0,
      bonusPaise: 0,
      premiumPaise: 0,
      premiumFrequency: "yearly",
      startDate: null,
      renewalDate: null,
      maturityDate: null,
      nominee: "",
      nomineePersonId: null,
      coveredPersonIds: ["a1000000-0000-4000-8000-000000000001"],
      coveredMembers: [],
      notes: "",
    });

    assert.deepEqual(policy.coveredPersonIds, ["a1000000-0000-4000-8000-000000000001"]);
  });
});

// ─── sumPolicyPremiumsInRange ─────────────────────────────────────────────────

describe("sumPolicyPremiumsInRange", () => {
  it("returns totalPaise and count from the DB query result", async () => {
    const db = makeDb({
      selectResults: [[{ totalPaise: 75_000, count: 3 }]],
      findFirstPolicy: makePolicyRow(), // ownedPolicy check not called in sumPolicyPremiumsInRange
    });

    const result = await sumPolicyPremiumsInRange(
      db as never,
      "user-1",
      "policy-1",
      "2025-04-01",
      "2026-03-31",
    );

    assert.equal(result.totalPaise, 75_000);
    assert.equal(result.count, 3);
  });

  it("returns {totalPaise:0, count:0} when the DB query returns an empty result (no premiums in range)", async () => {
    // This simulates a query that found no premiums in the given FY — either
    // there were none logged, or all matching transactions were soft-deleted
    // (which the isNull(transactions.deletedAt) filter in the service removes).
    const db = makeDb({
      selectResults: [[{ totalPaise: 0, count: 0 }]],
    });

    const result = await sumPolicyPremiumsInRange(
      db as never,
      "user-1",
      "policy-1",
      "2025-04-01",
      "2026-03-31",
    );

    assert.equal(result.totalPaise, 0);
    assert.equal(result.count, 0);
  });

  it("returns {totalPaise:0, count:0} when the DB returns no rows (null-safety fallback)", async () => {
    // If the select returns an empty array (no aggregation row), the service
    // should fall back to 0 rather than throwing.
    const db = makeDb({
      selectResults: [[]],
    });

    const result = await sumPolicyPremiumsInRange(
      db as never,
      "user-1",
      "policy-1",
      "2025-04-01",
      "2026-03-31",
    );

    assert.equal(result.totalPaise, 0);
    assert.equal(result.count, 0);
  });
});
