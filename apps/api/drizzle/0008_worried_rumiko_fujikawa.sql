CREATE TYPE "public"."reward_cap_period" AS ENUM('per_transaction', 'monthly', 'statement_cycle', 'annual');--> statement-breakpoint
CREATE TYPE "public"."reward_redemption_route" AS ENUM('cashback', 'air_miles', 'catalogue', 'statement_credit');--> statement-breakpoint
CREATE TABLE "reward_point_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_details_account_id" uuid NOT NULL,
	"earned_at" timestamp with time zone NOT NULL,
	"points" integer NOT NULL,
	"expires_at" timestamp with time zone,
	"is_redeemed" boolean DEFAULT false NOT NULL,
	"description" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_point_lots_points_nonneg" CHECK ("points" >= 0)
);
--> statement-breakpoint
CREATE TABLE "reward_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"card_product_name" text NOT NULL,
	"network" "card_network",
	"base_earn_per_100" integer DEFAULT 0 NOT NULL,
	"mcc_exclusions" text[] DEFAULT '{}'::text[] NOT NULL,
	"accel_earn_multiplier" integer,
	"accel_earn_cap_paise" bigint,
	"accel_earn_cap_period" "reward_cap_period",
	"redemption_values" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"milestone_spend_paise" bigint,
	"milestone_benefit_desc" text,
	"annual_fee_waiver_spend_paise" bigint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reward_rules_base_earn_nonneg" CHECK ("base_earn_per_100" >= 0),
	CONSTRAINT "reward_rules_accel_consistent" CHECK ((
        "accel_earn_multiplier" IS NULL AND "accel_earn_cap_paise" IS NULL AND "accel_earn_cap_period" IS NULL
      ) OR (
        "accel_earn_multiplier" IS NOT NULL AND "accel_earn_cap_paise" IS NOT NULL AND "accel_earn_cap_period" IS NOT NULL
      ))
);
--> statement-breakpoint
CREATE TYPE "public"."delivery_eta_band" AS ENUM('instant', 'same_day', 'next_day', 'scheduled');--> statement-breakpoint
ALTER TABLE "price_sources" ADD COLUMN "delivery_fee_paise" bigint;--> statement-breakpoint
ALTER TABLE "price_sources" ADD COLUMN "min_cart_paise" bigint;--> statement-breakpoint
ALTER TABLE "price_sources" ADD COLUMN "delivery_eta_band" "delivery_eta_band";--> statement-breakpoint
ALTER TABLE "reward_point_lots" ADD CONSTRAINT "reward_point_lots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_point_lots" ADD CONSTRAINT "reward_point_lots_card_details_account_id_card_details_account_id_fk" FOREIGN KEY ("card_details_account_id") REFERENCES "public"."card_details"("account_id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reward_rules" ADD CONSTRAINT "reward_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reward_point_lots_user_expires_idx" ON "reward_point_lots" USING btree ("user_id","expires_at");--> statement-breakpoint
CREATE INDEX "reward_point_lots_user_idx" ON "reward_point_lots" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reward_rules_user_product_idx" ON "reward_rules" USING btree ("user_id","card_product_name");--> statement-breakpoint
CREATE INDEX "reward_rules_user_idx" ON "reward_rules" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "price_sources" ADD CONSTRAINT "price_sources_delivery_fee_nonneg" CHECK ("delivery_fee_paise" IS NULL OR "delivery_fee_paise" >= 0);--> statement-breakpoint
ALTER TABLE "price_sources" ADD CONSTRAINT "price_sources_min_cart_nonneg" CHECK ("min_cart_paise" IS NULL OR "min_cart_paise" >= 0);