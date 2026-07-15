CREATE TYPE "public"."card_network" AS ENUM('visa', 'mastercard', 'amex', 'rupay', 'diners');--> statement-breakpoint
CREATE TYPE "public"."gold_form" AS ENUM('physical', 'digital', 'etf', 'sgb');--> statement-breakpoint
CREATE TYPE "public"."nps_tier" AS ENUM('tier_i', 'tier_ii');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'ppf';--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'epf';--> statement-breakpoint
CREATE TABLE "gold_details" (
	"holding_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"form" "gold_form" DEFAULT 'physical' NOT NULL,
	"purity_karat" integer,
	"maturity_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "nps_details" (
	"holding_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"pran" text DEFAULT '' NOT NULL,
	"tier" "nps_tier" DEFAULT 'tier_i' NOT NULL,
	"equity_pct" integer DEFAULT 0 NOT NULL,
	"corporate_pct" integer DEFAULT 0 NOT NULL,
	"govt_pct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "retirement_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"annual_rate_bps" integer DEFAULT 0 NOT NULL,
	"maturity_date" date,
	"reference_number" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "asset_class" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."asset_class";--> statement-breakpoint
CREATE TYPE "public"."asset_class" AS ENUM('stock', 'mutual_fund', 'etf', 'gold', 'fd', 'nps', 'other');--> statement-breakpoint
ALTER TABLE "holdings" ALTER COLUMN "asset_class" SET DATA TYPE "public"."asset_class" USING "asset_class"::"public"."asset_class";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "institution" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "account_last4" text;--> statement-breakpoint
ALTER TABLE "card_details" ADD COLUMN "network" "card_network";--> statement-breakpoint
ALTER TABLE "card_details" ADD COLUMN "product_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "gold_details" ADD CONSTRAINT "gold_details_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "gold_details" ADD CONSTRAINT "gold_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_details" ADD CONSTRAINT "nps_details_holding_id_holdings_id_fk" FOREIGN KEY ("holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "nps_details" ADD CONSTRAINT "nps_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_details" ADD CONSTRAINT "retirement_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "retirement_details" ADD CONSTRAINT "retirement_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;