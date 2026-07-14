import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateHoldingEventSchema,
  CreateHoldingSchema,
  HoldingEventSchema,
  HoldingSchema,
  PortfolioSchema,
  SetValuationSchema,
  UpdateHoldingSchema,
} from "@compass/shared";
import {
  addEvent,
  createHolding,
  deleteEvent,
  deleteHolding,
  getPortfolio,
  setValuation,
  updateHolding,
} from "../services/holdings.ts";

const IdParams = z.object({ id: z.uuid() });
const EventParams = z.object({ id: z.uuid(), eventId: z.uuid() });

export async function holdingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/portfolio",
    { schema: { response: { 200: PortfolioSchema } } },
    async (req) => getPortfolio(app.db, req.session!.userId),
  );

  r.post(
    "/api/holdings",
    { schema: { body: CreateHoldingSchema, response: { 201: HoldingSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createHolding(app.db, req.session!.userId, req.body)),
  );

  r.patch(
    "/api/holdings/:id",
    { schema: { params: IdParams, body: UpdateHoldingSchema, response: { 200: HoldingSchema } } },
    async (req) => updateHolding(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/holdings/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteHolding(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.put(
    "/api/holdings/:id/valuation",
    { schema: { params: IdParams, body: SetValuationSchema, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await setValuation(app.db, req.session!.userId, req.params.id, req.body);
      return { ok: true };
    },
  );

  r.post(
    "/api/holdings/:id/events",
    { schema: { params: IdParams, body: CreateHoldingEventSchema, response: { 201: HoldingEventSchema } } },
    async (req, reply) =>
      reply.code(201).send(await addEvent(app.db, req.session!.userId, req.params.id, req.body)),
  );

  r.delete(
    "/api/holdings/:id/events/:eventId",
    { schema: { params: EventParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteEvent(app.db, req.session!.userId, req.params.id, req.params.eventId);
      return { ok: true };
    },
  );
}
