CREATE TYPE "public"."sip_funding_source" AS ENUM('bank_debit', 'payroll');--> statement-breakpoint
ALTER TABLE "sips" ADD COLUMN "funding_source" "sip_funding_source" DEFAULT 'bank_debit' NOT NULL;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "sip_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_sip_id_sips_id_fk" FOREIGN KEY ("sip_id") REFERENCES "public"."sips"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "transactions_sip_date_idx" ON "transactions" USING btree ("sip_id","date") WHERE sip_id is not null and deleted_at is null;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_payroll_requires_account_target" CHECK ("sips"."funding_source" <> 'payroll' or "sips"."target_kind" = 'account');