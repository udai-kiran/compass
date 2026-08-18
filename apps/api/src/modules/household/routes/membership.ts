import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { AcceptInviteSchema, HouseholdInviteSchema, HouseholdMemberSchema, HouseholdSchema } from "@compass/shared";
import { acceptInvite, createInvite, leaveHousehold, listMembers, removeMember } from "../services/membership.ts";

const IdParams = z.object({ id: z.uuid() });
const MemberParams = z.object({ id: z.uuid(), memberId: z.uuid() });

export async function membershipRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  // Must be registered before GET /api/households/:id to avoid route ordering issues
  r.post(
    "/api/households/invites/accept",
    { schema: { body: AcceptInviteSchema, response: { 200: HouseholdSchema } } },
    async (req) => acceptInvite(app.db, req.session!.userId, req.body.token),
  );

  r.post(
    "/api/households/:id/invite",
    { schema: { params: IdParams, response: { 201: HouseholdInviteSchema } } },
    async (req, reply) => reply.code(201).send(await createInvite(app.db, req.session!.userId, req.params.id)),
  );

  r.get(
    "/api/households/:id/members",
    { schema: { params: IdParams, response: { 200: z.array(HouseholdMemberSchema) } } },
    async (req) => listMembers(app.db, req.session!.userId, req.params.id),
  );

  r.post(
    "/api/households/:id/leave",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => { await leaveHousehold(app.db, req.session!.userId, req.params.id); return { ok: true }; },
  );

  r.delete(
    "/api/households/:id/members/:memberId",
    { schema: { params: MemberParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => { await removeMember(app.db, req.session!.userId, req.params.id, req.params.memberId); return { ok: true }; },
  );
}
