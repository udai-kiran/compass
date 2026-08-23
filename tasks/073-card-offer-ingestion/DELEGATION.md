# Sonnet Worker Delegation — 073 (Phase A)

## Task
073 — Card Offer & Deal Ingestion (task 10.4)

## Approved Plan
- P1: Add cardOfferDiscountKind enum + cardOffers table to credit/schema.ts; add "offer_extract" to automation/schema.ts aiEventKind pgEnum
- P2: Generate migration SQL
- P3: Add "offer_extract" to AiEventKindSchema in packages/shared/src/schemas/ai-events.ts
- P4: Add Zod schemas to packages/shared/src/schemas/credit.ts
- P5: Write services/card-offers.ts
- P6: Write routes and register in credit/plugin.ts
- P7: Update backup.ts (ordering: after email_ingestions)
- P8: Update credit schema.smoke.test.ts and db/schema.decomposition.test.ts
- P9: Write tests
- P10: Update route snapshots

## Files and Symbols
- `apps/api/src/modules/credit/schema.ts` — add cardOfferDiscountKind pgEnum, cardOffers pgTable
- `apps/api/src/modules/automation/schema.ts` — add "offer_extract" to aiEventKind enum
- `apps/api/drizzle/` — new migration file (db:generate)
- `packages/shared/src/schemas/ai-events.ts` — add "offer_extract" to AiEventKindSchema
- `packages/shared/src/schemas/credit.ts` — add CardOfferDiscountKindSchema, CardOfferSchema, CreateCardOfferSchema, ReviewCardOfferSchema
- `apps/api/src/modules/credit/services/card-offers.ts` — NEW
- `apps/api/src/modules/credit/services/card-offers.test.ts` — NEW
- `apps/api/src/modules/credit/routes/card-offers.ts` — NEW (full paths: /api/credit/card-offers, ...)
- `apps/api/src/modules/credit/routes/card-offers.hermetic.test.ts` — NEW
- `apps/api/src/modules/credit/plugin.ts` — register new route
- `apps/api/src/modules/system/services/backup.ts` — add card_offers after email_ingestions in ALL_TABLES; add to USER_TABLES
- `apps/api/src/modules/credit/schema.smoke.test.ts` — update table/enum counts
- `apps/api/src/db/schema.decomposition.test.ts` — update credit resident sets
- `apps/api/src/route-surface.snapshot.txt` — add new routes
- `apps/api/src/route-table.snapshot.txt` — add new routes

## Required Changes

### 1. credit/schema.ts additions
```ts
export const cardOfferDiscountKind = pgEnum("card_offer_discount_kind", [
  "flat", "percentage", "cashback", "points"
]);

export const cardOffers = pgTable("card_offers", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").notNull().references(() => users.id, { onDelete: "cascade" }),
  platform: text("platform").notNull(),
  issuer: text("issuer").notNull(),
  cardProductName: text("card_product_name"),
  discountKind: cardOfferDiscountKind("discount_kind").notNull(),
  discountRateBps: integer("discount_rate_bps").notNull(),
  maxCapPaise: bigint("max_cap_paise", { mode: "number" }),
  minSpendPaise: bigint("min_spend_paise", { mode: "number" }),
  validFrom: timestamp("valid_from", { withTimezone: true }).notNull(),
  validUntil: timestamp("valid_until", { withTimezone: true }).notNull(),
  stackable: boolean("stackable").notNull().default(false),
  isReviewed: boolean("is_reviewed").notNull().default(false),
  sourceEmailId: uuid("source_email_id").references(() => emailIngestions.id, { onDelete: "set null" }),
  raw: text("raw"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (t) => [
  index("card_offers_user_valid_idx").on(t.userId, t.validUntil),
  check("card_offers_rate_nonneg", sql`"discount_rate_bps" >= 0`),
  check("card_offers_cap_nonneg", sql`"max_cap_paise" IS NULL OR "max_cap_paise" >= 0`),
  check("card_offers_min_spend_nonneg", sql`"min_spend_paise" IS NULL OR "min_spend_paise" >= 0`),
]);
```
Import `emailIngestions` from `../../db/shared/hubs.ts` (already imported there for cardStatements).

### 2. automation/schema.ts
Read the file first. Find the aiEventKind pgEnum and add "offer_extract" to its values array.

### 3. packages/shared/src/schemas/ai-events.ts
Add "offer_extract" to AiEventKindSchema z.enum array.

