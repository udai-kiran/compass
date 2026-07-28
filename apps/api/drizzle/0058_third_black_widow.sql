CREATE TYPE "public"."expense_necessity" AS ENUM('essential', 'non_essential');--> statement-breakpoint
ALTER TABLE "categories" ADD COLUMN "necessity" "expense_necessity";