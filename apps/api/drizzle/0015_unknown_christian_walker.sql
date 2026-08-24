CREATE TYPE "public"."income_event_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."income_kind" AS ENUM('salary', 'interest', 'dividend', 'rent', 'other');--> statement-breakpoint
CREATE TYPE "public"."income_source_kind" AS ENUM('payslip', 'holding_event', 'manual', 'ais');--> statement-breakpoint
CREATE TABLE "income_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"accrual_date" date NOT NULL,
	"fy" text NOT NULL,
	"income_kind" "income_kind" NOT NULL,
	"source_kind" "income_source_kind" NOT NULL,
	"source_id" uuid,
	"payer_name" text,
	"payer_pan" text,
	"payer_tan" text,
	"gross_paise" bigint NOT NULL,
	"tds_paise" bigint DEFAULT 0 NOT NULL,
	"notes" text,
	"status" "income_event_status" DEFAULT 'pending' NOT NULL,
	"accepted_at" timestamp with time zone,
	"original_values" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "income_events_gross_paise_non_negative" CHECK ("income_events"."gross_paise" >= 0),
	CONSTRAINT "income_events_tds_paise_non_negative" CHECK ("income_events"."tds_paise" >= 0),
	CONSTRAINT "income_events_tds_le_gross" CHECK ("income_events"."tds_paise" <= "income_events"."gross_paise")
);
--> statement-breakpoint
ALTER TABLE "income_events" ADD CONSTRAINT "income_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "income_events_source_unique_idx" ON "income_events" USING btree ("user_id","source_kind","source_id") WHERE source_id is not null;--> statement-breakpoint
CREATE INDEX "income_events_user_fy_idx" ON "income_events" USING btree ("user_id","fy");