### 4. packages/shared/src/schemas/credit.ts
Add at the end:
```ts
export const CardOfferDiscountKindSchema = z.enum(["flat", "percentage", "cashback", "points"]);
export type CardOfferDiscountKind = z.infer<typeof CardOfferDiscountKindSchema>;

export const CardOfferSchema = z.object({
  id: z.uuid(),
  platform: z.string().min(1),
  issuer: z.string().min(1),
  cardProductName: z.string().nullable(),
  discountKind: CardOfferDiscountKindSchema,
  discountRateBps: z.number().int().nonnegative(),
  maxCapPaise: z.number().int().nonnegative().nullable(),
  minSpendPaise: z.number().int().nonnegative().nullable(),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  stackable: z.boolean(),
  isReviewed: z.boolean(),
  sourceEmailId: z.uuid().nullable(),
  createdAt: z.coerce.date(),
  updatedAt: z.coerce.date(),
});
export type CardOffer = z.infer<typeof CardOfferSchema>;

export const CreateCardOfferSchema = z.object({
  platform: z.string().min(1).max(120).trim(),
  issuer: z.string().min(1).max(120).trim(),
  cardProductName: z.string().max(200).nullable().default(null),
  discountKind: CardOfferDiscountKindSchema,
  discountRateBps: z.number().int().nonnegative(),
  maxCapPaise: z.number().int().nonnegative().nullable().default(null),
  minSpendPaise: z.number().int().nonnegative().nullable().default(null),
  validFrom: z.coerce.date(),
  validUntil: z.coerce.date(),
  stackable: z.boolean().default(false),
  raw: z.string().nullable().default(null),
});
export type CreateCardOffer = z.input<typeof CreateCardOfferSchema>;
```

### 5. services/card-offers.ts
- `listOffers(db, userId, opts?: {includeExpired?: boolean})` → CardOffer[]
- `createOffer(db, userId, data: CreateCardOffer)` → CardOffer
- `reviewOffer(db, userId, offerId)` → CardOffer (set isReviewed=true; 404 if wrong user)
- `deleteOffer(db, userId, offerId)` → void (404 if wrong user)
- `getActiveOffers(db, userId)` → CardOffer[] (validUntil >= new Date() AND isReviewed=true)

### 6. Routes (full paths since credit module is NOT prefix-mounted)
Read credit/plugin.ts to confirm it doesn't use a prefix. Routes use full /api/credit/... paths.
- GET /api/credit/card-offers?includeExpired=false
- POST /api/credit/card-offers
- PATCH /api/credit/card-offers/:id/review
- DELETE /api/credit/card-offers/:id

### 7. backup.ts
Insert "card_offers" in ALL_TABLES AFTER "email_ingestions" (FK ordering). Add card_offers: "user_id" to USER_TABLES.

### 8. Generate migration
Run: `npm run db:generate -w apps/api`
Review generated SQL — must include: CREATE TYPE card_offer_discount_kind, CREATE TABLE card_offers, ALTER TYPE ai_event_kind ADD VALUE 'offer_extract'

### 9. Update schema counts
- credit/schema.smoke.test.ts: increment table count by 1 (card_offers), enum count by 1 (card_offer_discount_kind)
- db/schema.decomposition.test.ts: add card_offers to credit resident tables, card_offer_discount_kind to credit resident enums

### 10. Route snapshots
Run tests, get snapshot failure output, update route-surface.snapshot.txt and route-table.snapshot.txt.

## Must Not Change
- apps/api/src/modules/shopping/schema.ts
- Any existing credit routes (cards.ts, emis.ts, etc.)
- apps/api/src/modules/automation/ (except schema.ts aiEventKind enum)

## Acceptance Criteria
- AC1: card_offers table in credit module with all required fields
- AC2: "offer_extract" in AiEventKindSchema AND aiEventKind Postgres enum
- AC3: getActiveOffers excludes expired (validUntil < now()) and unreviewed
- AC4: isReviewed=false on create; PATCH /review sets true
- AC5: cardProductName nullable
- AC6: card_offers in ALL_TABLES after email_ingestions, in USER_TABLES
- AC7: schema counts pass
- AC8: typecheck + lint + test green

## Commands
1. `npm run db:generate -w apps/api` (after schema changes)
2. `npm run typecheck`
3. `npm run lint`
4. `npm run test -w apps/api`
5. `npm run test -w packages/shared`

## Required Evidence
- All files changed with line counts
- Complete diff
- Output of all commands with exit codes
- Migration SQL content
- Any plan deviations or blockers
