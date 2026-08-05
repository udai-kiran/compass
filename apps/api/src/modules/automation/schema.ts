/**
 * Thin, named re-export of the automation domain's 2 tables + 3 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md and tasks/008-migrate-credit/TASK.md): these
 * 2 tables carry outbound FKs into core `users`, and physically relocating the
 * table definitions here would create a genuine cross-file ES-module cycle with
 * `db/schema.ts`. Table definitions stay in `db/schema.ts`, unmoved, until task
 * 1.9's cross-module FK-graph/SCC work decides a final, acyclic home for each
 * one.
 *
 * Services/routes inside `modules/automation/` import table objects from this
 * local file (never reaching into `../../../db/schema.ts` directly for
 * automation-owned tables) — this is the module-boundary discipline that
 * matters: it costs nothing today and means a future physical decomposition
 * only has to change this one file, not every service/route that already
 * imports from `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the automation
 * tables' only home is still `db/schema.ts` itself, so the reverse direction
 * would just recreate a pointless cycle (same reasoning as the ledger module).
 */
export {
  aiSettings,
  aiEvents,
  aiProvider,
  aiEventKind,
  aiEventStatus,
} from "../../db/schema.ts";
