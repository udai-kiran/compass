/**
 * Platform seed registry (task 10.1).
 *
 * `ensurePlatformSeeds` inserts 11 well-known Indian shopping platforms into
 * `price_sources` for the given user, using ON CONFLICT DO NOTHING so it is
 * fully idempotent and never overwrites user edits. It is called from the
 * GET /sources handler on every request (cheap thanks to the index).
 *
 * ADAPTER INTERFACE NOTE: Future live-scraping adapters should implement:
 *   interface PriceAdapter {
 *     fetch(catalogItemId: string, sourceId: string): Promise<PriceObservation | null>
 *   }
 * and be registered as disabled-by-default compose profiles (like apps/ingestor).
 * Core never ships a scraper.
 */

import type { Db } from "../../../db/index.ts";
import { priceSources } from "../schema.ts";

type SeedEntry = {
  name: string;
  kind: "quick_commerce" | "ecommerce" | "local_store" | "manual";
  url: string | null;
};

const PLATFORM_SEEDS: SeedEntry[] = [
  { name: "Blinkit", kind: "quick_commerce", url: "https://blinkit.com" },
  { name: "Swiggy Instamart", kind: "quick_commerce", url: "https://www.swiggy.com/instamart" },
  { name: "Zepto", kind: "quick_commerce", url: "https://www.zeptonow.com" },
  { name: "BigBasket", kind: "ecommerce", url: "https://www.bigbasket.com" },
  { name: "JioMart", kind: "ecommerce", url: "https://www.jiomart.com" },
  { name: "DMart", kind: "ecommerce", url: "https://www.dmart.in" },
  { name: "Flipkart", kind: "ecommerce", url: "https://www.flipkart.com" },
  { name: "Amazon", kind: "ecommerce", url: "https://www.amazon.in" },
  { name: "DealShare", kind: "ecommerce", url: "https://dealshare.in" },
  { name: "MilkBasket", kind: "quick_commerce", url: "https://www.milkbasket.com" },
  { name: "Local Kirana", kind: "local_store", url: null },
];

/**
 * Idempotently insert 11 platform seeds for `userId`.
 * ON CONFLICT (user_id, name) DO NOTHING — never overwrites user edits.
 */
export async function ensurePlatformSeeds(db: Db, userId: string): Promise<void> {
  await db
    .insert(priceSources)
    .values(PLATFORM_SEEDS.map((s) => ({ ...s, userId })))
    .onConflictDoNothing();
}
