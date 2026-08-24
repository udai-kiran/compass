/**
 * scheme-compliance.ts — PPF/SSY/NPS Tier I scheme compliance routes (task 13.6).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   GET /scheme-compliance         → GET /api/tax/scheme-compliance  (all eligible accounts)
 *   GET /scheme-compliance/:accountId → GET /api/tax/scheme-compliance/:accountId (single)
 *
 * Static route registered before the parameterized one so Fastify resolves the
 * collection path before :accountId.
 *
 * Session-authenticated. Demo sessions are automatically rejected on mutating
 * methods by the single chokepoint in `plugins/auth.ts` (GET-only, so no issue).
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AccountComplianceResultSchema,
  SchemeComplianceListSchema,
  GetSchemeComplianceQuerySchema,
} from "@compass/shared";
import {
  getAllSchemeCompliance,
  getAccountSchemeCompliance,
  resolveSchemeComplianceFy,
} from "../services/scheme-compliance.ts";
import { HttpError } from "../../../lib/errors.ts";

const AccountIdParams = z.object({ accountId: z.uuid() });

export async function schemeComplianceRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /scheme-compliance — list compliance results for all PPF/SSY/NPS Tier I
   * accounts owned by the authenticated user.
   * NPS Tier II accounts are silently excluded.
   *
   * Query: fy (optional, defaults to current FY)
   */
  r.get(
    "/scheme-compliance",
    {
      schema: {
        querystring: GetSchemeComplianceQuerySchema,
        response: { 200: SchemeComplianceListSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const fy = resolveSchemeComplianceFy(req.query.fy);
      const results = await getAllSchemeCompliance(req.server.db, userId, fy);
      return { results };
    },
  );

  /**
   * GET /scheme-compliance/:accountId — single account compliance result.
   * Returns 404 when the account does not exist, is not owned by the user, is
   * not a scheme account (PPF/SSY/NPS), or is NPS Tier II.
   *
   * Query: fy (optional, defaults to current FY)
   */
  r.get(
    "/scheme-compliance/:accountId",
    {
      schema: {
        params: AccountIdParams,
        querystring: GetSchemeComplianceQuerySchema,
        response: { 200: AccountComplianceResultSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const { accountId } = req.params;
      const fy = resolveSchemeComplianceFy(req.query.fy);
      const result = await getAccountSchemeCompliance(req.server.db, userId, accountId, fy);
      if (!result) throw new HttpError(404, "Account not found or not a scheme account");
      return result;
    },
  );
}
