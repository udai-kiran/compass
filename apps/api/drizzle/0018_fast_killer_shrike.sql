CREATE TABLE "projection_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"equity_return_bps" integer DEFAULT 1200 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "projection_settings" ADD CONSTRAINT "projection_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;