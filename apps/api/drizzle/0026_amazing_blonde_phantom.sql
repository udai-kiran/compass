CREATE TYPE "public"."policy_ownership" AS ENUM('personal', 'employer');--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "ownership" "policy_ownership" DEFAULT 'personal' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "employer_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "deductible_paise" bigint;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "co_pay_bps" integer;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "room_rent_limit_paise" bigint;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "room_rent_limit_bps" integer;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "icu_limit_paise" bigint;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "icu_limit_bps" integer;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "sub_limits" jsonb DEFAULT '[]'::jsonb NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "initial_waiting_days" integer;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "pre_existing_waiting_months" integer;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "maternity_waiting_months" integer;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "restoration_benefit" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "ncb_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "ncb_max_bps" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "tpa_name" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "tpa_contact_phone" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "exclusions" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "disclosures_complete" boolean DEFAULT false NOT NULL;