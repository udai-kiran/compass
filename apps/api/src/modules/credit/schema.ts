/**
 * Thin, named re-export of the credit domain's 8 tables + 2 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md and tasks/008-migrate-credit/TASK.md): these
 * 8 tables carry 7 outbound FKs into ledger-owned `accounts`/`recurring_templates`
 * and 8 outbound FKs into core `users`, plus 2 outbound FKs into the still-flat
 * ingest module's `email_ingestions` — physically relocating the table
 * definitions here would create a genuine cross-file ES-module cycle with
 * `db/schema.ts`. Table definitions stay in `db/schema.ts`, unmoved, until task
 * 1.9's cross-module FK-graph/SCC work decides a final, acyclic home for each
 * one.
 *
 * Services/routes inside `modules/credit/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * credit-owned tables) — this is the module-boundary discipline that matters:
 * it costs nothing today and means a future physical decomposition only has
 * to change this one file, not every service/route that already imports from
 * `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the credit tables'
 * only home is still `db/schema.ts` itself, so the reverse direction would
 * just recreate a pointless cycle (same reasoning as the ledger module).
 */
export {
  cardDetails,
  cardIssuerSettings,
  cardStatements,
  bankDetails,
  overdraftDetails,
  rewardEntries,
  statementReconciliations,
  emiDetails,
  cardNetwork,
  bankAccountSubtype,
} from "../../db/schema.ts";
