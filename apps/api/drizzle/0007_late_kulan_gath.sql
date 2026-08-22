CREATE TYPE "public"."card_offer_discount_kind" AS ENUM('flat', 'percentage', 'cashback', 'points');--> statement-breakpoint
ALTER TYPE "public"."ai_event_kind" ADD VALUE 'offer_extract';--> statement-breakpoint
CREATE TABLE "card_offers" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"platform" text NOT NULL,
	"issuer" text NOT NULL,
	"card_product_name" text,
	"discount_kind" "card_offer_discount_kind" NOT NULL,
	"discount_rate_bps" integer NOT NULL,
	"max_cap_paise" bigint,
	"min_spend_paise" bigint,
	"valid_from" timestamp with time zone NOT NULL,
	"valid_until" timestamp with time zone NOT NULL,
	"stackable" boolean DEFAULT false NOT NULL,
	"is_reviewed" boolean DEFAULT false NOT NULL,
	"source_email_id" uuid,
	"raw" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_offers_rate_nonneg" CHECK ("discount_rate_bps" >= 0),
	CONSTRAINT "card_offers_cap_nonneg" CHECK ("max_cap_paise" IS NULL OR "max_cap_paise" >= 0),
	CONSTRAINT "card_offers_min_spend_nonneg" CHECK ("min_spend_paise" IS NULL OR "min_spend_paise" >= 0)
);
--> statement-breakpoint
ALTER TABLE "card_offers" ADD CONSTRAINT "card_offers_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "card_offers" ADD CONSTRAINT "card_offers_source_email_id_email_ingestions_id_fk" FOREIGN KEY ("source_email_id") REFERENCES "public"."email_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "card_offers_user_valid_idx" ON "card_offers" USING btree ("user_id","valid_until");