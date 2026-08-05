/**
 * Thin, named re-export of the ledger domain's 11 tables + 7 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — see
 * Root Cause in tasks/007-migrate-ledger/TASK.md for why: ledger has 4
 * outbound FKs to still-flat tables (goals, insurance_policies, sips,
 * statement_reconciliations) and 23 inbound FK columns from still-flat tables
 * into these 11, so physically relocating the table definitions here would
 * create a genuine bidirectional ES-module cycle with `db/schema.ts`. Table
 * definitions stay in `db/schema.ts`, unmoved, until task 1.9's cross-module
 * FK-graph/SCC work decides a final, acyclic home for each one.
 *
 * Services/routes inside `modules/ledger/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * ledger-owned tables) — this is the module-boundary discipline that matters:
 * it costs nothing today and means a future physical decomposition only has
 * to change this one file, not every service/route that already imports from
 * `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the ledger tables'
 * only home is still `db/schema.ts` itself, so the reverse direction would
 * just recreate a pointless cycle (same reasoning as all five modules).
 */
export {
  accounts,
  categories,
  resources,
  transactions,
  transactionSplits,
  transferLinks,
  transactionLinks,
  merchantRules,
  recurringTemplates,
  userTasks,
  attachments,
  accountType,
  categoryKind,
  expenseNecessity,
  transactionSource,
  resourceKind,
  recurringFrequency,
  recurringKind,
} from "../../db/schema.ts";
