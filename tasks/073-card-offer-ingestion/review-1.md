**Findings**

1. **`card_offers` should probably live in the credit module, not shopping.**
   The proposed table is card/issuer/email-ingestion centric: `issuer`, `cardProductName`, later card-account linking, and `sourceEmailId`. [credit/schema.ts](/work/personal/compass/apps/api/src/modules/credit/schema.ts:1) already owns card-specific tables (`cardDetails`, `cardStatements`, `rewardEntries`, `emiDetails`) and already imports `emailIngestions` for statement-derived credit rows. [shopping/schema.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.ts:1) is currently scoped to catalog/list/price/pantry/cart intelligence and has no credit-card concepts.  
   Recommendation: define `cardOfferDiscountKind` + `cardOffers` in `apps/api/src/modules/credit/schema.ts`, and put shared Zod contracts in `packages/shared/src/schemas/credit.ts`. Shopping/checkout code can consume active offers later, but the resident table boundary fits credit.

2. **The plan misses DB schema barrel/decomposition updates.**
   Adding a resident table/enum requires updating [apps/api/src/db/schema.ts](/work/personal/compass/apps/api/src/db/schema.ts:1), plus [apps/api/src/db/schema.decomposition.test.ts](/work/personal/compass/apps/api/src/db/schema.decomposition.test.ts:1) resident sets and fixed counts. If placed in credit, also update [apps/api/src/modules/credit/schema.smoke.test.ts](/work/personal/compass/apps/api/src/modules/credit/schema.smoke.test.ts:1). If left in shopping, update [apps/api/src/modules/shopping/schema.smoke.test.ts](/work/personal/compass/apps/api/src/modules/shopping/schema.smoke.test.ts:1).

3. **`offer_extract` must be added to the DB enum too, not only `AiEventKindSchema`.**
   The plan says a new `ai_events` kind is logged but only mentions [packages/shared/src/schemas/ai-events.ts](/work/personal/compass/packages/shared/src/schemas/ai-events.ts:4). The API DB enum is [automation/schema.ts](/work/personal/compass/apps/api/src/modules/automation/schema.ts:55), and prior additions used migrations like `ALTER TYPE "public"."ai_event_kind" ADD VALUE 'shopping_parse'`. Without this, inserts with `kind = "offer_extract"` will fail at Postgres.

4. **No current shared test deep-equals the AI event enum values.**
   I found only inclusion-style tests for `shopping_parse` in [packages/shared/src/schemas/shopping.test.ts](/work/personal/compass/packages/shared/src/schemas/shopping.test.ts:1045). No test currently deep-equals `AiEventKindSchema.options`, so adding `"offer_extract"` should not require fixing a brittle enum equality test. Adding a targeted acceptance test for `offer_extract` is still appropriate.

5. **Backup coverage direction is right, but ordering needs correction.**
   Adding `card_offers` to both `ALL_TABLES` and `USER_TABLES` is correct if the table has direct `user_id`. Existing tests in [backup.test.ts](/work/personal/compass/apps/api/src/modules/system/services/backup.test.ts:46) verify schema coverage and `exportGaps()`, so missing coverage will fail.  
   Ordering concern: because `source_email_id` FKs `email_ingestions`, `card_offers` must appear in `ALL_TABLES` after `"email_ingestions"` unless restore defers `source_email_id`. If `card_offers` is placed near the other credit tables before mailbox/email ingestion rows, full restore and per-user restore can fail on FK insertion. The clean fix is ordering it after `"email_ingestions"`/`"extracted_transactions"` and adding a backup ordering assertion.

6. **Email classification may also need scope clarification.**
   The task text says the email pipeline classification is extended with a new class, but the scope only adds `offer_extract` to AI event kinds. If offer emails need their own ingestion classification, `email_class` / `EmailClassSchema` currently has no `"offer"` value, so that should be explicit or left as a non-goal.