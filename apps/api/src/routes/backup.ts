import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { z } from "zod";
import { createEncryptedBackup, exportUserData, transactionsCsv } from "../services/backup.ts";

export async function backupRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get("/api/export.json", async (req, reply) => {
    const data = await exportUserData(app.db, req.session!.userId);
    return reply
      .header("content-type", "application/json")
      .header("content-disposition", `attachment; filename="compass-export.json"`)
      .send(JSON.stringify(data, null, 2));
  });

  r.get("/api/export/transactions.csv", async (req, reply) => {
    const csv = await transactionsCsv(app.db, req.session!.userId);
    return reply
      .header("content-type", "text/csv; charset=utf-8")
      .header("content-disposition", `attachment; filename="compass-transactions.csv"`)
      .send(csv);
  });

  // manual trigger for a full encrypted backup (also runs weekly on a schedule)
  r.post(
    "/api/backup/run",
    { schema: { response: { 200: z.object({ path: z.string(), bytes: z.number().int() }) } } },
    async () => createEncryptedBackup(app.db, app.config),
  );
}
