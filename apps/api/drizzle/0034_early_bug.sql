CREATE TABLE "card_issuer_settings" (
	"user_id" uuid NOT NULL,
	"institution" text NOT NULL,
	"credit_limit_paise" bigint DEFAULT 0 NOT NULL,
	"utilization_alert_pct" integer DEFAULT 30,
	"remind_days" integer DEFAULT 3 NOT NULL,
	"bill_mobile" text DEFAULT '' NOT NULL,
	"statement_password_enc" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "card_issuer_settings_user_id_institution_pk" PRIMARY KEY("user_id","institution")
);
--> statement-breakpoint
ALTER TABLE "card_issuer_settings" ADD CONSTRAINT "card_issuer_settings_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
-- Backfill issuer settings from existing per-card details before dropping those
-- columns. Credit limit and the other shared fields move up to the bank level:
-- one row per (user, institution), donated by that bank's highest-limit card.
-- Cards with no institution have nowhere to move to and are left behind (assign
-- a bank to keep their limit/password/mobile).
INSERT INTO "card_issuer_settings" (
	"user_id", "institution", "credit_limit_paise",
	"utilization_alert_pct", "remind_days", "bill_mobile", "statement_password_enc"
)
SELECT DISTINCT ON (a."user_id", a."institution")
	a."user_id", a."institution", cd."credit_limit_paise",
	cd."utilization_alert_pct", cd."remind_days", cd."bill_mobile", cd."statement_password_enc"
FROM "card_details" cd
JOIN "accounts" a ON a."id" = cd."account_id"
WHERE a."institution" IS NOT NULL AND a."institution" <> ''
ORDER BY a."user_id", a."institution", cd."credit_limit_paise" DESC;--> statement-breakpoint
ALTER TABLE "card_details" DROP COLUMN "bill_mobile";--> statement-breakpoint
ALTER TABLE "card_details" DROP COLUMN "statement_password_enc";--> statement-breakpoint
ALTER TABLE "card_details" DROP COLUMN "credit_limit_paise";--> statement-breakpoint
ALTER TABLE "card_details" DROP COLUMN "utilization_alert_pct";--> statement-breakpoint
ALTER TABLE "card_details" DROP COLUMN "remind_days";