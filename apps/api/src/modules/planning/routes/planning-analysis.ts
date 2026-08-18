import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { DataCompletenessReportSchema, IncomeSurplusResultSchema } from "@compass/shared";
import { getIncomeSurplus } from "../services/income-surplus.ts";
import { getDataCompletenessReport } from "../services/data-completeness.ts";

/**
 * GET /api/planning/income-surplus
 * GET /api/planning/data-completeness
 *
 * OWNER-ONLY SCOPING: Both endpoints return data for the authenticated user's
 * own accounts only. `withSharing` (lib/sharing.ts) is deliberately NOT used
 * because it currently has zero production call sites anywhere in the codebase.
 * Every existing endpoint is owner-only; making these sharing-aware would be
 * inconsistent with the rest of the app. This decision is reversible and is
 * tracked for a future sharing-rollout decision (task 061).
 *
 * For data-completeness specifically: shared accounts visible elsewhere in the
 * household UI are omitted from readiness reporting.
 *
 * RESIDUAL REAL-DB 500 RISKS (AC12):
 * (a) Number(bigintString) / Drizzle mode:"number" can exceed
 *     Number.MAX_SAFE_INTEGER, which the contract's .safe() then correctly
 *     rejects → 500. No DB constraint or runtime guard prevents this.
 * (b) statement_reconciliations.period is unconstrained text (spines.ts:204-207)
 *     while the contract demands strict YYYY-MM, so malformed legacy data → 500.
 * These are recorded, not fixed, in this task.
 */
export async function planningAnalysisRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/planning/income-surplus",
    {
      schema: {
        querystring: z.object({
          lookbackMonths: z.coerce.number().int().min(1).max(120).default(12),
        }),
        response: { 200: IncomeSurplusResultSchema },
      },
    },
    async (req) =>
      getIncomeSurplus(app.db, req.session!.userId, req.query.lookbackMonths),
  );

  r.get(
    "/api/planning/data-completeness",
    {
      schema: {
        // `today` is deliberately NOT exposed: it is a determinism seam for
        // tests (data-completeness.ts:162-165). Letting a client move the
        // readiness report's reference date is a correctness hazard for no
        // benefit. This route defines NO querystring schema, so query params
        // are not processed by the validator at all — ?today=... reaches the
        // route handler but the handler calls getDataCompletenessReport with
        // only (db, userId), omitting the third argument entirely. The service
        // then defaults today = new Date(). The query param has no effect and
        // the returned asOf always reflects the server's current date.
        response: { 200: DataCompletenessReportSchema },
      },
    },
    async (req) => getDataCompletenessReport(app.db, req.session!.userId),
  );
}
