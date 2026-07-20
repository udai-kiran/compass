import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  CardDetailsSchema,
  CardSummarySchema,
  CreateRewardEntrySchema,
  RewardEntrySchema,
  UpsertCardDetailsSchema,
} from "@compass/shared";
import {
  addRewardEntry,
  deleteRewardEntry,
  listCards,
  listRewards,
  setCardStatementPassword,
  upsertCardDetails,
} from "../services/cards.ts";
import { mailboxSecret } from "../services/mailboxes.ts";

const AccountParams = z.object({ accountId: z.uuid() });
const RewardParams = z.object({ accountId: z.uuid(), id: z.uuid() });

export async function cardRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/cards",
    { schema: { response: { 200: z.array(CardSummarySchema) } } },
    async (req) => listCards(app.db, req.session!.userId),
  );

  r.put(
    "/api/cards/:accountId/details",
    {
      schema: {
        params: AccountParams,
        body: UpsertCardDetailsSchema,
        response: { 200: CardDetailsSchema },
      },
    },
    async (req) =>
      upsertCardDetails(
        app.db,
        req.session!.userId,
        req.params.accountId,
        req.body,
        mailboxSecret(app.config),
      ),
  );

  r.put(
    "/api/cards/:accountId/statement-password",
    {
      schema: {
        params: AccountParams,
        body: z.object({ password: z.string().max(200) }),
        response: { 200: z.object({ hasStatementPassword: z.boolean() }) },
      },
    },
    async (req) =>
      setCardStatementPassword(
        app.db,
        req.session!.userId,
        req.params.accountId,
        req.body.password,
        mailboxSecret(app.config),
      ),
  );

  r.get(
    "/api/cards/:accountId/rewards",
    { schema: { params: AccountParams, response: { 200: z.array(RewardEntrySchema) } } },
    async (req) => listRewards(app.db, req.session!.userId, req.params.accountId),
  );

  r.post(
    "/api/cards/:accountId/rewards",
    {
      schema: {
        params: AccountParams,
        body: CreateRewardEntrySchema,
        response: { 201: RewardEntrySchema },
      },
    },
    async (req, reply) =>
      reply
        .code(201)
        .send(await addRewardEntry(app.db, req.session!.userId, req.params.accountId, req.body)),
  );

  r.delete(
    "/api/cards/:accountId/rewards/:id",
    { schema: { params: RewardParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteRewardEntry(app.db, req.session!.userId, req.params.accountId, req.params.id);
      return { ok: true };
    },
  );
}
