import type { FastifyInstance } from "fastify";
import { aiRoutes } from "./routes/ai.ts";
import { aiEventRoutes } from "./routes/ai-events.ts";

/**
 * `modules/automation/` — sixth of 8 Phase-1 module migrations (task 1.6),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers both AI route groups internally, replacing the 2 separate
 * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
 * handler bodies — pure relocation, no behavioral change. Unlike the earlier
 * migrations (which interleaved registrations and therefore legitimately
 * restructured Fastify's raw `printRoutes()` tree), the two AI registrations
 * (`aiRoutes`/`aiEventRoutes`) were already adjacent and already in order, so
 * wrapping them in this plugin does NOT change the raw `printRoutes()` tree —
 * `route-table.snapshot.txt` stays byte-identical.
 */
export async function automationRoutes(app: FastifyInstance): Promise<void> {
  await app.register(aiRoutes);
  await app.register(aiEventRoutes);
}
