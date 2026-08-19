import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { CreateHouseholdSplitSchema, HouseholdBalancesSchema, HouseholdSplitSchema, UpdateHouseholdSplitSchema } from "@compass/shared";
import type { HouseholdSplit } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import { householdMembers, splits, splitShares } from "../schema.ts";
import { transactions } from "../../../db/shared/ledger.ts";
import { and, eq } from "drizzle-orm";
import { HttpError } from "../../../lib/errors.ts";
import { createSplit, deleteSplit, getSplit, updateSplit } from "../services/splits.ts";
import { getHouseholdBalances } from "../services/settlements.ts";

const TxIdParams = z.object({ txId: z.uuid() });
const IdParams = z.object({ id: z.uuid() });
const HouseholdIdParams = z.object({ id: z.uuid() });

async function assertMember(db: Db, userId: string, householdId: string): Promise<void> {
  const rows = await db
    .select({ id: householdMembers.id })
    .from(householdMembers)
    .where(and(eq(householdMembers.householdId, householdId), eq(householdMembers.userId, userId)));
  if (rows.length === 0) throw new HttpError(403, "Not a member of this household");
}

function toSplitResponse(
  split: typeof splits.$inferSelect,
  shares: (typeof splitShares.$inferSelect)[],
): HouseholdSplit {
  return {
    id: split.id,
    transactionId: split.transactionId,
    householdId: split.householdId,
    rule: split.rule,
    payerPersonId: split.payerPersonId,
    createdByUserId: split.createdByUserId,
    createdAt: split.createdAt,
    updatedAt: split.updatedAt,
    shares: shares.map((s) => ({
      id: s.id,
      splitId: s.splitId,
      personId: s.personId,
      sharePaise: s.sharePaise,
      createdAt: s.createdAt,
    })),
  };
}

export async function splitRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.post(
    "/api/transactions/:txId/split",
    { schema: { params: TxIdParams, body: CreateHouseholdSplitSchema, response: { 201: HouseholdSplitSchema } } },
    async (req, reply) => {
      await assertMember(app.db, req.session!.userId, req.body.householdId);
      // Verify transaction ownership
      const [txRow] = await app.db
        .select({ userId: transactions.userId })
        .from(transactions)
        .where(eq(transactions.id, req.params.txId));
      if (!txRow) throw new HttpError(404, "Transaction not found");
      if (txRow.userId !== req.session!.userId) throw new HttpError(403, "Not your transaction");
      const split = await createSplit(app.db, req.session!.userId, {
        transactionId: req.params.txId,
        householdId: req.body.householdId,
        rule: req.body.rule,
        totalPaise: req.body.totalPaise,
        payerPersonId: req.body.payerPersonId,
        memberPersonIds: req.body.memberPersonIds,
        sharePaise: req.body.sharePaise,
        ratios: req.body.ratios,
      });
      const { shares } = await getSplit(app.db, req.session!.userId, split.id);
      return reply.code(201).send(toSplitResponse(split, shares));
    },
  );

  r.get(
    "/api/splits/:id",
    { schema: { params: IdParams, response: { 200: HouseholdSplitSchema } } },
    async (req) => {
      const { split, shares } = await getSplit(app.db, req.session!.userId, req.params.id);
      await assertMember(app.db, req.session!.userId, split.householdId);
      return toSplitResponse(split, shares);
    },
  );

  r.patch(
    "/api/splits/:id",
    { schema: { params: IdParams, body: UpdateHouseholdSplitSchema, response: { 200: HouseholdSplitSchema } } },
    async (req) => {
      // Load first to get householdId for membership check
      const { split: existing } = await getSplit(app.db, req.session!.userId, req.params.id);
      await assertMember(app.db, req.session!.userId, existing.householdId);
      const { split, shares } = await updateSplit(app.db, req.session!.userId, req.params.id, req.body);
      return toSplitResponse(split, shares);
    },
  );

  r.delete(
    "/api/splits/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      const { split } = await getSplit(app.db, req.session!.userId, req.params.id);
      await assertMember(app.db, req.session!.userId, split.householdId);
      await deleteSplit(app.db, req.session!.userId, req.params.id);
      return { ok: true };
    },
  );

  r.get(
    "/api/households/:id/balances",
    { schema: { params: HouseholdIdParams, response: { 200: HouseholdBalancesSchema } } },
    async (req) => {
      await assertMember(app.db, req.session!.userId, req.params.id);
      return getHouseholdBalances(app.db, req.session!.userId, req.params.id);
    },
  );
}
