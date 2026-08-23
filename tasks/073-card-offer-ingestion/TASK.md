# Task: 073 — Card Offer & Deal Ingestion (task 10.4)

## Status
COMPLETE

## Objective
Add `card_offers` table to the **credit module** (not shopping — card offers are credit-card data). Add `"offer_extract"` to both the shared `AiEventKindSchema` AND the `ai_event_kind` Postgres enum in `automation/schema.ts`. Offers are reviewable before trusted. Expired offers auto-excluded. Tables added to backup with correct ordering (after email_ingestions).

## Root Cause
No `card_offers` table exists. Codex review confirmed: card offers belong in the credit module.

## Scope
- `apps/api/src/modules/credit/schema.ts` — add `cardOfferDiscountKind` pgEnum (`flat`, `percentage`, `cashback`, `points`); add `cardOffers` table (id uuid PK, userId uuid FK users NOT NULL, platform text NOT NULL, issuer text NOT NULL, cardProductName text nullable, discountKind cardOfferDiscountKind NOT NULL, discountRateBps int NOT NULL, maxCapPaise bigint nullable, minSpendPaise bigint nullable, validFrom timestamp NOT NULL, validUntil timestamp NOT NULL, stackable boolean NOT NULL default false, isReviewed boolean NOT NULL default false, sourceEmailId uuid nullable FK emailIngestions ON DELETE SET NULL, raw text nullable, createdAt, updatedAt); CHECK discountRateBps >= 0; CHECK maxCapPaise IS NULL OR maxCapPaise >= 0; index (userId, validUntil) for active-offer queries
- `apps/api/src/modules/automation/schema.ts` — add `"offer_extract"` to the `aiEventKind` pgEnum values
- `apps/api/drizzle/` — generate migration (new table + ALTER TYPE ADD VALUE)
- `packages/shared/src/schemas/ai-events.ts` — add `"offer_extract"` to `AiEventKindSchema`
- `packages/shared/src/schemas/credit.ts` — (or new `packages/shared/src/schemas/card-offers.ts`) add `CardOfferDiscountKindSchema`, `CardOfferSchema`, `CreateCardOfferSchema`, `ReviewCardOfferSchema`
- `apps/api/src/modules/credit/services/card-offers.ts` — `listOffers(db, userId, {includeExpired?})`, `createOffer(db, userId, data)`, `reviewOffer(db, userId, offerId)`, `deleteOffer(db, userId, offerId)`, `getActiveOffers(db, userId)` (validUntil >= now AND isReviewed=true)
- `apps/api/src/modules/credit/routes/card-offers.ts` — GET /api/credit/card-offers, POST /api/credit/card-offers, PATCH /api/credit/card-offers/:id/review, DELETE /api/credit/card-offers/:id. (These use full paths since credit routes are not prefix-mounted)
- `apps/api/src/modules/credit/plugin.ts` — register new routes
- `apps/api/src/modules/system/services/backup.ts` — add `card_offers` to ALL_TABLES after `"email_ingestions"` (sourceEmailId FKs emailIngestions, so must restore after); add to USER_TABLES (user_id)
- `apps/api/src/modules/credit/schema.smoke.test.ts` — update table/enum counts
- `apps/api/src/db/schema.decomposition.test.ts` — update credit resident sets
- `apps/api/src/modules/credit/services/card-offers.test.ts` — expired filter unit tests, ownership guard
- `apps/api/src/modules/credit/routes/card-offers.hermetic.test.ts`
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Dependencies
- task 9.3 ✓
- Parallel to 070/071/072

## Plan
- P1: Add schema table + enums to credit/schema.ts; add `"offer_extract"` to automation/schema.ts aiEventKind
- P2: Generate migration SQL
- P3: Add `"offer_extract"` to AiEventKindSchema in packages/shared/src/schemas/ai-events.ts
- P4: Add Zod schemas to shared/credit.ts or shared/card-offers.ts
- P5: Write services/card-offers.ts
- P6: Write routes and register in credit/plugin.ts
- P7: Update backup.ts (ordering: after email_ingestions)
- P8: Update schema.smoke.test.ts and schema.decomposition.test.ts for credit module
- P9: Write tests
- P10: Update route snapshots

## Acceptance Criteria
- AC1: `card_offers` in credit module with all required fields including maxCapPaise (nullable)
- AC2: `"offer_extract"` in both AiEventKindSchema (Zod) AND `aiEventKind` Postgres enum
- AC3: `getActiveOffers` returns only rows where `validUntil >= now()` AND `isReviewed = true`
- AC4: POST creates isReviewed=false; PATCH /review sets isReviewed=true
- AC5: `cardProductName` nullable — unmatched offers still captured
- AC6: `card_offers` in ALL_TABLES after `"email_ingestions"`, in USER_TABLES
- AC7: credit schema.smoke.test.ts and decomposition.test.ts pass
- AC8: typecheck + lint + test green

## Verification
- T1: `npm run typecheck` exits 0
- T2: `npm run lint` exits 0
- T3: `npm run test -w apps/api` exits 0
- T4: `npm run test -w packages/shared` exits 0

## Non-Goals
- Actual AI extraction of offers from emails (extractor pipeline change is future work)
- Stacking multiple offers
- EmailClassSchema "offer" value (not in scope — AI event kind is sufficient for now)
