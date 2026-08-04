/**
 * Thin, named re-export of the investments domain's 8 tables + 10 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md and tasks/010-migrate-investments/TASK.md):
 * these 8 tables carry 5 outbound FK columns to still-flat tables
 * (`holdings.goalId`, `accountNpsDetails.accountId`, `sips.goalId`,
 * `sips.sourceAccountId`, `sips.targetAccountId`) and 1 inbound FK from a
 * still-flat table (`transactions.sipId → sips.id`) — physically relocating
 * the table definitions here would create a genuine cross-file ES-module
 * cycle with `db/schema.ts`. Table definitions stay in `db/schema.ts`,
 * unmoved, until task 1.9's cross-module FK-graph/SCC work decides a final,
 * acyclic home for each one.
 *
 * Services/routes inside `modules/investments/` import table objects from
 * this local file (never reaching into `../../db/schema.ts` directly for
 * investments-owned tables) — this is the module-boundary discipline that
 * matters: it costs nothing today and means a future physical decomposition
 * only has to change this one file, not every service/route that already
 * imports from `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the investments
 * tables' only home is still `db/schema.ts` itself, so the reverse direction
 * would just recreate a pointless cycle (same reasoning as the ledger/credit
 * modules).
 */
export {
  holdings,
  accountNpsDetails,
  npsDetails,
  goldDetails,
  holdingValuations,
  holdingEvents,
  sips,
  netWorthSnapshots,
  assetClass,
  gainsTaxClass,
  npsTier,
  goldForm,
  holdingEventType,
  holdingEventSource,
  sipTargetKind,
  sipStatus,
  sipFundingSource,
  sipFrequency,
} from "../../db/schema.ts";
