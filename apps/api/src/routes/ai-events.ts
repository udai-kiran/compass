import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AiEventDetailSchema,
  AiEventPageSchema,
  ListAiEventsQuerySchema,
} from "@compass/shared";
import { getAiEvent, listAiEvents } from "../services/ai/events.ts";

const IdParams = z.object({ id: z.uuid() });

/** Read-only AI event log: every model call's context + response, per user. */
export async function aiEventRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/ai-events",
    { schema: { querystring: ListAiEventsQuerySchema, response: { 200: AiEventPageSchema } } },
    async (req) => listAiEvents(app.db, req.session!.userId, req.query),
  );

  r.get(
    "/api/ai-events/:id",
    { schema: { params: IdParams, response: { 200: AiEventDetailSchema } } },
    async (req) => getAiEvent(app.db, req.session!.userId, req.params.id),
  );
}
