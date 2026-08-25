/**
 * capital-losses.ts — Capital loss carry-forward CRUD + set-off service (task 13.11).
 *
 * Indian set-off ordering (Section 70-74):
 *   1. STCL sets off against STCG first, then remaining STCL against LTCG.
 *   2. LTCL sets off against LTCG only.
 *   3. Residual unabsorbed losses carry forward for 8 assessment years.
 *   4. Carry-forward requires ITR filed within due date (returnFiled flag).
 *
 * All amounts: integer paise. Negative gross gains (losses) are treated as 0 for
 * set-off purposes — the carry-forward entries hold the loss amounts explicitly.
 */

import { and, eq } from "drizzle-orm";
import type { Db, DbOrTx } from "../../../db/index.ts";
import { capitalLossCarryforward } from "../schema.ts";
import { getCapitalGains } from "../../investments/services/capital-gains.ts";
import { parseFy, fyOf } from "../../../lib/financial-year.ts";
import { HttpError } from "../../../lib/errors.ts";
import type {
  CapitalLossEntry,
  CreateCapitalLossEntry,
  UpdateCapitalLossEntry,
  LossSetoffResult,
  CapitalPosition,
} from "@compass/shared";

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/**
 * Given originFy (e.g. "2022-23"), compute the expiry FY (8 years later: "2030-31").
 * Uses parseFy to get startYear, adds 8.
 */
export function computeExpiresFy(originFy: string): string {
  const startYear = parseFy(originFy);
  const expiryStart = startYear + 8;
  const expiryEndYY = (expiryStart + 1) % 100;
  return `${expiryStart}-${String(expiryEndYY).padStart(2, "0")}`;
}

/**
 * Apply Indian loss set-off rules to current-year gains.
 *
 * Inputs:
 *   grossStcgPaise — current FY short-term capital gains (may be 0, never negative)
 *   grossLtcgPaise — current FY long-term capital gains (may be 0, never negative)
 *   stclPaise      — brought-forward STCL available for set-off (≥ 0)
 *   ltclPaise      — brought-forward LTCL available for set-off (≥ 0)
 *
 * Returns LossSetoffResult with net gains and absorption details.
 */
export function applyLossSetoff(
  grossStcgPaise: number,
  grossLtcgPaise: number,
  stclPaise: number,
  ltclPaise: number,
): LossSetoffResult {
  // Step 1: STCL against STCG
  const stclAgainstStcg = Math.min(stclPaise, grossStcgPaise);
  const remainingStcl = stclPaise - stclAgainstStcg;
  const stcgAfterStcl = grossStcgPaise - stclAgainstStcg;

  // Step 2: Remaining STCL against LTCG
  const stclAgainstLtcg = Math.min(remainingStcl, grossLtcgPaise);
  const residualStcl = remainingStcl - stclAgainstLtcg;
  const ltcgAfterStcl = grossLtcgPaise - stclAgainstLtcg;

  // Step 3: LTCL against remaining LTCG only
  const ltclAgainstLtcg = Math.min(ltclPaise, ltcgAfterStcl);
  const residualLtcl = ltclPaise - ltclAgainstLtcg;
  const netLtcg = ltcgAfterStcl - ltclAgainstLtcg;

  return {
    netStcgPaise: stcgAfterStcl,
    netLtcgPaise: netLtcg,
    residualStclPaise: residualStcl,
    residualLtclPaise: residualLtcl,
    stclAgainstStcgPaise: stclAgainstStcg,
    stclAgainstLtcgPaise: stclAgainstLtcg,
    ltclAgainstLtcgPaise: ltclAgainstLtcg,
  };
}

// ─── Row mapper ───────────────────────────────────────────────────────────────

