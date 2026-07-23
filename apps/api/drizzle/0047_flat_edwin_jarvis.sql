CREATE TYPE "public"."sip_frequency" AS ENUM('monthly', 'quarterly', 'yearly');--> statement-breakpoint
ALTER TABLE "sips" ADD COLUMN "frequency" "sip_frequency" DEFAULT 'monthly' NOT NULL;