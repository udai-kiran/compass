/**
 * capital-losses.ts — Routes for capital loss carry-forward CRUD + capital position (task 13.11).
 *
 * Routes (relative to /api/tax):
 *   GET    /capital-position         — net capital position after set-off
 *   GET    /capital-losses            — list carry-forward entries
 *   POST   /capital-losses            — create entry
 *   PATCH  /capital-losses/:id        — update entry
 *   DELETE /capital-losses/:id        — delete entry
 */

import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CapitalPositionSchema,
  GetCapitalPositionQuerySchema,
  CapitalLossEntrySchema,
  CreateCapitalLossEntrySchema,
  UpdateCapitalLossEntrySchema,
} from "@compass/shared";
import {
  getCapitalPosition,
  listCapitalLossEntries,
  createCapitalLossEntry,
  updateCapitalLossEntry,
  deleteCapitalLossEntry,
} from "../services/capital-losses.ts";

export async function capitalLossRoutes(app: FastifyInstance): Promise<void> {
  const a = app.withTypeProvider<ZodTypeProvider>();

  a.get(
    "/capital-position",
    {
      schema: {
        querystring: GetCapitalPositionQuerySchema,
        response: { 200: CapitalPositionSchema },
      },
    },
    async (req, reply) => {
      const pos = await getCapitalPosition(app.db, req.session!.userId, req.query.fy);
      return reply.send(pos);
    },
  );

  a.get(
    "/capital-losses",
    {
      schema: {
        response: { 200: z.array(CapitalLossEntrySchema) },
      },
    },
    async (req, reply) => {
      const entries = await listCapitalLossEntries(app.db, req.session!.userId);
      return reply.send(entries);
    },
  );

  a.post(
    "/capital-losses",
    {
      schema: {
        body: CreateCapitalLossEntrySchema,
        response: { 201: CapitalLossEntrySchema },
      },
    },
    async (req, reply) => {
      const entry = await createCapitalLossEntry(app.db, req.session!.userId, req.body);
      return reply.code(201).send(entry);
    },
  );

  a.patch(
    "/capital-losses/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        body: UpdateCapitalLossEntrySchema,
        response: { 200: CapitalLossEntrySchema },
      },
    },
    async (req, reply) => {
      const entry = await updateCapitalLossEntry(
        app.db,
        req.session!.userId,
        req.params.id,
        req.body,
      );
      return reply.send(entry);
    },
  );

  a.delete(
    "/capital-losses/:id",
    {
      schema: {
        params: z.object({ id: z.string().uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await deleteCapitalLossEntry(app.db, req.session!.userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
