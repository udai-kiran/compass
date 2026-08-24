/**
 * modules/tax/ — Tax data, regime preference, payslip, income-event and EPF
 * reconciliation module (tasks 13.1, 13.2, 13.4, 13.5).
 *
 * Registered with { prefix: "/api/tax" } in app.ts.
 * Route paths within this module are relative to that prefix.
 */

import type { FastifyInstance } from "fastify";
import { regimePreferenceRoutes } from "./routes/regime-preference.ts";
import { payslipRoutes } from "./routes/payslips.ts";
import { incomeEventRoutes } from "./routes/income-events.ts";
import { epfContributionRoutes } from "./routes/epf-contributions.ts";
import { schemeComplianceRoutes } from "./routes/scheme-compliance.ts";
import { deductionRoutes } from "./routes/deductions.ts";

export async function taxRoutes(app: FastifyInstance): Promise<void> {
  await app.register(regimePreferenceRoutes);
  await app.register(payslipRoutes);
  await app.register(incomeEventRoutes);
  await app.register(epfContributionRoutes);
  await app.register(schemeComplianceRoutes);
  await app.register(deductionRoutes);
}
