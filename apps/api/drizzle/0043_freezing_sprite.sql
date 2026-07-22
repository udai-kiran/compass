CREATE TYPE "public"."ai_event_kind" AS ENUM('email_extract', 'statement_parse', 'statement_summary', 'categorize', 'summary', 'assistant');--> statement-breakpoint
CREATE TYPE "public"."ai_event_status" AS ENUM('ok', 'error');--> statement-breakpoint
CREATE TABLE "ai_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "ai_event_kind" NOT NULL,
	"status" "ai_event_status" NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"ingestion_id" uuid,
	"account_id" uuid,
	"request_context" text DEFAULT '' NOT NULL,
	"response_raw" text DEFAULT '' NOT NULL,
	"latency_ms" integer,
	"error" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ai_events" ADD CONSTRAINT "ai_events_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "ai_events_user_created_idx" ON "ai_events" USING btree ("user_id","created_at" DESC NULLS LAST);