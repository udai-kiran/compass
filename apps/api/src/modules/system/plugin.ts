import type { FastifyInstance } from "fastify";
import { healthRoutes } from "./routes/health.ts";
import { authRoutes } from "./routes/auth.ts";
import { notificationRoutes } from "./routes/notifications.ts";
import { backupRoutes } from "./routes/backup.ts";
import { profileRoutes } from "./routes/profile.ts";

/**
 * `modules/system/` — eighth of 8 Phase-1 module migrations (task 1.8),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 5 system route groups internally (health, auth, notifications,
 * backup, profile), in the same relative order they registered in `app.ts`
 * before this migration, replacing the 5 separate `app.register(...)` calls
 * `app.ts` used to make directly. Same URLs, same handler bodies — pure
 * relocation, no behavioral change. `notificationRoutes`/`backupRoutes`/
 * `profileRoutes` used to register much later (after `ingestRoutes`),
 * interleaved with other flat registrations — see
 * `tasks/018-migrate-system/TASK.md` Root Cause — so collapsing all 5 into
 * one contiguous plugin call, in the position `healthRoutes` used to occupy,
 * legitimately restructures Fastify's raw `printRoutes()` tree (see
 * `route-table.snapshot.txt`'s regenerated diff) but does not change the
 * canonical (method, path) surface (`route-surface.snapshot.txt`).
 */
export async function systemRoutes(app: FastifyInstance): Promise<void> {
  await app.register(healthRoutes);
  await app.register(authRoutes);
  await app.register(notificationRoutes);
  await app.register(backupRoutes);
  await app.register(profileRoutes);
}