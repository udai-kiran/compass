import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { MerchantRuleSchema, RenameMerchantSchema } from "@compass/shared";
import { and, eq } from "drizzle-orm";
import { merchantRules } from "../schema.ts";
import { HttpError } from "../../../lib/errors.ts";
import { renameMerchant } from "../services/merchants.ts";

const IdParams = z.object({ id: z.uuid() });

/** Merchant-name normalization rules. (Categorization is manual / AI-assisted, not rule-based.) */
export async function ruleRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/merchant-rules",
    { schema: { response: { 200: z.array(MerchantRuleSchema) } } },
    async (req) =>
      app.db.query.merchantRules.findMany({
        where: eq(merchantRules.userId, req.session!.userId),
        orderBy: (m, { asc }) => [asc(m.match)],
      }),
  );

  r.delete(
    "/api/merchant-rules/:id",
    { schema: { params: IdParams, response: { 200: z.object({ ok: z.boolean() }) } } },
    async (req) => {
      const rows = await app.db
        .delete(merchantRules)
        .where(
          and(eq(merchantRules.id, req.params.id), eq(merchantRules.userId, req.session!.userId)),
        )
        .returning({ id: merchantRules.id });
      if (rows.length === 0) throw new HttpError(404, "Rule not found");
      return { ok: true };
    },
  );

  r.post(
    "/api/merchants/rename",
    {
      schema: { body: RenameMerchantSchema, response: { 200: z.object({ updated: z.number().int() }) } },
    },
    async (req) => renameMerchant(app.db, req.session!.userId, req.body),
  );
}
