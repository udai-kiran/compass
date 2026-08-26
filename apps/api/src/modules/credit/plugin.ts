import type { FastifyInstance } from "fastify";
import { cardRoutes } from "./routes/cards.ts";
import { emiRoutes } from "./routes/emis.ts";
import { bankDetailsRoutes } from "./routes/bank-details.ts";
import { overdraftDetailsRoutes } from "./routes/overdraft-details.ts";
import { revolvingDebtRoutes } from "./routes/revolving-debt.ts";
import { cardOfferRoutes } from "./routes/card-offers.ts";
import { rewardRuleRoutes } from "./routes/reward-rules.ts";
import { rewardLotRoutes } from "./routes/reward-lots.ts";
import { prepayVsInvestRoutes } from "./routes/prepay-vs-invest.ts";

/**
 * `modules/credit/` — second of 8 Phase-1 module migrations (task 1.2),
 * reusing task 1.1's `modules/<domain>/` template directly: `schema.ts` (thin
 * re-export — see schema.ts's own comment), `services/`, `routes/`,
 * `plugin.ts` (this file).
 *
 * Registers all 5 credit route groups internally. The first 4 replace the
 * `app.register(...)` calls `app.ts` used to make directly (pure relocation,
 * same URLs, same handler bodies). The 5th — `revolvingDebtRoutes` — is a new
 * addition (task 059) that adds one new URL path:
 *   GET /api/credit/revolving-debt
 * This path was not previously in `app.ts`. This collapses 5 registrations
 * (2 of which were previously interleaved with `retirementRoutes`/
 * `accountNpsRoutes`, see `tasks/008-migrate-credit/TASK.md` Root Cause) into
 * one contiguous plugin call, which legitimately restructures Fastify's raw
 * `printRoutes()` tree (see `route-table.snapshot.txt`'s regenerated diff)
 * and extends the canonical (method, path) surface with the 1 new route above
 * (reflected in `route-surface.snapshot.txt`).
 */
export async function creditRoutes(app: FastifyInstance): Promise<void> {
  await app.register(cardRoutes);
  await app.register(emiRoutes);
  await app.register(bankDetailsRoutes);
  await app.register(overdraftDetailsRoutes);
  await app.register(revolvingDebtRoutes);
  await app.register(cardOfferRoutes);
  await app.register(rewardRuleRoutes);
  await app.register(rewardLotRoutes);
  await app.register(prepayVsInvestRoutes);
}
