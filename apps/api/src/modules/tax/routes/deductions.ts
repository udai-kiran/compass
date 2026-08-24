/**
 * deductions.ts — Deduction basket + manual entry CRUD routes (task 13.7).
 *
 * Registered under the /api/tax prefix; paths here are RELATIVE:
 *   GET    /deductions                 → GET    /api/tax/deductions          (basket)
 *   GET    /deductions/entries         → GET    /api/tax/deductions/entries   (list)
 *   POST   /deductions/entries         → POST   /api/tax/deductions/entries   (create)
 *   PUT    /deductions/entries/:id     → PUT    /api/tax/deductions/entries/:id (update)
 *   DELETE /deductions/entries/:id     → DELETE /api/tax/deductions/entries/:id (delete)
 *
 * Static routes are registered before parameterized ones (Fastify resolution order).
 *
 * Session-authenticated. Demo sessions are automatically rejected on all
 * mutating methods by the single chokepoint in `plugins/auth.ts`.
 */

import { z } from "zod";
import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  DeductionEntrySchema,
  DeductionBasketSchema,
  CreateDeductionEntrySchema,
  UpdateDeductionEntrySchema,
  GetDeductionBasketQuerySchema,
  GetDeductionEntriesQuerySchema,
} from "@compass/shared";
import {
  listDeductionEntries,
  createDeductionEntry,
  updateDeductionEntry,
  deleteDeductionEntry,
  getDeductionBasket,
} from "../services/deductions.ts";

const DeductionEntryParams = z.object({ id: z.uuid() });

export async function deductionRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  /**
   * GET /deductions — Compute and return the full deduction basket for a FY.
   *
   * Read-only. Expensive: aggregates multiple tables. Caller should cache.
   */
  r.get(
    "/deductions",
    {
      schema: {
        querystring: GetDeductionBasketQuerySchema,
        response: { 200: DeductionBasketSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return getDeductionBasket(req.server.db, userId, req.query.fy);
    },
  );

  /**
   * GET /deductions/entries — List manual deduction entries for a FY.
   * Static path registered before /:id to ensure correct resolution order.
   */
  r.get(
    "/deductions/entries",
    {
      schema: {
        querystring: GetDeductionEntriesQuerySchema,
        response: { 200: z.array(DeductionEntrySchema) },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return listDeductionEntries(req.server.db, userId, req.query.fy);
    },
  );

  /**
   * POST /deductions/entries — Create a manual deduction entry.
   *
   * Zod superRefine + DB check constraints enforce section/kind/group compatibility.
   * Returns 201 with the created entry.
   */
  r.post(
    "/deductions/entries",
    {
      schema: {
        body: CreateDeductionEntrySchema,
        response: { 201: DeductionEntrySchema },
      },
    },
    async (req, reply) => {
      const userId = req.session!.userId;
      const entry = await createDeductionEntry(req.server.db, userId, req.body);
      return reply.code(201).send(entry);
    },
  );

  /**
   * PUT /deductions/entries/:id — Update an existing manual deduction entry.
   *
   * section, deductionKind, and fy are immutable after creation.
   * Only amountPaise, description, employerType, salaryBasePaise, and
   * eightyDGroup may be updated. Unset fields are unchanged.
   * DB check constraints backstop cross-field validity.
   * Returns 404 if not found or not owned by the caller.
   */
  r.put(
    "/deductions/entries/:id",
    {
      schema: {
        params: DeductionEntryParams,
        body: UpdateDeductionEntrySchema,
        response: { 200: DeductionEntrySchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      return updateDeductionEntry(req.server.db, userId, req.params.id, req.body);
    },
  );

  /**
   * DELETE /deductions/entries/:id — Delete a manual deduction entry.
   *
   * Returns 204 (no body) on success.
   * Returns 404 if not found or not owned by the caller.
   */
  r.delete(
    "/deductions/entries/:id",
    {
      schema: {
        params: DeductionEntryParams,
        response: { 204: z.undefined() },
      },
    },
    async (req, reply) => {
      const userId = req.session!.userId;
      await deleteDeductionEntry(req.server.db, userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
