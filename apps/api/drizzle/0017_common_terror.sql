ALTER TABLE "income_events" ADD COLUMN "section" text;--> statement-breakpoint
ALTER TABLE "income_events" ADD COLUMN "source_priority" integer DEFAULT 0 NOT NULL;