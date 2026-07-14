import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import {
  AccountSchema,
  AccountWithBalanceSchema,
  CreateAccountSchema,
  UpdateAccountSchema,
} from "@compass/shared";
import {
  createAccount,
  deleteAccount,
  listAccounts,
  updateAccount,
} from "../services/accounts.ts";

const IdParams = z.object({ id: z.uuid() });

export async function accountRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/accounts",
    { schema: { response: { 200: z.array(AccountWithBalanceSchema) } } },
    async (req) => listAccounts(app.db, req.session!.userId),
  );

  r.post(
    "/api/accounts",
    { schema: { body: CreateAccountSchema, response: { 201: AccountSchema } } },
    async (req, reply) =>
      reply.code(201).send(await createAccount(app.db, req.session!.userId, req.body)),
  );

  r.patch(
    "/api/accounts/:id",
    { schema: { params: IdParams, body: UpdateAccountSchema, response: { 200: AccountSchema } } },
    async (req) => updateAccount(app.db, req.session!.userId, req.params.id, req.body),
  );

  r.delete(
    "/api/accounts/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      await deleteAccount(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );
}
