CREATE TYPE "public"."tax_line_match_status" AS ENUM('matched', 'unmatched', 'amount_mismatch');--> statement-breakpoint
CREATE TYPE "public"."tax_statement_kind" AS ENUM('ais', '26as', 'form16');--> statement-breakpoint
CREATE TYPE "public"."tax_statement_status" AS ENUM('pending', 'accepted', 'rejected');--> statement-breakpoint
CREATE TABLE "tax_statement_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"statement_id" uuid NOT NULL,
	"section" text,
	"category" "income_kind" NOT NULL,
	"payer_name" text,
	"payer_tan" text,
	"period" text,
	"accrual_date" date,
	"gross_paise" bigint NOT NULL,
	"tds_paise" bigint DEFAULT 0 NOT NULL,
	"match_status" "tax_line_match_status" DEFAULT 'unmatched' NOT NULL,
	"matched_income_event_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tax_statement_lines_gross_non_negative" CHECK ("tax_statement_lines"."gross_paise" >= 0),
	CONSTRAINT "tax_statement_lines_tds_non_negative" CHECK ("tax_statement_lines"."tds_paise" >= 0),
	CONSTRAINT "tax_statement_lines_tds_le_gross" CHECK ("tax_statement_lines"."tds_paise" <= "tax_statement_lines"."gross_paise")
);
--> statement-breakpoint
CREATE TABLE "tax_statements" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"doc_kind" "tax_statement_kind" NOT NULL,
	"status" "tax_statement_status" DEFAULT 'pending' NOT NULL,
	"document_key" text,
	"pan_last_4" text,
	"source_label" text,
	"line_count" integer DEFAULT 0 NOT NULL,
	"gross_total_paise" bigint DEFAULT 0 NOT NULL,
	"tds_total_paise" bigint DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"amount_mismatch_count" integer DEFAULT 0 NOT NULL,
	"unmatched_ledger_count" integer DEFAULT 0 NOT NULL,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "tax_statement_lines" ADD CONSTRAINT "tax_statement_lines_statement_id_tax_statements_id_fk" FOREIGN KEY ("statement_id") REFERENCES "public"."tax_statements"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statement_lines" ADD CONSTRAINT "tax_statement_lines_matched_income_event_id_income_events_id_fk" FOREIGN KEY ("matched_income_event_id") REFERENCES "public"."income_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tax_statements" ADD CONSTRAINT "tax_statements_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "tax_statement_lines_statement_idx" ON "tax_statement_lines" USING btree ("statement_id");--> statement-breakpoint
CREATE INDEX "tax_statements_user_fy_idx" ON "tax_statements" USING btree ("user_id","fy");