/**
 * modules/vehicles/ — odometer tracking, fuel-economy, and service-due
 * reminders for a `resources` row of kind "vehicle".
 *
 * Registered with { prefix: "/api/vehicles" } in app.ts.
 * Route paths within this module are relative to that prefix.
 */

import type { FastifyInstance } from "fastify";
import { vehicleRoutes } from "./routes/vehicles.ts";

export async function vehiclesRoutes(app: FastifyInstance): Promise<void> {
  await app.register(vehicleRoutes);
}
