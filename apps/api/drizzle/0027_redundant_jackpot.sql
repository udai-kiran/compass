ALTER TABLE "accounts" ADD COLUMN "nominee" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "nominee_person_id" uuid;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "nominee" text DEFAULT '' NOT NULL;--> statement-breakpoint
ALTER TABLE "holdings" ADD COLUMN "nominee_person_id" uuid;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_nominee_person_id_family_members_id_fk" FOREIGN KEY ("nominee_person_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "holdings" ADD CONSTRAINT "holdings_nominee_person_id_family_members_id_fk" FOREIGN KEY ("nominee_person_id") REFERENCES "public"."family_members"("id") ON DELETE set null ON UPDATE no action;