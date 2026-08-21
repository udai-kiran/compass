import type { FastifyInstance } from "fastify";
import { shoppingUnitRoutes } from "./routes/units.ts";

/**
 * `modules/shopping/` — Shopping Intelligence pillar (task 9.1). The first
 * domain built natively on the Phase-1 module pattern rather than migrated
 * onto it.
 *
 * This is the first module registered with a Fastify `prefix` (`/api/shopping`)
 * at the `app.ts` registration site — every pre-existing route module hardcodes
 * its full `/api/...` path inside its route files. Because the prefix is applied
 * at the `app.ts` registration site (not here), route files in this module
 * declare paths relative to it (e.g. `/units` resolves to `GET /api/shopping/units`).
 */
export async function shoppingRoutes(app: FastifyInstance): Promise<void> {
  await app.register(shoppingUnitRoutes);
}
