/**
 * Thin, named re-export of the planning domain's 6 tables + 2 owned enums.
 *
 * This is deliberately NOT where the `pgTable()`/`pgEnum()` calls live —
 * planning is now uniform with the other four modules (ledger, credit,
 * investments, protection). `goals.id` has inbound FKs from `accounts`,
 * `holdings` and `sips`; `budget_lines`/`budget_alerts` have outbound FKs
 * to `categories`. Physically relocating the table definitions here would
 * create a genuine cross-file ES-module cycle with `db/schema.ts`. Table
 * definitions stay in `db/schema.ts`, unmoved, until task 1.9's cross-module
 * FK-graph/SCC work decides a final, acyclic home for each one.
 *
 * Services/routes inside `modules/planning/` import table objects from this
 * local file (never reaching into `../../db/schema.ts` directly for
 * planning-owned tables) — this is the module-boundary discipline that matters:
 * it costs nothing today and means a future physical decomposition only has
 * to change this one file, not every service/route that already imports from
 * `./schema.ts`.
 *
 * `db/schema.ts` does NOT `export *` back from this file — the planning tables'
 * only home is still `db/schema.ts` itself, so the reverse direction would
 * just recreate a pointless cycle (same reasoning as the other four modules).
 */
export {
  budgets,
  budgetLines,
  budgetAlerts,
  goals,
  subscriptionDismissals,
  projectionSettings,
  budgetPeriod,
  goalType,
} from "../../db/schema.ts";