function toEntry(row: typeof capitalLossCarryforward.$inferSelect): CapitalLossEntry {
  return {
    id: row.id,
    userId: row.userId,
    originFy: row.originFy,
    lossKind: row.lossKind as "STCL" | "LTCL",
    originalPaise: row.originalPaise,
    remainingPaise: row.remainingPaise,
    expiresFy: row.expiresFy,
    returnFiled: row.returnFiled,
    note: row.note,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

// ─── CRUD ─────────────────────────────────────────────────────────────────────

export async function listCapitalLossEntries(
  db: DbOrTx,
  userId: string,
): Promise<CapitalLossEntry[]> {
  const rows = await db
    .select()
    .from(capitalLossCarryforward)
    .where(eq(capitalLossCarryforward.userId, userId))
    .orderBy(
      capitalLossCarryforward.originFy,
      capitalLossCarryforward.lossKind,
      capitalLossCarryforward.id, // unique tie-breaker → deterministic ordering/allocation
    );
  return rows.map(toEntry);
}

export async function createCapitalLossEntry(
  db: DbOrTx,
  userId: string,
  input: CreateCapitalLossEntry,
): Promise<CapitalLossEntry> {
  try { parseFy(input.originFy); } catch {
    throw new HttpError(400, `Invalid originFy: "${input.originFy}"`);
  }
  const expiresFy = computeExpiresFy(input.originFy);
  const remainingPaise = input.remainingPaise ?? input.originalPaise;
  const [row] = await db
    .insert(capitalLossCarryforward)
    .values({
      userId,
      originFy: input.originFy,
      lossKind: input.lossKind,
      originalPaise: input.originalPaise,
      remainingPaise,
      expiresFy,
      returnFiled: input.returnFiled ?? false,
      note: input.note ?? null,
    })
    .returning();
  if (!row) throw new HttpError(500, "Failed to create capital loss entry");
  return toEntry(row);
}

export async function updateCapitalLossEntry(
  db: DbOrTx,
  userId: string,
  id: string,
  input: UpdateCapitalLossEntry,
): Promise<CapitalLossEntry> {
  const set: Partial<{
    remainingPaise: number;
    returnFiled: boolean;
    note: string | null;
    updatedAt: Date;
  }> = { updatedAt: new Date() };
  if (input.remainingPaise !== undefined) set.remainingPaise = input.remainingPaise;
  if (input.returnFiled !== undefined) set.returnFiled = input.returnFiled;
  if (input.note !== undefined) set.note = input.note ?? null;
  const [row] = await db
    .update(capitalLossCarryforward)
    .set(set)
    .where(
      and(
        eq(capitalLossCarryforward.id, id),
        eq(capitalLossCarryforward.userId, userId),
      ),
    )
    .returning();
  if (!row) throw new HttpError(404, "Capital loss entry not found");
  return toEntry(row);
}

export async function deleteCapitalLossEntry(
  db: DbOrTx,
  userId: string,
  id: string,
): Promise<void> {
  const rows = await db
    .delete(capitalLossCarryforward)
    .where(
      and(
        eq(capitalLossCarryforward.id, id),
        eq(capitalLossCarryforward.userId, userId),
      ),
    )
    .returning({ id: capitalLossCarryforward.id });
  if (rows.length === 0) throw new HttpError(404, "Capital loss entry not found");
}

// ─── Capital position (set-off computation) ───────────────────────────────────

/**
 * Compute net capital position for a user in a given FY:
 *  1. Get realised gains from capital-gains service (STCG + LTCG).
 *  2. Load brought-forward losses not yet expired as of the FY.
 *  3. Apply set-off in statutory order.
 *  4. Surface expiring losses (within 2 FYs of the given FY).
 */
export async function getCapitalPosition(
  db: Db,
  userId: string,
  fy?: string,
  today?: string,
): Promise<CapitalPosition> {
  const refDate = today ?? new Date().toISOString().slice(0, 10);
  const resolvedFy = fy ?? fyOf(refDate);
  try { parseFy(resolvedFy); } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : `Invalid FY: "${resolvedFy}"`);
  }

  // 1. Realised gains for the FY (posted through the reference date — the
  // optional `today` lets callers replay the position at an earlier cutoff).
  const gainsStatement = await getCapitalGains(db, userId, resolvedFy, refDate);
  const rawStcg = gainsStatement.shortTermGainPaise; // may be negative (net STCL)
  const rawLtcg = gainsStatement.longTermGainPaise;  // may be negative (net LTCL)

  // Gross positive gains for reporting
  const grossStcg = Math.max(0, rawStcg);
  const grossLtcg = Math.max(0, rawLtcg);

  // Current-year within-year set-off (Sec 70): applied BEFORE brought-forward losses.
  // STCL first against STCG, residual STCL against LTCG; LTCL only against LTCG.
  const currentStcl = rawStcg < 0 ? -rawStcg : 0;
  const currentLtcl = rawLtcg < 0 ? -rawLtcg : 0;
  // Step A: STCL against STCG
  const stclVsCurrentStcg = Math.min(currentStcl, grossStcg);
  const residualCurrentStcl = currentStcl - stclVsCurrentStcg;
  const stcgAfterCurrentYear = grossStcg - stclVsCurrentStcg;
  // Step B: residual STCL against LTCG (STCL can offset both categories)
  const stclVsCurrentLtcg = Math.min(residualCurrentStcl, grossLtcg);
  const ltcgAfterCurrentStcl = grossLtcg - stclVsCurrentLtcg;
  // Step C: LTCL against remaining LTCG only
  const ltcgAfterCurrentYear = Math.max(0, ltcgAfterCurrentStcl - currentLtcl);

  // 2. Brought-forward losses — all entries for the user; eligibility filtered in
  // memory so that unfiled-return entries can still surface a warning below.
  const allCfRows = await db
    .select()
    .from(capitalLossCarryforward)
    .where(eq(capitalLossCarryforward.userId, userId))
    .orderBy(
      capitalLossCarryforward.originFy,
      capitalLossCarryforward.lossKind,
      capitalLossCarryforward.id, // unique tie-breaker → deterministic ordering/allocation
    );
  // Eligible: prior FY only (no current/future losses), return filed, not yet expired
  // (inclusive of the expiry FY — a loss expiring in "2030-31" is still eligible then),
  // and has remaining paise > 0.
  const validBf = allCfRows.filter(
    (r) =>
      r.originFy < resolvedFy &&
      r.returnFiled &&
      r.expiresFy >= resolvedFy &&
      r.remainingPaise > 0,
  );

  const bfStcl = validBf
    .filter((r) => r.lossKind === "STCL")
    .reduce((s, r) => s + r.remainingPaise, 0);
  const bfLtcl = validBf
    .filter((r) => r.lossKind === "LTCL")
    .reduce((s, r) => s + r.remainingPaise, 0);

  // 3. Apply brought-forward set-off to post-current-year gains.
  const setoff = applyLossSetoff(stcgAfterCurrentYear, ltcgAfterCurrentYear, bfStcl, bfLtcl);

  // Build absorption detail per entry (deterministic oldest-first allocation)
  const broughtForwardLossesApplied: CapitalPosition["broughtForwardLossesApplied"] = [];
  const totalBfStclAbsorbed = setoff.stclAgainstStcgPaise + setoff.stclAgainstLtcgPaise;
  const totalBfLtclAbsorbed = setoff.ltclAgainstLtcgPaise;

  let remainingStclToAllocate = totalBfStclAbsorbed;
  let remainingLtclToAllocate = totalBfLtclAbsorbed;

  /** Post-set-off balance per entry id — used for the expiring-losses warning. */
  const postSetoffRemaining = new Map<string, number>();

  for (const r of validBf) {
    let absorbed = 0;
    if (r.lossKind === "STCL" && remainingStclToAllocate > 0) {
      absorbed = Math.min(r.remainingPaise, remainingStclToAllocate);
      remainingStclToAllocate -= absorbed;
    } else if (r.lossKind === "LTCL" && remainingLtclToAllocate > 0) {
      absorbed = Math.min(r.remainingPaise, remainingLtclToAllocate);
      remainingLtclToAllocate -= absorbed;
    }
    postSetoffRemaining.set(r.id, r.remainingPaise - absorbed);
    if (absorbed > 0) {
      broughtForwardLossesApplied.push({
        entryId: r.id,
        originFy: r.originFy,
        lossKind: r.lossKind as "STCL" | "LTCL",
        absorbedPaise: absorbed,
      });
    }
  }

  // 4. Expiring losses — expiresFy within 2 FYs. Reports the POST-set-off balance:
  // a fully-absorbed entry has nothing left to lapse and must not warn.
  const fyStartYear = parseFy(resolvedFy);
  const warningBoundary = `${fyStartYear + 2}-${String((fyStartYear + 3) % 100).padStart(2, "0")}`;
  const expiringLosses = validBf
    .filter((r) => r.expiresFy <= warningBoundary)
    .map((r) => ({
      originFy: r.originFy,
      lossKind: r.lossKind as "STCL" | "LTCL",
      remainingPaise: postSetoffRemaining.get(r.id) ?? r.remainingPaise,
      expiresFy: r.expiresFy,
    }))
    .filter((e) => e.remainingPaise > 0);

  const assumptions: string[] = [
    `Capital gains from investment holdings only (FIFO); other asset classes may have additional gains/losses.`,
    `Brought-forward losses require ITR filed within due date (returnFiled=true entries only).`,
    `Current-year net losses reduce gross gains before brought-forward set-off is applied.`,
    `Labelled an estimate: pending or unrecorded transactions may affect the final position.`,
    `FY: ${resolvedFy}.`,
  ];

  const unfiledCount = allCfRows.filter((r) => r.originFy < resolvedFy && !r.returnFiled).length;
  if (unfiledCount > 0) {
    assumptions.push(
      `${unfiledCount} prior-FY loss entr${unfiledCount === 1 ? "y" : "ies"} marked returnFiled=false — carry-forward NOT available for these; update the entry if the return was filed.`,
    );
  }

  // Current-year losses that could not be absorbed — these carry forward under Sec 74
  // but are NOT auto-created as carryforward entries; the user must add them manually.
  const currentYearResidualStcl = residualCurrentStcl - stclVsCurrentLtcg;
  const currentYearResidualLtcl = Math.max(0, currentLtcl - ltcgAfterCurrentStcl);

  return {
    fy: resolvedFy,
    grossStcgPaise: grossStcg,
    grossLtcgPaise: grossLtcg,
    currentYearResidualStclPaise: currentYearResidualStcl,
    currentYearResidualLtclPaise: currentYearResidualLtcl,
    broughtForwardLossesApplied,
    setoff,
    expiringLosses,
    assumptions,
    isEstimate: true,
    generatedAt: new Date().toISOString(),
  };
}
