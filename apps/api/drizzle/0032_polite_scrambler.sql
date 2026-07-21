ALTER TABLE "insurance_policies" ADD COLUMN "covered_members" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "document_path" text;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "document_name" text;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "document_mime" text;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "document_size_bytes" integer;