import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CardOfferSchema, CreateCardOfferSchema } from "@compass/shared";
import {
  listOffers,
  createOffer,
  reviewOffer,
  deleteOffer,
} from "../services/card-offers.ts";

/**
 * Card offers CRUD routes. Full /api/credit/card-offers paths (credit module
 * is not prefix-mounted — routes register with complete paths, same pattern as
 * revolvingDebtRoutes and other credit routes).
 *
 * - GET    /api/credit/card-offers          list (optionally include expired)
 * - POST   /api/credit/card-offers          create (isReviewed=false)
 * - PATCH  /api/credit/card-offers/:id/review  mark reviewed
 * - DELETE /api/credit/card-offers/:id      remove
 */
export async function cardOfferRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/credit/card-offers",
    {
      schema: {
        querystring: z.object({
          includeExpired: z.coerce.boolean().default(false),
        }),
        response: { 200: z.array(CardOfferSchema) },
      },
    },
    async (req) => {
      const { includeExpired } = req.query;
      return listOffers(app.db, req.session!.userId, { includeExpired });
    },
  );

  r.post(
    "/api/credit/card-offers",
    {
      schema: {
        body: CreateCardOfferSchema,
        response: { 201: CardOfferSchema },
      },
    },
    async (req, reply) => {
      const offer = await createOffer(app.db, req.session!.userId, req.body);
      return reply.code(201).send(offer);
    },
  );

  r.patch(
    "/api/credit/card-offers/:id/review",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 200: CardOfferSchema },
      },
    },
    async (req) => {
      return reviewOffer(app.db, req.session!.userId, req.params.id);
    },
  );

  r.delete(
    "/api/credit/card-offers/:id",
    {
      schema: {
        params: z.object({ id: z.uuid() }),
        response: { 204: z.void() },
      },
    },
    async (req, reply) => {
      await deleteOffer(app.db, req.session!.userId, req.params.id);
      return reply.code(204).send();
    },
  );
}
