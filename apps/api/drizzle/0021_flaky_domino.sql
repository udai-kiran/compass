DO $$
BEGIN
	CREATE TYPE "public"."ai_provider" AS ENUM('none', 'anthropic', 'ollama', 'openrouter', 'deepseek', 'custom');
EXCEPTION
	WHEN duplicate_object THEN NULL;
END
$$;--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "ai_settings" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"provider" "ai_provider" DEFAULT 'none' NOT NULL,
	"api_key_enc" text DEFAULT '' NOT NULL,
	"base_url" text DEFAULT '' NOT NULL,
	"model" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
DO $$
BEGIN
	ALTER TABLE "ai_settings" ADD CONSTRAINT "ai_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN NULL;
END
$$;
