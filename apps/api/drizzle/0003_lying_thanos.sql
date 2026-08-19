ALTER TABLE "card_details" ADD COLUMN "apr_bps" integer;--> statement-breakpoint
ALTER TABLE "card_details" ADD COLUMN "cash_apr_bps" integer;--> statement-breakpoint
ALTER TABLE "card_details" ADD COLUMN "late_fee_paise" bigint;--> statement-breakpoint
ALTER TABLE "card_details" ADD COLUMN "interest_free_days" integer;