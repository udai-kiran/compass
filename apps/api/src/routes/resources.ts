import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CreateResourceSchema,
  ResourceSchema,
  UpdateResourceSchema,
} from "@compass/shared";
import {
  createResource,
  deleteResource,
  listResources,
  updateResource,
} from "../services/resources.ts";

const Params = z.object({ id: z.uuid() });

export async function resourceRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/resources",
    { schema: { response: { 200: z.array(ResourceSchema) } } },
    (req) => listResources(app.db, req.session!.userId),
  );
  r.post(
    "/api/resources",
    { schema: { body: CreateResourceSchema, response: { 200: ResourceSchema } } },
    (req) => createResource(app.db, req.session!.userId, req.body),
  );
  r.patch(
    "/api/resources/:id",
    {
      schema: {
        params: Params,
        body: UpdateResourceSchema,
        response: { 200: ResourceSchema },
      },
    },
    (req) => updateResource(app.db, req.session!.userId, req.params.id, req.body),
  );
  r.delete(
    "/api/resources/:id",
    {
      schema: {
        params: Params,
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await deleteResource(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
