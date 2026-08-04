import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import {
  NetWorthBackfillRequestSchema,
  NetWorthBackfillResultSchema,
  NetWorthByGoalSchema,
  NetWorthReportSchema,
} from "@compass/shared";
import { backfillSnapshots, getNetWorthReport, repairSnapshots } from "../services/networth.ts";
import { netWorthByGoal } from "../services/goal-networth.ts";

export async function netWorthRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/net-worth",
    { schema: { response: { 200: NetWorthReportSchema } } },
    async (req) => getNetWorthReport(app.db, req.session!.userId),
  );

  r.get(
    "/api/net-worth/by-goal",
    { schema: { response: { 200: NetWorthByGoalSchema } } },
    async (req) => netWorthByGoal(app.db, req.session!.userId),
  );

  // Two operations behind one endpoint, chosen by whether `from` is given:
  //
  //  - no `from` — estimate month-end history that is entirely absent
  //    (`backfillSnapshots`, which never overwrites a day that already has a row);
  //  - with `from` — recompute days that exist but went stale, which is what an
  //    import backdated past the nightly sweep's window leaves behind.
  //
  // `from` is optional so a caller posting only `{ months }` is unaffected, and
  // `repair` is null on that path so the response mirrors the request.
  r.post(
    "/api/net-worth/backfill",
    {
      schema: {
        body: NetWorthBackfillRequestSchema,
        response: { 200: NetWorthBackfillResultSchema },
      },
    },
    async (req) => {
      const userId = req.session!.userId;
      const repair =
        req.body.from === undefined
          ? null
          : await repairSnapshots(app.db, app.redis, userId, req.body.from);
      if (repair === null) await backfillSnapshots(app.db, userId, req.body.months);
      return { ...(await getNetWorthReport(app.db, userId)), repair };
    },
  );
}
