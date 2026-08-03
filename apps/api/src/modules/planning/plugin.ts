import type { FastifyInstance } from "fastify";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";

/**
 * `modules/<domain>/` convention (introduced by task 0.3, the first slice of
 * the planning module task 1.5 will complete): `schema.ts` (Drizzle tables),
 * `services/` (business logic + db access), `routes/` (thin Fastify handlers
 * validated with `@compass/shared` Zod schemas), `plugin.ts` (this file — the
 * single Fastify plugin entry `app.ts` registers for the whole module).
 *
 * Today this only wires up `projection_settings`. Task 1.5 registers the rest
 * of the planning module here (budgets, goals, cashflow, bills, dashboard,
 * insights, reports).
 */
export async function planningRoutes(app: FastifyInstance): Promise<void> {
  await app.register(projectionSettingsRoutes);
}
