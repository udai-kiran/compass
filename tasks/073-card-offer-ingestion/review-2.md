No AC violations found.

Checklist:

1. `apps/api/src/modules/credit/schema.ts`
   - `cardOffers` is defined with the required fields: `platform`, `issuer`, nullable `cardProductName`, `discountKind`, `discountRateBps`, nullable `maxCapPaise`, nullable `minSpendPaise`, `validFrom`, `validUntil`, `stackable`, `isReviewed`, nullable `sourceEmailId`, nullable `raw`.
   - Non-negative CHECKs exist for `discount_rate_bps`, `max_cap_paise`, and `min_spend_paise`.

2. `apps/api/src/modules/automation/schema.ts`
   - `offer_extract` is present in `aiEventKind`.

3. `packages/shared/src/schemas/ai-events.ts`
   - `offer_extract` is present in `AiEventKindSchema`.

4. `apps/api/src/modules/credit/services/card-offers.ts`
   - `getActiveOffers()` filters by `userId`, `isReviewed = true`, and `validUntil >= now`.

5. `apps/api/src/modules/system/services/backup.ts`
   - `ALL_TABLES` has `card_offers` immediately after `email_ingestions`.
   - `USER_TABLES` includes `card_offers: "user_id"` after `email_ingestions`.

6. `apps/api/src/modules/credit/schema.smoke.test.ts`
   - Counts/sets are updated to 9 credit table objects and 3 owned enum objects.

7. `apps/api/src/db/schema.decomposition.test.ts`
   - Credit resident set includes `cardOffers` and `cardOfferDiscountKind`.
   - Assertions are updated to `66` tables and `48` enums.
   - Minor stale text only: the comment/test title still says `65 tables + 47 enums`, but the executable assertions are correct.

8. `apps/api/drizzle/`
   - Migration exists: `apps/api/drizzle/0007_late_kulan_gath.sql`.
   - It includes `CREATE TYPE "public"."card_offer_discount_kind" ...`.
   - It includes `ALTER TYPE "public"."ai_event_kind" ADD VALUE 'offer_extract'`.
   - It creates `card_offers` with the expected nullable columns and non-negative CHECK constraints.

Tests were not run; this was a read-only implementation review using file inspection only.