import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ProjectionSettingsSchema, UpdateProjectionSettingsSchema } from "@compass/shared";
import {
  getProjectionSettings,
  updateProjectionSettings,
} from "../services/projection-settings.ts";

export async function projectionSettingsRoutes(app: FastifyInstance) {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/api/projection-settings",
    { schema: { response: { 200: ProjectionSettingsSchema } } },
    async (req) => getProjectionSettings(app.db, req.session!.userId),
  );

  r.put(
    "/api/projection-settings",
    {
      schema: {
        body: UpdateProjectionSettingsSchema,
        response: { 200: ProjectionSettingsSchema },
      },
    },
    async (req) => updateProjectionSettings(app.db, req.session!.userId, req.body),
  );
}
