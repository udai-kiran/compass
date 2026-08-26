import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ContinuityDossierSchema } from "@compass/shared";
import { getContinuityDossier } from "../services/dossier.ts";

export async function dossierRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/protection/dossier",
    { schema: { response: { 200: ContinuityDossierSchema } } },
    async (req) => getContinuityDossier(app.db, req.session!.userId),
  );
}
