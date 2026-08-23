/**
 * regime-preference.ts — Tax regime preference routes (task 13.1).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   GET  /regime-preference?fy=2025-26 → GET  /api/tax/regime-preference
 *   PUT  /regime-preference            → PUT  /api/tax/regime-preference
 *
 * Session-authenticated. Demo sessions are automatically rejected on all
 * mutating methods by the single chokepoint in `plugins/auth.ts`.
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  RegimePreferenceSchema,
  GetRegimePreferenceQuerySchema,
  UpsertRegimePreferenceBodySchema,
} from "@compass/shared";
import type { Regime } from "@compass/shared";
import { getRegimePreference, upsertRegimePreference } from "../services/regime-preference.ts";

export async function regimePreferenceRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /api/tax/regime-preference?fy=2025-26
   *
   * Returns the regime preference for the authenticated user and the given FY.
   * If no explicit preference exists, returns the default (new regime).
   */
  r.get(
    "/regime-preference",
    {
      schema: {
        querystring: GetRegimePreferenceQuerySchema,
        response: { 200: RegimePreferenceSchema },
      },
    },
    async (req) => {
      const { fy } = req.query;
      const userId = req.session!.userId;
      const result = await getRegimePreference(app.db, userId, fy);
      return {
        fy: result.fy,
        chosen: result.chosen,
        inferredRegime: result.inferredRegime,
        inferredAt: result.inferredAt,
        effective: result.effective as Regime,
        source: result.source,
      };
    },
  );

  /**
   * PUT /api/tax/regime-preference
   *
   * Stores the user's explicit regime choice for the given FY.
   * Only `chosen` is written — `inferredRegime` is preserved if set.
   */
  r.put(
    "/regime-preference",
    {
      schema: {
        body: UpsertRegimePreferenceBodySchema,
        response: { 200: RegimePreferenceSchema },
      },
    },
    async (req) => {
      const { fy, chosen } = req.body;
      const userId = req.session!.userId;
      const result = await upsertRegimePreference(app.db, userId, fy, chosen);
      return {
        fy: result.fy,
        chosen: result.chosen,
        inferredRegime: result.inferredRegime,
        inferredAt: result.inferredAt,
        effective: result.effective as Regime,
        source: result.source,
      };
    },
  );
}
