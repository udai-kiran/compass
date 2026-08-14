import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { findInconsistentPostings } from "../services/reconcile-postings.ts";

export async function integrityRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();
  r.get(
    "/api/ledger/integrity",
    {
      schema: {
        response: {
          200: z.object({
            ok: z.boolean(),
            problems: z.array(
              z.object({
                userId: z.string(),
                transactionId: z.string(),
                reason: z.string(),
              }),
            ),
          }),
        },
      },
    },
    async (req) => {
      const problems = await findInconsistentPostings(app.db, req.session!.userId);
      return { ok: problems.length === 0, problems };
    },
  );
}
