/**
 * modules/tax/ — Tax data and regime preference module (task 13.1).
 *
 * Registered with { prefix: "/api/tax" } in app.ts.
 * Route paths within this module are relative to that prefix.
 */

import type { FastifyInstance } from "fastify";
import { regimePreferenceRoutes } from "./routes/regime-preference.ts";

export async function taxRoutes(app: FastifyInstance): Promise<void> {
  await app.register(regimePreferenceRoutes);
}
