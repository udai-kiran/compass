CREATE TYPE "public"."resource_kind" AS ENUM('vehicle', 'electricity', 'mobile', 'internet', 'gas', 'water', 'other');--> statement-breakpoint
CREATE TABLE "resources" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "resource_kind" NOT NULL,
	"name" text NOT NULL,
	"identifier" text DEFAULT '' NOT NULL,
	"provider" text DEFAULT '' NOT NULL,
	"plan_name" text DEFAULT '' NOT NULL,
	"details" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "resource_id" uuid;--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "recurring_template_id" uuid;--> statement-breakpoint
ALTER TABLE "resources" ADD CONSTRAINT "resources_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "resources_user_kind_idx" ON "resources" USING btree ("user_id","kind","name");--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_templates" ADD CONSTRAINT "recurring_templates_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_resource_id_resources_id_fk" FOREIGN KEY ("resource_id") REFERENCES "public"."resources"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_recurring_template_id_recurring_templates_id_fk" FOREIGN KEY ("recurring_template_id") REFERENCES "public"."recurring_templates"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_resource_idx" ON "transactions" USING btree ("resource_id");--> statement-breakpoint
CREATE INDEX "transactions_recurring_template_idx" ON "transactions" USING btree ("recurring_template_id");