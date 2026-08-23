/**
 * payslip-review.ts — Payslip staged-review state machine (task 13.2).
 *
 * State machine (D3):
 *   pending → accepted | rejected  (only these transitions are allowed)
 *   Guarded UPDATE … WHERE status='pending' RETURNING — atomic, concurrent-safe.
 *   Corrections applied atomically with acceptance in one transaction.
 *   Pending rows feed no downstream computation.
 *
 * FY TDS aggregate (D4):
 *   FY TDS = SUM(tds_current_paise) over ACCEPTED payslips per (user, fy).
 *   tds_ytd_paise is stored for reconciliation only, never summed.
 *   Exposed in listPayslips() response metadata.
 */

import { and, eq, sql } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { payslips, payslipComponents } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import type { Payslip, PayslipComponent, AcceptPayslipBody } from "@compass/shared";

// ─── DTO builders (pure) ──────────────────────────────────────────────────────

/** Convert a DB payslip row to the shared DTO. Pure — no I/O. */
export function buildPayslipDto(
  row: typeof payslips.$inferSelect,
  components: Array<typeof payslipComponents.$inferSelect>,
): Payslip {
  return {
    id: row.id,
    fy: row.fy,
    payMonth: row.payMonth,
    employerName: row.employerName ?? null,
    documentKey: row.documentKey ?? null,
    status: row.status as Payslip["status"],
    grossPaise: row.grossPaise ?? null,
    netPaise: row.netPaise ?? null,
    tdsCurrentPaise: row.tdsCurrentPaise ?? null,
    tdsYtdPaise: row.tdsYtdPaise ?? null,
    acceptedAt: row.acceptedAt ? row.acceptedAt.toISOString() : null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    components: components
      .sort((a, b) => a.displayOrder - b.displayOrder)
      .map((c) => buildComponentDto(c)),
  };
}

/** Convert a DB component row to the shared DTO. Pure — no I/O. */
export function buildComponentDto(row: typeof payslipComponents.$inferSelect): PayslipComponent {
  return {
    id: row.id,
    payslipId: row.payslipId,
    rawLabel: row.rawLabel,
    canonicalKind: row.canonicalKind as PayslipComponent["canonicalKind"],
    category: row.category as PayslipComponent["category"],
    currentPaise: row.currentPaise,
    ytdPaise: row.ytdPaise ?? null,
    sourceQuote: row.sourceQuote ?? null,
    confidence: row.confidence ?? null,
    displayOrder: row.displayOrder,
    createdAt: row.createdAt.toISOString(),
  };
}

/**
 * Compute FY TDS aggregate from a list of payslip rows (pure, D4).
 * Only accepted payslips contribute; tds_ytd_paise is never summed.
 */
export function computeFyTdsPaise(rows: Array<typeof payslips.$inferSelect>): number {
  return rows
    .filter((r) => r.status === "accepted" && r.tdsCurrentPaise !== null)
    .reduce((sum, r) => sum + (r.tdsCurrentPaise ?? 0), 0);
}

// ─── DB helpers ───────────────────────────────────────────────────────────────

async function loadPayslipWithComponents(
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<{
  row: typeof payslips.$inferSelect;
  components: Array<typeof payslipComponents.$inferSelect>;
}> {
  const [row] = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.id, id), eq(payslips.userId, userId)));
  if (!row) throw new HttpError(404, "Payslip not found");

  const components = await db
    .select()
    .from(payslipComponents)
    .where(eq(payslipComponents.payslipId, id));

  return { row, components };
}

// ─── Service operations ───────────────────────────────────────────────────────

/** Fetch a single payslip with its components (ownership-scoped). */
export async function getPayslip(db: DbOrTx, userId: string, id: string): Promise<Payslip> {
  const { row, components } = await loadPayslipWithComponents(db, userId, id);
  return buildPayslipDto(row, components);
}

/**
 * List payslips for a user and FY.
 * Returns the payslips plus fyTdsPaise = SUM(tds_current_paise) over accepted
 * payslips (D4). Pending/rejected rows are included in the list but excluded
 * from the aggregate.
 */
