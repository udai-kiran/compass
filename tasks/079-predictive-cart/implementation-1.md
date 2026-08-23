Implemented task 079.

Files created:

- `apps/api/drizzle/0010_windy_romulus.sql`
- `apps/api/drizzle/meta/0010_snapshot.json`
- `apps/api/src/modules/shopping/routes/cart-drafts.ts`
- `apps/api/src/modules/shopping/services/cart-draft-generator.ts`
- `apps/api/src/modules/shopping/services/cart-draft-generator.test.ts`

Files modified:

- `apps/api/drizzle/meta/_journal.json`
- `apps/api/src/db/schema.decomposition.test.ts`
- `apps/api/src/db/schema.ts`
- `apps/api/src/modules/shopping/plugin.ts`
- `apps/api/src/modules/shopping/schema.ts`
- `apps/api/src/modules/shopping/services/ownership.ts`
- `apps/api/src/modules/system/services/backup.ts`
- `apps/api/src/route-surface.snapshot.txt`
- `apps/api/src/route-table.snapshot.txt`
- `packages/shared/src/schemas/shopping.ts`

Changes made:

- Added `cart_draft_items` with required FKs, nullable catalog link, checks, and index.
- Generated migration `0010_windy_romulus.sql`.
- Added shared cart-draft item, draft-with-items, generation response, and edit contracts.
- Implemented replenishment generation, UTC-day idempotency, stale/latest price handling, integer unit-price comparisons, spike detection, substitutions, total calculation, and teaching-signal clamp.
- Added ownership guard for cart drafts.
- Added generate/list/get/update/abandon draft routes. No route can create an order.
- Registered routes, backup linkage, schema barrel export, and route snapshots.
- Updated schema decomposition coverage for the added table.
- Added 10 pure tests covering replenishment, quantity, spike thresholds/no data, totals, and teaching-signal clamp.

Migration SQL:

```sql
CREATE TABLE "cart_draft_items" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "cart_draft_id" uuid NOT NULL,
  "catalog_item_id" uuid,
  "quantity_base" bigint,
  "unit" "normalized_unit",
  "reason" text NOT NULL,
  "suggested_price_paise" bigint,
  "suggested_source_id" uuid,
  "substitution_for_item_id" uuid,
  "price_delta_paise" bigint,
  "is_removed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "cart_draft_items_quantity_nonneg" CHECK ("quantity_base" IS NULL OR "quantity_base" >= 0),
  CONSTRAINT "cart_draft_items_quantity_unit_paired" CHECK (("quantity_base" IS NULL) = ("unit" IS NULL)),
  CONSTRAINT "cart_draft_items_price_nonneg" CHECK ("suggested_price_paise" IS NULL OR "suggested_price_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cart_draft_items" ADD CONSTRAINT "cart_draft_items_cart_draft_id_cart_drafts_id_fk" FOREIGN KEY ("cart_draft_id") REFERENCES "public"."cart_drafts"("id") ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_draft_items" ADD CONSTRAINT "cart_draft_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cart_draft_items" ADD CONSTRAINT "cart_draft_items_suggested_source_id_price_sources_id_fk" FOREIGN KEY ("suggested_source_id") REFERENCES "public"."price_sources"("id") ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "cart_draft_items_draft_idx" ON "cart_draft_items" USING btree ("cart_draft_id");
```

Verification:

- `node --test ...cart-draft-generator.test.ts` initially exited `1` as expected: generator module did not exist.
- `node --test ...cart-draft-generator.test.ts` after implementation: exit `0`, 10/10 passed.
- `DATABASE_URL=postgresql://localhost:5432/compass npm run db:generate`: exit `0`; migration generated.
- `npm run db:migrate`: exit `1`; blocked because this workspace has no `.env`, configured `DATABASE_URL`, or running PostgreSQL service.
- `npm run typecheck`: exit `0`.
- `npm run lint`: exit `0`.
- Focused generator, route-snapshot, and schema decomposition tests: exit `0`, 20/20 passed.
- `npm run test -w apps/api`: exit `1`; task tests and route snapshots passed, but 35 existing DB-backed tests abort because `DATABASE_URL`/Postgres/Redis are unavailable. This is an environment prerequisite failure.
- `git diff --check` for task files: exit `0`.

Risks/deviations:

- Migration application and the complete API suite could not run in this environment due to missing database/Redis configuration. No application behavior was changed to bypass those requirements.
- The worktree already contained unrelated in-progress changes; they were preserved.