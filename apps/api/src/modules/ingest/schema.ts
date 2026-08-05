/**
 * Thin, named re-export of the ingest domain's 7 tables + 8 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md): these tables carry outbound FKs into
 * core `users` (and, for `extracted_transactions`, into ledger's `accounts`/
 * `categories`/`transactions`), and physically relocating the table
 * definitions here would create a genuine cross-file ES-module cycle with
 * `db/schema.ts`. Table definitions stay in `db/schema.ts`, unmoved, until
 * task 1.9's cross-module FK-graph/SCC work decides a final, acyclic home for
 * each one.
 *
 * Services/routes inside `modules/ingest/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * ingest-owned tables) — this is the module-boundary discipline that matters:
 * it costs nothing today and means a future physical decomposition only has
 * to change this one file, not every service/route that already imports from
 * `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the ingest
 * tables' only home is still `db/schema.ts` itself, so the reverse direction
 * would just recreate a pointless cycle (same reasoning as every other
 * migrated module).
 */
export {
  importStatus,
  imports,
  importRows,
  importPresets,
  mailboxProvider,
  mailboxStatus,
  mailboxAccounts,
  mailboxCredentials,
  emailClass,
  emailIngestStatus,
  emailIngestions,
  extractedTxnStatus,
  txnDirection,
  extractedTxnIntent,
  extractedTransactions,
} from "../../db/schema.ts";