export async function listPayslips(
  db: Db,
  userId: string,
  fy: string,
): Promise<{ payslips: Payslip[]; fyTdsPaise: number }> {
  const rows = await db
    .select()
    .from(payslips)
    .where(and(eq(payslips.userId, userId), eq(payslips.fy, fy)));

  if (rows.length === 0) {
    return { payslips: [], fyTdsPaise: 0 };
  }

  const allComponents = await db
    .select()
    .from(payslipComponents)
    .where(
      sql`${payslipComponents.payslipId} IN (SELECT id FROM payslips WHERE user_id = ${userId} AND fy = ${fy})`,
    );

  const componentsByPayslipId = new Map<string, Array<typeof payslipComponents.$inferSelect>>();
  for (const c of allComponents) {
    const arr = componentsByPayslipId.get(c.payslipId) ?? [];
    arr.push(c);
    componentsByPayslipId.set(c.payslipId, arr);
  }

  const payslipDtos = rows.map((row) =>
    buildPayslipDto(row, componentsByPayslipId.get(row.id) ?? []),
  );

  return {
    payslips: payslipDtos,
    fyTdsPaise: computeFyTdsPaise(rows),
  };
}

/**
 * Accept a pending payslip, applying reviewer corrections atomically (D3).
 *
 * Concurrency-safe: guarded UPDATE WHERE status='pending' RETURNING ensures
 * only one of two racing requests wins. The loser gets a 409.
 * Corrections are applied in the same transaction as the status flip.
 */
export async function acceptPayslip(
  db: Db,
  userId: string,
  id: string,
  corrections: AcceptPayslipBody,
): Promise<Payslip> {
  await db.transaction(async (tx) => {
    // Build the correction set (only provided fields override the extracted values).
    const headerSet: Record<string, unknown> = {
      status: "accepted",
      acceptedAt: new Date(),
      updatedAt: new Date(),
    };
    if (corrections.grossPaise !== undefined) headerSet.grossPaise = corrections.grossPaise;
    if (corrections.netPaise !== undefined) headerSet.netPaise = corrections.netPaise;
    if (corrections.tdsCurrentPaise !== undefined)
      headerSet.tdsCurrentPaise = corrections.tdsCurrentPaise;
    if (corrections.tdsYtdPaise !== undefined) headerSet.tdsYtdPaise = corrections.tdsYtdPaise;
    if (corrections.employerName !== undefined) headerSet.employerName = corrections.employerName;

    const [claimed] = await tx
      .update(payslips)
      .set(headerSet)
      .where(and(eq(payslips.id, id), eq(payslips.userId, userId), eq(payslips.status, "pending")))
      .returning({ id: payslips.id });

    if (!claimed) {
      const [exists] = await tx
        .select({ id: payslips.id })
        .from(payslips)
        .where(and(eq(payslips.id, id), eq(payslips.userId, userId)));
      throw new HttpError(
        exists ? 409 : 404,
        exists ? "Payslip is not pending" : "Payslip not found",
      );
    }

    // Apply per-component corrections.
    for (const corr of corrections.componentCorrections) {
      const compSet: Record<string, unknown> = {};
      if (corr.currentPaise !== undefined) compSet.currentPaise = corr.currentPaise;
      if (corr.ytdPaise !== undefined) compSet.ytdPaise = corr.ytdPaise;
      if (Object.keys(compSet).length === 0) {
        throw new HttpError(
          400,
          `Component correction for ${corr.id} must include at least one field to change (currentPaise or ytdPaise)`,
        );
      }
      if (Object.keys(compSet).length > 0) {
        const affected = await tx
          .update(payslipComponents)
          .set(compSet)
          .where(and(eq(payslipComponents.id, corr.id), eq(payslipComponents.payslipId, id)))
          .returning({ id: payslipComponents.id });
        if (affected.length === 0) {
          throw new HttpError(400, `Component ${corr.id} not found on this payslip`);
        }
      }
    }
  });

  return getPayslip(db, userId, id);
}

/**
 * Reject a pending payslip (D3).
 * Guarded UPDATE WHERE status='pending' RETURNING — atomic, concurrent-safe.
 */
