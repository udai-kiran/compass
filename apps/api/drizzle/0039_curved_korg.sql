ALTER TABLE "extracted_transactions" ADD COLUMN "occurred_at_ts" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "occurred_at" timestamp with time zone;