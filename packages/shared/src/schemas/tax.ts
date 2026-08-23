/**
 * tax.ts — shared Zod contracts for the tax module (task 13.1).
 *
 * Covers:
 *  - Regime preference GET/PUT API
 *
 * Persistence source of truth: apps/api/src/modules/tax/schema.ts.
 */

import { z } from "zod";

/** Canonical Indian FY label: "YYYY-YY" (e.g. "2025-26"). */
export const FySchema = z
  .string()
  .regex(/^\d{4}-\d{2}$/, 'FY must be in "YYYY-YY" format (e.g. "2025-26")')
  .refine(
    (fy) => {
      const startYear = Number(fy.slice(0, 4));
      const expectedEndYY = (startYear + 1) % 100;
      const actualEndYY = Number(fy.slice(5, 7));
      return actualEndYY === expectedEndYY;
    },
    { message: 'FY end-year suffix must be exactly (start year + 1) mod 100 (e.g. "2025-26", "1999-00")' },
  );

/** Income-tax regime. */
export const RegimeSchema = z.enum(["old", "new"]);
export type Regime = z.infer<typeof RegimeSchema>;

/** The source that determined the effective regime. */
export const RegimeSourceSchema = z.enum(["chosen", "inferred", "default"]);
export type RegimeSource = z.infer<typeof RegimeSourceSchema>;

// ─── Regime preference ───────────────────────────────────────────────────────

/** Response body for GET /api/tax/regime-preference and the PUT response. */
export const RegimePreferenceSchema = z.object({
  fy: FySchema,
  /** User's explicit choice. null = not yet explicitly chosen. */
  chosen: RegimeSchema.nullable(),
  /** Inferred from payslip TDS. null = not yet inferred. */
  inferredRegime: RegimeSchema.nullable(),
  /** ISO timestamp of when the inferred regime was last set. */
  inferredAt: z.string().nullable(),
  /** Resolved effective regime: chosen ?? inferredRegime ?? 'new'. */
  effective: RegimeSchema,
  /** What determined the effective value. */
  source: RegimeSourceSchema,
});
export type RegimePreference = z.infer<typeof RegimePreferenceSchema>;

/** Query parameters for GET /api/tax/regime-preference. */
export const GetRegimePreferenceQuerySchema = z.object({
  fy: FySchema,
});
export type GetRegimePreferenceQuery = z.infer<typeof GetRegimePreferenceQuerySchema>;

/** Request body for PUT /api/tax/regime-preference. */
export const UpsertRegimePreferenceBodySchema = z.object({
  fy: FySchema,
  /** The user's explicit regime choice. */
  chosen: RegimeSchema,
});
export type UpsertRegimePreferenceBody = z.infer<typeof UpsertRegimePreferenceBodySchema>;
