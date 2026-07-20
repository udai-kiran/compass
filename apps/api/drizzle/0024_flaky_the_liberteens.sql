CREATE TABLE "insurance_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"kind" "insurance_kind" DEFAULT 'life' NOT NULL,
	"vehicle_type" "vehicle_kind",
	"insurer" text DEFAULT '' NOT NULL,
	"policy_number" text DEFAULT '' NOT NULL,
	"sum_assured_paise" bigint DEFAULT 0 NOT NULL,
	"bonus_paise" bigint DEFAULT 0 NOT NULL,
	"premium_paise" bigint DEFAULT 0 NOT NULL,
	"premium_frequency" "premium_frequency" DEFAULT 'yearly' NOT NULL,
	"start_date" date,
	"renewal_date" date,
	"maturity_date" date,
	"nominee" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "transactions" ADD COLUMN "policy_id" uuid;--> statement-breakpoint
ALTER TABLE "insurance_policies" ADD CONSTRAINT "insurance_policies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "insurance_policies_user_idx" ON "insurance_policies" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "transactions" ADD CONSTRAINT "transactions_policy_id_insurance_policies_id_fk" FOREIGN KEY ("policy_id") REFERENCES "public"."insurance_policies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transactions_policy_idx" ON "transactions" USING btree ("policy_id");