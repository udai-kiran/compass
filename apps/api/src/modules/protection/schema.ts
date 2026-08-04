/**
 * Thin, named re-export of the protection domain's 3 tables + 4 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live — same
 * deferral task 1.1 established for the ledger module (see Root Cause in
 * tasks/007-migrate-ledger/TASK.md and tasks/008-migrate-credit/TASK.md): these
 * 3 tables carry outbound FKs into ledger-owned `resources`/`accounts` and
 * core `users`, plus an inbound FK from ledger's `transactions.policyId` —
 * physically relocating the table definitions here would create a genuine
 * cross-file ES-module cycle with `db/schema.ts`. Table definitions stay in
 * `db/schema.ts`, unmoved, until task 1.9's cross-module FK-graph/SCC work
 * decides a final, acyclic home for each one.
 *
 * Services/routes inside `modules/protection/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * protection-owned tables) — this is the module-boundary discipline that
 * matters: it costs nothing today and means a future physical decomposition
 * only has to change this one file, not every service/route that already
 * imports from `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the protection
 * tables' only home is still `db/schema.ts` itself, so the reverse direction
 * would just recreate a pointless cycle (same reasoning as the ledger module).
 */
export {
  retirementDetails,
  insuranceKind,
  vehicleKind,
  healthType,
  premiumFrequency,
  insurancePolicies,
  insuranceHealthCards,
} from "../../db/schema.ts";