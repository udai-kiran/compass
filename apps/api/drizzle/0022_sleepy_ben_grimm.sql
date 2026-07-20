CREATE TYPE "public"."insurance_kind" AS ENUM('life', 'health', 'vehicle');--> statement-breakpoint
CREATE TYPE "public"."premium_frequency" AS ENUM('monthly', 'quarterly', 'half_yearly', 'yearly', 'single');--> statement-breakpoint
CREATE TYPE "public"."vehicle_kind" AS ENUM('car', 'bike', 'other');--> statement-breakpoint
ALTER TYPE "public"."account_type" ADD VALUE 'insurance';--> statement-breakpoint
CREATE TABLE "insurance_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "insurance_kind" DEFAULT 'life' NOT NULL,
	"vehicle_type" "vehicle_kind",
	"policy_number" text DEFAULT '' NOT NULL,
	"cover_paise" bigint DEFAULT 0 NOT NULL,
	"premium_paise" bigint DEFAULT 0 NOT NULL,
	"premium_frequency" "premium_frequency" DEFAULT 'yearly' NOT NULL,
	"start_date" date,
	"renewal_date" date,
	"maturity_date" date,
	"nominee" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "policy_account_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_details" ADD CONSTRAINT "insurance_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "insurance_details" ADD CONSTRAINT "insurance_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_policy_account_id_accounts_id_fk" FOREIGN KEY ("policy_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_policy_idx" ON "transactions" USING btree ("policy_account_id");