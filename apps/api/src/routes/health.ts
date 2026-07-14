import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { HealthStatusSchema } from "@compass/shared";
import { getHealth } from "../services/health.ts";

export async function healthRoutes(app: FastifyInstance) {
  app.withTypeProvider<ZodTypeProvider>().get(
    "/health",
    {
      config: { public: true },
      schema: {
        response: { 200: HealthStatusSchema },
      },
    },
    async () => getHealth(app.pg, app.redis),
  );
}
