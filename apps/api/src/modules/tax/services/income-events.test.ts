/**
 * income-events.test.ts — Unit tests for the income-event ledger service (task 13.4).
 *
 * Hermetic: no DB, no Redis, no network. Pure helpers are called directly; the
 * DB-backed operations are exercised against a minimal stub of the Drizzle query
 * builder (`makeStubDb`), which records the values/set objects handed to
 * `insert().values()` / `update().set()` and replays canned rows for each
 * `select()`. That lets the real service code paths run — guard order, forced
 * columns, snapshot construction, summary aggregation — without a live database.
 *
 * Covered:
 *   - lastDayOfMonth: pay month → last day ISO date
 *   - buildIncomeEventDto: DB row → DTO conversion, incl. computed afterTdsPaise
 *   - createIncomeEvent: forced sourceKind='manual', real-calendar-date guard
 *   - accept/reject: guarded one-way transitions, 404 vs 409, originalValues snapshot
 *   - getSummary: accepted-only totals, acceptedCount/pendingCount, all five kinds, notes
 *   - deriveFromPayslip: ownership/status/null-gross guards, section='192', idempotency
 *   - deriveFromHoldingEvent: cross-user 404, non-dividend 400, dividend mapping
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CreateIncomeEventBody } from "@compass/shared";
import {
  lastDayOfMonth,
  buildIncomeEventDto,
  createIncomeEvent,
  acceptIncomeEvent,
  rejectIncomeEvent,
  getSummary,
  deriveFromPayslip,
  deriveFromHoldingEvent,
  GROSS_NOT_TAXABLE_NOTE,
} from "./income-events.ts";

// ─── lastDayOfMonth tests ─────────────────────────────────────────────────────

describe("lastDayOfMonth", () => {
  it("returns last day of June", () => {
    assert.equal(lastDayOfMonth("2025-06"), "2025-06-30");
  });

  it("returns last day of January", () => {
    assert.equal(lastDayOfMonth("2025-01"), "2025-01-31");
  });

  it("returns last day of February (non-leap year)", () => {
    assert.equal(lastDayOfMonth("2025-02"), "2025-02-28");
  });

  it("returns last day of February (leap year)", () => {
    assert.equal(lastDayOfMonth("2024-02"), "2024-02-29");
  });

  it("returns last day of March", () => {
    assert.equal(lastDayOfMonth("2026-03"), "2026-03-31");
  });

  it("returns last day of April", () => {
    assert.equal(lastDayOfMonth("2025-04"), "2025-04-30");
  });

  it("returns last day of December", () => {
    assert.equal(lastDayOfMonth("2025-12"), "2025-12-31");
  });
});

// ─── Fixtures ─────────────────────────────────────────────────────────────────

const NOW = new Date("2025-07-31T12:00:00Z");
const USER = "user-uuid-1";

type IncomeEventRow = Parameters<typeof buildIncomeEventDto>[0];

function makeIncomeEventRow(overrides: Partial<{
  id: string;
  userId: string;
  accrualDate: string;
  fy: string;
  incomeKind: string;
  section: string | null;
  sourceKind: string;
  sourceId: string | null;
  sourcePriority: number;
  payerName: string | null;
  payerPan: string | null;
  payerTan: string | null;
  grossPaise: number;
  tdsPaise: number;
  notes: string | null;
  status: string;
  acceptedAt: Date | null;
  originalValues: unknown;
  createdAt: Date;
  updatedAt: Date;
}> = {}): IncomeEventRow {
  const row = {
    id: overrides.id ?? "event-uuid-1",
    userId: overrides.userId ?? USER,
    accrualDate: overrides.accrualDate ?? "2025-06-30",
    fy: overrides.fy ?? "2025-26",
    incomeKind: overrides.incomeKind ?? "salary",
    section: overrides.section !== undefined ? overrides.section : null,
    sourceKind: overrides.sourceKind ?? "payslip",
    sourceId: overrides.sourceId !== undefined ? overrides.sourceId : "payslip-uuid-1",
    sourcePriority: overrides.sourcePriority ?? 0,
    payerName: overrides.payerName !== undefined ? overrides.payerName : "ACME Corp",
    payerPan: overrides.payerPan !== undefined ? overrides.payerPan : null,
    payerTan: overrides.payerTan !== undefined ? overrides.payerTan : null,
    grossPaise: overrides.grossPaise ?? 5000000,
    tdsPaise: overrides.tdsPaise ?? 300000,
    notes: overrides.notes !== undefined ? overrides.notes : null,
    status: overrides.status ?? "pending",
    acceptedAt: overrides.acceptedAt !== undefined ? overrides.acceptedAt : null,
    originalValues: overrides.originalValues !== undefined ? overrides.originalValues : null,
    createdAt: overrides.createdAt ?? NOW,
    updatedAt: overrides.updatedAt ?? NOW,
  };
  return row as unknown as IncomeEventRow;
}

// ─── Drizzle query-builder stub ───────────────────────────────────────────────

type Rows = readonly unknown[];

interface QueryNode {
  from(...args: unknown[]): QueryNode;
  innerJoin(...args: unknown[]): QueryNode;
  where(...args: unknown[]): QueryNode;
  orderBy(...args: unknown[]): QueryNode;
  onConflictDoNothing(...args: unknown[]): QueryNode;
  returning(...args: unknown[]): QueryNode;
  then(onFulfilled: (rows: Rows) => unknown, onRejected?: (err: unknown) => unknown): Promise<unknown>;
}

/** A thenable chain node: every builder method returns itself, `await` yields `rows`. */
function queryNode(rows: Rows): QueryNode {
  const self: QueryNode = {
    from: () => self,
    innerJoin: () => self,
    where: () => self,
    orderBy: () => self,
    onConflictDoNothing: () => self,
    returning: () => self,
    then: (onFulfilled, onRejected) => Promise.resolve(rows).then(onFulfilled, onRejected),
  };
  return self;
}

