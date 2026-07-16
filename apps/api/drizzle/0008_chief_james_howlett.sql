CREATE TYPE "public"."bank_account_subtype" AS ENUM('savings', 'current', 'salary', 'nre', 'nro');--> statement-breakpoint
CREATE TABLE "bank_details" (
	"account_id" uuid PRIMARY KEY NOT NULL,
	"user_id" uuid NOT NULL,
	"account_number" text DEFAULT '' NOT NULL,
	"ifsc" text DEFAULT '' NOT NULL,
	"branch" text DEFAULT '' NOT NULL,
	"subtype" "bank_account_subtype",
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "holder_name" text;--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "upi_ids" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_details" ADD CONSTRAINT "bank_details_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;