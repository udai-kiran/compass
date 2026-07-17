ALTER TABLE "goal_contributions" DISABLE ROW LEVEL SECURITY;--> statement-breakpoint
DROP TABLE "goal_contributions" CASCADE;--> statement-breakpoint
ALTER TABLE "goals" DROP CONSTRAINT "goals_account_id_accounts_id_fk";
--> statement-breakpoint
ALTER TABLE "goals" DROP COLUMN "account_id";