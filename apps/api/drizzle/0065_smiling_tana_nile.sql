ALTER TABLE "user_tasks" ADD COLUMN "source" text DEFAULT 'user' NOT NULL;--> statement-breakpoint
ALTER TABLE "user_tasks" ADD COLUMN "source_key" text;--> statement-breakpoint
CREATE UNIQUE INDEX "user_tasks_source_key_idx" ON "user_tasks" USING btree ("user_id","source_key") WHERE "user_tasks"."source_key" is not null;--> statement-breakpoint
ALTER TABLE "user_tasks" ADD CONSTRAINT "user_tasks_source_check" CHECK ("user_tasks"."source" in ('user', 'card-due'));