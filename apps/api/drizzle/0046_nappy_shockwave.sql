CREATE TYPE "public"."sip_status" AS ENUM('active', 'paused');--> statement-breakpoint
CREATE TYPE "public"."sip_target_kind" AS ENUM('mf_folio', 'account');--> statement-breakpoint
CREATE TABLE "sips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"source_account_id" uuid NOT NULL,
	"target_kind" "sip_target_kind" NOT NULL,
	"target_holding_id" uuid,
	"target_account_id" uuid,
	"amount_paise" bigint NOT NULL,
	"day_of_month" integer NOT NULL,
	"status" "sip_status" DEFAULT 'active' NOT NULL,
	"start_date" date NOT NULL,
	"end_date" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_source_account_id_accounts_id_fk" FOREIGN KEY ("source_account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_target_holding_id_holdings_id_fk" FOREIGN KEY ("target_holding_id") REFERENCES "public"."holdings"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sips" ADD CONSTRAINT "sips_target_account_id_accounts_id_fk" FOREIGN KEY ("target_account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "sips_user_idx" ON "sips" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "sips_goal_idx" ON "sips" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "sips_source_account_idx" ON "sips" USING btree ("source_account_id");