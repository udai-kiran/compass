CREATE TABLE "statement_reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"period" text NOT NULL,
	"statement_date" date,
	"ingestion_id" uuid,
	"total_due_paise" bigint,
	"min_due_paise" bigint,
	"reward_opening" integer,
	"reward_earned" integer,
	"reward_redeemed" integer,
	"reward_closing" integer,
	"line_count" integer DEFAULT 0 NOT NULL,
	"line_debit_paise" bigint DEFAULT 0 NOT NULL,
	"matched_count" integer DEFAULT 0 NOT NULL,
	"matched_paise" bigint DEFAULT 0 NOT NULL,
	"unmatched_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "reconciled_statement_id" uuid;--> statement-breakpoint
ALTER TABLE "statement_reconciliations" ADD CONSTRAINT "statement_reconciliations_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reconciliations" ADD CONSTRAINT "statement_reconciliations_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "statement_reconciliations" ADD CONSTRAINT "statement_reconciliations_ingestion_id_email_ingestions_id_fk" FOREIGN KEY ("ingestion_id") REFERENCES "public"."email_ingestions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "statement_reconciliations_cycle_idx" ON "statement_reconciliations" USING btree ("account_id","period");--> statement-breakpoint
CREATE INDEX "statement_reconciliations_user_idx" ON "statement_reconciliations" USING btree ("user_id","account_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_reconciled_statement_id_statement_reconciliations_id_fk" FOREIGN KEY ("reconciled_statement_id") REFERENCES "public"."statement_reconciliations"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_reconciled_idx" ON "transactions" USING btree ("reconciled_statement_id");