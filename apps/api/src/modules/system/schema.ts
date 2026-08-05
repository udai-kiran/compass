/**
 * Thin, named re-export of the system domain's 6 tables + 2 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md): these tables carry outbound FKs into
 * core `users` (and, for some tables, into other domains), and physically
 * relocating the table definitions here would create a genuine cross-file
 * ES-module cycle with `db/schema.ts`. Table definitions stay in `db/schema.ts`,
 * unmoved, until task 1.9's cross-module FK-graph/SCC work decides a final,
 * acyclic home for each one.
 *
 * Services/routes inside `modules/system/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * system-owned tables) — this is the module-boundary discipline that matters:
 * it costs nothing today and means a future physical decomposition only has
 * to change this one file, not every service/route that already imports from
 * `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the system
 * tables' only home is still `db/schema.ts` itself, so the reverse direction
 * would just recreate a pointless cycle (same reasoning as every other
 * migrated module).
 *
 * Note: `users` is imported from `../../db/core-schema.ts` (the cycle-free
 * leaf) rather than through `../../db/schema.ts`, matching the same pattern
 * established by `db/schema.ts`'s own re-export of `users` from
 * `core-schema.ts`.
 */
export { users } from "../../db/core-schema.ts";
export {
  userProfiles,
  familyMembers,
  notifications,
  alertLedger,
  notificationPrefs,
  familyRelationship,
  educationStage,
} from "../../db/schema.ts";