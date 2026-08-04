import type { FastifyInstance } from "fastify";
import { retirementRoutes } from "./routes/retirement.ts";
import { insuranceRoutes } from "./routes/insurance.ts";

/**
 * `modules/protection/` — fourth of 8 Phase-1 module migrations (task 1.4),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers both protection route groups internally, replacing the 2 separate
 * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
 * handler bodies — pure relocation, no behavioral change. This collapses 2
 * registrations (which were already adjacent and in order in `app.ts`) into
 * one contiguous plugin call, so it does not restructure Fastify's raw
 * `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated diff,
 * expected empty) and does not change the canonical (method, path) surface
 * (`route-surface.snapshot.txt`).
 */
export async function protectionRoutes(app: FastifyInstance): Promise<void> {
  await app.register(retirementRoutes);
  await app.register(insuranceRoutes);
}