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
ALTER TABLE "cart_draft_items" ADD CONSTRAINT "cart_draft_items_cart_draft_id_cart_drafts_id_fk" FOREIGN KEY ("cart_draft_id") REFERENCES "public"."cart_drafts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_draft_items" ADD CONSTRAINT "cart_draft_items_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cart_draft_items" ADD CONSTRAINT "cart_draft_items_suggested_source_id_price_sources_id_fk" FOREIGN KEY ("suggested_source_id") REFERENCES "public"."price_sources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "cart_draft_items_draft_idx" ON "cart_draft_items" USING btree ("cart_draft_id");