interface StubOptions {
  /** One canned result per `select()` call, in call order. Missing → []. */
  selects?: Rows[];
  /** Result of `insert(...).values(...)[.onConflictDoNothing()].returning()`. */
  insertReturning?: Rows;
  /** Result of `update(...).set(...).where(...).returning(...)`. */
  updateReturning?: Rows;
}

interface StubCapture {
  insertValues: Record<string, unknown>[];
  updateSets: Record<string, unknown>[];
  selectCalls: number;
}

type ServiceDb = Parameters<typeof acceptIncomeEvent>[0];

function makeStubDb(opts: StubOptions = {}): { db: ServiceDb; capture: StubCapture } {
  const capture: StubCapture = { insertValues: [], updateSets: [], selectCalls: 0 };
  const selects = [...(opts.selects ?? [])];

  const db = {
    select: (): QueryNode => {
      capture.selectCalls += 1;
      return queryNode(selects.shift() ?? []);
    },
    insert: () => ({
      values: (values: Record<string, unknown>): QueryNode => {
        capture.insertValues.push(values);
        return queryNode(opts.insertReturning ?? []);
      },
    }),
    update: () => ({
      set: (values: Record<string, unknown>): QueryNode => {
        capture.updateSets.push(values);
        return queryNode(opts.updateReturning ?? []);
      },
    }),
  };

  return { db: db as unknown as ServiceDb, capture };
}

/** assert.rejects matcher for an HttpError with a given status code. */
function httpError(statusCode: number, messageIncludes?: string) {
  return (err: unknown): true => {
    const e = err as { name?: string; statusCode?: number; message?: string };
    assert.equal(e.name, "HttpError", `expected HttpError, got ${String(e.name)}`);
    assert.equal(e.statusCode, statusCode);
    if (messageIncludes !== undefined) {
      assert.ok(
        (e.message ?? "").includes(messageIncludes),
        `expected message to include "${messageIncludes}", got "${String(e.message)}"`,
      );
    }
    return true;
  };
}

// ─── buildIncomeEventDto tests ────────────────────────────────────────────────

