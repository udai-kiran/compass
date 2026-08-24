/**
 * regime-preference.ts — CRUD operations for the tax_regime_preferences table.
 *
 * Three operations:
 *   - getRegimePreference  — read preference for a user+FY (default: new regime)
 *   - upsertRegimePreference — PUT path: writes only `chosen`, computes effective+source
 *   - updateInferredRegime — internal-only: used by the payslip service to record TDS-inferred regime
 *
 * Both write paths use atomic single-statement INSERT … ON CONFLICT DO UPDATE to avoid
 * the read-modify-write race between concurrent PUT(chosen) and inference writes (M1).
 */

import { sql } from "drizzle-orm";
import type { Db } from "../../../db/index.ts";
import type { Regime, RegimeSource } from "@compass/shared";
import { parseFy } from "../../../lib/financial-year.ts";
import { coveredFys } from "../../../lib/tax-rules.ts";
import { HttpError } from "../../../lib/errors.ts";
import { taxRegimePreferences } from "../schema.ts";

/**
 * Resolved regime preference shape returned by all public functions.
 */
export interface RegimePreferenceResult {
  fy: string;
  chosen: Regime | null;
  inferredRegime: Regime | null;
  inferredAt: string | null;
  effective: Regime;
  source: RegimeSource;
}

/** Default effective regime when neither chosen nor inferred is set. */
const DEFAULT_REGIME: Regime = "new";

/**
 * Validates the FY label format and coverage.
 * Throws HttpError(400) if invalid or unsupported.
 */
function assertValidCoveredFy(fy: string): void {
  try {
    parseFy(fy);
  } catch (e) {
    throw new HttpError(400, e instanceof Error ? e.message : `Invalid FY label: "${fy}"`);
  }
  const covered = coveredFys();
  if (!covered.includes(fy)) {
    throw new HttpError(
      400,
      `FY "${fy}" is not in the supported tax data set. Supported FYs: ${covered.join(", ")}`,
    );
  }
}

/**
 * Maps a DB row to the result shape.
 */
function rowToResult(row: {
  fy: string;
  chosen: "old" | "new" | null;
  inferredRegime: "old" | "new" | null;
  inferredAt: Date | null;
  effective: "old" | "new";
  source: "chosen" | "inferred" | "default";
}): RegimePreferenceResult {
  return {
    fy: row.fy,
    chosen: row.chosen ?? null,
    inferredRegime: row.inferredRegime ?? null,
    inferredAt: row.inferredAt?.toISOString() ?? null,
    effective: row.effective as Regime,
    source: row.source as RegimeSource,
  };
}

/**
 * Retrieves the regime preference for a user and FY.
 * Returns a default (new regime) row if none exists — does NOT write to DB.
 *
 * @throws {HttpError(400)} If the FY label is invalid or not covered.
 */
export async function getRegimePreference(
  db: Db,
  userId: string,
  fy: string,
): Promise<RegimePreferenceResult> {
  assertValidCoveredFy(fy);

  const rows = await db
    .select()
    .from(taxRegimePreferences)
    .where(
      sql`${taxRegimePreferences.userId} = ${userId} AND ${taxRegimePreferences.fy} = ${fy}`,
    )
    .limit(1);

  if (rows.length === 0) {
    return {
      fy,
      chosen: null,
      inferredRegime: null,
      inferredAt: null,
      effective: DEFAULT_REGIME,
      source: "default",
    };
  }

  return rowToResult(rows[0]!);
}

/**
 * Atomically upserts the regime preference for a user and FY, writing only
 * the `chosen` field. Any existing `inferredRegime` is preserved by computing
 * effective/source entirely in SQL via COALESCE/CASE on the merged row — no
 * pre-read required.
 *
 * This is the handler for PUT /api/tax/regime-preference.
 *
 * @throws {HttpError(400)} If the FY label is invalid or not covered.
 */
export async function upsertRegimePreference(
  db: Db,
  userId: string,
  fy: string,
  chosen: Regime,
): Promise<RegimePreferenceResult> {
  assertValidCoveredFy(fy);

  const tbl = taxRegimePreferences;

  const [row] = await db
    .insert(tbl)
    .values({
      userId,
      fy,
      chosen,
      inferredRegime: null,
      inferredAt: null,
      // Placeholder values — overridden by ON CONFLICT SET on conflict,
      // and used directly on first insert (no inferred row yet, so chosen wins).
      effective: chosen,
      source: "chosen",
    })
    .onConflictDoUpdate({
      target: [tbl.userId, tbl.fy],
      set: {
        chosen: sql`excluded.chosen`,
        // effective = chosen (since chosen is being set, it wins over everything)
        effective: sql`excluded.chosen`,
        // source = 'chosen' (because we just set chosen)
        source: sql`'chosen'::regime_source`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return rowToResult(row!);
}

/**
 * Internal-only: atomically updates the inferred regime for a user+FY (called
 * by the payslip service when TDS analysis produces a regime inference).
 *
 * Does NOT overwrite `chosen` — a user's explicit choice always wins.
 * effective/source are computed in SQL from the merged row.
 *
 * @throws {HttpError(400)} If the FY label is invalid or not covered.
 */
export async function updateInferredRegime(
  db: Db,
  userId: string,
  fy: string,
  inferred: Regime,
): Promise<RegimePreferenceResult> {
  assertValidCoveredFy(fy);

  const tbl = taxRegimePreferences;
  const now = new Date();

  const [row] = await db
    .insert(tbl)
    .values({
      userId,
      fy,
      chosen: null,
      inferredRegime: inferred,
      inferredAt: now,
      // Placeholder values for first insert (no chosen yet, so inferred wins).
      effective: inferred,
      source: "inferred",
    })
    .onConflictDoUpdate({
      target: [tbl.userId, tbl.fy],
      set: {
        inferredRegime: sql`excluded.inferred_regime`,
        inferredAt: sql`excluded.inferred_at`,
        // effective = chosen if set, else inferred, else 'new'
        effective: sql`coalesce(${tbl.chosen}, excluded.inferred_regime, 'new'::tax_regime)`,
        // source: 'chosen' > 'inferred' > 'default'
        source: sql`(case when ${tbl.chosen} is not null then 'chosen' when excluded.inferred_regime is not null then 'inferred' else 'default' end)::regime_source`,
        updatedAt: sql`now()`,
      },
    })
    .returning();

  return rowToResult(row!);
}
