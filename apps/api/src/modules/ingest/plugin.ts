import type { FastifyInstance } from "fastify";
import { importRoutes } from "./routes/imports.ts";
import { inboxRoutes } from "./routes/inbox.ts";
import { mailboxRoutes } from "./routes/mailboxes.ts";

/**
 * `modules/ingest/` — seventh of 8 Phase-1 module migrations (task 1.7),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 3 ingest route groups internally (imports, inbox, mailboxes),
 * in the same relative order they registered in `app.ts` before this
 * migration, replacing the 3 separate `app.register(...)` calls `app.ts`
 * used to make directly. Same URLs, same handler bodies — pure relocation,
 * no behavioral change. `inboxRoutes`/`mailboxRoutes` used to register much
 * later (after `profileRoutes`), interleaved with other flat registrations —
 * see `tasks/017-migrate-ingest/TASK.md` Root Cause — so collapsing all 3
 * into one contiguous plugin call, in the position `importRoutes` used to
 * occupy, legitimately restructures Fastify's raw `printRoutes()` tree (see
 * `route-table.snapshot.txt`'s regenerated diff) but does not change the
 * canonical (method, path) surface (`route-surface.snapshot.txt`).
 */
export async function ingestRoutes(app: FastifyInstance): Promise<void> {
  await app.register(importRoutes);
  await app.register(inboxRoutes);
  await app.register(mailboxRoutes);
}
