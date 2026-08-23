/**
 * epf-contributions.ts — EPF passbook reconciliation routes (task 13.5).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   GET  /epf-contributions             → GET  /api/tax/epf-contributions  (list)
 *   GET  /epf-contributions/gaps        → GET  /api/tax/epf-contributions/gaps
 *   GET  /epf-contributions/projection  → GET  /api/tax/epf-contributions/projection
 *   POST /epf-contributions             → POST /api/tax/epf-contributions  (manual entry)
 *   POST /epf-contributions/import-from-payslip/:payslipId
 *   POST /epf-contributions/:id/confirm-actual
 *
 * Static routes are registered before parameterized ones so Fastify resolves
 * /epf-contributions/gaps and /epf-contributions/projection before /:id/...
 *
 * NOTE: this is the TAX-domain reconciliation surface. It is distinct from the
 * ledger module's own EPF contribution flow (POST /api/epf-contributions) —
 * that module is untouched.
 *
 * Session-authenticated. Demo sessions are automatically rejected on all
 * mutating methods by the single chokepoint in `plugins/auth.ts`.
 *
 * epfoMemberId is REQUIRED on both create paths — a payslip never embeds it,
 * and it is part of the row identity (user_id, wage_month, epfo_member_id).
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  EpfContributionSchema,
  EpfGapResultSchema,
  EpfCorpusProjectionSchema,
  CreateEpfContributionBodySchema,
  ImportFromPayslipBodySchema,
  ConfirmActualBodySchema,
  GetEpfContributionsQuerySchema,
  GetEpfGapsQuerySchema,
  GetEpfProjectionQuerySchema,
} from "@compass/shared";
import {
  createManual,
  importFromPayslip,
  confirmActual,
  listContributions,
  getGaps,
  getProjection,
} from "../services/epf-contributions.ts";

const EpfContributionParams = z.object({ id: z.uuid() });
const ImportPayslipParams = z.object({ payslipId: z.uuid() });

export async function epfContributionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /epf-contributions — List EPF contribution rows for the user.
   * Optional filter: wageMonth (exact) or fy (April→March wage-month range).
   * wageMonth wins when both are supplied.
   */
  r.get(
    "/epf-contributions",
    {
      schema: {
        querystring: GetEpfContributionsQuerySchema,
        response: { 200: z.array(EpfContributionSchema) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return listContributions(req.server.db, userId, req.query);
    },
  );

  /**
   * GET /epf-contributions/gaps — Rows with expected values but no confirmed actuals.
   *
   * Read-only: status 'gap' is never persisted by this endpoint.
   * Registered before /:id-style routes.
   */
  r.get(
    "/epf-contributions/gaps",
    {
      schema: {
        querystring: GetEpfGapsQuerySchema,
        response: { 200: z.array(EpfGapResultSchema) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return getGaps(req.server.db, userId, req.query.fy);
    },
  );

  /**
   * GET /epf-contributions/projection — Compound-interest EPF corpus projection.
   *
   * Always an estimate: isEstimate=true, no future contributions assumed,
   * 8.25% p.a. (assumedAnnualRateBps=825, rateSource='last_known_official').
   */
  r.get(
    "/epf-contributions/projection",
    {
      schema: {
        querystring: GetEpfProjectionQuerySchema,
        response: { 200: EpfCorpusProjectionSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return getProjection(
        req.server.db,
        userId,
        req.query.accountId,
        req.query.retirementAge,
      );
    },
  );

  /**
   * POST /epf-contributions — Manual EPF contribution entry.
   *
   * Upserts on (user_id, wage_month, epfo_member_id): re-posting the same
   * month/member replaces the expected_* values and leaves actual_* intact.
   */
  r.post(
    "/epf-contributions",
    {
      schema: {
        body: CreateEpfContributionBodySchema,
        response: { 201: EpfContributionSchema },
      },
    },
    async (req, reply) => {
      const userId = req.session!.userId;
      const row = await createManual(req.server.db, userId, req.body);
      return reply.code(201).send(row);
    },
  );

  /**
   * POST /epf-contributions/import-from-payslip/:payslipId — Derive expected_*
   * from an accepted payslip's canonical components.
   *
   * Body { epfoMemberId } is REQUIRED (422 from Zod validation if absent).
   * Idempotent by payslip_id: a second call returns the existing row.
   * Re-import over an existing (month, member) row preserves actual_*.
   *
   * employer_epf = credited to PF corpus (AFTER EPS diversion);
   * eps = diverted to the pension fund. Never double-counted.
   */
  r.post(
    "/epf-contributions/import-from-payslip/:payslipId",
    {
      schema: {
        params: ImportPayslipParams,
        body: ImportFromPayslipBodySchema,
        response: { 200: EpfContributionSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return importFromPayslip(
        req.server.db,
        userId,
        req.params.payslipId,
        req.body.epfoMemberId,
      );
    },
  );

  /**
   * POST /epf-contributions/:id/confirm-actual — Record EPFO passbook actuals.
   *
   * reconciliationStatus is computed by computeStatus() and persisted in the
   * same UPDATE: 'matched' within 1% tolerance, otherwise 'mismatch'.
   */
  r.post(
    "/epf-contributions/:id/confirm-actual",
    {
      schema: {
        params: EpfContributionParams,
        body: ConfirmActualBodySchema,
        response: { 200: EpfContributionSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return confirmActual(req.server.db, userId, req.params.id, req.body);
    },
  );
}
