CREATE TYPE "public"."receipt_line_match_status" AS ENUM('unmatched', 'matched', 'extra', 'missing', 'price_diff', 'ambiguous');--> statement-breakpoint
CREATE TYPE "public"."receipt_status" AS ENUM('parsed', 'reconciled', 'confirmed');--> statement-breakpoint
CREATE TABLE "receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"receipt_id" uuid NOT NULL,
	"position" integer DEFAULT 0 NOT NULL,
	"raw_text" text NOT NULL,
	"normalized_name" text,
	"catalog_item_id" uuid,
	"quantity_base" bigint,
	"unit" "normalized_unit",
	"price_paise" bigint,
	"matched_draft_item_id" uuid,
	"match_status" "receipt_line_match_status" DEFAULT 'unmatched' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipt_lines_quantity_nonneg" CHECK ("quantity_base" IS NULL OR "quantity_base" >= 0),
	CONSTRAINT "receipt_lines_quantity_unit_paired" CHECK (("quantity_base" IS NULL) = ("unit" IS NULL)),
	CONSTRAINT "receipt_lines_price_nonneg" CHECK ("price_paise" IS NULL OR "price_paise" >= 0),
	CONSTRAINT "receipt_lines_position_nonneg" CHECK ("position" >= 0)
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"cart_draft_id" uuid,
	"shopping_list_id" uuid,
	"stored_path" text NOT NULL,
	"mime_type" text NOT NULL,
	"status" "receipt_status" DEFAULT 'parsed' NOT NULL,
	"merchant_name" text,
	"purchase_date" date,
	"total_paise" bigint,
	"parsed_at" timestamp with time zone,
	"reconciled_at" timestamp with time zone,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "receipts_total_nonneg" CHECK ("total_paise" IS NULL OR "total_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipt_lines" ADD CONSTRAINT "receipt_lines_catalog_item_id_catalog_items_id_fk" FOREIGN KEY ("catalog_item_id") REFERENCES "public"."catalog_items"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_cart_draft_id_cart_drafts_id_fk" FOREIGN KEY ("cart_draft_id") REFERENCES "public"."cart_drafts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_shopping_list_id_shopping_lists_id_fk" FOREIGN KEY ("shopping_list_id") REFERENCES "public"."shopping_lists"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "receipt_lines_receipt_idx" ON "receipt_lines" USING btree ("receipt_id");--> statement-breakpoint
CREATE INDEX "receipts_user_idx" ON "receipts" USING btree ("user_id");