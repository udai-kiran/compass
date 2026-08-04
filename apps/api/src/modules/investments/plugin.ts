import type { FastifyInstance } from "fastify";
import { holdingRoutes } from "./routes/holdings.ts";
import { sipRoutes } from "./routes/sips.ts";
import { netWorthRoutes } from "./routes/networth.ts";
import { accountNpsRoutes } from "./routes/account-nps.ts";

/**
 * `modules/investments/` — third of 8 Phase-1 module migrations (task 1.3),
 * reusing task 1.1/1.2's `modules/<domain>/` template directly: `schema.ts`
 * (thin re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 4 investments route groups internally, replacing the 4
 * separate `app.register(...)` calls `app.ts` used to make directly. Same
 * URLs, same handler bodies — pure relocation, no behavioral change.
 * `account-nps` was previously registered interleaved with `retirementRoutes`
 * (a protection-domain route that stays flat) — see
 * `tasks/010-migrate-investments/TASK.md` Root Cause's Scope decision 1 for
 * why `account-nps` belongs here rather than with protection (task 1.4). This
 * collapses 4 registrations into one contiguous plugin call, which
 * legitimately restructures Fastify's raw `printRoutes()` tree (see
 * `route-table.snapshot.txt`'s regenerated diff) but does not change the
 * canonical (method, path) surface (`route-surface.snapshot.txt`).
 */
export async function investmentsRoutes(app: FastifyInstance): Promise<void> {
  await app.register(holdingRoutes);
  await app.register(sipRoutes);
  await app.register(netWorthRoutes);
  await app.register(accountNpsRoutes);
}
