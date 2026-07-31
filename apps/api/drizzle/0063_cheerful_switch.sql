CREATE TYPE "public"."extracted_txn_intent" AS ENUM('repayment', 'refund', 'cashback');--> statement-breakpoint
ALTER TABLE "extracted_transactions" ADD COLUMN "intent" "extracted_txn_intent";