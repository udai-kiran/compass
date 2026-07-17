ALTER TABLE "retirement_details" ADD COLUMN "eps_balance_paise" bigint;--> statement-breakpoint
-- Backfill the invariants this migration introduces on already-existing rows:
-- a goal earmark only belongs on accounts you accumulate toward a goal, and EPF
-- has no maturity date. (EPS starts null everywhere, so needs no backfill.)
UPDATE "accounts" SET "goal_id" = NULL WHERE "goal_id" IS NOT NULL AND "type" NOT IN ('investment', 'ppf', 'epf', 'ssy');--> statement-breakpoint
UPDATE "retirement_details" AS rd SET "maturity_date" = NULL FROM "accounts" a WHERE rd."account_id" = a."id" AND a."type" = 'epf';
