/**
 * Checkout Recommendation loader (task 10.6).
 *
 * DB facade that assembles all inputs required by the pure `scoreCheckout`
 * function: basket arbitrage result, active card offers, reward rules, card
 * details + issuer settings.  Returns a `CheckoutRecommendation`.
 *
 * `currentOwedPaise` is set to 0 (conservative default) when no statement
 * data is available for an issuer — the utilisation guard then compares just
 * the proposed spend against the limit, which is the most permissive estimate
 * still consistent with the user's configured threshold.
 */

import { and, desc, eq, inArray } from "drizzle-orm";
import type { CheckoutRecommendation } from "@compass/shared";
import type { Db } from "../../../db/index.ts";
import {
  priceObservations,
  priceSources,
  serviceabilityChecks,
  shoppingListItems,
  shoppingLists,
} from "../schema.ts";
import { cardDetails, cardIssuerSettings } from "../../credit/schema.ts";
import { accounts } from "../../../db/shared/hubs.ts";
import { getActiveOffers } from "../../credit/services/card-offers.ts";
import { listRewardRules } from "../../credit/services/reward-rules.ts";
import { scoreCheckout, type CardInfo, type IssuerUtilization } from "./checkout-recommendation.ts";
import { optimizeBasket, MAX_SOURCES } from "./basket-arbitrage.ts";
import { HttpError } from "../../../lib/errors.ts";

/**
 * Load all inputs, run the basket arbitrage, and score checkout options.
 *
 * @param db      - Drizzle database handle
 * @param userId  - session user (all data is scoped to this user)
 * @param listId  - the shopping list to recommend for
 * @param _pincode - reserved for future serviceability filtering by pincode;
 *                  currently unused (serviceability excludes confirmed-false
 *                  sources regardless of pincode)
 */
export async function buildCheckoutRecommendation(
  db: Db,
  userId: string,
  listId: string,
  _pincode?: string,
): Promise<CheckoutRecommendation> {
  // 1. Verify list ownership.
  const list = await db.query.shoppingLists.findFirst({
    where: and(eq(shoppingLists.id, listId), eq(shoppingLists.userId, userId)),
    columns: { id: true },
  });
  if (!list) throw new HttpError(404, "Shopping list not found");

  // 2. Load all list items.
  const items = await db.query.shoppingListItems.findMany({
    where: eq(shoppingListItems.listId, listId),
  });

  // 3. Fetch active price sources for the user.
  const allSources = await db.query.priceSources.findMany({
    where: and(eq(priceSources.userId, userId), eq(priceSources.isActive, true)),
  });

  // 4. Exclude sources that are confirmed NOT serviceable for any pincode.
  //    Sources with null (unknown) or true records are kept.
  const notServiceableIds = new Set(
    (
      await db
        .select({ priceSourceId: serviceabilityChecks.priceSourceId })
        .from(serviceabilityChecks)
        .where(
          and(
            eq(serviceabilityChecks.userId, userId),
            eq(serviceabilityChecks.isServiceable, false),
          ),
        )
    ).map((r) => r.priceSourceId),
  );
  const serviceableSources = allSources.filter((s) => !notServiceableIds.has(s.id));

  if (serviceableSources.length > MAX_SOURCES) {
    throw new HttpError(
      400,
      `Too many active serviceable sources: ${serviceableSources.length}. Maximum is ${MAX_SOURCES}.`,
    );
  }

  const sourceInfos = serviceableSources.map((s) => ({
    sourceId: s.id,
    sourceName: s.name,
    deliveryFeePaise: s.deliveryFeePaise ?? 0,
    minCartPaise: s.minCartPaise ?? null,
  }));

  // 5. Build priceMap: most recent price per (catalogItemId × sourceId),
  //    propagated to list-item-level keys (`${listItemId}:${sourceId}`).
  const itemsWithCatalog = items.filter((i) => i.catalogItemId !== null);
  const catalogItemIds = [...new Set(itemsWithCatalog.map((i) => i.catalogItemId!))];
  const sourceIds = serviceableSources.map((s) => s.id);

  const priceMap = new Map<string, { pricePaise: number; observedAt: Date }>();
  if (catalogItemIds.length > 0 && sourceIds.length > 0) {
    const obsRows = await db
      .select({
        catalogItemId: priceObservations.catalogItemId,
        priceSourceId: priceObservations.priceSourceId,
        pricePaise: priceObservations.pricePaise,
        observedAt: priceObservations.observedAt,
      })
      .from(priceObservations)
      .where(
        and(
          eq(priceObservations.userId, userId),
          inArray(priceObservations.catalogItemId, catalogItemIds),
          inArray(priceObservations.priceSourceId, sourceIds),
        ),
      )
      .orderBy(desc(priceObservations.observedAt));

    const seen = new Set<string>();
    for (const obs of obsRows) {
      const pairKey = `${obs.catalogItemId}:${obs.priceSourceId}`;
      if (seen.has(pairKey)) continue;
      seen.add(pairKey);

      for (const item of itemsWithCatalog) {
        if (item.catalogItemId === obs.catalogItemId) {
          const mapKey = `${item.id}:${obs.priceSourceId}`;
          if (!priceMap.has(mapKey)) {
            priceMap.set(mapKey, { pricePaise: obs.pricePaise, observedAt: obs.observedAt });
          }
        }
      }
    }
  }

  // 6. Run basket arbitrage.
  const arbitrageResult = optimizeBasket(
    items.map((i) => i.id),
    sourceInfos,
    priceMap,
  );

  // 7. Load credit-card data in parallel.
  const [activeOffers, rewardRules, cardRows] = await Promise.all([
    getActiveOffers(db, userId),
    listRewardRules(db, userId),
    db
      .select({
        accountId: cardDetails.accountId,
        productName: cardDetails.productName,
        network: cardDetails.network,
        institution: accounts.institution,
      })
      .from(cardDetails)
      .innerJoin(accounts, eq(cardDetails.accountId, accounts.id))
      .where(eq(cardDetails.userId, userId)),
  ]);

  // 8. Load issuer settings and build utilisation map.
  const issuerSettingsRows = await db.query.cardIssuerSettings.findMany({
    where: eq(cardIssuerSettings.userId, userId),
  });

  const issuerUtilization = new Map<string, IssuerUtilization>();
  for (const setting of issuerSettingsRows) {
    issuerUtilization.set(setting.institution, {
      creditLimitPaise: setting.creditLimitPaise ?? null,
      currentOwedPaise: 0, // statement data unavailable at recommendation time
      utilizationAlertPct: setting.utilizationAlertPct ?? null,
    });
  }

  // 9. Build CardInfo list.
  const cards: CardInfo[] = cardRows.map((row) => ({
    accountId: row.accountId,
    institution: row.institution ?? null,
    productName: row.productName,
    network: row.network ?? null,
  }));

  // 10. Score and return.
  return scoreCheckout(arbitrageResult, activeOffers, rewardRules, cards, issuerUtilization);
}
