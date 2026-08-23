/**
 * income-events.ts — Income event ledger routes (task 13.4).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   GET    /income-events              → GET    /api/tax/income-events    (list)
 *   POST   /income-events             → POST   /api/tax/income-events    (create manual)
 *   GET    /income-events/summary     → GET    /api/tax/income-events/summary  (FY summary)
 *   GET    /income-events/:id         → GET    /api/tax/income-events/:id
 *   POST   /income-events/:id/accept  → POST   /api/tax/income-events/:id/accept
 *   POST   /income-events/:id/reject  → POST   /api/tax/income-events/:id/reject
 *   POST   /income-events/derive/payslip/:payslipId
 *   POST   /income-events/derive/holding-event/:eventId
 *
 * Static routes are registered before parameterized routes so Fastify resolves
 * /income-events/summary before /income-events/:id.
 *
 * Session-authenticated. Demo sessions are automatically rejected on all
 * mutating methods by the single chokepoint in `plugins/auth.ts`.
 *
 * FY is NEVER accepted from the client for create/derive — always server-computed.
 * PAN/TAN are normalized (trim + toUpperCase) by the Zod schema before storage.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  IncomeEventSchema,
  IncomeEventSummarySchema,
  CreateIncomeEventBodySchema,
  AcceptIncomeEventBodySchema,
  GetIncomeEventsQuerySchema,
  GetIncomeEventsSummaryQuerySchema,
} from "@compass/shared";
import {
  createIncomeEvent,
  listIncomeEvents,
  getIncomeEvent,
  acceptIncomeEvent,
  rejectIncomeEvent,
  getSummary,
  deriveFromPayslip,
  deriveFromHoldingEvent,
} from "../services/income-events.ts";

const IncomeEventParams = z.object({ id: z.uuid() });
const PayslipDeriveParams = z.object({ payslipId: z.uuid() });
const HoldingEventDeriveParams = z.object({ eventId: z.uuid() });

export async function incomeEventRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /income-events — List income events for the authenticated user.
   * Supports optional filtering by fy, status, incomeKind.
   */
  r.get(
    "/income-events",
    {
      schema: {
        querystring: GetIncomeEventsQuerySchema,
        response: { 200: z.array(IncomeEventSchema) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return listIncomeEvents(req.server.db, userId, req.query);
    },
  );

  /**
   * GET /income-events/summary — FY income summary.
   *
   * Aggregates only accepted rows for monetary totals.
   * Pending rows → pendingCount only. Rejected rows → excluded.
   * isEstimate is always true.
   * All 5 income kinds are present in byKind (zero if none).
   *
   * Registered before /:id to prevent the param route from capturing "summary".
   */
  r.get(
    "/income-events/summary",
    {
      schema: {
        querystring: GetIncomeEventsSummaryQuerySchema,
        response: { 200: IncomeEventSummarySchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return getSummary(req.server.db, userId, req.query.fy);
    },
  );

  /**
   * GET /income-events/:id — Get a single income event.
   */
  r.get(
    "/income-events/:id",
    {
      schema: {
        params: IncomeEventParams,
        response: { 200: IncomeEventSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return getIncomeEvent(req.server.db, userId, req.params.id);
    },
  );

  /**
   * POST /income-events — Create a manual income event.
   *
   * FY is always server-computed from accrualDate (never accepted from client).
   * sourceKind is forced to 'manual' (and sourceId to NULL) by the service, so a
   * client cannot claim payslip / holding_event / ais provenance here.
   * accrualDate is rejected with a 400 unless it is a real calendar date.
   */
  r.post(
    "/income-events",
    {
      schema: {
        body: CreateIncomeEventBodySchema,
        response: { 201: IncomeEventSchema },
      },
    },
    async (req, reply) => {
      const userId = req.session!.userId;
      const event = await createIncomeEvent(req.server.db, userId, req.body);
      return reply.code(201).send(event);
    },
  );

  /**
   * POST /income-events/:id/accept — Accept a pending income event.
   *
   * Optional corrections to payer_name, payer_pan, payer_tan, notes are applied
   * atomically with the status transition. Pre-accept state stored in original_values.
   * Returns 409 if already accepted/rejected.
   *
   * Registered as POST (static segment) before /:id so Fastify does not confuse
   * /:id/accept with a plain /:id route.
   */
  r.post(
    "/income-events/:id/accept",
    {
      schema: {
        params: IncomeEventParams,
        body: AcceptIncomeEventBodySchema,
        response: { 200: IncomeEventSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return acceptIncomeEvent(req.server.db, userId, req.params.id, req.body);
    },
  );

  /**
   * POST /income-events/:id/reject — Reject a pending income event.
   * Returns 409 if already accepted/rejected.
   */
  r.post(
    "/income-events/:id/reject",
    {
      schema: {
        params: IncomeEventParams,
        response: { 200: IncomeEventSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return rejectIncomeEvent(req.server.db, userId, req.params.id);
    },
  );

  /**
   * POST /income-events/derive/payslip/:payslipId — Derive from an accepted payslip.
   *
   * Idempotent: calling this twice for the same payslip returns the existing row.
   * accrualDate = lastDayOfMonth(payslip.payMonth).
   * FY = fyOf(accrualDate) — always server-computed.
   * Requires: payslip is accepted and has a non-null grossPaise.
   *
   * Registered after /:id/accept and /:id/reject: the first dynamic segment after
   * /income-events/ is "derive" (static), which is distinct from ":id" (param) —
   * Fastify's specificity rules prevent any conflict regardless of registration order.
   */
  r.post(
    "/income-events/derive/payslip/:payslipId",
    {
      schema: {
        params: PayslipDeriveParams,
        response: { 200: IncomeEventSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return deriveFromPayslip(req.server.db, userId, req.params.payslipId);
    },
  );

  /**
   * POST /income-events/derive/holding-event/:eventId — Derive from a dividend holding event.
   *
   * Rejects non-dividend events with HTTP 400.
   * Verifies ownership via holdingEvents → holdings.userId = userId.
   * Idempotent: calling twice returns the existing row.
   */
  r.post(
    "/income-events/derive/holding-event/:eventId",
    {
      schema: {
        params: HoldingEventDeriveParams,
        response: { 200: IncomeEventSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      // The service always throws (HttpError 400/404/500) or returns a non-null
      // IncomeEvent. An `if (!event)` fallback here would be unreachable.
      return deriveFromHoldingEvent(req.server.db, userId, req.params.eventId);
    },
  );
}
