/**
 * income-events.ts — Structured taxable-income ledger service (task 13.4).
 *
 * State machine (D3):
 *   pending → accepted | rejected  (only these transitions are allowed)
 *   Guarded UPDATE … WHERE status='pending' RETURNING — atomic, concurrent-safe.
 *   Corrections stored in original_values at acceptance.
 *
 * FY is always server-computed from accrualDate via fyOf(). Clients never supply fy.
 *
 * Summary (AC3): aggregate ONLY accepted rows for monetary totals.
 *   Pending rows → pendingCount only.
 *   Rejected rows → excluded entirely.
 *   Response also carries acceptedCount and notes[] (salary is GROSS, not
 *   taxable salary).
 *
 * deriveFromPayslip: idempotent via onConflictDoNothing + fetch-if-empty-returning.
 *   accrualDate = lastDayOfMonth(payslip.payMonth).
 *   Requires accepted payslip and non-null grossPaise.
 *
 * deriveFromHoldingEvent: requires event.type === 'dividend'. Verifies ownership
 *   via holdingEvents.holdingId → holdings.userId = userId.
 */

import { and, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { incomeEvents, payslips } from "../schema.ts";
import { holdingEvents, holdings } from "../../../db/schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { fyOf } from "../../../lib/financial-year.ts";
import { isRealIsoDate } from "@compass/shared";
import type {
  IncomeEvent,
  IncomeEventSummary,
  CreateIncomeEventBody,
  AcceptIncomeEventBody,
  GetIncomeEventsQuery,
} from "@compass/shared";

// ─── Internal helpers ─────────────────────────────────────────────────────────

/**
 * Mandatory summary caveat (AC3): salary rows carry payslip GROSS, which is not
 * taxable salary. Exemptions/deductions live in payslip components and are
 * applied downstream (13.7 / 13.8 / 13.10).
 */
export const GROSS_NOT_TAXABLE_NOTE =
  "Salary amounts are GROSS, not taxable salary: exemptions and deductions live in " +
  "payslip components and are applied downstream.";

/**
 * Returns the last day of a "YYYY-MM" pay month as an ISO date string "YYYY-MM-DD".
 * e.g. "2025-06" → "2025-06-30", "2025-02" → "2025-02-28" (or 29 for leap year).
 */
export function lastDayOfMonth(payMonth: string): string {
  const [yearStr, monthStr] = payMonth.split("-") as [string, string];
  const year = Number(yearStr);
  const month = Number(monthStr);
  // Date.UTC(year, month, 0) = last day of (month) in 0-indexed, i.e. last day of (month-1 in 0-index)
  // month is 1-indexed, so month 6 (June) → Date.UTC(year, 6, 0) = last day of June
  const lastDay = new Date(Date.UTC(year, month, 0));
  const d = lastDay.getUTCDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
}

/** Convert a DB income event row to the shared DTO. Pure — no I/O. */
export function buildIncomeEventDto(row: typeof incomeEvents.$inferSelect): IncomeEvent {
  return {
    id: row.id,
    fy: row.fy,
    accrualDate: row.accrualDate,
    incomeKind: row.incomeKind as IncomeEvent["incomeKind"],
    // Deduction/TDS section — present on the row, propagated to the DTO.
    section: row.section ?? null,
    sourceKind: row.sourceKind as IncomeEvent["sourceKind"],
    sourceId: row.sourceId ?? null,
    // Source precedence — present on the row (always 0 on creation paths in 13.4).
    sourcePriority: row.sourcePriority,
    payerName: row.payerName ?? null,
    payerPan: row.payerPan ?? null,
    payerTan: row.payerTan ?? null,
    grossPaise: row.grossPaise,
    tdsPaise: row.tdsPaise,
    // Computed, never persisted (a stored generated column would need
    // OMITTED_RESTORE_COLUMNS handling in the backup/restore path).
    afterTdsPaise: row.grossPaise - row.tdsPaise,
    notes: row.notes ?? null,
    status: row.status as IncomeEvent["status"],
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    originalValues: (row.originalValues as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── Service operations ───────────────────────────────────────────────────────

/**
 * Create a manual income event (FY computed from accrualDate).
 *
 * sourceKind is FORCED to 'manual' and sourceId to NULL: a client cannot claim
 * payslip / holding_event / ais provenance through this path.
 *
 * accrualDate is re-validated as a real calendar date here (not just its shape)
 * so an impossible date such as "2025-02-30" produces a 400 instead of fyOf()
 * throwing a plain Error and surfacing as a 500. The route's Zod body schema
 * (z.iso.date()) already rejects it; this guard also covers internal callers.
 */
export async function createIncomeEvent(
  db: DbOrTx,
  userId: string,
  input: CreateIncomeEventBody,
): Promise<IncomeEvent> {
  if (!isRealIsoDate(input.accrualDate)) {
    throw new HttpError(400, "accrualDate must be a real calendar date (YYYY-MM-DD)");
  }
  const fy = fyOf(input.accrualDate);
  const now = new Date();

  const [created] = await db
    .insert(incomeEvents)
    .values({
      userId,
      accrualDate: input.accrualDate,
      fy,
      incomeKind: input.incomeKind,
      // Section comes from the client for manual entries (e.g. '194A' for interest).
      section: input.section ?? null,
      // Forced server-side — never taken from client input.
      sourceKind: "manual",
      sourceId: null,
      // Always 0 on manual creation; reconciliation/override is out of scope for 13.4.
      sourcePriority: 0,
      payerName: input.payerName ?? null,
      payerPan: input.payerPan ?? null,
      payerTan: input.payerTan ?? null,
      grossPaise: input.grossPaise,
      tdsPaise: input.tdsPaise ?? 0,
      notes: input.notes ?? null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .returning();

  if (!created) throw new HttpError(500, "Failed to create income event");
  return buildIncomeEventDto(created);
}

/** List income events for a user with optional filters. */
export async function listIncomeEvents(
  db: DbOrTx,
  userId: string,
  query: GetIncomeEventsQuery,
): Promise<IncomeEvent[]> {
  const conditions = [eq(incomeEvents.userId, userId)];
  if (query.fy) conditions.push(eq(incomeEvents.fy, query.fy));
  if (query.status) conditions.push(eq(incomeEvents.status, query.status));
  if (query.incomeKind) conditions.push(eq(incomeEvents.incomeKind, query.incomeKind));

  const rows = await db
    .select()
    .from(incomeEvents)
    .where(and(...conditions))
    .orderBy(incomeEvents.accrualDate, incomeEvents.createdAt);

  return rows.map(buildIncomeEventDto);
}

/** Fetch a single income event by ID (ownership-scoped). */
export async function getIncomeEvent(db: DbOrTx, userId: string, id: string): Promise<IncomeEvent> {
  const [row] = await db
    .select()
    .from(incomeEvents)
    .where(and(eq(incomeEvents.id, id), eq(incomeEvents.userId, userId)));

  if (!row) throw new HttpError(404, "Income event not found");
  return buildIncomeEventDto(row);
}

/**
 * Accept a pending income event, applying reviewer corrections atomically.
 *
 * Concurrency-safe: guarded UPDATE WHERE status='pending' RETURNING ensures
 * only one of two racing requests wins. The loser gets a 409.
 * Pre-accept state is stored in original_values for audit trail.
 * Corrections: payer_name, payer_pan, payer_tan, notes.
 */
export async function acceptIncomeEvent(
  db: Db,
  userId: string,
  id: string,
  corrections: AcceptIncomeEventBody,
): Promise<IncomeEvent> {
  // Fetch the current row first to snapshot pre-accept state.
  const [current] = await db
    .select()
    .from(incomeEvents)
    .where(and(eq(incomeEvents.id, id), eq(incomeEvents.userId, userId)));

  if (!current) throw new HttpError(404, "Income event not found");
  if (current.status !== "pending") {
    throw new HttpError(409, "Income event is not pending");
  }

  // Build the correction set and pre-accept snapshot.
  const hasCorrections =
    corrections.payerName !== undefined ||
    corrections.payerPan !== undefined ||
    corrections.payerTan !== undefined ||
    corrections.notes !== undefined;

  const originalValues: Record<string, unknown> | null = hasCorrections
    ? {
        payerName: current.payerName,
        payerPan: current.payerPan,
        payerTan: current.payerTan,
        notes: current.notes,
      }
    : null;

  const updateSet: Record<string, unknown> = {
    status: "accepted",
    acceptedAt: new Date(),
    updatedAt: new Date(),
    originalValues,
  };

  if (corrections.payerName !== undefined) updateSet.payerName = corrections.payerName;
  if (corrections.payerPan !== undefined) updateSet.payerPan = corrections.payerPan;
  if (corrections.payerTan !== undefined) updateSet.payerTan = corrections.payerTan;
  if (corrections.notes !== undefined) updateSet.notes = corrections.notes;

  const [claimed] = await db
    .update(incomeEvents)
    .set(updateSet)
    .where(
      and(
        eq(incomeEvents.id, id),
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.status, "pending"),
      ),
    )
    .returning({ id: incomeEvents.id });

  if (!claimed) {
    throw new HttpError(409, "Income event is not pending");
  }

  return getIncomeEvent(db, userId, id);
}

/**
 * Reject a pending income event.
 * Guarded UPDATE WHERE status='pending' RETURNING — atomic, concurrent-safe.
 */
export async function rejectIncomeEvent(db: Db, userId: string, id: string): Promise<IncomeEvent> {
  const [claimed] = await db
    .update(incomeEvents)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(
      and(
        eq(incomeEvents.id, id),
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.status, "pending"),
      ),
    )
    .returning({ id: incomeEvents.id });

  if (!claimed) {
    const [exists] = await db
      .select({ id: incomeEvents.id })
      .from(incomeEvents)
      .where(and(eq(incomeEvents.id, id), eq(incomeEvents.userId, userId)));
    throw new HttpError(
      exists ? 409 : 404,
      exists ? "Income event is not pending" : "Income event not found",
    );
  }

  return getIncomeEvent(db, userId, id);
}

/**
 * Get FY income summary.
 *
 * Aggregates ONLY accepted rows for monetary totals.
 * Pending rows contribute to pendingCount only.
 * Rejected rows are excluded entirely.
 * isEstimate is always true (pending rows may still be accepted).
 */
export async function getSummary(
  db: DbOrTx,
  userId: string,
  fy: string,
): Promise<IncomeEventSummary> {
  const rows = await db
    .select()
    .from(incomeEvents)
    .where(and(eq(incomeEvents.userId, userId), eq(incomeEvents.fy, fy)));

  const kindKeys = ["salary", "interest", "dividend", "rent", "other"] as const;
  const byKind = Object.fromEntries(
    kindKeys.map((k) => [k, { grossPaise: 0, tdsPaise: 0, count: 0 }]),
  ) as IncomeEventSummary["byKind"];

  let totalGrossPaise = 0;
  let totalTdsPaise = 0;
  let pendingCount = 0;
  let acceptedCount = 0;

  for (const row of rows) {
    if (row.status === "pending") {
      pendingCount++;
    } else if (row.status === "accepted") {
      acceptedCount++;
      const kind = row.incomeKind as keyof typeof byKind;
      byKind[kind].grossPaise += row.grossPaise;
      byKind[kind].tdsPaise += row.tdsPaise;
      byKind[kind].count++;
      totalGrossPaise += row.grossPaise;
      totalTdsPaise += row.tdsPaise;
    }
    // rejected rows: excluded entirely
  }

  const notes: string[] = [GROSS_NOT_TAXABLE_NOTE];
  if (pendingCount > 0) {
    notes.push(
      `${pendingCount} pending event${pendingCount === 1 ? "" : "s"} ` +
        `${pendingCount === 1 ? "is" : "are"} excluded from these totals until accepted.`,
    );
  }

  return {
    fy,
    totalGrossPaise,
    totalTdsPaise,
    isEstimate: true,
    acceptedCount,
    pendingCount,
    notes,
    byKind,
  };
}

/**
 * Derive an income event from an accepted payslip (idempotent).
 *
 * accrualDate = lastDayOfMonth(payslip.payMonth) — e.g. "2025-06" → "2025-06-30".
 * fy = fyOf(accrualDate) — always server-computed.
 * source_kind = 'payslip', source_id = payslip.id.
 * Requires: payslip is accepted, grossPaise is non-null.
 *
 * Idempotency: uses onConflictDoNothing() WITHOUT explicit target (partial index
 * limitation). If RETURNING is empty, fetches the existing row by (userId, sourceKind, sourceId).
 */
export async function deriveFromPayslip(
  db: Db,
  userId: string,
  payslipId: string,
): Promise<IncomeEvent> {
  // Load the payslip and verify ownership.
  const [payslip] = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.id, payslipId), eq(payslips.userId, userId)));

  if (!payslip) throw new HttpError(404, "Payslip not found");
  if (payslip.status !== "accepted") {
    throw new HttpError(400, "Payslip must be accepted before deriving an income event");
  }
  if (payslip.grossPaise === null || payslip.grossPaise === undefined) {
    throw new HttpError(400, "Payslip has no gross amount — cannot derive income event");
  }

  const accrualDate = lastDayOfMonth(payslip.payMonth);
  const fy = fyOf(accrualDate);
  const now = new Date();

  const inserted = await db
    .insert(incomeEvents)
    .values({
      userId,
      accrualDate,
      fy,
      incomeKind: "salary",
      // TDS on salary is deducted under section 192.
      section: "192",
      sourceKind: "payslip",
      sourceId: payslipId,
      // Always 0 on derivation paths in 13.4; reconciliation is out of scope.
      sourcePriority: 0,
      payerName: payslip.employerName ?? null,
      payerPan: null,
      payerTan: null,
      grossPaise: payslip.grossPaise,
      tdsPaise: payslip.tdsCurrentPaise ?? 0,
      notes: null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return buildIncomeEventDto(inserted[0]!);
  }

  // Conflict: row already exists — fetch it.
  const [existing] = await db
    .select()
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.sourceKind, "payslip"),
        eq(incomeEvents.sourceId, payslipId),
      ),
    );

  if (!existing) throw new HttpError(500, "Income event conflict but existing row not found");
  return buildIncomeEventDto(existing);
}

