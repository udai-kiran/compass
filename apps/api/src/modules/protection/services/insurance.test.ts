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
import { createPolicy, sumPolicyPremiumsInRange, updatePolicy } from "./insurance.ts";
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

/** An update builder that records every .set() payload into `captured` for the test to inspect. */
function updateBuilder(captured: Record<string, unknown>[]) {
  return {
    set: (vals: Record<string, unknown>) => {
      captured.push(vals);
      return { where: () => Promise.resolve([]) };
    },
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
  /** every db.update(insurancePolicies).set(vals) call's `vals`, in order */
  capturedUpdates?: Record<string, unknown>[];
} = {}): unknown {
  let selectIdx = 0;
  let insertIdx = 0;
  const capturedUpdates = options.capturedUpdates ?? [];
  const db: Record<string, unknown> = {
    select: (_fields?: unknown) => {
      const rows = (options.selectResults ?? [])[selectIdx++] ?? [];
      return selectBuilder(rows);
    },
    insert: (_table: unknown) => {
      const rows = (options.insertResults ?? [])[insertIdx++] ?? [];
      return insertBuilder(rows);
    },
    update: (_table: unknown) => updateBuilder(capturedUpdates),
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
    ownership: "personal",
    employerName: "",
    deductiblePaise: null,
    coPayBps: null,
    roomRentLimitPaise: null,
    roomRentLimitBps: null,
    icuLimitPaise: null,
    icuLimitBps: null,
    subLimits: [],
    initialWaitingDays: null,
    preExistingWaitingMonths: null,
    maternityWaitingMonths: null,
    restorationBenefit: false,
    ncbBps: 0,
    ncbMaxBps: 0,
    tpaName: "",
    tpaContactPhone: "",
    exclusions: [],
    disclosuresComplete: false,
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

// ─── structured terms & claim-readiness (task 14.1) ──────────────────────────

describe("createPolicy: structured terms, waiting periods & claim-readiness", () => {
  it("surfaces employer ownership, structured terms, waiting-period end dates and a ready-with-gaps checklist", async () => {
    // Fixed, deliberately distant dates so waiting-period elapsed / renewal-current
    // checks are stable no matter what day this test runs (never chase "today").
    const policyRow = makePolicyRow({
      startDate: "2000-01-01",
      renewalDate: "2099-01-01",
      documentPath: null, // no document uploaded
      nominee: "Spouse",
      ownership: "employer",
      employerName: "Acme Corp",
      deductiblePaise: 10_000_00,
      coPayBps: 2000,
      roomRentLimitBps: 100,
      icuLimitBps: 200,
      subLimits: [{ label: "Cataract", capPaise: 4_000_00 }],
      initialWaitingDays: 30,
      preExistingWaitingMonths: 36,
      maternityWaitingMonths: null, // not applicable to this policy
      restorationBenefit: true,
      ncbBps: 1000,
      ncbMaxBps: 5000,
      tpaName: "MediAssist",
      tpaContactPhone: "1800-000-0000",
      exclusions: ["cosmetic surgery"],
      disclosuresComplete: true,
    });
    const db = makeDb({
      insertResults: [[{ id: "policy-1" }], []],
      selectResults: [[], []],
      findFirstPolicy: policyRow,
      findManyCards: [{ id: "card-1", label: "Self", fileName: "card.pdf", mimeType: "application/pdf", sizeBytes: 100 }],
    });

    const policy = await createPolicy(db as never, "user-1", {
      name: "Group Health",
      kind: "health",
      vehicleType: null,
      vehicleRegNo: "",
      resourceId: null,
      healthType: "indemnity",
      insurer: "Star Health",
      policyNumber: "",
      policyWordingUrl: "",
      sumAssuredPaise: 10_00_000_00,
      bonusPaise: 0,
      premiumPaise: 0,
      premiumFrequency: "yearly",
      startDate: "2000-01-01",
      renewalDate: "2099-01-01",
      maturityDate: null,
      nominee: "Spouse",
      nomineePersonId: null,
      coveredMembers: [],
      ownership: "employer",
      employerName: "Acme Corp",
      notes: "",
    });

    assert.equal(policy.ownership, "employer");
    assert.equal(policy.employerName, "Acme Corp");
    assert.equal(policy.deductiblePaise, 10_000_00);
    assert.equal(policy.coPayBps, 2000);
    assert.deepEqual(policy.subLimits, [{ label: "Cataract", capPaise: 4_000_00 }]);
    // 2000-01-01 + 30 days
    assert.equal(policy.initialWaitingEndDate, "2000-01-31");
    // 2000-01-01 + 36 months
    assert.equal(policy.preExistingWaitingEndDate, "2003-01-01");
    // maternityWaitingMonths is null → not applicable, no end date
    assert.equal(policy.maternityWaitingEndDate, null);

    // Document missing is the only outstanding gap; everything else is ready.
    const doc = policy.claimReadiness.find((i) => i.key === "document")!;
    assert.equal(doc.ready, false);
    assert.equal(doc.missingArtifact, "Policy document (PDF/scan)");
    const others = policy.claimReadiness.filter((i) => i.key !== "document");
    for (const item of others) {
      assert.equal(item.ready, true, `expected "${item.key}" to be ready`);
    }
  });

  it("rejects health-only structured terms on a non-health (life) policy", async () => {
    await assert.rejects(() =>
      createPolicy(makeDb() as never, "user-1", {
        name: "Term Life",
        kind: "life",
        vehicleType: null,
        vehicleRegNo: "",
        resourceId: null,
        healthType: null,
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
        coveredMembers: [],
        // deductiblePaise only applies to health — schema should reject this combination
        deductiblePaise: 5000,
        notes: "",
      } as never),
    );
  });
});

// ─── updatePolicy: structured terms preserved/cleared correctly (Codex review fixes) ──

describe("updatePolicy: omitted structured-term fields are preserved, not defaulted away", () => {
  it("does not overwrite deductible/co-pay/TPA/ownership when the update body omits them (mirrors the current web form, which doesn't send these fields)", async () => {
    const existingRow = makePolicyRow({
      kind: "health",
      deductiblePaise: 50_000,
      coPayBps: 2000,
      tpaName: "MediAssist",
      tpaContactPhone: "1800-000-0000",
      ownership: "employer",
      employerName: "Acme Corp",
    });
    const capturedUpdates: Record<string, unknown>[] = [];
    const db = makeDb({ findFirstPolicy: existingRow, capturedUpdates });

    // Exactly what apps/web's PolicyForm sends today — no new-field keys at all.
    await updatePolicy(db as never, "user-1", "policy-1", {
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
      premiumPaise: 0,
      premiumFrequency: "yearly",
      startDate: null,
      renewalDate: null,
      maturityDate: null,
      nominee: "",
      coveredMembers: [],
      notes: "",
    });

    assert.equal(capturedUpdates.length, 1);
    const set = capturedUpdates[0]!;
    for (const key of ["deductiblePaise", "coPayBps", "tpaName", "tpaContactPhone", "ownership", "employerName"]) {
      assert.equal(key in set, false, `${key} must be absent from the SET clause (left unchanged), not defaulted`);
    }
  });

  it("force-clears health-only fields when this request changes the policy's kind away from health, even though it doesn't mention them", async () => {
    const existingRow = makePolicyRow({
      kind: "health",
      deductiblePaise: 50_000,
      coPayBps: 2000,
      tpaName: "MediAssist",
      tpaContactPhone: "1800-000-0000",
      restorationBenefit: true,
      ncbBps: 1000,
      subLimits: [{ label: "Cataract", capPaise: 400000 }],
    });
    const capturedUpdates: Record<string, unknown>[] = [];
    const db = makeDb({ findFirstPolicy: existingRow, capturedUpdates });

    await updatePolicy(db as never, "user-1", "policy-1", {
      name: "Term Life",
      kind: "life", // switching away from health; body says nothing about the health fields
      vehicleType: null,
      vehicleRegNo: "",
      resourceId: null,
      healthType: null,
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
      coveredMembers: [],
      notes: "",
    } as never);

    const set = capturedUpdates[0]!;
    assert.equal(set.deductiblePaise, null);
    assert.equal(set.coPayBps, null);
    assert.equal(set.tpaName, "");
    assert.equal(set.tpaContactPhone, "");
    assert.equal(set.restorationBenefit, false);
    assert.equal(set.ncbBps, 0);
    assert.deepEqual(set.subLimits, []);
  });

  it("force-clears employerName when this request changes ownership away from employer, even though it doesn't mention employerName", async () => {
    const existingRow = makePolicyRow({ kind: "health", ownership: "employer", employerName: "Acme Corp" });
    const capturedUpdates: Record<string, unknown>[] = [];
    const db = makeDb({ findFirstPolicy: existingRow, capturedUpdates });

    await updatePolicy(db as never, "user-1", "policy-1", {
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
      coveredMembers: [],
      ownership: "personal", // switching away from employer
      notes: "",
    });

    const set = capturedUpdates[0]!;
    assert.equal(set.employerName, "");
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
