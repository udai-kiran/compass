ALTER TABLE "insurance_details" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "insurance_details" CASCADE;--> statement-breakpoint
ALTER TABLE "transactions" DROP CONSTRAINT "transactions_policy_account_id_accounts_id_fk";
--> statement-breakpoint
DROP INDEX "transactions_policy_idx";--> statement-breakpoint
ALTER TABLE "transactions" DROP COLUMN "policy_account_id";