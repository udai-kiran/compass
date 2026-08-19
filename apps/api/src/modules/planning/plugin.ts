import type { FastifyInstance } from "fastify";
import { budgetRoutes } from "./routes/budgets.ts";
import { dashboardRoutes } from "./routes/dashboard.ts";
import { goalRoutes } from "./routes/goals.ts";
import { cashflowRoutes } from "./routes/cashflow.ts";
import { billRoutes } from "./routes/bills.ts";
import { insightRoutes } from "./routes/insights.ts";
import { reportRoutes } from "./routes/reports.ts";
import { projectionSettingsRoutes } from "./routes/projection-settings.ts";
import { planningAnalysisRoutes } from "./routes/planning-analysis.ts";
import { goalAnalysisRoutes } from "./routes/goal-analysis.ts";
import { roadmapNarrativeRoutes } from "./routes/roadmap-narrative.ts";

/**
 * `modules/planning/` — fifth of 8 Phase-1 module migrations (task 1.5),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 9 planning route groups internally. The first 8 replace the
 * `app.register(...)` calls `app.ts` used to make directly (pure relocation,
 * same URLs, same handler bodies). The 9th — `planningAnalysisRoutes` — is a
 * new addition (task 059) that adds two new URL paths:
 *   GET /api/planning/income-surplus
 *   GET /api/planning/data-completeness
 * These were not previously in `app.ts`. This collapses 9 registrations into
 * one contiguous plugin call, which legitimately restructures Fastify's raw
 * `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated diff)
 * and extends the canonical (method, path) surface with the 2 new routes
 * above (reflected in `route-surface.snapshot.txt`). Order below preserves
 * the relative registration order the route groups had in `app.ts`: budgets,
 * dashboard, goals, cashflow, bills, insights, reports, projection-settings,
 * planning-analysis.
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
  await app.register(planningAnalysisRoutes);
  await app.register(goalAnalysisRoutes);
  await app.register(roadmapNarrativeRoutes);
}
