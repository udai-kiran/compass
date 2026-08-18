import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateHouseholdSchema, HouseholdSchema, UpdateHouseholdSchema } from "@compass/shared";
import { createHousehold, deleteHousehold, getHousehold, listHouseholds, updateHousehold } from "../services/households.ts";

const IdParams = z.object({ id: z.uuid() });

export async function householdCrudRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/households",
    { schema: { response: { 200: z.array(HouseholdSchema) } } },
    async (req) => listHouseholds(app.db, req.session!.userId),
  );

  r.post(
    "/api/households",
    { schema: { body: CreateHouseholdSchema, response: { 201: HouseholdSchema } } },
    async (req, reply) => reply.code(201).send(await createHousehold(app.db, req.session!.userId, req.body)),
  );

  r.get(
    "/api/households/:id",
    { schema: { params: IdParams, response: { 200: HouseholdSchema } } },
    async (req) => getHousehold(app.db, req.session!.userId, req.params.id),
  );

  r.patch(
    "/api/households/:id",
    { schema: { params: IdParams, body: UpdateHouseholdSchema, response: { 200: HouseholdSchema } } },
    async (req) => updateHousehold(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/households/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => { await deleteHousehold(app.db, req.session!.userId, req.params.id); return { ok: true }; },
  );
}