describe("buildIncomeEventDto", () => {
  it("converts a pending salary row to DTO", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow());

    assert.equal(dto.id, "event-uuid-1");
    assert.equal(dto.fy, "2025-26");
    assert.equal(dto.accrualDate, "2025-06-30");
    assert.equal(dto.incomeKind, "salary");
    assert.equal(dto.sourceKind, "payslip");
    assert.equal(dto.sourceId, "payslip-uuid-1");
    assert.equal(dto.payerName, "ACME Corp");
    assert.equal(dto.payerPan, null);
    assert.equal(dto.payerTan, null);
    assert.equal(dto.grossPaise, 5000000);
    assert.equal(dto.tdsPaise, 300000);
    assert.equal(dto.notes, null);
    assert.equal(dto.status, "pending");
    assert.equal(dto.acceptedAt, null);
    assert.equal(dto.originalValues, null);
    assert.equal(dto.createdAt, NOW.toISOString());
    assert.equal(dto.updatedAt, NOW.toISOString());
  });

  it("computes afterTdsPaise as grossPaise - tdsPaise", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow({ grossPaise: 5000000, tdsPaise: 300000 }));
    assert.equal(dto.afterTdsPaise, 4700000);
  });

  it("computes afterTdsPaise = grossPaise when there is no TDS", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow({ grossPaise: 123456, tdsPaise: 0 }));
    assert.equal(dto.afterTdsPaise, 123456);
  });

  it("computes afterTdsPaise = 0 when TDS equals gross", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow({ grossPaise: 900, tdsPaise: 900 }));
    assert.equal(dto.afterTdsPaise, 0);
  });

  it("converts an accepted row with acceptedAt to DTO", () => {
    const accepted = new Date("2025-08-01T09:00:00Z");
    const dto = buildIncomeEventDto(
      makeIncomeEventRow({
        status: "accepted",
        acceptedAt: accepted,
        originalValues: { payerName: "Old Corp" },
      }),
    );

    assert.equal(dto.status, "accepted");
    assert.equal(dto.acceptedAt, accepted.toISOString());
    assert.deepEqual(dto.originalValues, { payerName: "Old Corp" });
  });

  it("converts a rejected row to DTO", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow({ status: "rejected" }));
    assert.equal(dto.status, "rejected");
    assert.equal(dto.acceptedAt, null);
  });

  it("handles null sourceId for manual entry", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow({ sourceId: null, sourceKind: "manual" }));
    assert.equal(dto.sourceId, null);
    assert.equal(dto.sourceKind, "manual");
  });

  it("handles dividend income kind", () => {
    const dto = buildIncomeEventDto(
      makeIncomeEventRow({
        incomeKind: "dividend",
        sourceKind: "holding_event",
        sourceId: "event-uuid-2",
      }),
    );
    assert.equal(dto.incomeKind, "dividend");
    assert.equal(dto.sourceKind, "holding_event");
    assert.equal(dto.sourceId, "event-uuid-2");
  });

  it("sets tdsPaise to 0 when default", () => {
    const dto = buildIncomeEventDto(makeIncomeEventRow({ tdsPaise: 0 }));
    assert.equal(dto.tdsPaise, 0);
  });

  it("passes through PAN and TAN when set", () => {
    const dto = buildIncomeEventDto(
      makeIncomeEventRow({ payerPan: "ABCDE1234F", payerTan: "ABCD01234E" }),
    );
    assert.equal(dto.payerPan, "ABCDE1234F");
    assert.equal(dto.payerTan, "ABCD01234E");
  });
});

// ─── createIncomeEvent tests ──────────────────────────────────────────────────

/** Base manual-create body. */
function createBody(overrides: Partial<CreateIncomeEventBody> = {}): CreateIncomeEventBody {
  return {
    accrualDate: "2025-06-15",
    incomeKind: "interest",
    grossPaise: 100000,
    tdsPaise: 10000,
    ...overrides,
  };
}

