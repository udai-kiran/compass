CREATE TYPE "public"."gains_tax_class" AS ENUM('equity', 'unlisted_shares', 'other', 'specified_fund', 'market_linked_debenture', 'unlisted_bond');--> statement-breakpoint
CREATE TYPE "public"."holding_event_source" AS ENUM('import', 'manual');--> statement-breakpoint
ALTER TABLE "holding_events" ADD COLUMN "seq" integer;--> statement-breakpoint
ALTER TABLE "holding_events" ADD COLUMN "source" "holding_event_source" DEFAULT 'import' NOT NULL;--> statement-breakpoint
-- Backfill a deterministic 0-based intra-day ordinal per (holding, date), so
-- same-day lots stop falling back to created_at/UUID in the FIFO engine. Best
-- available proxy for source order: record time, then id.
UPDATE "holding_events" he SET "seq" = ord.rn
FROM (
  SELECT "id", (row_number() OVER (PARTITION BY "holding_id", "date" ORDER BY "created_at", "id") - 1) AS rn
  FROM "holding_events"
) ord
WHERE he."id" = ord."id";--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "grandfather_nav_paise" bigint;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "gains_tax_class" "gains_tax_class" DEFAULT 'equity' NOT NULL;--> statement-breakpoint
-- Seed existing rows to a sensible default by asset class (mirrors defaultTaxClass);
-- equity-ish classes keep the 'equity' column default, everything else is 'other'.
UPDATE "holdings" SET "gains_tax_class" = 'other' WHERE "asset_class" NOT IN ('stock', 'mutual_fund', 'etf');