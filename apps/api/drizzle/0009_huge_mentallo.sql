ALTER TYPE "public"."account_type" ADD VALUE 'home_loan_od';--> statement-breakpoint
CREATE TABLE "overdraft_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"sanctioned_limit_paise" bigint DEFAULT 0 NOT NULL,
	"annual_rate_bps" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "overdraft_details" ADD CONSTRAINT "overdraft_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "overdraft_details" ADD CONSTRAINT "overdraft_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;