export async function rejectPayslip(db: Db, userId: string, id: string): Promise<Payslip> {
  const [claimed] = await db
    .update(payslips)
    .set({ status: "rejected", updatedAt: new Date() })
    .where(and(eq(payslips.id, id), eq(payslips.userId, userId), eq(payslips.status, "pending")))
    .returning({ id: payslips.id });

  if (!claimed) {
    const [exists] = await db
      .select({ id: payslips.id })
      .from(payslips)
      .where(and(eq(payslips.id, id), eq(payslips.userId, userId)));
    throw new HttpError(
      exists ? 409 : 404,
      exists ? "Payslip is not pending" : "Payslip not found",
    );
  }

  return getPayslip(db, userId, id);
}

/**
 * Create a manual payslip entry directly in accepted state.
 * Manual = user is the source of truth; no AI review step needed.
 */
export async function createManualPayslip(
  db: Db,
  userId: string,
  input: {
    fy: string;
    payMonth: string;
    employerName?: string;
    grossPaise?: number;
    netPaise?: number;
    tdsCurrentPaise?: number;
    tdsYtdPaise?: number;
    components: Array<{
      rawLabel: string;
      canonicalKind: string;
      category: string;
      currentPaise: number;
      ytdPaise?: number;
    }>;
  },
): Promise<Payslip> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(payslips)
      .values({
        userId,
        fy: input.fy,
        payMonth: input.payMonth,
        employerName: input.employerName ?? null,
        status: "accepted",
        acceptedAt: now,
        grossPaise: input.grossPaise ?? null,
        netPaise: input.netPaise ?? null,
        tdsCurrentPaise: input.tdsCurrentPaise ?? null,
        tdsYtdPaise: input.tdsYtdPaise ?? null,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) throw new HttpError(500, "Failed to create payslip");

    if (input.components.length > 0) {
      await tx.insert(payslipComponents).values(
        input.components.map((c, i) => ({
          payslipId: created.id,
          rawLabel: c.rawLabel,
          canonicalKind: c.canonicalKind,
          category: c.category,
          currentPaise: c.currentPaise,
          ytdPaise: c.ytdPaise ?? null,
          displayOrder: i,
        })),
      );
    }

    return getPayslip(tx, userId, created.id);
  });
}

/**
 * Create a pending payslip from AI extraction output.
 * Status is 'pending' — requires user review before feeding downstream.
 * Returns the new payslip id.
 */
export async function createExtractedPayslip(
  db: Db,
  userId: string,
  input: {
    fy: string;
    payMonth: string | null;
    employerName: string | null;
    grossPaise: number | null;
    netPaise: number | null;
    tdsCurrentPaise: number | null;
    tdsYtdPaise: number | null;
    documentKey?: string | null;
    components: Array<{
      rawLabel: string;
      canonicalKind: string;
      category: string;
      currentPaise: number;
      ytdPaise: number | null;
      sourceQuote: string | null;
      confidence: number | null;
      displayOrder: number;
    }>;
  },
): Promise<string> {
  const now = new Date();

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(payslips)
      .values({
        userId,
        fy: input.fy,
        payMonth: input.payMonth ?? "",
        employerName: input.employerName,
        documentKey: input.documentKey ?? null,
        status: "pending",
        grossPaise: input.grossPaise,
        netPaise: input.netPaise,
        tdsCurrentPaise: input.tdsCurrentPaise,
        tdsYtdPaise: input.tdsYtdPaise,
        createdAt: now,
        updatedAt: now,
      })
      .returning();

    if (!created) throw new HttpError(500, "Failed to create payslip");

    if (input.components.length > 0) {
      await tx.insert(payslipComponents).values(
        input.components.map((c) => ({
          payslipId: created.id,
          rawLabel: c.rawLabel,
          canonicalKind: c.canonicalKind,
          category: c.category,
          currentPaise: c.currentPaise,
          ytdPaise: c.ytdPaise,
          sourceQuote: c.sourceQuote,
          confidence: c.confidence,
          displayOrder: c.displayOrder,
        })),
      );
    }

    return created.id;
  });
}
