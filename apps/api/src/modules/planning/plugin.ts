import type { FastifyInstance } from "fastify";
import { budgetRoutes } from "./routes/budgets.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { goalRoutes } from "./routes/goals.ts";
import { cashflowRoutes } from "./routes/cashflow.ts";
import { billRoutes } from "./routes/bills.ts";
import { insightRoutes } from "./routes/insights.ts";
import { reportRoutes } from "./routes/reports.ts";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";

/**
 * `modules/planning/` — fifth of 8 Phase-1 module migrations (task 1.5),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 8 planning route groups internally, replacing the 8 separate
 * `app.register(...)` calls `app.ts` used to make directly. Same URLs, same
 * handler bodies — pure relocation, no behavioral change. This collapses 8
 * registrations (most of which were previously interleaved with
 * `notificationRoutes`/`investmentsRoutes`/`creditRoutes`/`protectionRoutes`)
 * into one contiguous plugin call, which legitimately restructures Fastify's
 * raw `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated
 * diff) but does not change the canonical (method, path) surface
 * (`route-surface.snapshot.txt`). Order below preserves the relative
 * registration order the route groups had in `app.ts`: budgets, dashboard,
 * goals, cashflow, bills, insights, reports, projection-settings.
 */
export async function planningRoutes(app: FastifyInstance): Promise<void> {
  await app.register(budgetRoutes);
  await app.register(dashboardRoutes);
  await app.register(goalRoutes);
  await app.register(cashflowRoutes);
  await app.register(billRoutes);
  await app.register(insightRoutes);
  await app.register(reportRoutes);
  await app.register(projectionSettingsRoutes);
}
