import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateSettlementSchema, SettlementSchema } from "@compass/shared";
import type { Settlement } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { householdMembers, settlements } from "../schema.ts";
import { and, eq } from "drizzle-orm";
import { HttpError } from "../../../lib/errors.ts";
import { createSettlement, listSettlements } from "../services/settlements.ts";

const IdParams = z.object({ id: z.uuid() });

async function assertMember(db: Db, userId: string, householdId: string): Promise<void> {
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  if (rows.length === 0) throw new HttpError(403, "Not a member of this household");
}

function toSettlement(row: typeof settlements.$inferSelect): Settlement {
  return {
    id: row.id,
    householdId: row.householdId,
    fromPersonId: row.fromPersonId,
    toPersonId: row.toPersonId,
    amountPaise: row.amountPaise,
    transferTransactionId: row.transferTransactionId ?? null,
    note: row.note ?? null,
    createdAt: row.createdAt,
  };
}

export async function settlementRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/households/:id/settlements",
    { schema: { params: IdParams, body: CreateSettlementSchema, response: { 201: SettlementSchema } } },
    async (req, reply) => {
      await assertMember(app.db, req.session!.userId, req.params.id);
      const row = await createSettlement(app.db, req.session!.userId, {
        householdId: req.params.id,
        fromPersonId: req.body.fromPersonId,
        toPersonId: req.body.toPersonId,
        amountPaise: req.body.amountPaise,
        note: req.body.note,
      });
      return reply.code(201).send(toSettlement(row));
    },
  );

  r.get(
    "/api/households/:id/settlements",
    { schema: { params: IdParams, response: { 200: z.array(SettlementSchema) } } },
    async (req) => {
      await assertMember(app.db, req.session!.userId, req.params.id);
      const rows = await listSettlements(app.db, req.session!.userId, req.params.id);
      return rows.map(toSettlement);
    },
  );
}
