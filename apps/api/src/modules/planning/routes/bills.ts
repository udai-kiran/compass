import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { BillOccurrenceSchema, SubscriptionSuggestionSchema } from "@compass/shared";
import { dismissSubscription, suggestSubscriptions, upcomingBills } from "../services/bills.ts";

export async function billRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/bills/upcoming",
    {
      schema: {
        querystring: z.object({ days: z.coerce.number().int().min(7).max(120).default(60) }),
        response: { 200: z.array(BillOccurrenceSchema) },
      },
    },
    async (req) => upcomingBills(app.db, req.session!.userId, req.query.days),
  );

  r.get(
    "/api/subscriptions/suggestions",
    { schema: { response: { 200: z.array(SubscriptionSuggestionSchema) } } },
    async (req) => suggestSubscriptions(app.db, req.session!.userId),
  );

  r.post(
    "/api/subscriptions/dismiss",
    {
      schema: {
        body: z.object({ merchant: z.string().min(1) }),
        response: { 200: z.object({ ok: z.boolean() }) },
      },
    },
    async (req) => {
      await dismissSubscription(app.db, req.session!.userId, req.body.merchant);
      return { ok: true };
    },
  );
}
