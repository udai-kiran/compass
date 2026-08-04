import type { FastifyInstance } from "fastify";
import { cardRoutes } from "./routes/cards.ts";
import { emiRoutes } from "./routes/emis.ts";
import { bankDetailsRoutes } from "./routes/bank-details.ts";
import { overdraftDetailsRoutes } from "./routes/overdraft-details.ts";

/**
 * `modules/credit/` — second of 8 Phase-1 module migrations (task 1.2),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 4 credit route groups internally, replacing the 4 separate
 * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
 * handler bodies — pure relocation, no behavioral change. This collapses 4
 * registrations (2 of which were previously interleaved with
 * `retirementRoutes`/`accountNpsRoutes`, see `tasks/008-migrate-credit/TASK.md`
 * Root Cause) into one contiguous plugin call, which legitimately restructures
 * Fastify's raw `printRoutes()` tree (see `route-table.snapshot.txt`'s
 * regenerated diff) but does not change the canonical (method, path) surface
 * (`route-surface.snapshot.txt`).
 */
export async function creditRoutes(app: FastifyInstance): Promise<void> {
  await app.register(cardRoutes);
  await app.register(emiRoutes);
  await app.register(bankDetailsRoutes);
  await app.register(overdraftDetailsRoutes);
}
