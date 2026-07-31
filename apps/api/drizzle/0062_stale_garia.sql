ALTER TABLE "emi_details" ADD COLUMN "loan_account_id" uuid;--> statement-breakpoint
ALTER TABLE "emi_details" ADD COLUMN "outstanding_principal_paise" bigint;--> statement-breakpoint
ALTER TABLE "emi_details" ADD CONSTRAINT "emi_details_loan_account_id_accounts_id_fk" FOREIGN KEY ("loan_account_id") REFERENCES "public"."accounts"("id") ON DELETE set null ON UPDATE no action;