describe("createIncomeEvent", () => {
  it("forces sourceKind='manual' and sourceId=null even if the client claims payslip provenance", async () => {
    const stub = makeStubDb({
      insertReturning: [makeIncomeEventRow({ sourceKind: "manual", sourceId: null })],
    });
    // A rogue client body carrying provenance fields the contract does not accept.
    const rogue = {
      ...createBody(),
      sourceKind: "payslip",
      sourceId: "payslip-uuid-1",
    } as unknown as CreateIncomeEventBody;

    await createIncomeEvent(stub.db, USER, rogue);

    assert.equal(stub.capture.insertValues.length, 1);
    assert.equal(stub.capture.insertValues[0]!.sourceKind, "manual");
    assert.equal(stub.capture.insertValues[0]!.sourceId, null);
  });

  it("forces sourceKind='manual' even if the client claims ais provenance", async () => {
    const stub = makeStubDb({ insertReturning: [makeIncomeEventRow({ sourceKind: "manual" })] });
    const rogue = { ...createBody(), sourceKind: "ais" } as unknown as CreateIncomeEventBody;

    await createIncomeEvent(stub.db, USER, rogue);
    assert.equal(stub.capture.insertValues[0]!.sourceKind, "manual");
  });

  it("derives fy server-side from accrualDate and always inserts status='pending'", async () => {
    const stub = makeStubDb({ insertReturning: [makeIncomeEventRow()] });
    await createIncomeEvent(stub.db, USER, createBody({ accrualDate: "2025-06-15" }));

    const values = stub.capture.insertValues[0]!;
    assert.equal(values.fy, "2025-26");
    assert.equal(values.accrualDate, "2025-06-15");
    assert.equal(values.status, "pending");
    assert.equal(values.userId, USER);
  });

  it("derives fy across the 31 March / 1 April FY boundary", async () => {
    const march = makeStubDb({ insertReturning: [makeIncomeEventRow()] });
    await createIncomeEvent(march.db, USER, createBody({ accrualDate: "2026-03-31" }));
    assert.equal(march.capture.insertValues[0]!.fy, "2025-26");

    const april = makeStubDb({ insertReturning: [makeIncomeEventRow()] });
    await createIncomeEvent(april.db, USER, createBody({ accrualDate: "2026-04-01" }));
    assert.equal(april.capture.insertValues[0]!.fy, "2026-27");
  });

  it("rejects an impossible calendar date with 400 before any DB call", async () => {
    const stub = makeStubDb();
    await assert.rejects(
      () => createIncomeEvent(stub.db, USER, createBody({ accrualDate: "2025-02-30" })),
      httpError(400, "real calendar date"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
    assert.equal(stub.capture.selectCalls, 0);
  });

  it("rejects 29 February in a non-leap year with 400", async () => {
    const stub = makeStubDb();
    await assert.rejects(
      () => createIncomeEvent(stub.db, USER, createBody({ accrualDate: "2023-02-29" })),
      httpError(400, "real calendar date"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("rejects an out-of-range month with 400", async () => {
    const stub = makeStubDb();
    await assert.rejects(
      () => createIncomeEvent(stub.db, USER, createBody({ accrualDate: "2025-13-01" })),
      httpError(400, "real calendar date"),
    );
  });

  it("accepts a valid leap day (2024-02-29)", async () => {
    const stub = makeStubDb({
      insertReturning: [makeIncomeEventRow({ accrualDate: "2024-02-29", fy: "2023-24" })],
    });
    const dto = await createIncomeEvent(stub.db, USER, createBody({ accrualDate: "2024-02-29" }));
    assert.equal(stub.capture.insertValues[0]!.accrualDate, "2024-02-29");
    assert.equal(stub.capture.insertValues[0]!.fy, "2023-24");
    assert.equal(dto.accrualDate, "2024-02-29");
  });

  it("defaults tdsPaise to 0 when omitted", async () => {
    const stub = makeStubDb({ insertReturning: [makeIncomeEventRow()] });
    const body = createBody();
    delete (body as { tdsPaise?: number }).tdsPaise;
    await createIncomeEvent(stub.db, USER, body);
    assert.equal(stub.capture.insertValues[0]!.tdsPaise, 0);
  });
});

// ─── acceptIncomeEvent tests ──────────────────────────────────────────────────

describe("acceptIncomeEvent", () => {
  it("404s when the row does not exist or belongs to another user", async () => {
    const stub = makeStubDb({ selects: [[]] });
    await assert.rejects(
      () => acceptIncomeEvent(stub.db, USER, "event-uuid-1", {}),
      httpError(404, "not found"),
    );
    assert.equal(stub.capture.updateSets.length, 0);
  });

  it("409s when the event is already accepted (one-way transition)", async () => {
    const stub = makeStubDb({ selects: [[makeIncomeEventRow({ status: "accepted" })]] });
    await assert.rejects(
      () => acceptIncomeEvent(stub.db, USER, "event-uuid-1", {}),
      httpError(409, "not pending"),
    );
    assert.equal(stub.capture.updateSets.length, 0);
  });

  it("409s when the event is already rejected (one-way transition)", async () => {
    const stub = makeStubDb({ selects: [[makeIncomeEventRow({ status: "rejected" })]] });
    await assert.rejects(
      () => acceptIncomeEvent(stub.db, USER, "event-uuid-1", {}),
      httpError(409, "not pending"),
    );
    assert.equal(stub.capture.updateSets.length, 0);
  });

  it("409s when the guarded UPDATE claims nothing (concurrent accept/reject race loser)", async () => {
    const stub = makeStubDb({
      selects: [[makeIncomeEventRow({ status: "pending" })]],
      updateReturning: [], // another request already moved the row out of 'pending'
    });
    await assert.rejects(
      () => acceptIncomeEvent(stub.db, USER, "event-uuid-1", {}),
      httpError(409, "not pending"),
    );
    assert.equal(stub.capture.updateSets.length, 1);
  });

  it("sets status='accepted' with acceptedAt and no originalValues when there are no corrections", async () => {
    const accepted = makeIncomeEventRow({ status: "accepted", acceptedAt: NOW });
    const stub = makeStubDb({
      selects: [[makeIncomeEventRow({ status: "pending" })], [accepted]],
      updateReturning: [{ id: "event-uuid-1" }],
    });

    const dto = await acceptIncomeEvent(stub.db, USER, "event-uuid-1", {});

    const set = stub.capture.updateSets[0]!;
    assert.equal(set.status, "accepted");
    assert.ok(set.acceptedAt instanceof Date);
    assert.equal(set.originalValues, null);
    assert.equal(dto.status, "accepted");
  });

  it("snapshots the pre-correction values into originalValues and applies the corrections", async () => {
    const pending = makeIncomeEventRow({
      status: "pending",
      payerName: "ACME Corp",
      payerPan: null,
      payerTan: null,
      notes: null,
    });
    const stub = makeStubDb({
      selects: [[pending], [makeIncomeEventRow({ status: "accepted", acceptedAt: NOW })]],
      updateReturning: [{ id: "event-uuid-1" }],
    });

    await acceptIncomeEvent(stub.db, USER, "event-uuid-1", {
      payerName: "ACME Corporation Ltd",
      payerPan: "ABCDE1234F",
    });

    const set = stub.capture.updateSets[0]!;
    assert.deepEqual(set.originalValues, {
      payerName: "ACME Corp",
      payerPan: null,
      payerTan: null,
      notes: null,
    });
    assert.equal(set.payerName, "ACME Corporation Ltd");
    assert.equal(set.payerPan, "ABCDE1234F");
    // Fields not supplied as corrections are left untouched by the UPDATE.
    assert.equal("payerTan" in set, false);
    assert.equal("notes" in set, false);
  });

  it("treats an explicit null correction as a correction (snapshot taken)", async () => {
    const stub = makeStubDb({
      selects: [
        [makeIncomeEventRow({ status: "pending", payerTan: "ABCD01234E" })],
        [makeIncomeEventRow({ status: "accepted", acceptedAt: NOW })],
      ],
      updateReturning: [{ id: "event-uuid-1" }],
    });

    await acceptIncomeEvent(stub.db, USER, "event-uuid-1", { payerTan: null });

    const set = stub.capture.updateSets[0]!;
    assert.equal(set.payerTan, null);
    assert.deepEqual(set.originalValues, {
      payerName: "ACME Corp",
      payerPan: null,
      payerTan: "ABCD01234E",
      notes: null,
    });
  });
});

// ─── rejectIncomeEvent tests ──────────────────────────────────────────────────

describe("rejectIncomeEvent", () => {
  it("sets status='rejected' and never sets acceptedAt", async () => {
    const stub = makeStubDb({
      selects: [[makeIncomeEventRow({ status: "rejected" })]],
      updateReturning: [{ id: "event-uuid-1" }],
    });

    const dto = await rejectIncomeEvent(stub.db, USER, "event-uuid-1");

    const set = stub.capture.updateSets[0]!;
    assert.equal(set.status, "rejected");
    assert.equal("acceptedAt" in set, false);
    assert.equal(dto.status, "rejected");
    assert.equal(dto.acceptedAt, null);
  });

  it("409s when the row exists but is no longer pending", async () => {
    const stub = makeStubDb({
      updateReturning: [],
      selects: [[{ id: "event-uuid-1" }]], // existence probe finds the row
    });
    await assert.rejects(
      () => rejectIncomeEvent(stub.db, USER, "event-uuid-1"),
      httpError(409, "not pending"),
    );
  });

  it("404s when the row does not exist or belongs to another user", async () => {
    const stub = makeStubDb({ updateReturning: [], selects: [[]] });
    await assert.rejects(
      () => rejectIncomeEvent(stub.db, USER, "event-uuid-1"),
      httpError(404, "not found"),
    );
  });
});

// ─── getSummary tests ─────────────────────────────────────────────────────────

describe("getSummary", () => {
  it("aggregates accepted rows only; pending rows count, rejected rows are ignored", async () => {
    const rows = [
      makeIncomeEventRow({ status: "accepted", incomeKind: "salary", grossPaise: 5000000, tdsPaise: 300000 }),
      makeIncomeEventRow({ status: "accepted", incomeKind: "interest", grossPaise: 100000, tdsPaise: 10000 }),
      makeIncomeEventRow({ status: "pending", incomeKind: "salary", grossPaise: 999999, tdsPaise: 99 }),
      makeIncomeEventRow({ status: "rejected", incomeKind: "rent", grossPaise: 777777, tdsPaise: 77 }),
    ];
    const stub = makeStubDb({ selects: [rows] });

    const summary = await getSummary(stub.db, USER, "2025-26");

    assert.equal(summary.fy, "2025-26");
    assert.equal(summary.totalGrossPaise, 5100000);
    assert.equal(summary.totalTdsPaise, 310000);
    assert.equal(summary.acceptedCount, 2);
    assert.equal(summary.pendingCount, 1);
    assert.equal(summary.isEstimate, true);
    assert.deepEqual(summary.byKind.salary, { grossPaise: 5000000, tdsPaise: 300000, count: 1 });
    assert.deepEqual(summary.byKind.interest, { grossPaise: 100000, tdsPaise: 10000, count: 1 });
    // Rejected rent row contributed nothing.
    assert.deepEqual(summary.byKind.rent, { grossPaise: 0, tdsPaise: 0, count: 0 });
  });

  it("always returns all five income kinds, zeroed when empty", async () => {
    const stub = makeStubDb({ selects: [[]] });
    const summary = await getSummary(stub.db, USER, "2025-26");

    assert.deepEqual(Object.keys(summary.byKind), [
      "salary",
      "interest",
      "dividend",
      "rent",
      "other",
    ]);
    for (const kind of ["salary", "interest", "dividend", "rent", "other"] as const) {
      assert.deepEqual(summary.byKind[kind], { grossPaise: 0, tdsPaise: 0, count: 0 });
    }
    assert.equal(summary.totalGrossPaise, 0);
    assert.equal(summary.totalTdsPaise, 0);
    assert.equal(summary.acceptedCount, 0);
    assert.equal(summary.pendingCount, 0);
  });

  it("sums multiple accepted rows of the same kind", async () => {
    const rows = [
      makeIncomeEventRow({ status: "accepted", incomeKind: "dividend", grossPaise: 1000, tdsPaise: 100 }),
      makeIncomeEventRow({ status: "accepted", incomeKind: "dividend", grossPaise: 2500, tdsPaise: 250 }),
    ];
    const stub = makeStubDb({ selects: [rows] });
    const summary = await getSummary(stub.db, USER, "2025-26");

    assert.deepEqual(summary.byKind.dividend, { grossPaise: 3500, tdsPaise: 350, count: 2 });
    assert.equal(summary.acceptedCount, 2);
  });

  it("always states that salary amounts are gross, not taxable salary", async () => {
    const stub = makeStubDb({ selects: [[]] });
    const summary = await getSummary(stub.db, USER, "2025-26");

    assert.equal(summary.notes[0], GROSS_NOT_TAXABLE_NOTE);
    assert.match(summary.notes[0]!, /GROSS, not taxable salary/);
    assert.match(summary.notes[0]!, /payslip components/);
    // No pending rows → only the gross caveat.
    assert.equal(summary.notes.length, 1);
  });

  it("adds a pending-exclusion note when pending rows exist", async () => {
    const rows = [
      makeIncomeEventRow({ status: "pending" }),
      makeIncomeEventRow({ status: "pending" }),
    ];
    const stub = makeStubDb({ selects: [rows] });
    const summary = await getSummary(stub.db, USER, "2025-26");

    assert.equal(summary.notes.length, 2);
    assert.equal(summary.notes[0], GROSS_NOT_TAXABLE_NOTE);
    assert.match(summary.notes[1]!, /2 pending events are excluded/);
    assert.equal(summary.pendingCount, 2);
    assert.equal(summary.acceptedCount, 0);
  });

  it("singularizes the pending-exclusion note for one pending row", async () => {
    const stub = makeStubDb({ selects: [[makeIncomeEventRow({ status: "pending" })]] });
    const summary = await getSummary(stub.db, USER, "2025-26");
    assert.match(summary.notes[1]!, /1 pending event is excluded/);
  });
});

// ─── deriveFromPayslip tests ──────────────────────────────────────────────────

function makePayslipRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "payslip-uuid-1",
    userId: USER,
    fy: "2099-00",
    payMonth: "2025-06",
    employerName: "ACME Corp",
    documentKey: null,
    status: "accepted",
    grossPaise: 5000000,
    netPaise: 4200000,
    tdsCurrentPaise: 300000,
    tdsYtdPaise: 900000,
    acceptedAt: NOW,
    createdAt: NOW,
    updatedAt: NOW,
    ...overrides,
  };
}

describe("deriveFromPayslip", () => {
  it("404s when the payslip is missing or owned by another user", async () => {
    const stub = makeStubDb({ selects: [[]] });
    await assert.rejects(
      () => deriveFromPayslip(stub.db, USER, "payslip-uuid-1"),
      httpError(404, "Payslip not found"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("400s when the payslip is not accepted", async () => {
    const stub = makeStubDb({ selects: [[makePayslipRow({ status: "pending" })]] });
    await assert.rejects(
      () => deriveFromPayslip(stub.db, USER, "payslip-uuid-1"),
      httpError(400, "must be accepted"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("400s when the payslip has a null grossPaise", async () => {
    const stub = makeStubDb({ selects: [[makePayslipRow({ grossPaise: null })]] });
    await assert.rejects(
      () => deriveFromPayslip(stub.db, USER, "payslip-uuid-1"),
      httpError(400, "no gross amount"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("maps an accepted payslip to a pending salary event with section='192'", async () => {
    const stub = makeStubDb({
      selects: [[makePayslipRow()]],
      insertReturning: [makeIncomeEventRow({ accrualDate: "2025-06-30", section: "192" })],
    });

    const dto = await deriveFromPayslip(stub.db, USER, "payslip-uuid-1");

    const values = stub.capture.insertValues[0]!;
    assert.equal(values.incomeKind, "salary");
    assert.equal(values.section, "192");
    assert.equal(values.sourceKind, "payslip");
    assert.equal(values.sourceId, "payslip-uuid-1");
    // accrualDate = lastDayOfMonth(payMonth), and fy is recomputed from it —
    // the payslip's own (deliberately bogus "2099-00") fy is not trusted.
    assert.equal(values.accrualDate, "2025-06-30");
    assert.equal(values.fy, "2025-26");
    assert.equal(values.grossPaise, 5000000);
    assert.equal(values.tdsPaise, 300000);
    assert.equal(values.payerName, "ACME Corp");
    assert.equal(values.status, "pending");
    assert.equal(dto.status, "pending");
  });

  it("treats a null tdsCurrentPaise as zero TDS", async () => {
    const stub = makeStubDb({
      selects: [[makePayslipRow({ tdsCurrentPaise: null })]],
      insertReturning: [makeIncomeEventRow({ tdsPaise: 0 })],
    });
    await deriveFromPayslip(stub.db, USER, "payslip-uuid-1");
    assert.equal(stub.capture.insertValues[0]!.tdsPaise, 0);
  });

  it("derives a March payslip into the FY that ends in that March", async () => {
    const stub = makeStubDb({
      selects: [[makePayslipRow({ payMonth: "2026-03" })]],
      insertReturning: [makeIncomeEventRow({ accrualDate: "2026-03-31", fy: "2025-26" })],
    });
    await deriveFromPayslip(stub.db, USER, "payslip-uuid-1");
    assert.equal(stub.capture.insertValues[0]!.accrualDate, "2026-03-31");
    assert.equal(stub.capture.insertValues[0]!.fy, "2025-26");
  });

  it("is idempotent: on conflict it returns the existing row instead of a new one", async () => {
    const existing = makeIncomeEventRow({ id: "existing-uuid", section: "192" });
    const stub = makeStubDb({
      selects: [[makePayslipRow()], [existing]],
      insertReturning: [], // onConflictDoNothing swallowed the insert
    });

    const dto = await deriveFromPayslip(stub.db, USER, "payslip-uuid-1");

    assert.equal(dto.id, "existing-uuid");
    assert.equal(stub.capture.selectCalls, 2);
  });

  it("500s when the insert conflicted but the existing row cannot be re-fetched", async () => {
    const stub = makeStubDb({ selects: [[makePayslipRow()], []], insertReturning: [] });
    await assert.rejects(
      () => deriveFromPayslip(stub.db, USER, "payslip-uuid-1"),
      httpError(500, "existing row not found"),
    );
  });
});

// ─── deriveFromHoldingEvent tests ─────────────────────────────────────────────

function makeHoldingEventRow(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    id: "holding-event-uuid-1",
    type: "dividend",
    date: "2025-09-10",
    amountPaise: 250000,
    holdingId: "holding-uuid-1",
    holdingName: "Nifty Index Fund",
    holdingUserId: USER,
    ...overrides,
  };
}

describe("deriveFromHoldingEvent", () => {
  it("404s when the holding event does not exist", async () => {
    const stub = makeStubDb({ selects: [[]] });
    await assert.rejects(
      () => deriveFromHoldingEvent(stub.db, USER, "holding-event-uuid-1"),
      httpError(404, "Holding event not found"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("404s when the holding belongs to another user", async () => {
    const stub = makeStubDb({ selects: [[makeHoldingEventRow({ holdingUserId: "other-user" })]] });
    await assert.rejects(
      () => deriveFromHoldingEvent(stub.db, USER, "holding-event-uuid-1"),
      httpError(404, "Holding event not found"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("400s for a buy event", async () => {
    const stub = makeStubDb({ selects: [[makeHoldingEventRow({ type: "buy" })]] });
    await assert.rejects(
      () => deriveFromHoldingEvent(stub.db, USER, "holding-event-uuid-1"),
      httpError(400, "Only dividend events"),
    );
    assert.equal(stub.capture.insertValues.length, 0);
  });

  it("400s for a sell event", async () => {
    const stub = makeStubDb({ selects: [[makeHoldingEventRow({ type: "sell" })]] });
    await assert.rejects(
      () => deriveFromHoldingEvent(stub.db, USER, "holding-event-uuid-1"),
      httpError(400, "Only dividend events"),
    );
  });

  it("maps a dividend event to a pending dividend income event", async () => {
    const stub = makeStubDb({
      selects: [[makeHoldingEventRow()]],
      insertReturning: [
        makeIncomeEventRow({
          incomeKind: "dividend",
          sourceKind: "holding_event",
          sourceId: "holding-event-uuid-1",
        }),
      ],
    });

    const dto = await deriveFromHoldingEvent(stub.db, USER, "holding-event-uuid-1");

    const values = stub.capture.insertValues[0]!;
    assert.equal(values.incomeKind, "dividend");
    assert.equal(values.sourceKind, "holding_event");
    assert.equal(values.sourceId, "holding-event-uuid-1");
    assert.equal(values.accrualDate, "2025-09-10");
    assert.equal(values.fy, "2025-26");
    assert.equal(values.grossPaise, 250000);
    assert.equal(values.tdsPaise, 0);
    assert.equal(values.payerName, "Nifty Index Fund");
    assert.equal(values.status, "pending");
    assert.equal(dto.incomeKind, "dividend");
  });

  it("is idempotent: on conflict it returns the existing row", async () => {
    const existing = makeIncomeEventRow({
      id: "existing-uuid",
      incomeKind: "dividend",
      sourceKind: "holding_event",
      sourceId: "holding-event-uuid-1",
    });
    const stub = makeStubDb({
      selects: [[makeHoldingEventRow()], [existing]],
      insertReturning: [],
    });

    const dto = await deriveFromHoldingEvent(stub.db, USER, "holding-event-uuid-1");
    assert.equal(dto.id, "existing-uuid");
    assert.equal(stub.capture.selectCalls, 2);
  });
});
