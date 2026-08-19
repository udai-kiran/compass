import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { HouseholdRevolvingDebtSchema } from "@compass/shared";
import { getHouseholdRevolvingDebt } from "../services/revolving-debt.ts";

/**
 * GET /api/credit/revolving-debt
 *
 * OWNER-ONLY SCOPING: Despite the "Household" naming, this endpoint returns
 * data for the authenticated user's own credit cards only. `withSharing`
 * (lib/sharing.ts) is deliberately NOT used because it currently has zero
 * production call sites anywhere in the codebase. Every existing endpoint is
 * owner-only; making this sharing-aware would be inconsistent with the rest of
 * the app. Shared credit cards are therefore silently omitted. This is a
 * pre-existing limitation in the service name and the HouseholdRevolvingDebt
 * type (committed in b829d87). The decision is reversible and tracked for a
 * future sharing-rollout decision (task 061).
 *
 * RESIDUAL REAL-DB 500 RISKS (AC12):
 * (a) Number(bigintString) / Drizzle mode:"number" can exceed
 *     Number.MAX_SAFE_INTEGER, which the contract's .safe() then correctly
 *     rejects → 500. No DB constraint or runtime guard prevents this.
 * (b) statement_reconciliations.period is unconstrained text (spines.ts:204-207)
 *     while the contract demands strict YYYY-MM, so malformed legacy data → 500.
 * These are recorded, not fixed, in this task.
 */
export async function revolvingDebtRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/credit/revolving-debt",
    { schema: { response: { 200: HouseholdRevolvingDebtSchema } } },
    async (req) => getHouseholdRevolvingDebt(app.db, req.session!.userId),
  );
}
