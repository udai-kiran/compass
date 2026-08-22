import type { FastifyInstance } from "fastify";
import { shoppingUnitRoutes } from "./routes/units.ts";
import { shoppingListRoutes } from "./routes/lists.ts";
import { shoppingCatalogRoutes } from "./routes/catalog.ts";
import { shoppingCaptureRoutes } from "./routes/capture.ts";
import { shoppingCaptureImageRoutes } from "./routes/capture-image.ts";
import { shoppingPriceSourceRoutes } from "./routes/price-sources.ts";
import { shoppingPriceObservationRoutes } from "./routes/price-observations.ts";
import { shoppingServiceabilityRoutes } from "./routes/serviceability.ts";
import { shoppingArbitrageRoutes } from "./routes/arbitrage.ts";
import { shoppingPriceHistoryRoutes } from "./routes/price-history.ts";
import { checkoutRecommendationRoutes } from "./routes/checkout-recommendation.ts";
import { shoppingPantryRoutes } from "./routes/pantry.ts";
import { shoppingHabitProfileRoutes } from "./routes/habit-profiles.ts";
import { financialGuardRoutes } from "./routes/financial-guards.ts";
import { shoppingCartDraftRoutes } from "./routes/cart-drafts.ts";

/**
 * `modules/shopping/` — Shopping Intelligence pillar (task 9.1). The first
 * domain built natively on the Phase-1 module pattern rather than migrated
 * onto it.
 *
 * This is the first module registered with a Fastify `prefix` (`/api/shopping`)
 * at the `app.ts` registration site — every pre-existing route module hardcodes
 * its full `/api/...` path inside its route files. Because the prefix is applied
 * at the `app.ts` registration site (not here), route files in this module
 * declare paths relative to it (e.g. `/units` resolves to `GET /api/shopping/units`).
 */
export async function shoppingRoutes(app: FastifyInstance): Promise<void> {
  await app.register(shoppingUnitRoutes);
  await app.register(shoppingListRoutes);
  await app.register(shoppingCatalogRoutes);
  await app.register(shoppingCaptureRoutes);
  await app.register(shoppingCaptureImageRoutes);
  await app.register(shoppingPriceSourceRoutes);
  await app.register(shoppingPriceObservationRoutes);
  await app.register(shoppingServiceabilityRoutes);
  await app.register(shoppingPriceHistoryRoutes);
  await app.register(shoppingArbitrageRoutes);
  await app.register(checkoutRecommendationRoutes);
  await app.register(shoppingPantryRoutes);
  await app.register(shoppingHabitProfileRoutes);
  await app.register(financialGuardRoutes);
  await app.register(shoppingCartDraftRoutes);
}