/**
 * Derive an income event from a holding event (dividend only).
 *
 * Verifies ownership via holdingEvents.holdingId → holdings.userId = userId.
 * Rejects non-dividend events with HTTP 400.
 * Idempotent: uses onConflictDoNothing() + fetch on conflict.
 */
export async function deriveFromHoldingEvent(
  db: Db,
  userId: string,
  eventId: string,
): Promise<IncomeEvent> {
  // Load holding event and verify ownership in one query.
  const [result] = await db
    .select({
      id: holdingEvents.id,
      type: holdingEvents.type,
      date: holdingEvents.date,
      amountPaise: holdingEvents.amountPaise,
      holdingId: holdingEvents.holdingId,
      holdingName: holdings.name,
      holdingUserId: holdings.userId,
    })
    .from(holdingEvents)
    .innerJoin(holdings, eq(holdingEvents.holdingId, holdings.id))
    .where(eq(holdingEvents.id, eventId));

  if (!result || result.holdingUserId !== userId) {
    throw new HttpError(404, "Holding event not found");
  }

  if (result.type !== "dividend") {
    throw new HttpError(400, "Only dividend events can be derived as income");
  }

  const accrualDate = result.date;
  const fy = fyOf(accrualDate);
  const now = new Date();

  const inserted = await db
    .insert(incomeEvents)
    .values({
      userId,
      accrualDate,
      fy,
      incomeKind: "dividend",
      // TDS on income from mutual-fund units (IDCW/dividend) is deducted under section 194K.
      // (194-I is rent; 194A is bank interest — distinct from MF income.)
      section: "194K",
      sourceKind: "holding_event",
      sourceId: eventId,
      // Always 0 on derivation paths in 13.4; reconciliation is out of scope.
      sourcePriority: 0,
      payerName: result.holdingName,
      payerPan: null,
      payerTan: null,
      grossPaise: result.amountPaise,
      tdsPaise: 0,
      notes: null,
      status: "pending",
      createdAt: now,
      updatedAt: now,
    })
    .onConflictDoNothing()
    .returning();

  if (inserted.length > 0) {
    return buildIncomeEventDto(inserted[0]!);
  }

  // Conflict: row already exists — fetch it.
  const [existing] = await db
    .select()
    .from(incomeEvents)
    .where(
      and(
        eq(incomeEvents.userId, userId),
        eq(incomeEvents.sourceKind, "holding_event"),
        eq(incomeEvents.sourceId, eventId),
      ),
    );

  if (!existing) throw new HttpError(500, "Income event conflict but existing row not found");
  return buildIncomeEventDto(existing);
}
