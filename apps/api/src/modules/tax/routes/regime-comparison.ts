/**
 * regime-comparison.ts — Route for GET /api/tax/regime-comparison (task 13.8).
 *
 * Registered under the /api/tax prefix; path is relative:
 *   GET /regime-comparison?fy=2025-26&taxpayerType=ordinary&hraExemptionPaise=0&homeLoanInterestPaise=0
 *     → GET /api/tax/regime-comparison
 *
 * Session-authenticated; read-only (no mutations).
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  GetRegimeComparisonQuerySchema,
  RegimeComparisonSchema,
} from "@compass/shared";
import { compareRegimes } from "../services/regime-comparison.ts";

export async function regimeComparisonRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/tax/regime-comparison
   *
   * Returns an old vs new regime tax comparison for the authenticated user and FY.
   * Income is derived from accepted income_events; deductions from the basket.
   * HRA exemption and home-loan interest are optional query parameters.
   */
  r.get(
    "/regime-comparison",
    {
      schema: {
        querystring: GetRegimeComparisonQuerySchema,
        response: { 200: RegimeComparisonSchema },
      },
    },
    async (req) => {
      const { fy, taxpayerType, hraExemptionPaise, homeLoanInterestPaise } = req.query;
      const userId = req.session!.userId;
      return compareRegimes(app.db, userId, fy, {
        taxpayerType,
        hraExemptionPaise,
        homeLoanInterestPaise,
      });
    },
  );
}
