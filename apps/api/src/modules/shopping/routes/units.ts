import type { FastifyInstance } from "fastify";
import type { ZodTypeProvider } from "fastify-type-provider-zod";
import { ShoppingUnitsResponseSchema } from "@compass/shared";
import { NORMALIZED_UNITS } from "../services/units.ts";

/**
 * Publishes the normalized-unit vocabulary. Registered under the module's
 * `/api/shopping` prefix, so the URL is `GET /api/shopping/units`.
 *
 * Authenticated like every other route — `plugins/auth.ts` rejects a session-less
 * request unless the route opts out with `config: { public: true }`, which this
 * one deliberately does not.
 */
export async function shoppingUnitRoutes(app: FastifyInstance): Promise<void> {
  const r = app.withTypeProvider<ZodTypeProvider>();

  r.get(
    "/units",
    { schema: { response: { 200: ShoppingUnitsResponseSchema } } },
    async () => ({ units: [...NORMALIZED_UNITS] }),
  );
}
