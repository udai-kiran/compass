import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateSharingGrantSchema, SharingGrantSchema, SharingResourceTypeSchema } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { householdMembers } from "../schema.ts";
import { and, eq } from "drizzle-orm";
import { HttpError } from "../../../lib/errors.ts";
import { createGrant, listGrants, revokeGrant } from "../services/grants.ts";

const IdParams = z.object({ id: z.uuid() });
const GrantsQuery = z.object({
  resourceType: SharingResourceTypeSchema.optional(),
  resourceId: z.uuid().optional(),
});

async function assertMember(db: Db, userId: string, householdId: string): Promise<void> {
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  if (rows.length === 0) throw new HttpError(403, "Not a member of this household");
}

export async function sharingRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/sharing-grants",
    { schema: { body: CreateSharingGrantSchema, response: { 201: SharingGrantSchema } } },
    async (req, reply) => {
      await assertMember(app.db, req.session!.userId, req.body.householdId);
      // Verify grantee is also a member of this household
      // Note: resource ownership verification (that the caller owns the resourceId) is deferred to a future phase
      const granteeRows = await app.db
        .select({ id: householdMembers.id })
        .from(householdMembers)
        .where(and(
          eq(householdMembers.householdId, req.body.householdId),
          eq(householdMembers.userId, req.body.grantedToUserId),
        ));
      if (granteeRows.length === 0) {
        throw new HttpError(400, "Grantee is not a member of this household");
      }
      return reply.code(201).send(await createGrant(app.db, req.session!.userId, req.body));
    },
  );

  r.get(
    "/api/sharing-grants",
    { schema: { querystring: GrantsQuery, response: { 200: z.array(SharingGrantSchema) } } },
    async (req) => listGrants(app.db, req.session!.userId, req.query),
  );

  r.delete(
    "/api/sharing-grants/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => { await revokeGrant(app.db, req.session!.userId, req.params.id); return { ok: true }; },
  );
}
