ALTER TYPE "public"."ai_event_kind" ADD VALUE 'payslip_parse';--> statement-breakpoint
CREATE TABLE "payslip_components" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"payslip_id" uuid NOT NULL,
	"raw_label" text NOT NULL,
	"canonical_kind" text NOT NULL,
	"category" text NOT NULL,
	"current_paise" bigint NOT NULL,
	"ytd_paise" bigint,
	"source_quote" text,
	"confidence" real,
	"display_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "payslips" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"fy" text NOT NULL,
	"pay_month" text NOT NULL,
	"employer_name" text,
	"document_key" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"gross_paise" bigint,
	"net_paise" bigint,
	"tds_current_paise" bigint,
	"tds_ytd_paise" bigint,
	"accepted_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "payslip_components" ADD CONSTRAINT "payslip_components_payslip_id_payslips_id_fk" FOREIGN KEY ("payslip_id") REFERENCES "public"."payslips"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "payslips" ADD CONSTRAINT "payslips_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "payslip_components_payslip_idx" ON "payslip_components" USING btree ("payslip_id");--> statement-breakpoint
CREATE INDEX "payslips_user_fy_status_idx" ON "payslips" USING btree ("user_id","fy","status");--> statement-breakpoint
CREATE UNIQUE INDEX "payslips_user_month_employer_idx" ON "payslips" USING btree ("user_id","pay_month","employer_name");