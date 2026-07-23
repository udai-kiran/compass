ALTER TYPE "public"."account_type" ADD VALUE 'nps' BEFORE 'home_loan_od';--> statement-breakpoint
CREATE TABLE "account_nps_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"pran" text DEFAULT '' NOT NULL,
	"tier" "nps_tier" DEFAULT 'tier_i' NOT NULL,
	"equity_pct" integer DEFAULT 0 NOT NULL,
	"corporate_pct" integer DEFAULT 0 NOT NULL,
	"govt_pct" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "account_nps_details" ADD CONSTRAINT "account_nps_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "account_nps_details" ADD CONSTRAINT "account_nps_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;